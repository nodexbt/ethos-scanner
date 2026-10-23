import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getScanJob } from "@/lib/db/scan-jobs";

// GET /api/scan/jobs/[id] — poll a scan job. Only the requester (or an
// admin) can read it; logs may name wallets the requester is looking into.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const job = await getScanJob(id);
  if (!job || (job.requestedBy !== auth.profileId && !auth.isAdmin)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
}
