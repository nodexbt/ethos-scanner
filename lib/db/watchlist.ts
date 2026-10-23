import { getSupabase } from "./supabase";

export interface WatchedProfile {
  profileId: number;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  addedAt: string;
}

export async function listWatched(userProfileId: number): Promise<WatchedProfile[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("watchlist")
    .select("watched_profile_id, added_at")
    .eq("user_profile_id", userProfileId)
    .order("added_at", { ascending: false });
  if (error || !data || data.length === 0) return [];
  const ids = data.map((r: { watched_profile_id: number }) => r.watched_profile_id);
  const { data: profiles } = await supabase
    .from("profile_latest")
    .select("profile_id, display_name, username, avatar_url")
    .in("profile_id", ids);
  const byId = new Map(
    ((profiles ?? []) as { profile_id: number; display_name: string | null; username: string | null; avatar_url: string | null }[]).map((p) => [p.profile_id, p])
  );
  return data.map((r: { watched_profile_id: number; added_at: string }) => ({
    profileId: r.watched_profile_id,
    displayName: byId.get(r.watched_profile_id)?.display_name ?? null,
    username: byId.get(r.watched_profile_id)?.username ?? null,
    avatarUrl: byId.get(r.watched_profile_id)?.avatar_url ?? null,
    addedAt: r.added_at,
  }));
}

export async function isWatching(userProfileId: number, watchedProfileId: number): Promise<boolean> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("watchlist")
    .select("watched_profile_id")
    .eq("user_profile_id", userProfileId)
    .eq("watched_profile_id", watchedProfileId)
    .maybeSingle();
  return !!data;
}

export async function addWatch(userProfileId: number, watchedProfileId: number): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("watchlist")
    .upsert({ user_profile_id: userProfileId, watched_profile_id: watchedProfileId }, { onConflict: "user_profile_id,watched_profile_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

export async function removeWatch(userProfileId: number, watchedProfileId: number): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("user_profile_id", userProfileId)
    .eq("watched_profile_id", watchedProfileId);
  if (error) throw new Error(error.message);
}

/** Map of watched profile id → the users watching it, for the given ids. */
export async function watchersOf(profileIds: number[]): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (profileIds.length === 0) return out;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("watchlist")
    .select("user_profile_id, watched_profile_id")
    .in("watched_profile_id", profileIds);
  if (error || !data) return out;
  for (const r of data as { user_profile_id: number; watched_profile_id: number }[]) {
    out.set(r.watched_profile_id, [...(out.get(r.watched_profile_id) ?? []), r.user_profile_id]);
  }
  return out;
}
