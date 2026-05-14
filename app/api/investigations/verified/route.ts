import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { listVerifiedInvestigations } from "@/lib/db/investigations";

// GET /api/investigations/verified — investigations whose target is the
// primary wallet of a human-verified Ethos profile, sorted by strong-cluster
// count desc. Lastscanned attribution stripped for non-admins, same as
// /api/investigations.
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const investigations = await listVerifiedInvestigations();

  const enriched = investigations.map((inv) => {
    const { lastScannedByProfileId, ...rest } = inv;
    return auth.isAdmin
      ? { ...rest, lastScannedByProfileId, lastScannedBy: null }
      : { ...rest, lastScannedByProfileId: null, lastScannedBy: null };
  });

  return NextResponse.json(enriched);
}
