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

// process.loadEnvFile is the built-in Node 22+ replacement for dotenv.
// Silent no-op if the file is missing.
try {
  process.loadEnvFile(".env.local");
} catch {
  // intentional: ok if running in an env that injects vars directly
}

import { getSupabase } from "@/lib/db/supabase";
import { runClusterScan } from "@/lib/cluster-scanner";
import { MAX_WALLETS_PER_SCAN } from "@/lib/scan-target";
import { getContractFlags } from "@/lib/wallet-classify";
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
  /** Scan every profile with score > N instead of only human-verified ones. */
  minScore: number | null;
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
    minScore: null,
  };
  for (const arg of argv) {
    if (arg === "--twitter") flags.twitter = true;
    else if (arg === "--force") flags.force = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("--owner=")) flags.owner = Number(arg.slice("--owner=".length));
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--skip-days=")) flags.skipDays = Number(arg.slice("--skip-days=".length));
    else if (arg.startsWith("--pace-ms=")) flags.paceMs = Number(arg.slice("--pace-ms=".length));
    else if (arg.startsWith("--min-score=")) flags.minScore = Number(arg.slice("--min-score=".length));
  }
  return flags;
}

interface VerifiedProfile {
  profileId: number;
  address: string;
  /** Personal EOA wallets to scan (smart wallets excluded via is_contract). */
  wallets: string[];
  /** Every attested wallet incl. smart wallets, for self-exclusion. */
  allWallets: string[];
  displayName: string | null;
  username: string | null;
}

