import { getSupabase } from "./supabase";

/** One scan-derived connection between two Ethos profiles. */
export interface InvestigationEdge {
  sourceProfileId: number;
  candidateProfileId: number;
  investigationId: string;
  confidence: "high" | "medium";
  score: number;
}

interface CandidateLite {
  score?: number;
  ethosProfile?: { profileId?: number };
}

interface ClusterResultLite {
  strongCluster?: CandidateLite[];
  possibleCluster?: CandidateLite[];
}

/** Extract profile→profile edges from a cluster result. */
export function edgesFromClusterResult(
  sourceProfileId: number,
  investigationId: string,
  clusterResult: unknown
): InvestigationEdge[] {
  const cr = clusterResult as ClusterResultLite | null;
  if (!cr) return [];
  const out = new Map<number, InvestigationEdge>();
  const collect = (list: CandidateLite[] | undefined, confidence: "high" | "medium") => {
    for (const c of list ?? []) {
      const pid = c.ethosProfile?.profileId;
      if (!pid || pid === sourceProfileId || out.has(pid)) continue;
      out.set(pid, {
        sourceProfileId,
        candidateProfileId: pid,
        investigationId,
        confidence,
        score: typeof c.score === "number" ? Math.round(c.score) : 0,
      });
    }
  };
  collect(cr.strongCluster, "high");
  collect(cr.possibleCluster, "medium");
  return [...out.values()];
}

/**
 * Replace the stored edges for a source profile with the given set —
 * a re-scan is the fresh truth for that profile's connections, so stale
 * edges (candidates that no longer appear) are deleted.
 */
export async function replaceEdgesForSource(
  sourceProfileId: number,
  edges: InvestigationEdge[]
): Promise<void> {
  const supabase = getSupabase();

  const { error: delError } = await supabase
    .from("investigation_edges")
    .delete()
    .eq("source_profile_id", sourceProfileId);
  if (delError) {
    console.error("replaceEdgesForSource delete error:", delError.message);
    return;
  }
  if (edges.length === 0) return;

  const rows = edges.map((e) => ({
    source_profile_id: e.sourceProfileId,
    candidate_profile_id: e.candidateProfileId,
    investigation_id: e.investigationId,
    confidence: e.confidence,
    score: e.score,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("investigation_edges").upsert(rows, {
    onConflict: "source_profile_id,candidate_profile_id",
  });
  if (error) console.error("replaceEdgesForSource upsert error:", error.message);
}

/** Remove every edge sourced from the given investigation id. Called when
    an investigation is deleted so the connections graph doesn't surface
    edges pointing at a scan that no longer exists. */
export async function deleteEdgesForInvestigation(investigationId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("investigation_edges")
    .delete()
    .eq("investigation_id", investigationId);
  if (error) console.error("deleteEdgesForInvestigation error:", error.message);
}

/**
 * All edges touching any of the given profiles, in either direction —
 * what those profiles' own scans found (outgoing) and which other saved
 * scans flagged them (incoming).
 */
export async function getEdgesTouching(
  profileIds: number[]
): Promise<InvestigationEdge[]> {
  if (profileIds.length === 0) return [];
  const supabase = getSupabase();
  const out: InvestigationEdge[] = [];

  for (let i = 0; i < profileIds.length; i += 100) {
    const chunk = profileIds.slice(i, i + 100);
    const [outgoing, incoming] = await Promise.all([
      supabase
        .from("investigation_edges")
        .select("source_profile_id, candidate_profile_id, investigation_id, confidence, score")
        .in("source_profile_id", chunk),
      supabase
        .from("investigation_edges")
        .select("source_profile_id, candidate_profile_id, investigation_id, confidence, score")
        .in("candidate_profile_id", chunk),
    ]);
    for (const { data, error } of [outgoing, incoming]) {
      if (error) {
        console.error("getEdgesTouching error:", error.message);
        continue;
      }
      for (const row of (data ?? []) as {
        source_profile_id: number;
        candidate_profile_id: number;
        investigation_id: string;
        confidence: string;
        score: number;
      }[]) {
        out.push({
          sourceProfileId: row.source_profile_id,
          candidateProfileId: row.candidate_profile_id,
          investigationId: row.investigation_id,
          confidence: row.confidence === "high" ? "high" : "medium",
          score: row.score ?? 0,
        });
      }
    }
  }

  // Both directions can return the same edge when two queried profiles
  // are connected to each other — dedupe on the pair.
  const seen = new Set<string>();
  return out.filter((e) => {
    const key = `${e.sourceProfileId}:${e.candidateProfileId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
