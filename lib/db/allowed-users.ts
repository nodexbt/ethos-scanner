import { getSupabase } from "./supabase";

export interface AllowedUser {
  profileId: number;
  addedBy: number;
  addedAt: number;
  note: string | null;
  twitterUsername: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface AuditEntry {
  id: number;
  profileId: number;
  action: "add" | "remove" | "update";
  actorProfileId: number;
  details: Record<string, unknown> | null;
  createdAt: number;
}

// Process-local cache so we don't hit Supabase on every protected request.
// Short TTL (10s) so removed users lose access nearly-immediately while
// keeping common-case load on the DB at roughly one query per instance per
// TTL window. Removal endpoints invalidate the cache in their own instance.
const CACHE_TTL_MS = 10_000;
let cache: { ids: Set<number>; expires: number } | null = null;

function invalidateCache() {
  cache = null;
}

async function loadAllowedIds(): Promise<Set<number>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("allowed_users")
    .select("profile_id");
  if (error) {
    console.error("loadAllowedIds error:", error);
    // On DB error, return an empty set rather than the stale cache so a
    // misconfigured DB never silently grants access. The next call will
    // re-attempt the load.
    return new Set();
  }
  return new Set((data || []).map((r) => r.profile_id as number));
}

/**
 * Returns true if the given Ethos profileId is currently allowlisted.
 * Uses a short-lived in-process cache so the common case is a Set lookup.
 */
export async function isAllowed(profileId: number): Promise<boolean> {
  const now = Date.now();
  if (!cache || cache.expires <= now) {
    cache = { ids: await loadAllowedIds(), expires: now + CACHE_TTL_MS };
  }
  return cache.ids.has(profileId);
}

function rowToUser(row: Record<string, unknown>): AllowedUser {
  return {
    profileId: row.profile_id as number,
    addedBy: row.added_by as number,
    addedAt: new Date(row.added_at as string).getTime(),
    note: (row.note as string | null) ?? null,
    twitterUsername: (row.twitter_username as string | null) ?? null,
    displayName: (row.display_name as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
  };
}

export async function listAllowedUsers(): Promise<AllowedUser[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("allowed_users")
    .select("*")
    .order("added_at", { ascending: false });
  if (error) {
    console.error("listAllowedUsers error:", error);
    return [];
  }
  return (data || []).map(rowToUser);
}

export async function addAllowedUser(input: {
  profileId: number;
  addedBy: number;
  note?: string | null;
  twitterUsername?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}): Promise<AllowedUser> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("allowed_users")
    .upsert(
      {
        profile_id: input.profileId,
        added_by: input.addedBy,
        note: input.note ?? null,
        twitter_username: input.twitterUsername ?? null,
        display_name: input.displayName ?? null,
        avatar_url: input.avatarUrl ?? null,
      },
      { onConflict: "profile_id" }
    )
    .select()
    .single();

  if (error || !data) {
    console.error("addAllowedUser error:", error);
    throw new Error(error?.message || "Failed to add allowed user");
  }

  await writeAudit({
    profileId: input.profileId,
    action: "add",
    actorProfileId: input.addedBy,
    details: {
      twitterUsername: input.twitterUsername ?? null,
      note: input.note ?? null,
    },
  });

  invalidateCache();
  return rowToUser(data);
}

export async function removeAllowedUser(
  profileId: number,
  actorProfileId: number
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("allowed_users")
    .delete()
    .eq("profile_id", profileId);
  if (error) {
    console.error("removeAllowedUser error:", error);
    throw new Error(error.message);
  }

  await writeAudit({
    profileId,
    action: "remove",
    actorProfileId,
    details: null,
  });

  invalidateCache();
}

export async function updateAllowedUserNote(
  profileId: number,
  note: string | null,
  actorProfileId: number
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("allowed_users")
    .update({ note })
    .eq("profile_id", profileId);
  if (error) {
    console.error("updateAllowedUserNote error:", error);
    throw new Error(error.message);
  }

  await writeAudit({
    profileId,
    action: "update",
    actorProfileId,
    details: { note },
  });

  // Note changes don't affect access, but keep the cache fresh anyway.
  invalidateCache();
}

async function writeAudit(input: {
  profileId: number;
  action: "add" | "remove" | "update";
  actorProfileId: number;
  details: Record<string, unknown> | null;
}): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("allowed_users_audit").insert({
    profile_id: input.profileId,
    action: input.action,
    actor_profile_id: input.actorProfileId,
    details: input.details,
  });
  if (error) {
    // Audit failures are non-fatal — log and continue. Losing an audit
    // entry is better than blocking a legitimate allowlist change.
    console.error("writeAudit error:", error);
  }
}

export async function listAuditEntries(limit = 100): Promise<AuditEntry[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("allowed_users_audit")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listAuditEntries error:", error);
    return [];
  }
  return (data || []).map((row) => ({
    id: row.id as number,
    profileId: row.profile_id as number,
    action: row.action as "add" | "remove" | "update",
    actorProfileId: row.actor_profile_id as number,
    details: (row.details as Record<string, unknown> | null) ?? null,
    createdAt: new Date(row.created_at as string).getTime(),
  }));
}

/**
 * One-time seed: copies any profile IDs in the legacy
 * ETHOS_PROFILE_ALLOWLIST env var into the allowed_users table if they're
 * not already present. Idempotent — safe to call repeatedly. Used to
 * migrate from env-based to DB-based allowlist without locking anyone out.
 *
 * Returns the number of rows newly inserted.
 */
export async function seedFromEnvIfMissing(): Promise<number> {
  const raw = process.env.ETHOS_PROFILE_ALLOWLIST || "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (ids.length === 0) return 0;

  const supabase = getSupabase();
  const { data: existing, error: selectErr } = await supabase
    .from("allowed_users")
    .select("profile_id")
    .in("profile_id", ids);
  if (selectErr) {
    console.error("seedFromEnvIfMissing select error:", selectErr);
    return 0;
  }
  const have = new Set((existing || []).map((r) => r.profile_id as number));
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length === 0) return 0;

  const rows = missing.map((profileId) => ({
    profile_id: profileId,
    added_by: profileId, // self — no admin actor for seeded rows
    note: "Seeded from ETHOS_PROFILE_ALLOWLIST env var",
  }));
  const { error: insertErr } = await supabase
    .from("allowed_users")
    .insert(rows);
  if (insertErr) {
    console.error("seedFromEnvIfMissing insert error:", insertErr);
    return 0;
  }
  invalidateCache();
  return missing.length;
}
