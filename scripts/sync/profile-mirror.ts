#!/usr/bin/env -S npx tsx
/**
 * Sync the local Ethos profile mirror (profile_latest, profile_addresses)
 * from the public Ethos API.
 *
 * The scanner discovers cluster candidates by matching on-chain
 * counterparties against profile_addresses, so a stale mirror means newly
 * attested wallets can never surface as connections. This replaces the
 * Postgres-replica job removed in Aug 2026; the public API needs no DB
 * credentials or IP allowlisting.
 *
 * Usage:
 *   npx tsx scripts/sync/profile-mirror.ts [--dry-run] [--from=<id>]
 *
 *   --dry-run  fetch and diff, write nothing
 *   --from=N   start at profile id N instead of 1 (incremental refresh of
 *              recent profiles; default is a full pass, ~2 minutes)
 *
 * Walks profile ids in batches of 500 until it has gone well past the last
 * id that returned anything. For every ACTIVE profile it upserts the
 * profile_latest row and the (profile_id, address) pairs, and removes
 * address rows the profile no longer attests (fixes the old append-only
 * drift). is_contract on new rows is left null; run
 * scripts/backfill/classify-wallets.ts afterwards to classify them.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // intentional: CI injects env directly
}

import { getSupabase } from "@/lib/db/supabase";
import {
  fetchProfilesByIds,
  getWalletAddresses,
  PROFILE_ID_BATCH_SIZE,
  type EthosProfile,
} from "@/lib/ethos";

const DRY_RUN = process.argv.includes("--dry-run");
const fromArg = process.argv.find((a) => a.startsWith("--from="));
const FROM_ID = fromArg ? Math.max(1, parseInt(fromArg.slice(7), 10) || 1) : 1;

/** Stop once this many consecutive batches (×500 ids) return nothing. */
const EMPTY_BATCHES_TO_STOP = 6;
const CONCURRENCY = 4;
const WRITE_CHUNK = 500;
const RETRIES = 4;

async function fetchBatchWithRetry(ids: number[]): Promise<EthosProfile[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await fetchProfilesByIds(ids);
    } catch (err) {
      lastErr = err;
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 10000);
      console.warn(`  batch ${ids[0]}-${ids[ids.length - 1]} failed (${attempt}/${RETRIES}): ${err instanceof Error ? err.message : String(err)}; retrying in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

interface LatestRow {
  profile_id: number;
  score: number | null;
  xp_total: number | null;
  human_verified: boolean;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  primary_address: string | null;
  last_seen: string;
}

async function upsertChunks<T>(table: string, rows: T[], onConflict: string, ignoreDuplicates = false) {
  const supabase = getSupabase();
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict, ignoreDuplicates });
    if (error) throw new Error(`upsert ${table} failed: ${error.message}`);
  }
}

/** All existing (profile_id, address) rows, keyed by profile id. */
async function loadExistingAddresses(): Promise<Map<number, Set<string>>> {
  const supabase = getSupabase();
  const byProfile = new Map<number, Set<string>>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("profile_addresses")
      .select("profile_id, address")
      .order("profile_id", { ascending: true })
      .order("address", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`profile_addresses fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as { profile_id: number; address: string }[]) {
      let set = byProfile.get(r.profile_id);
      if (!set) byProfile.set(r.profile_id, (set = new Set()));
      set.add(r.address.toLowerCase());
    }
    if (data.length < PAGE) break;
  }
  return byProfile;
}

