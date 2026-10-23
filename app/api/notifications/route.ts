import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { listNotifications, markNotificationsRead } from "@/lib/db/notifications";

// GET /api/notifications → { items, unread }
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  return NextResponse.json(await listNotifications(auth.profileId), { headers: { "Cache-Control": "no-store" } });
}

// POST /api/notifications { ids?: number[] } → mark read (all when omitted)
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : undefined;
  try {
    await markNotificationsRead(auth.profileId, ids);
  } catch {
    // Table may not exist yet; nothing to mark.
  }
  return NextResponse.json({ ok: true });
}
