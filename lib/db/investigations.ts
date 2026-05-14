import { getSupabase } from "./supabase";
import { nanoid } from "../utils";

export interface InvestigationSummary {
  id: string;
  target: string;
  targetName: string | null;
  targetAvatar: string | null;
  savedAt: number;
  strongCount: number;
  possibleCount: number;
  hasAnalysis: boolean;
  shareId: string | null;
  isPublic: boolean;
  ownerProfileId: number | null;
  lastScannedByProfileId: number | null;
}

export interface InvestigationRow {
  id: string;
  target: string;
  targetName: string | null;
  clusterResult: unknown;
  aiAnalysis: string | null;
  shareId: string | null;
  isPublic: boolean;
  twitterEvidence: Record<string, unknown> | null;
}

export async function listInvestigations(): Promise<InvestigationSummary[]> {
  const supabase = getSupabase();
  // strong_count + possible_count are STORED generated columns (see
  // scripts/migrations/2026-05-14-investigation-counts.sql), so we no
  // longer need to fetch the entire cluster_result JSONB just to count
  // signals. The cluster_result column averages ~15 KB per row — pulling
  // it for 100 rows on every list call adds noticeable latency.
  const { data, error } = await supabase
    .from("investigations")
    .select(
      "id, target, target_name, target_avatar, ai_analysis, share_id, is_public, owner_profile_id, last_scanned_by_profile_id, updated_at, strong_count, possible_count"
    )
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("listInvestigations error:", error);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    target: row.target,
    targetName: row.target_name,
    targetAvatar: row.target_avatar ?? null,
    savedAt: new Date(row.updated_at).getTime(),
    strongCount: row.strong_count ?? 0,
    possibleCount: row.possible_count ?? 0,
    hasAnalysis: !!row.ai_analysis,
    shareId: row.share_id,
    isPublic: row.is_public ?? false,
    ownerProfileId: row.owner_profile_id ?? null,
    lastScannedByProfileId: row.last_scanned_by_profile_id ?? null,
  }));
}

export interface VerifiedListPage {
  rows: InvestigationSummary[];
  total: number;
}

/**
 * Page through investigations whose target is the primary wallet of a
 * human-verified Ethos profile, sorted by strong-cluster count desc so the
 * most-flagged profiles surface first. Backed by the generated count
 * columns + composite index so this returns in tens of ms regardless of
 * how big the universe gets.
 */
export async function listVerifiedInvestigations(
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<VerifiedListPage> {
  const supabase = getSupabase();

  // Step 1: collect all human-verified primary addresses (paginated, no cap).
  const addresses: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("profile_latest")
      .select("primary_address")
      .eq("human_verified", true)
      .not("primary_address", "is", null)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("listVerifiedInvestigations profile fetch error:", error);
      return { rows: [], total: 0 };
    }
    if (!data || data.length === 0) break;
    for (const row of data as { primary_address: string | null }[]) {
      if (row.primary_address) addresses.push(row.primary_address.toLowerCase());
    }
    if (data.length < PAGE) break;
  }
  if (addresses.length === 0) return { rows: [], total: 0 };

  const verifiedSet = new Set(addresses);

  // Step 2: pull the full investigations list (sorted by strong-count at the
  // DB level using the composite index), then filter to verified targets in
  // JS. We can't ship a 1.1k-element .in() filter — PostgREST URL-encodes the
  // values inline and the result exceeds the proxy's URL limit. A single
  // unfiltered fetch with the new generated count columns is ~300 ms for the
  // current 1.1k-row table; the bound is set high enough to absorb organic
  // growth without paging.
  const HARD_CAP = 5000;
  const { data, error } = await supabase
    .from("investigations")
    .select(
      "id, target, target_name, target_avatar, ai_analysis, share_id, is_public, owner_profile_id, last_scanned_by_profile_id, updated_at, strong_count, possible_count"
    )
    .order("strong_count", { ascending: false, nullsFirst: false })
    .order("possible_count", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(HARD_CAP);

  if (error) {
    console.error("listVerifiedInvestigations select error:", error);
    return { rows: [], total: 0 };
  }

  type Row = {
    id: string;
    target: string;
    target_name: string | null;
    target_avatar: string | null;
    ai_analysis: string | null;
    share_id: string | null;
    is_public: boolean | null;
    owner_profile_id: number | null;
    last_scanned_by_profile_id: number | null;
    updated_at: string;
    strong_count: number | null;
    possible_count: number | null;
  };

  const verifiedRows = (data ?? []).filter((row) =>
    verifiedSet.has(((row as Row).target ?? "").toLowerCase())
  ) as Row[];

  const page = verifiedRows.slice(offset, offset + limit).map<InvestigationSummary>((row) => ({
    id: row.id,
    target: row.target,
    targetName: row.target_name,
    targetAvatar: row.target_avatar ?? null,
    savedAt: new Date(row.updated_at).getTime(),
    strongCount: row.strong_count ?? 0,
    possibleCount: row.possible_count ?? 0,
    hasAnalysis: !!row.ai_analysis,
    shareId: row.share_id,
    isPublic: row.is_public ?? false,
    ownerProfileId: row.owner_profile_id ?? null,
    lastScannedByProfileId: row.last_scanned_by_profile_id ?? null,
  }));

  return { rows: page, total: verifiedRows.length };
}

