import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getInvestigation } from "@/lib/db/investigations";
import { getEdgesTouching } from "@/lib/db/investigation-edges";
import { getSupabase } from "@/lib/db/supabase";

interface CandidateLite {
  ethosProfile?: { profileId?: number };
}
interface ClusterResultLite {
  targetProfileId?: number | null;
  targetEthos?: { profileId?: number };
  strongCluster?: CandidateLite[];
  possibleCluster?: CandidateLite[];
}

/**
 * GET /api/investigations/[id]/connections — second-degree connections
 * for an investigation, derived from the saved-scan edge graph: what the
 * investigation's candidates' own scans found, which other saved scans
 * flagged them, and which other scans flagged the target itself. Costs
 * no Alchemy calls; it only reads investigation_edges.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;
  const investigation = await getInvestigation(id);
  if (!investigation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const cr = investigation.clusterResult as ClusterResultLite | null;
  const sourcePid =
    cr?.targetProfileId ?? cr?.targetEthos?.profileId ?? null;

  const candidatePids = new Set<number>();
  for (const c of [...(cr?.strongCluster ?? []), ...(cr?.possibleCluster ?? [])]) {
    const pid = c.ethosProfile?.profileId;
    if (pid && pid !== sourcePid) candidatePids.add(pid);
  }

  const queried = [...candidatePids, ...(sourcePid ? [sourcePid] : [])];
  if (queried.length === 0) {
    return NextResponse.json({ edges: [], profiles: {} });
  }

  const allEdges = await getEdgesTouching(queried);

  // Drop edges that just restate this investigation's own findings
  // (target → its candidates); everything else is new information.
  const edges = allEdges.filter(
    (e) =>
      !(
        sourcePid !== null &&
        e.sourceProfileId === sourcePid &&
        candidatePids.has(e.candidateProfileId)
      )
  );

  // Enrich all involved profile ids with display data from the local
  // profile mirror (no Ethos API round-trip).
  const pids = [
    ...new Set(edges.flatMap((e) => [e.sourceProfileId, e.candidateProfileId])),
  ];
  const profiles: Record<
    number,
    {
      displayName: string | null;
      username: string | null;
      avatarUrl: string | null;
      score: number | null;
      humanVerified: boolean;
    }
  > = {};
  const supabase = getSupabase();
  for (let i = 0; i < pids.length; i += 200) {
    const chunk = pids.slice(i, i + 200);
    const { data } = await supabase
      .from("profile_latest")
      .select("profile_id, display_name, username, avatar_url, score, human_verified")
      .in("profile_id", chunk);
    for (const row of (data ?? []) as {
      profile_id: number;
      display_name: string | null;
      username: string | null;
      avatar_url: string | null;
      score: number | null;
      human_verified: boolean | null;
    }[]) {
      profiles[row.profile_id] = {
        displayName: row.display_name,
        username: row.username,
        avatarUrl: row.avatar_url,
        score: row.score,
        humanVerified: row.human_verified ?? false,
      };
    }
  }

  return NextResponse.json({ sourceProfileId: sourcePid, edges, profiles });
}
