#!/usr/bin/env -S npx tsx
/**
 * Backfill cluster scans for all human-verified Ethos profiles.
 *
 * Usage:
 *   npx tsx scripts/backfill/scan-verified.ts --owner=PROFILE_ID [flags]
 *
 * Flags:
 *   --owner=N        Profile ID to credit as owner on new investigations (required)
 *   --limit=N        Stop after N profiles (pilot mode; default: all)
 *   --twitter        Run Scan-all-candidates for each scan (costs twitterapi.io credits)
 *   --force          Re-scan even if a recent investigation already exists
 *   --skip-days=N    Skip if last scanned within N days (default: 7)
 *   --dry-run        Print what would be scanned and exit
 *   --pace-ms=N      Min delay between Twitter calls (default: 1500)
 *
 * Bypasses HTTP/auth entirely — calls runClusterScan + searchTweets
 * + saveInvestigation directly with the service-key DB connection.
 */

import { resolve } from "path";
import { writeFileSync, mkdirSync, existsSync, appendFileSync } from "fs";

// Match scripts/monitoring/daily.ts — process.loadEnvFile is the built-in
// Node 22+ replacement for dotenv. Silent no-op if the file is missing.
try {
  process.loadEnvFile(".env.local");
} catch {
  // intentional: ok if running in an env that injects vars directly
}

import { getSupabase } from "@/lib/db/supabase";
import { runClusterScan } from "@/lib/cluster-scanner";
import { saveInvestigation } from "@/lib/db/investigations";
import { searchTweets, TwitterSearchError } from "@/lib/twitter-search";

interface CliFlags {
  owner: number | null;
  limit: number | null;
  twitter: boolean;
  force: boolean;
  skipDays: number;
  dryRun: boolean;
  paceMs: number;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    owner: null,
    limit: null,
    twitter: false,
    force: false,
    skipDays: 7,
    dryRun: false,
    paceMs: 1500,
  };
  for (const arg of argv) {
    if (arg === "--twitter") flags.twitter = true;
    else if (arg === "--force") flags.force = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("--owner=")) flags.owner = Number(arg.slice("--owner=".length));
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--skip-days=")) flags.skipDays = Number(arg.slice("--skip-days=".length));
    else if (arg.startsWith("--pace-ms=")) flags.paceMs = Number(arg.slice("--pace-ms=".length));
  }
  return flags;
}

interface VerifiedProfile {
  profileId: number;
  address: string;
  displayName: string | null;
  username: string | null;
}

async function loadVerifiedProfiles(): Promise<VerifiedProfile[]> {
  const supabase = getSupabase();
  // Paginate — Supabase REST caps at 1000/page by default.
  const all: VerifiedProfile[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("profile_latest")
      .select("profile_id, primary_address, display_name, username")
      .eq("human_verified", true)
      .not("primary_address", "is", null)
      .order("profile_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`profile_latest fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as {
      profile_id: number;
      primary_address: string | null;
      display_name: string | null;
      username: string | null;
    }[]) {
      if (!row.primary_address) continue;
      all.push({
        profileId: row.profile_id,
        address: row.primary_address.toLowerCase(),
        displayName: row.display_name,
        username: row.username,
      });
    }
    if (data.length < PAGE) break;
  }
  return all;
}

