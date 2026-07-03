import { getSupabase } from "./supabase";
import { nanoid } from "../utils";
import {
  edgesFromClusterResult,
  replaceEdgesForSource,
  deleteEdgesForInvestigation,
} from "./investigation-edges";

export interface InvestigationSummary {
  id: string;
  target: string;
  targetName: string | null;
  targetAvatar: string | null;
  savedAt: number;
  strongCount: number;
  possibleCount: number;
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
  shareId: string | null;
  isPublic: boolean;
  twitterEvidence: Record<string, unknown> | null;
}

export async function listInvestigations(
  {
    limit = 50,
    offset = 0,
    ownerProfileId = null,
  }: { limit?: number; offset?: number; ownerProfileId?: number | null } = {}
): Promise<{ rows: InvestigationSummary[]; total: number }> {
  const supabase = getSupabase();
  // strong_count + possible_count are STORED generated columns (see
  // scripts/migrations/2026-05-14-investigation-counts.sql), so we no
  // longer need to fetch the entire cluster_result JSONB just to count
  // signals. The cluster_result column averages ~15 KB per row — pulling
  // it for 100 rows on every list call adds noticeable latency.
  let query = supabase
    .from("investigations")
    .select(
      "id, target, target_name, target_avatar, share_id, is_public, owner_profile_id, last_scanned_by_profile_id, updated_at, strong_count, possible_count",
      { count: "exact" }
    );
  if (ownerProfileId !== null) {
    query = query.eq("owner_profile_id", ownerProfileId);
  }
  const { data, count, error } = await query
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("listInvestigations error:", error);
    return { rows: [], total: 0 };
  }

  const rows = (data || []).map((row) => ({
    id: row.id,
    target: row.target,
    targetName: row.target_name,
    targetAvatar: row.target_avatar ?? null,
    savedAt: new Date(row.updated_at).getTime(),
    strongCount: row.strong_count ?? 0,
    possibleCount: row.possible_count ?? 0,
    shareId: row.share_id,
    isPublic: row.is_public ?? false,
    ownerProfileId: row.owner_profile_id ?? null,
    lastScannedByProfileId: row.last_scanned_by_profile_id ?? null,
  }));
  return { rows, total: count ?? rows.length };
}

/**
 * Global signal totals across every investigation, for the scanner
 * empty-state stat cards. Pages the two thin generated-count columns
 * (PostgREST caps a single response at 1000 rows) and sums in JS.
 */
// 60s process-local caches for the two whole-table reads below. Both
// re-derive their result from a full table walk on every call, but the
// underlying data only changes when an investigation is written, so writes
// invalidate explicitly (saveInvestigation / deleteInvestigation /
// shareInvestigation). Per-instance on serverless, which is fine — worst
// case a cold instance recomputes once and the TTL bounds staleness for
// writes that happen on other instances (e.g. the nightly backfill).
const LIST_CACHE_TTL_MS = 60_000;
let verifiedListCache: { rows: InvestigationSummary[]; expires: number } | null = null;
let statsCache: { value: { strongSum: number; possibleSum: number }; expires: number } | null =
  null;

export function invalidateInvestigationCaches(): void {
  verifiedListCache = null;
  statsCache = null;
}

export async function getInvestigationStats(): Promise<{
  strongSum: number;
  possibleSum: number;
}> {
  if (statsCache && statsCache.expires > Date.now()) return statsCache.value;

  const supabase = getSupabase();
  let strongSum = 0;
  let possibleSum = 0;
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("investigations")
      .select("strong_count, possible_count")
      .range(from, from + PAGE - 1);
    if (error) {
      // Partial sums are worse than a recompute next call — don't cache.
      console.error("getInvestigationStats error:", error);
      return { strongSum, possibleSum };
    }
    if (!data || data.length === 0) break;
    for (const row of data as { strong_count: number | null; possible_count: number | null }[]) {
      strongSum += row.strong_count ?? 0;
      possibleSum += row.possible_count ?? 0;
    }
    if (data.length < PAGE) break;
  }
  statsCache = { value: { strongSum, possibleSum }, expires: Date.now() + LIST_CACHE_TTL_MS };
  return { strongSum, possibleSum };
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
  if (!verifiedListCache || verifiedListCache.expires <= Date.now()) {
    const rows = await fetchVerifiedInvestigationRows();
    if (rows === null) return { rows: [], total: 0 }; // error path — don't cache
    verifiedListCache = { rows, expires: Date.now() + LIST_CACHE_TTL_MS };
  }
  const all = verifiedListCache.rows;
  return { rows: all.slice(offset, offset + limit), total: all.length };
}

/** The uncached full fetch backing listVerifiedInvestigations: collect all
 * verified primary addresses, walk the investigations table, intersect, and
 * return the complete sorted list (null on any query error). */
