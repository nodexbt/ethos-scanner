#!/usr/bin/env -S npx tsx
/**
 * One-off migration: re-key investigations from per-address ids
 * (`scan-<address>`) to per-profile ids (`scan-p<profileId>`), merging
 * duplicate rows that belong to the same Ethos profile (a profile with
 * two attested wallets used to get two separate investigations).
 *
 * Usage:
 *   npx tsx scripts/backfill/migrate-profile-ids.ts [--dry-run]
 *
 * Rules:
 *   - Address rows whose target isn't in profile_addresses stay untouched
 *     (unattested-wallet scans keep the legacy key).
 *   - One row per profile: re-key it and set profile_id/target_wallets.
 *   - Multiple rows per profile: canonical = existing `scan-p` row if one
 *     exists, else the row with a share_id, else most strong_count, else
 *     newest. Losers' twitter_evidence is merged into the canonical row
 *     (canonical entries win), then losers are DELETED — except a loser
 *     that has its own share_id when the canonical also has one: that row
 *     is kept as-is (legacy key, no profile_id) so its share link keeps
 *     resolving; these are logged for manual review.
 *
 * Idempotent: already-migrated rows (scan-p ids) pass through unchanged.
 * Requires scripts/migrations/2026-07-03-profile-investigations.sql first.
 */

import { resolve } from "path";
import { writeFileSync, mkdirSync, existsSync, appendFileSync } from "fs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // intentional: ok if running in an env that injects vars directly
}

import { getSupabase } from "@/lib/db/supabase";

const DRY_RUN = process.argv.includes("--dry-run");

interface InvRow {
  id: string;
  target: string;
  profile_id: number | null;
  share_id: string | null;
  strong_count: number | null;
  updated_at: string;
}