async function loadVerifiedProfiles(minScore: number | null): Promise<VerifiedProfile[]> {
  const supabase = getSupabase();
  // Paginate — Supabase REST caps at 1000/page by default.
  const all: VerifiedProfile[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("profile_latest")
      .select("profile_id, primary_address, display_name, username")
      .not("primary_address", "is", null);
    // --min-score selects by score; otherwise the default is human-verified.
    query = minScore !== null ? query.gt("score", minScore) : query.eq("human_verified", true);
    const { data, error } = await query
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
        wallets: [],
        allWallets: [],
        displayName: row.display_name,
        username: row.username,
      });
    }
    if (data.length < PAGE) break;
  }

  // Attach every attested wallet per profile.
  const pids = all.map((p) => p.profileId);
  const byPid = new Map(all.map((p) => [p.profileId, p]));
  for (let i = 0; i < pids.length; i += 200) {
    const chunk = pids.slice(i, i + 200);
    const { data, error } = await supabase
      .from("profile_addresses")
      .select("profile_id, address")
      .in("profile_id", chunk);
    if (error) throw new Error(`profile_addresses fetch failed: ${error.message}`);
    for (const row of (data ?? []) as { profile_id: number; address: string }[]) {
      const p = byPid.get(row.profile_id);
      const addr = row.address?.toLowerCase();
      if (p && addr && !p.allWallets.includes(addr)) p.allWallets.push(addr);
    }
  }

  // Classify all wallets as EOA vs smart-contract (cache-backed, live fallback
  // for any not yet in is_contract) so this run is correct even while the
  // classification backfill is still in progress. Scan only EOAs; keep smart
  // wallets in allWallets for self-exclusion.
  const everyWallet = [...new Set(all.flatMap((p) => p.allWallets))];
  const flags = await getContractFlags(everyWallet);
  for (const p of all) {
    p.wallets = p.allWallets.filter((w) => !flags.get(w));
    // Prefer an EOA as primary/target; fall back if the profile has only
    // smart wallets so it's still coverable.
    if (p.wallets.length === 0) p.wallets = p.allWallets.length ? [p.allWallets[0]] : [p.address];
    if (!p.wallets.includes(p.address)) p.address = p.wallets[0];
    if (p.allWallets.length === 0) p.allWallets = [...p.wallets];
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

  const cohort = flags.minScore !== null ? `profiles with score > ${flags.minScore}` : "human-verified profiles";
  console.log(`[backfill] loading ${cohort}…`);
  const profiles = await loadVerifiedProfiles(flags.minScore);
  console.log(`[backfill] ${profiles.length} ${cohort} with primary_address`);

  const ids = profiles.map((p) => `scan-p${p.profileId}`);
  const existing = await loadExistingScans(ids);

  const skipThresholdMs = flags.skipDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const queue: VerifiedProfile[] = [];
  let skipFresh = 0;
  let skipTwitter = 0;
  for (const p of profiles) {
    const id = `scan-p${p.profileId}`;
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
    const id = `scan-p${p.profileId}`;
    const tag = `[${i + 1}/${queue.length}] ${p.username ?? p.address.slice(0, 10)}`;
    console.log(`${tag} scanning ${p.address}${p.wallets.length > 1 ? ` (+${p.wallets.length - 1} wallets)` : ""}…`);

    const scanStart = Date.now();
    try {
      const result = await runClusterScan({
        profileId: p.profileId,
        wallets: p.wallets.slice(0, MAX_WALLETS_PER_SCAN),
        allWallets: p.allWallets,
        primaryWallet: p.address,
      });
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
        ownerProfileId: flags.owner!,
        profileId: p.profileId,
        targetWallets: p.wallets,
        // Automated scan — show no personal "Scanned by" attribution.
        scannedByProfileId: null,
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

  await runVerifiedInVerifiedReport(stamp, log);
}

/**
 * Walk every stored investigation whose target is a currently-verified
 * profile and report the ones whose strong/possible cluster contains
 * another verified profile. Source of truth for verification is the
 * fresh profile_latest snapshot, not the (possibly stale) humanVerified
 * flags baked into cluster_result at scan time.
 */
async function runVerifiedInVerifiedReport(
  stamp: string,
  log: (event: Record<string, unknown>) => void
) {
  const supabase = getSupabase();
  console.log(`\n[report] verified-in-verified pass…`);

  // 1) Load verified profile_id set + address→profile_id map.
  const verifiedProfileIds = new Set<number>();
  const verifiedAddresses = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("profile_latest")
      .select("profile_id, primary_address")
      .eq("human_verified", true)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`profile_latest verified fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as { profile_id: number; primary_address: string | null }[]) {
      verifiedProfileIds.add(row.profile_id);
      if (row.primary_address) verifiedAddresses.add(row.primary_address.toLowerCase());
    }
    if (data.length < PAGE) break;
  }
  console.log(`[report] ${verifiedProfileIds.size} verified profiles · ${verifiedAddresses.size} with primary address`);

  // 2) Page investigations and filter on the fly. cluster_result is large
  //    (~15 KB/row) so pull only what we need and stream.
  type CandidateLite = {
    address: string;
    ethosProfile?: { profileId?: number; humanVerified?: boolean; displayName?: string; username?: string | null; score?: number };
    signalTypes?: string[];
  };
  type ClusterResultLite = {
    targetProfileId?: number | null;
    targetEthos?: { profileId?: number; humanVerified?: boolean; displayName?: string; username?: string | null };
    strongCluster?: CandidateLite[];
    possibleCluster?: CandidateLite[];
  };

  interface Match {
    id: string;
    target: string;
    targetProfileId: number;
    targetDisplay: string;
    targetUsername: string | null;
    strongVerified: { profileId: number; displayName: string; username: string | null; score: number; signalTypes: string[] }[];
    possibleVerified: { profileId: number; displayName: string; username: string | null; score: number; signalTypes: string[] }[];
  }
  const matches: Match[] = [];

  const ROW_PAGE = 200;
  let scanned = 0;
  for (let from = 0; ; from += ROW_PAGE) {
    const { data, error } = await supabase
      .from("investigations")
      .select("id, target, profile_id, cluster_result")
      .range(from, from + ROW_PAGE - 1);
    if (error) throw new Error(`investigations fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as { id: string; target: string; profile_id: number | null; cluster_result: unknown }[]) {
      scanned += 1;
      // Verification is decided by the target's profile id — profile-keyed
      // rows may have a non-primary wallet as target, so an address gate
      // would drop them. Prefer the persisted profile_id column, then the
      // in-result targetProfileId, then targetEthos (which can be undefined
      // when the bulk Ethos lookup missed at scan time).
      const cr = (typeof row.cluster_result === "string"
        ? JSON.parse(row.cluster_result)
        : row.cluster_result) as ClusterResultLite | null;
      if (!cr) continue;

      const targetPid = row.profile_id ?? cr.targetProfileId ?? cr.targetEthos?.profileId;
      if (!targetPid || !verifiedProfileIds.has(targetPid)) continue;

      const collect = (list: CandidateLite[] | undefined) =>
        (list ?? [])
          .filter((c) => {
            const pid = c.ethosProfile?.profileId;
            return pid !== undefined && pid !== targetPid && verifiedProfileIds.has(pid);
          })
          .map((c) => ({
            profileId: c.ethosProfile!.profileId!,
            displayName: c.ethosProfile?.displayName ?? "",
            username: c.ethosProfile?.username ?? null,
            score: c.ethosProfile?.score ?? 0,
            signalTypes: c.signalTypes ?? [],
          }));

      const strongVerified = collect(cr.strongCluster);
      const possibleVerified = collect(cr.possibleCluster);
      if (strongVerified.length === 0 && possibleVerified.length === 0) continue;

      matches.push({
        id: row.id,
        target: row.target,
        targetProfileId: targetPid,
        targetDisplay: cr.targetEthos?.displayName ?? "",
        targetUsername: cr.targetEthos?.username ?? null,
        strongVerified,
        possibleVerified,
      });
    }
    if (data.length < ROW_PAGE) break;
  }

  // 3) Rank: strong matches first, then possible. Within each, by count desc.
  matches.sort((a, b) => {
    const sd = b.strongVerified.length - a.strongVerified.length;
    if (sd !== 0) return sd;
    return b.possibleVerified.length - a.possibleVerified.length;
  });

  const reportDir = resolve(process.cwd(), "scripts/backfill/logs");
  const reportPath = resolve(reportDir, `verified-in-verified-${stamp}.jsonl`);
  writeFileSync(reportPath, "", { flag: "w" });
  for (const m of matches) appendFileSync(reportPath, JSON.stringify(m) + "\n");

  const strongHits = matches.filter((m) => m.strongVerified.length > 0).length;
  console.log(
    `[report] scanned=${scanned} · matches=${matches.length} (strong=${strongHits}) → ${reportPath}`
  );
  log({ event: "verified-in-verified", scanned, matches: matches.length, strong: strongHits, path: reportPath });

  // Console preview: top 20 strong-cluster matches.
  const preview = matches.filter((m) => m.strongVerified.length > 0).slice(0, 20);
  if (preview.length > 0) {
    console.log(`\n[report] top ${preview.length} strong-cluster matches:`);
    for (const m of preview) {
      const label = m.targetUsername ?? m.targetDisplay ?? m.target.slice(0, 10);
      const members = m.strongVerified
        .slice(0, 5)
        .map((v) => v.username ?? v.displayName ?? String(v.profileId))
        .join(", ");
      const more = m.strongVerified.length > 5 ? ` +${m.strongVerified.length - 5}` : "";
      console.log(`  ${m.strongVerified.length}× ${label} ← ${members}${more}  [${m.id}]`);
    }
  }
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
