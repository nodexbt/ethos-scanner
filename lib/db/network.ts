import { getSupabase } from "./supabase";

export interface NetworkProfile {
  profileId: number;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  score: number | null;
  humanVerified: boolean;
}

export interface NetworkOverview {
  totals: { profilesScanned: number; linkedProfiles: number; edges: number; strongEdges: number };
  /** Profiles that the most other scans flagged (incoming edges). */
  mostLinked: (NetworkProfile & { linkedBy: number; strong: number })[];
  /** Scans that found the most links (outgoing edges). */
  largestClusters: (NetworkProfile & { links: number; strong: number; investigationId: string })[];
  /** Newest edges across all saved scans. */
  recent: { source: NetworkProfile; candidate: NetworkProfile; confidence: "high" | "medium"; score: number; updatedAt: string; investigationId: string }[];
}

let cache: { at: number; value: NetworkOverview } | null = null;
const TTL_MS = 60_000;

/** Aggregates over investigation_edges (a few thousand rows), cached a minute. */
export async function getNetworkOverview(): Promise<NetworkOverview> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const supabase = getSupabase();

  const edges: { source_profile_id: number; candidate_profile_id: number; investigation_id: string; confidence: string; score: number; updated_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("investigation_edges")
      .select("source_profile_id, candidate_profile_id, investigation_id, confidence, score, updated_at")
      .order("updated_at", { ascending: false })
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    edges.push(...(data as typeof edges));
    if (data.length < 1000) break;
  }

  const incoming = new Map<number, { n: number; strong: number }>();
  const outgoing = new Map<number, { n: number; strong: number; investigationId: string }>();
  for (const e of edges) {
    const i = incoming.get(e.candidate_profile_id) ?? { n: 0, strong: 0 };
    i.n++;
    if (e.confidence === "high") i.strong++;
    incoming.set(e.candidate_profile_id, i);
    const o = outgoing.get(e.source_profile_id) ?? { n: 0, strong: 0, investigationId: e.investigation_id };
    o.n++;
    if (e.confidence === "high") o.strong++;
    outgoing.set(e.source_profile_id, o);
  }
  const topIn = [...incoming].sort((a, b) => b[1].strong - a[1].strong || b[1].n - a[1].n).slice(0, 15);
  const topOut = [...outgoing].sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  const recent = edges.slice(0, 20);

  const ids = [...new Set([...topIn.map(([id]) => id), ...topOut.map(([id]) => id), ...recent.flatMap((e) => [e.source_profile_id, e.candidate_profile_id])])];
  const profiles = new Map<number, NetworkProfile>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("profile_latest")
      .select("profile_id, display_name, username, avatar_url, score, human_verified")
      .in("profile_id", ids.slice(i, i + 200));
    for (const p of (data ?? []) as { profile_id: number; display_name: string | null; username: string | null; avatar_url: string | null; score: number | null; human_verified: boolean | null }[]) {
      profiles.set(p.profile_id, { profileId: p.profile_id, displayName: p.display_name, username: p.username, avatarUrl: p.avatar_url, score: p.score, humanVerified: p.human_verified ?? false });
    }
  }
  const prof = (id: number): NetworkProfile => profiles.get(id) ?? { profileId: id, displayName: null, username: null, avatarUrl: null, score: null, humanVerified: false };

  const { count: profilesScanned } = await supabase.from("investigations").select("id", { count: "exact", head: true });

  const value: NetworkOverview = {
    totals: {
      profilesScanned: profilesScanned ?? 0,
      linkedProfiles: incoming.size,
      edges: edges.length,
      strongEdges: edges.filter((e) => e.confidence === "high").length,
    },
    mostLinked: topIn.map(([id, v]) => ({ ...prof(id), linkedBy: v.n, strong: v.strong })),
    largestClusters: topOut.map(([id, v]) => ({ ...prof(id), links: v.n, strong: v.strong, investigationId: v.investigationId })),
    recent: recent.map((e) => ({
      source: prof(e.source_profile_id),
      candidate: prof(e.candidate_profile_id),
      confidence: e.confidence === "high" ? "high" : "medium",
      score: e.score,
      updatedAt: e.updated_at,
      investigationId: e.investigation_id,
    })),
  };
  cache = { at: Date.now(), value };
  return value;
}