async function loadInvestigations(): Promise<InvRow[]> {
  const supabase = getSupabase();
  const all: InvRow[] = [];
  const PAGE = 1000;
  // profile_id only exists after the 2026-07-03 migration; fall back to a
  // column list without it so --dry-run can preview the merge beforehand.
  let columns = "id, target, profile_id, share_id, strong_count, updated_at";
  for (let from = 0; ; from += PAGE) {
    let { data, error } = await supabase
      .from("investigations")
      .select(columns)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error && /profile_id/.test(error.message)) {
      if (!DRY_RUN) {
        throw new Error(
          "investigations.profile_id missing — run scripts/migrations/2026-07-03-profile-investigations.sql first"
        );
      }
      columns = "id, target, share_id, strong_count, updated_at";
      ({ data, error } = await supabase
        .from("investigations")
        .select(columns)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1));
    }
    if (error) throw new Error(`investigations fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as InvRow[]));
    if (data.length < PAGE) break;
  }
  return all;
}

/** address (lowercased) → profile_id, plus profile_id → all its addresses. */
async function loadProfileAddressMap(targets: string[]): Promise<{
  addrToPid: Map<string, number>;
  pidToAddrs: Map<number, string[]>;
}> {
  const supabase = getSupabase();
  const addrToPid = new Map<string, number>();
  const pids = new Set<number>();

  for (let i = 0; i < targets.length; i += 200) {
    const chunk = targets.slice(i, i + 200);
    const { data, error } = await supabase
      .from("profile_addresses")
      .select("profile_id, address")
      .in("address", chunk);
    if (error) throw new Error(`profile_addresses fetch failed: ${error.message}`);
    for (const row of (data ?? []) as { profile_id: number; address: string }[]) {
      addrToPid.set(row.address.toLowerCase(), row.profile_id);
      pids.add(row.profile_id);
    }
  }

  // Full wallet list per matched profile, for target_wallets.
  const pidToAddrs = new Map<number, string[]>();
  const pidList = [...pids];
  for (let i = 0; i < pidList.length; i += 200) {
    const chunk = pidList.slice(i, i + 200);
    const { data, error } = await supabase
      .from("profile_addresses")
      .select("profile_id, address")
      .in("profile_id", chunk);
    if (error) throw new Error(`profile_addresses by pid failed: ${error.message}`);
    for (const row of (data ?? []) as { profile_id: number; address: string }[]) {
      const list = pidToAddrs.get(row.profile_id) ?? [];
      list.push(row.address.toLowerCase());
      pidToAddrs.set(row.profile_id, list);
    }
  }

  return { addrToPid, pidToAddrs };
}

async function fetchTwitterEvidence(id: string): Promise<Record<string, unknown> | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("investigations")
    .select("twitter_evidence")
    .eq("id", id)
    .single();
  const ev = data?.twitter_evidence;
  if (!ev) return null;
  return typeof ev === "string" ? JSON.parse(ev) : (ev as Record<string, unknown>);
}

/** Canonical pick: existing scan-p row > has share_id > strong_count > newest. */
function pickCanonical(rows: InvRow[]): InvRow {
  return [...rows].sort((a, b) => {
    const aP = a.id.startsWith("scan-p") ? 1 : 0;
    const bP = b.id.startsWith("scan-p") ? 1 : 0;
    if (aP !== bP) return bP - aP;
    const aS = a.share_id ? 1 : 0;
    const bS = b.share_id ? 1 : 0;
    if (aS !== bS) return bS - aS;
    const sc = (b.strong_count ?? 0) - (a.strong_count ?? 0);
    if (sc !== 0) return sc;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  })[0];
}

async function main() {
  const supabase = getSupabase();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logDir = resolve(process.cwd(), "scripts/backfill/logs");
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = resolve(logDir, `migrate-profile-ids-${stamp}.jsonl`);
  writeFileSync(logPath, "", { flag: "w" });
  const log = (event: Record<string, unknown>) => {
    appendFileSync(logPath, JSON.stringify({ t: new Date().toISOString(), ...event }) + "\n");
  };

  console.log(`[migrate] log → ${logPath}${DRY_RUN ? " (DRY RUN)" : ""}`);

  const rows = await loadInvestigations();
  console.log(`[migrate] ${rows.length} investigations loaded`);

  const addressRows = rows.filter((r) => /^scan-0x[a-f0-9]{40}$/i.test(r.id));
  const targets = [...new Set(addressRows.map((r) => r.target.toLowerCase()))];
  const { addrToPid, pidToAddrs } = await loadProfileAddressMap(targets);
  console.log(`[migrate] ${addrToPid.size}/${targets.length} targets map to an Ethos profile`);

  // Group every row by profile id (existing scan-p rows join their group so
  // an address row can merge into an already-migrated one).
  const byPid = new Map<number, InvRow[]>();
  let unattested = 0;
  for (const r of rows) {
    let pid: number | null = null;
    const pMatch = r.id.match(/^scan-p(\d+)$/i);
    if (pMatch) pid = Number(pMatch[1]);
    else pid = addrToPid.get(r.target.toLowerCase()) ?? null;
    if (pid === null) {
      unattested += 1;
      continue;
    }
    const list = byPid.get(pid) ?? [];
    list.push(r);
    byPid.set(pid, list);
  }
  console.log(`[migrate] ${byPid.size} profiles · ${unattested} unattested rows left as-is`);

  let rekeyed = 0;
  let merged = 0;
  let kept = 0;
  let conflicts = 0;

  for (const [pid, group] of byPid) {
    const newId = `scan-p${pid}`;
    const canonical = pickCanonical(group);
    const losers = group.filter((r) => r.id !== canonical.id);
    const wallets = pidToAddrs.get(pid) ?? [canonical.target.toLowerCase()];

    if (DRY_RUN) {
      if (losers.length > 0) {
        console.log(
          `  merge p${pid}: keep ${canonical.id}${canonical.share_id ? " (shared)" : ""} ← delete ${losers.map((l) => l.id + (l.share_id ? " (shared!)" : "")).join(", ")}`
        );
      }
      log({ event: "dry-run", pid, canonical: canonical.id, losers: losers.map((l) => l.id) });
      continue;
    }

    // Merge losers' twitter evidence into the canonical row before deleting.
    let mergedEvidence: Record<string, unknown> | null = null;
    const deletable: InvRow[] = [];
    for (const loser of losers) {
      if (loser.share_id && canonical.share_id) {
        // Both hold share links — keep the loser (legacy key, no profile_id)
        // so its /s/<shareId> link survives; flag for manual review.
        kept += 1;
        console.warn(`  KEPT (both shared): ${loser.id} vs canonical ${canonical.id} — review manually`);
        log({ event: "kept-shared-duplicate", pid, canonical: canonical.id, kept: loser.id });
        continue;
      }
      const ev = await fetchTwitterEvidence(loser.id);
      if (ev && Object.keys(ev).length > 0) {
        mergedEvidence = { ...(mergedEvidence ?? {}), ...ev };
      }
      deletable.push(loser);
    }

    const update: Record<string, unknown> = {
      id: newId,
      profile_id: pid,
      target_wallets: wallets,
    };
    // Canonical keeps its own share_id; inherit a loser's if it has none.
    if (!canonical.share_id) {
      const donor = deletable.find((l) => l.share_id);
      if (donor) {
        update.share_id = donor.share_id;
      }
    }
    if (mergedEvidence) {
      const own = await fetchTwitterEvidence(canonical.id);
      update.twitter_evidence = { ...mergedEvidence, ...(own ?? {}) };
    }

    // Delete losers first so a share_id being inherited doesn't collide with
    // the donor row's unique constraint.
    for (const loser of deletable) {
      const { error } = await supabase.from("investigations").delete().eq("id", loser.id);
      if (error) {
        console.error(`  delete ${loser.id} failed: ${error.message}`);
        log({ event: "delete-fail", pid, id: loser.id, error: error.message });
      } else {
        merged += 1;
        log({ event: "deleted", pid, id: loser.id, into: newId });
      }
    }

    const { error } = await supabase.from("investigations").update(update).eq("id", canonical.id);
    if (error) {
      conflicts += 1;
      console.error(`  re-key ${canonical.id} → ${newId} failed: ${error.message}`);
      log({ event: "rekey-fail", pid, id: canonical.id, error: error.message });
    } else {
      rekeyed += 1;
      log({ event: "rekeyed", pid, from: canonical.id, to: newId, mergedLosers: deletable.length });
    }
  }

  console.log(
    `\n[migrate] done · rekeyed=${rekeyed} · duplicates-merged=${merged} · kept-shared=${kept} · failures=${conflicts} · unattested-untouched=${unattested}`
  );
  log({ event: "summary", rekeyed, merged, kept, conflicts, unattested });
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
