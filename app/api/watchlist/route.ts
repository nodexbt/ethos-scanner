import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { listWatched, isWatching, addWatch, removeWatch } from "@/lib/db/watchlist";

// GET /api/watchlist            → the caller's watched profiles
// GET /api/watchlist?profileId= → { watching: boolean } for one profile
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const pid = req.nextUrl.searchParams.get("profileId");
  if (pid) {
    const id = Number(pid);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid profileId" }, { status: 400 });
    return NextResponse.json({ watching: await isWatching(auth.profileId, id) });
  }
  return NextResponse.json({ watched: await listWatched(auth.profileId) });
}

// POST /api/watchlist { profileId, watch: boolean }
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const body = (await req.json().catch(() => null)) as { profileId?: unknown; watch?: unknown } | null;
  const id = Number(body?.profileId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid profileId" }, { status: 400 });
  if (body?.watch === false) await removeWatch(auth.profileId, id);
  else await addWatch(auth.profileId, id);
  return NextResponse.json({ watching: body?.watch !== false });
}
