import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { addToWatchlist, removeFromWatchlist, isWatching } from "@/lib/db/monitoring";

function parseProfileId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// GET → { watching: boolean } for the caller
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { profileId: raw } = await params;
  const watched = parseProfileId(raw);
  if (!watched) return NextResponse.json({ error: "Invalid profileId" }, { status: 400 });

  try {
    const watching = await isWatching(auth.profileId, watched);
    return NextResponse.json({ watching });
  } catch (err) {
    console.error("isWatching failed:", err);
    return NextResponse.json({ error: "Failed to check watchlist" }, { status: 500 });
  }
}

// POST → add to watchlist
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { profileId: raw } = await params;
  const watched = parseProfileId(raw);
  if (!watched) return NextResponse.json({ error: "Invalid profileId" }, { status: 400 });
  if (watched === auth.profileId) {
    return NextResponse.json({ error: "Cannot watch yourself" }, { status: 400 });
  }

  try {
    await addToWatchlist(auth.profileId, watched);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("addToWatchlist failed:", err);
    return NextResponse.json({ error: "Failed to add to watchlist" }, { status: 500 });
  }
}

// DELETE → remove from watchlist
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { profileId: raw } = await params;
  const watched = parseProfileId(raw);
  if (!watched) return NextResponse.json({ error: "Invalid profileId" }, { status: 400 });

  try {
    await removeFromWatchlist(auth.profileId, watched);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("removeFromWatchlist failed:", err);
    return NextResponse.json({ error: "Failed to remove from watchlist" }, { status: 500 });
  }
}
