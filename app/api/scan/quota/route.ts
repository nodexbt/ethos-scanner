import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getDailyScanUsage } from "@/lib/db/scan-quota";

// GET /api/scan/quota — the caller's remaining scans for today (UTC).
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const usage = await getDailyScanUsage(auth.profileId);
  return NextResponse.json({
    used: usage.used,
    limit: usage.limit,
    remaining: Math.max(0, usage.limit - usage.used),
    unlimited: auth.isAdmin,
  });
}
