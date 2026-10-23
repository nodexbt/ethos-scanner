import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getActiveScanJob, ScanJobsUnavailable } from "@/lib/db/scan-jobs";

// GET /api/scan/jobs — the caller's active (queued/running) job, if any,
// so a reload can resume watching it.
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  try {
    const job = await getActiveScanJob(auth.profileId);
    return NextResponse.json({ job }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ScanJobsUnavailable) return NextResponse.json({ job: null });
    throw err;
  }
}
