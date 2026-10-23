import { getSupabase } from "./supabase";
import { watchersOf } from "./watchlist";

export type NotificationType = "new_links" | "watched_linked";

export interface Notification {
  id: number;
  type: NotificationType;
  subjectProfileId: number;
  investigationId: string | null;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

interface NamedProfile {
  profileId: number;
  displayName: string;
  username: string | null;
}

/**
 * Called after a complete scan is saved. `added` are the candidate
 * profiles that were not in the previous result. Two kinds of alert:
 * - new_links → everyone watching the scanned profile
 * - watched_linked → everyone watching one of the newly linked profiles
 * Best-effort: never throws (the notifications table may not exist yet).
 */
export async function notifyNewLinks(input: {
  investigationId: string;
  target: NamedProfile;
  added: (NamedProfile & { confidence: "high" | "medium" })[];
}): Promise<void> {
  if (input.added.length === 0) return;
  try {
    const watchers = await watchersOf([input.target.profileId, ...input.added.map((a) => a.profileId)]);
    const rows: Record<string, unknown>[] = [];
    for (const recipient of watchers.get(input.target.profileId) ?? []) {
      rows.push({
        recipient_profile_id: recipient,
        type: "new_links",
        subject_profile_id: input.target.profileId,
        investigation_id: input.investigationId,
        payload: { target: input.target, added: input.added },
      });
    }
    for (const a of input.added) {
      for (const recipient of watchers.get(a.profileId) ?? []) {
        rows.push({
          recipient_profile_id: recipient,
          type: "watched_linked",
          subject_profile_id: a.profileId,
          investigation_id: input.investigationId,
          payload: { target: input.target, linked: a },
        });
      }
    }
    if (rows.length === 0) return;
    const supabase = getSupabase();
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) console.error("notifyNewLinks insert failed:", error.message);
  } catch (err) {
    console.error("notifyNewLinks failed:", err);
  }
}

export async function listNotifications(recipient: number, limit = 30): Promise<{ items: Notification[]; unread: number }> {
  const supabase = getSupabase();
  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, type, subject_profile_id, investigation_id, payload, read, created_at")
      .eq("recipient_profile_id", recipient)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_profile_id", recipient)
      .eq("read", false),
  ]);
  if (error) return { items: [], unread: 0 };
  const items = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    type: r.type as NotificationType,
    subjectProfileId: r.subject_profile_id as number,
    investigationId: (r.investigation_id as string | null) ?? null,
    payload: (r.payload as Record<string, unknown>) ?? {},
    read: Boolean(r.read),
    createdAt: r.created_at as string,
  }));
  return { items, unread: count ?? 0 };
}

export async function markNotificationsRead(recipient: number, ids?: number[]): Promise<void> {
  const supabase = getSupabase();
  let q = supabase.from("notifications").update({ read: true }).eq("recipient_profile_id", recipient).eq("read", false);
  if (ids && ids.length > 0) q = q.in("id", ids);
  const { error } = await q;
  if (error) throw new Error(error.message);
}