async function main() {
  const supabase = getSupabase();
  const startedAt = Date.now();
  let runId: number | null = null;
  if (!DRY_RUN) {
    const { data } = await supabase
      .from("monitoring_runs")
      .insert({ status: "running" })
      .select("id")
      .single();
    runId = (data as { id: number } | null)?.id ?? null;
  }

  try {
    console.log(`[sync] profile mirror from id ${FROM_ID}${DRY_RUN ? " [DRY RUN]" : ""}`);

    // --- Fetch every profile from the API -------------------------------
    const profiles: EthosProfile[] = [];
    let nextId = FROM_ID;
    let emptyStreak = 0;
    let batches = 0;
    while (emptyStreak < EMPTY_BATCHES_TO_STOP) {
      const group: number[][] = [];
      for (let g = 0; g < CONCURRENCY; g++) {
        group.push(Array.from({ length: PROFILE_ID_BATCH_SIZE }, (_, i) => nextId + i));
        nextId += PROFILE_ID_BATCH_SIZE;
      }
      const results = await Promise.all(group.map(fetchBatchWithRetry));
      for (const r of results) {
        batches++;
        if (r.length === 0) emptyStreak++;
        else {
          emptyStreak = 0;
          profiles.push(...r);
        }
      }
      if (batches % 20 === 0) console.log(`[sync] ${batches} batches, ${profiles.length} profiles so far (next id ${nextId})`);
    }
    const active = profiles.filter((p) => p.profileId && p.status === "ACTIVE");
    console.log(`[sync] ${profiles.length} profiles fetched in ${batches} batches; ${active.length} active`);

    // --- Build rows ------------------------------------------------------
    const nowIso = new Date().toISOString();
    const latestRows: LatestRow[] = [];
    const current = new Map<number, Set<string>>();
    for (const p of active) {
      const wallets = getWalletAddresses(p);
      current.set(p.profileId!, new Set(wallets));
      latestRows.push({
        profile_id: p.profileId!,
        score: p.score ?? null,
        xp_total: p.xpTotal ?? null,
        human_verified: p.humanVerificationStatus === "VERIFIED",
        display_name: p.displayName ?? null,
        username: p.username ?? null,
        avatar_url: p.avatarUrl ?? null,
        primary_address: wallets[0] ?? null,
        last_seen: nowIso,
      });
    }
    const addressRows = [...current].flatMap(([profile_id, set]) =>
      [...set].map((address) => ({ profile_id, address }))
    );

    // --- Diff against the mirror ------------------------------------------
    console.log("[sync] loading existing profile_addresses…");
    const existing = await loadExistingAddresses();
    const toAdd = addressRows.filter((r) => !existing.get(r.profile_id)?.has(r.address));
    const toRemove: { profile_id: number; address: string }[] = [];
    for (const [pid, set] of current) {
      for (const addr of existing.get(pid) ?? []) {
        if (!set.has(addr)) toRemove.push({ profile_id: pid, address: addr });
      }
    }
    const newProfiles = latestRows.filter((r) => !existing.has(r.profile_id)).length;
    console.log(
      `[sync] profile_latest upserts=${latestRows.length} (new=${newProfiles}) · addresses add=${toAdd.length} remove=${toRemove.length}`
    );

    if (DRY_RUN) {
      console.log("[sync] dry run, nothing written");
      return;
    }

    // --- Write -----------------------------------------------------------
    await upsertChunks("profile_latest", latestRows, "profile_id");
    // ignoreDuplicates keeps is_contract on rows that already exist.
    await upsertChunks("profile_addresses", toAdd, "profile_id,address", true);
    const removeByProfile = new Map<number, string[]>();
    for (const r of toRemove) {
      removeByProfile.set(r.profile_id, [...(removeByProfile.get(r.profile_id) ?? []), r.address]);
    }
    for (const [pid, addrs] of removeByProfile) {
      const { error } = await supabase.from("profile_addresses").delete().eq("profile_id", pid).in("address", addrs);
      if (error) throw new Error(`profile_addresses delete failed: ${error.message}`);
    }

    const rowsWritten = latestRows.length + toAdd.length + toRemove.length;
    if (runId !== null) {
      await supabase
        .from("monitoring_runs")
        .update({ status: "success", finished_at: new Date().toISOString(), rows_written: rowsWritten, duration_ms: Date.now() - startedAt })
        .eq("id", runId);
    }
    console.log(`[sync] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s · ${rowsWritten} rows written`);
  } catch (err) {
    if (runId !== null) {
      await supabase
        .from("monitoring_runs")
        .update({ status: "failed", finished_at: new Date().toISOString(), error_message: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - startedAt })
        .eq("id", runId);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("[sync] fatal:", err);
  process.exit(1);
});
