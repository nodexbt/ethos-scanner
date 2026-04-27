import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getMonitoringSummary } from "@/lib/db/monitoring";

// GET /api/monitoring/summary?range=N — top movers, spikes, new profiles
// over the last N days (default 1 = today only).
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const rangeRaw = req.nextUrl.searchParams.get("range");
  const rangeDays = rangeRaw ? Number.parseInt(rangeRaw, 10) : 1;
  if (!Number.isFinite(rangeDays) || rangeDays <= 0) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  try {
    const summary = await getMonitoringSummary(rangeDays);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("getMonitoringSummary failed:", err);
    return NextResponse.json({ error: "Failed to load summary" }, { status: 500 });
  }
}