async function loadExistingScans(
  ids: string[]
): Promise<Map<string, { updatedAt: string; hasTwitter: boolean }>> {
  const supabase = getSupabase();
  const out = new Map<string, { updatedAt: string; hasTwitter: boolean }>();
  // Batch in chunks of 100 to keep the IN clause manageable.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data } = await supabase
      .from("investigations")
      .select("id, updated_at, twitter_evidence")
      .in("id", chunk);
    for (const row of (data ?? []) as {
      id: string;
      updated_at: string;
      twitter_evidence: Record<string, unknown> | null;
    }[]) {
      out.set(row.id, {
        updatedAt: row.updated_at,
        hasTwitter:
          row.twitter_evidence !== null &&
          row.twitter_evidence !== undefined &&
          Object.keys(row.twitter_evidence).length > 0,
      });
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.owner === null || !Number.isFinite(flags.owner)) {
    console.error("ERROR: --owner=PROFILE_ID required (the profile to credit as owner on new rows)");
    process.exit(2);
  }

  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const logDir = resolve(process.cwd(), "scripts/backfill/logs");
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = resolve(logDir, `run-${stamp}.jsonl`);
  writeFileSync(logPath, "", { flag: "w" });
  const log = (event: Record<string, unknown>) => {
    const line = JSON.stringify({ t: new Date().toISOString(), ...event });
    appendFileSync(logPath, line + "\n");
  };

  console.log(`[backfill] log → ${logPath}`);
  console.log(`[backfill] flags`, flags);

  console.log("[backfill] loading verified profiles…");
  const profiles = await loadVerifiedProfiles();
  console.log(`[backfill] ${profiles.length} verified profiles with primary_address`);

  const ids = profiles.map((p) => `scan-${p.address}`);
  const existing = await loadExistingScans(ids);

  const skipThresholdMs = flags.skipDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const queue: VerifiedProfile[] = [];
  let skipFresh = 0;
  let skipTwitter = 0;
  for (const p of profiles) {
    const id = `scan-${p.address}`;
    const ex = existing.get(id);
    if (!flags.force && ex) {
      const age = now - new Date(ex.updatedAt).getTime();
      const isFresh = age < skipThresholdMs;
      // If we're not also doing Twitter, a fresh cluster scan is enough.
      // If we ARE doing Twitter, also skip if twitter evidence already exists.
      if (isFresh && (!flags.twitter || ex.hasTwitter)) {
        if (flags.twitter && ex.hasTwitter) skipTwitter += 1;
        else skipFresh += 1;
        continue;
      }
    }
    queue.push(p);
  }

  console.log(
    `[backfill] queue: ${queue.length} · skip-fresh: ${skipFresh}` +
      (flags.twitter ? ` · skip-twitter-done: ${skipTwitter}` : "")
  );

  if (flags.limit !== null && Number.isFinite(flags.limit)) {
    queue.length = Math.min(queue.length, flags.limit);
    console.log(`[backfill] limited to first ${queue.length}`);
  }

  if (flags.dryRun) {
    console.log("[backfill] dry-run; would process:");
    for (const p of queue.slice(0, 20)) {
      console.log(`  - ${p.profileId} ${p.address} ${p.username ?? ""}`);
    }
    if (queue.length > 20) console.log(`  … and ${queue.length - 20} more`);
    log({ event: "dry-run", count: queue.length });
    return;
  }

  let ok = 0;
  let failed = 0;
  let tweetsFetched = 0;

  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    const id = `scan-${p.address}`;
    const tag = `[${i + 1}/${queue.length}] ${p.username ?? p.address.slice(0, 10)}`;
    console.log(`${tag} scanning ${p.address}…`);

    const scanStart = Date.now();
    try {
      const result = await runClusterScan(p.address);
      const scanDurationMs = Date.now() - scanStart;

      const candidates = [...result.strongCluster, ...result.possibleCluster];
      let twitterEvidence: Record<string, unknown> | undefined;

      if (flags.twitter) {
        twitterEvidence = {};
        const targets = [p.address, ...candidates.map((c) => c.address)];
        for (let j = 0; j < targets.length; j++) {
          const addr = targets[j];
          if (j > 0) await sleep(flags.paceMs);
          try {
            const t = await searchTweets(addr);
            twitterEvidence[addr] = t;
            tweetsFetched += t.tweets.length;
          } catch (err) {
            const msg = err instanceof TwitterSearchError ? err.message : String(err);
            console.warn(`${tag}   twitter ${addr} failed: ${msg}`);
            log({ event: "twitter-fail", id, address: addr, error: msg });
          }
        }
      }

      // Serialize Set → array (matches /api/scan's serialization)
      const serialized = {
        ...result,
        strongCluster: result.strongCluster.map((c) => ({
          ...c,
          signalTypes: [...c.signalTypes],
        })),
        possibleCluster: result.possibleCluster.map((c) => ({
          ...c,
          signalTypes: [...c.signalTypes],
        })),
      };

      await saveInvestigation({
        id,
        target: p.address,
        targetName: p.displayName,
        clusterResult: serialized,
        aiAnalysis: null,
        ownerProfileId: flags.owner!,
        scanDurationMs,
        twitterEvidence,
      });

      ok += 1;
      console.log(
        `${tag} done · strong=${result.strongCluster.length} possible=${result.possibleCluster.length} · ${(scanDurationMs / 1000).toFixed(1)}s`
      );
      log({
        event: "ok",
        id,
        profileId: p.profileId,
        address: p.address,
        strong: result.strongCluster.length,
        possible: result.possibleCluster.length,
        scanDurationMs,
        twitter: flags.twitter,
      });
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} FAILED: ${msg}`);
      log({ event: "fail", id, profileId: p.profileId, address: p.address, error: msg });
    }
  }

  const elapsedSec = Math.round((Date.now() - startedAt.getTime()) / 1000);
  console.log(
    `\n[backfill] done · ok=${ok} failed=${failed}` +
      (flags.twitter ? ` · tweets=${tweetsFetched}` : "") +
      ` · elapsed=${elapsedSec}s`
  );
  log({ event: "summary", ok, failed, tweetsFetched, elapsedSec });
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