export async function getInvestigation(id: string): Promise<InvestigationRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("investigations")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    target: data.target,
    targetName: data.target_name,
    clusterResult: typeof data.cluster_result === "string"
      ? JSON.parse(data.cluster_result)
      : data.cluster_result,
    aiAnalysis: data.ai_analysis,
    shareId: data.share_id,
    isPublic: data.is_public ?? false,
    twitterEvidence:
      typeof data.twitter_evidence === "string"
        ? JSON.parse(data.twitter_evidence)
        : (data.twitter_evidence as Record<string, unknown> | null) ?? null,
  };
}

export async function getInvestigationByShareId(shareId: string): Promise<InvestigationRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("investigations")
    .select("*")
    .eq("share_id", shareId)
    .eq("is_public", true)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    target: data.target,
    targetName: data.target_name,
    clusterResult: typeof data.cluster_result === "string"
      ? JSON.parse(data.cluster_result)
      : data.cluster_result,
    aiAnalysis: data.ai_analysis,
    shareId: data.share_id,
    isPublic: data.is_public ?? false,
    twitterEvidence:
      typeof data.twitter_evidence === "string"
        ? JSON.parse(data.twitter_evidence)
        : (data.twitter_evidence as Record<string, unknown> | null) ?? null,
  };
}

export async function saveInvestigation(data: {
  id: string;
  target: string;
  targetName: string | null;
  clusterResult: unknown;
  aiAnalysis: string | null;
  ownerProfileId: number;
  scanDurationMs?: number | null;
  /** Map of address → search result + tweets. Persisted as JSONB. */
  twitterEvidence?: Record<string, unknown> | null;
}): Promise<void> {
  const supabase = getSupabase();
  const result = data.clusterResult as { targetEthos?: { avatarUrl?: string } };

  // On upsert, only stamp owner_profile_id on new rows or legacy rows without
  // an owner — never overwrite an existing owner.
  const existingOwner = await getInvestigationOwner(data.id);
  const ownerToWrite = existingOwner === null ? data.ownerProfileId : existingOwner;

  // Prevent a non-owner from overwriting someone else's investigation.
  if (existingOwner !== null && existingOwner !== data.ownerProfileId) {
    throw new Error("Not authorized to modify this investigation");
  }

  // Merge incoming twitter_evidence with what's already in the DB so a save
  // with a partial map (or accidentally with {}) can't wipe previously
  // fetched tweets. Per-address entries from the incoming payload override
  // existing entries; addresses not in the incoming payload are preserved.
  // Skipped entirely when the caller doesn't provide twitterEvidence.
  let twitterEvidenceToWrite: Record<string, unknown> | undefined;
  if (data.twitterEvidence !== undefined) {
    if (data.twitterEvidence === null) {
      twitterEvidenceToWrite = null as unknown as Record<string, unknown>;
    } else {
      const { data: existingRow } = await supabase
        .from("investigations")
        .select("twitter_evidence")
        .eq("id", data.id)
        .single();
      const existing = (existingRow?.twitter_evidence ?? {}) as Record<string, unknown>;
      twitterEvidenceToWrite = { ...existing, ...data.twitterEvidence };
    }
  }

  const { error } = await supabase
    .from("investigations")
    .upsert({
      id: data.id,
      target: data.target,
      target_name: data.targetName,
      target_avatar: result?.targetEthos?.avatarUrl ?? null,
      cluster_result: data.clusterResult,
      ai_analysis: data.aiAnalysis,
      owner_profile_id: ownerToWrite,
      // last_scanned_by is always overwritten with the current user, unlike
      // owner_profile_id which is sticky to the original creator.
      last_scanned_by_profile_id: data.ownerProfileId,
      // scan_duration_ms is also always overwritten — the most recent
      // scan's timing is the most relevant for the rolling baseline.
      // Only write when we have a value; leave column untouched if not
      // (preserves the previous duration on legacy upserts).
      ...(data.scanDurationMs != null && { scan_duration_ms: data.scanDurationMs }),
      ...(twitterEvidenceToWrite !== undefined && { twitter_evidence: twitterEvidenceToWrite }),
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (error) {
    console.error("saveInvestigation error:", error);
    throw new Error(error.message);
  }
}

/**
 * Returns the owner_profile_id for an investigation, or null if the
 * row doesn't exist or has no owner set (legacy rows).
 */
export async function getInvestigationOwner(id: string): Promise<number | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("investigations")
    .select("owner_profile_id")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data.owner_profile_id ?? null;
}

export async function deleteInvestigation(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("investigations")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("deleteInvestigation error:", error);
  }
}