async function fetchVerifiedInvestigationRows(): Promise<InvestigationSummary[] | null> {
  const supabase = getSupabase();
  const PAGE = 1000;

  type Row = {
    id: string;
    target: string;
    profile_id: number | null;
    target_name: string | null;
    target_avatar: string | null;
    share_id: string | null;
    is_public: boolean | null;
    owner_profile_id: number | null;
    last_scanned_by_profile_id: number | null;
    updated_at: string;
    strong_count: number | null;
    possible_count: number | null;
  };

  // The two reads are independent, so run them concurrently rather than
  // back-to-back — roughly halves the cold-load latency that the verified
  // tab pays on a cache miss.

  // Collect all human-verified profiles: primary addresses (legacy
  // address-keyed rows) and profile ids (profile-keyed rows). Paginated, no cap.
  const collectVerified = async (): Promise<{
    addresses: Set<string>;
    profileIds: Set<number>;
  } | null> => {
    const addresses = new Set<string>();
    const profileIds = new Set<number>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("profile_latest")
        .select("profile_id, primary_address")
        .eq("human_verified", true)
        .range(from, from + PAGE - 1);
      if (error) {
        console.error("listVerifiedInvestigations profile fetch error:", error);
        return null;
      }
      if (!data || data.length === 0) break;
      for (const row of data as { profile_id: number; primary_address: string | null }[]) {
        if (row.primary_address) addresses.add(row.primary_address.toLowerCase());
        if (row.profile_id != null) profileIds.add(row.profile_id);
      }
      if (data.length < PAGE) break;
    }
    return { addresses, profileIds };
  };

  // Pull the full investigations list (sorted by strong-count at the DB level
  // using the composite index), to be filtered to verified targets in JS. We
  // can't ship a 1.1k-element .in() filter — PostgREST URL-encodes the values
  // inline and the result exceeds the proxy's URL limit. PostgREST also caps
  // any single response at 1000 rows regardless of .limit(), so page with
  // .range() until exhausted; HARD_CAP bounds the worst case.
  const HARD_CAP = 5000;
  const fetchInvestigationsList = async (): Promise<Row[] | null> => {
    const fetched: Row[] = [];
    for (let from = 0; from < HARD_CAP; from += PAGE) {
      const { data, error } = await supabase
        .from("investigations")
        .select(
          "id, target, profile_id, target_name, target_avatar, share_id, is_public, owner_profile_id, last_scanned_by_profile_id, updated_at, strong_count, possible_count"
        )
        .order("strong_count", { ascending: false, nullsFirst: false })
        .order("possible_count", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .range(from, Math.min(from + PAGE, HARD_CAP) - 1);

      if (error) {
        console.error("listVerifiedInvestigations select error:", error);
        return null;
      }
      if (!data || data.length === 0) break;
      fetched.push(...(data as Row[]));
      if (data.length < PAGE) break;
    }
    return fetched;
  };

  const [verified, fetched] = await Promise.all([
    collectVerified(),
    fetchInvestigationsList(),
  ]);
  if (verified === null || fetched === null) return null; // error path
  if (verified.addresses.size === 0 && verified.profileIds.size === 0) return [];

  const verifiedRows = fetched.filter(
    (row) =>
      (row.profile_id != null && verified.profileIds.has(row.profile_id)) ||
      verified.addresses.has((row.target ?? "").toLowerCase())
  );

  return verifiedRows.map<InvestigationSummary>((row) => ({
    id: row.id,
    target: row.target,
    targetName: row.target_name,
    targetAvatar: row.target_avatar ?? null,
    savedAt: new Date(row.updated_at).getTime(),
    strongCount: row.strong_count ?? 0,
    possibleCount: row.possible_count ?? 0,
    shareId: row.share_id,
    isPublic: row.is_public ?? false,
    ownerProfileId: row.owner_profile_id ?? null,
    lastScannedByProfileId: row.last_scanned_by_profile_id ?? null,
  }));
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
  ownerProfileId: number;
  /** Ethos profile the investigation targets; null for unattested wallets. */
  profileId?: number | null;
  /** Full wallet set that was scanned. */
  targetWallets?: string[] | null;
  /**
   * Who to display as the scanner. Defaults to ownerProfileId. Pass null
   * explicitly for automated (cron/backfill) scans so the UI shows no
   * personal "Scanned by" attribution.
   */
  scannedByProfileId?: number | null;
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
      owner_profile_id: ownerToWrite,
      ...(data.profileId !== undefined && { profile_id: data.profileId }),
      ...(data.targetWallets !== undefined && { target_wallets: data.targetWallets }),
      // last_scanned_by is always overwritten with the current scanner (null
      // for automated scans), unlike owner_profile_id which is sticky to the
      // original creator.
      last_scanned_by_profile_id:
        data.scannedByProfileId !== undefined ? data.scannedByProfileId : data.ownerProfileId,
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
  invalidateInvestigationCaches();

  // Refresh the cross-profile connection graph for this source profile.
  // Only automated scans (scannedByProfileId === null — the backfill /
  // cron path) feed the global edge graph. clusterResult is client-
  // supplied on interactive saves, and the graph is world-visible in
  // every user's connections panel, so we never let an arbitrary user
  // write edges under a profile key. Best-effort: an edge failure must
  // not fail the save.
  if (data.profileId && data.scannedByProfileId === null) {
    try {
      await replaceEdgesForSource(
        data.profileId,
        edgesFromClusterResult(data.profileId, data.id, data.clusterResult)
      );
    } catch (err) {
      console.error("saveInvestigation edge refresh failed:", err);
    }
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
  // Drop any connection-graph edges this scan contributed so the
  // connections panel doesn't reference a deleted investigation.
  await deleteEdgesForInvestigation(id);
  invalidateInvestigationCaches();
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
    invalidateInvestigationCaches();
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

  invalidateInvestigationCaches();
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
