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
}

export async function listInvestigations(): Promise<InvestigationSummary[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("investigations")
    .select("id, target, target_name, target_avatar, cluster_result, ai_analysis, share_id, is_public, owner_profile_id, last_scanned_by_profile_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("listInvestigations error:", error);
    return [];
  }

  return (data || []).map((row) => {
    let strongCount = 0;
    let possibleCount = 0;
    let targetAvatar: string | null = null;
    try {
      const result = typeof row.cluster_result === "string"
        ? JSON.parse(row.cluster_result)
        : row.cluster_result;
      strongCount = result?.strongCluster?.length ?? 0;
      possibleCount = result?.possibleCluster?.length ?? 0;
      targetAvatar = result?.targetEthos?.avatarUrl ?? row.target_avatar ?? null;
    } catch {}

    return {
      id: row.id,
      target: row.target,
      targetName: row.target_name,
      targetAvatar,
      savedAt: new Date(row.updated_at).getTime(),
      strongCount,
      possibleCount,
      hasAnalysis: !!row.ai_analysis,
      shareId: row.share_id,
      isPublic: row.is_public ?? false,
      ownerProfileId: row.owner_profile_id ?? null,
      lastScannedByProfileId: row.last_scanned_by_profile_id ?? null,
    };
  });
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
