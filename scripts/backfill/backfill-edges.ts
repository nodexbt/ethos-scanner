#!/usr/bin/env -S npx tsx
/**
 * One-off backfill: derive investigation_edges from every saved
 * investigation's cluster_result. New saves keep the graph fresh via
 * saveInvestigation; this seeds it from historical scans.
 *
 * Usage:
 *   npx tsx scripts/backfill/backfill-edges.ts [--dry-run]
 *
 * Requires scripts/migrations/2026-07-03-investigation-edges.sql first.
 * Idempotent — edges are replaced per source profile.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // intentional: ok if running in an env that injects vars directly
}

import { getSupabase } from "@/lib/db/supabase";
import {
  edgesFromClusterResult,
  replaceEdgesForSource,
  type InvestigationEdge,
} from "@/lib/db/investigation-edges";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const supabase = getSupabase();
  const PAGE = 200; // cluster_result is ~15 KB/row — keep pages small

  let scanned = 0;
  let skippedNoProfile = 0;

  // Accumulate edges per source profile across ALL rows before writing.
  // Legacy per-address duplicates of one profile share a source id; writing
  // per-row would make replaceEdgesForSource clobber earlier duplicates'
  // edges (order-dependent loss). Merging first makes the result independent
  // of row order and of whether the profile-id merge ran beforehand.
  const bySource = new Map<number, Map<number, InvestigationEdge>>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("investigations")
      .select("id, profile_id, cluster_result")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`investigations fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data as { id: string; profile_id: number | null; cluster_result: unknown }[]) {
      scanned += 1;
      const cr =
        typeof row.cluster_result === "string"
          ? JSON.parse(row.cluster_result)
          : row.cluster_result;
      const sourcePid: number | null =
        row.profile_id ??
        (cr as { targetProfileId?: number | null; targetEthos?: { profileId?: number } })?.targetProfileId ??
        (cr as { targetEthos?: { profileId?: number } })?.targetEthos?.profileId ??
        null;
      if (!sourcePid) {
        skippedNoProfile += 1;
        continue;
      }

      const merged = bySource.get(sourcePid) ?? new Map<number, InvestigationEdge>();
      for (const e of edgesFromClusterResult(sourcePid, row.id, cr)) {
        // Highest-confidence/most-recent-id wins on collision; keep the
        // stronger edge deterministically (high beats medium).
        const prev = merged.get(e.candidateProfileId);
        if (!prev || (prev.confidence !== "high" && e.confidence === "high")) {
          merged.set(e.candidateProfileId, e);
        }
      }
      bySource.set(sourcePid, merged);
    }
    if (data.length < PAGE) break;
  }

  let edges = 0;
  for (const [sourcePid, merged] of bySource) {
    const list = [...merged.values()];
    edges += list.length;
    if (DRY_RUN) {
      if (list.length > 0) console.log(`  p${sourcePid}: ${list.length} edge(s)`);
      continue;
    }
    await replaceEdgesForSource(sourcePid, list);
  }

  console.log(
    `[edges] done${DRY_RUN ? " (DRY RUN)" : ""} · investigations=${scanned} · sources=${bySource.size} · edges=${edges} · no-profile=${skippedNoProfile}`
  );
}

main().catch((err) => {
  console.error("[edges] fatal:", err);
  process.exit(1);
});