export async function shareInvestigation(id: string): Promise<string | null> {
  const supabase = getSupabase();

  // Check if already has a share ID
  const { data: existing } = await supabase
    .from("investigations")
    .select("share_id")
    .eq("id", id)
    .single();

  if (existing?.share_id) {
    // Just make sure it's public
    await supabase
      .from("investigations")
      .update({ is_public: true })
      .eq("id", id);
    return existing.share_id;
  }

  // Generate a new share ID (22 chars from 36-char alphabet ≈ 114 bits of entropy)
  const shareId = nanoid(22);
  const { error } = await supabase
    .from("investigations")
    .update({ share_id: shareId, is_public: true })
    .eq("id", id);

  if (error) {
    console.error("shareInvestigation error:", error);
    return null;
  }

  return shareId;
}

/** Cold-start fallback used when there isn't enough scan history yet
    to compute a meaningful rolling average. Tuned to a typical scan
    based on early observations; gets replaced once history accumulates. */
const COLD_START_BASELINE_MS = 90_000;
const ROLLING_AVERAGE_WINDOW = 20;
const MIN_SAMPLES_FOR_AVERAGE = 5;

/**
 * Returns the rolling average duration of recent scans, used by the
 * progress estimator to give the user a stable, time-based countdown
 * instead of guessing from per-step rate. Falls back to a hardcoded
 * baseline when there aren't enough samples to average reliably.
 *
 * Caches the result for 60 seconds per process so a burst of scans
 * doesn't hammer the DB on every start. Cache is process-local; that's
 * fine because the average changes slowly and stale-by-a-minute is
 * better than fresh-but-rate-limited.
 */
let baselineCache: { value: number; expires: number } | null = null;
const BASELINE_CACHE_TTL_MS = 60_000;

export async function getRecentScanAverageMs(): Promise<number> {
  const now = Date.now();
  if (baselineCache && baselineCache.expires > now) {
    return baselineCache.value;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("investigations")
    .select("scan_duration_ms")
    .not("scan_duration_ms", "is", null)
    .order("updated_at", { ascending: false })
    .limit(ROLLING_AVERAGE_WINDOW);

  let value = COLD_START_BASELINE_MS;
  if (!error && data && data.length >= MIN_SAMPLES_FOR_AVERAGE) {
    const sum = data.reduce(
      (acc, row) => acc + ((row.scan_duration_ms as number) ?? 0),
      0
    );
    value = Math.round(sum / data.length);
  }

  baselineCache = { value, expires: now + BASELINE_CACHE_TTL_MS };
  return value;
}
