import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { listVerifiedInvestigations } from "@/lib/db/investigations";

// GET /api/investigations/verified?limit=50&offset=0
// Investigations whose target is the primary wallet of a human-verified
// Ethos profile, sorted by strong-cluster count desc at the DB level.
// Returns { rows, total } so the client can render a "Show more" affordance.
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const url = req.nextUrl;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

  const { rows, total } = await listVerifiedInvestigations({ limit, offset });

  const enriched = rows.map((inv) => {
    const { lastScannedByProfileId, ...rest } = inv;
    return auth.isAdmin
      ? { ...rest, lastScannedByProfileId, lastScannedBy: null }
      : { ...rest, lastScannedByProfileId: null, lastScannedBy: null };
  });

  return NextResponse.json({ rows: enriched, total });
}
