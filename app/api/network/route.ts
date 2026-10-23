import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getNetworkOverview } from "@/lib/db/network";

// GET /api/network — aggregates over the saved-scan edge graph.
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  return NextResponse.json(await getNetworkOverview(), { headers: { "Cache-Control": "private, max-age=60" } });
}
