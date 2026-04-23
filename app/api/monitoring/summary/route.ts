import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getMonitoringSummary } from "@/lib/db/monitoring";

// GET /api/monitoring/summary — top movers, spikes, new profiles for today
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  try {
    const summary = await getMonitoringSummary();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("getMonitoringSummary failed:", err);
    return NextResponse.json({ error: "Failed to load summary" }, { status: 500 });
  }
}
