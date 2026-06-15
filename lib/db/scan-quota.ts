import { getSupabase } from "./supabase";

/** Max scans per user per UTC day. */
export const DAILY_SCAN_LIMIT = 25;

/** UTC calendar day as YYYY-MM-DD — the quota window key. */
function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Atomically consume one scan from the caller's daily quota.
 * Returns whether the scan is allowed and the post-increment count.
 *
 * Fails open: if the DB is unreachable we allow the scan rather than block a
 * legitimate user on infrastructure hiccups — this is a soft abuse limit, not
 * an access control (that's requireAuth's job).
 */
export async function consumeDailyScanQuota(
  profileId: number
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("increment_scan_quota", {
    p_profile_id: profileId,
    p_day: utcDay(),
  });
  if (error || typeof data !== "number") {
    console.error("consumeDailyScanQuota error:", error);
    return { allowed: true, count: 0, limit: DAILY_SCAN_LIMIT };
  }
  return { allowed: data <= DAILY_SCAN_LIMIT, count: data, limit: DAILY_SCAN_LIMIT };
}
