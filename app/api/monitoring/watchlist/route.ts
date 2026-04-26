import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getWatchlist } from "@/lib/db/monitoring";

// GET /api/monitoring/watchlist — list the caller's watched profiles
// joined to current state + today's activity.
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  try {
    const entries = await getWatchlist(auth.profileId);
    return NextResponse.json(entries);
  } catch (err) {
    console.error("getWatchlist failed:", err);
    return NextResponse.json({ error: "Failed to load watchlist" }, { status: 500 });
  }
}
