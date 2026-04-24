import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getProfileDetail } from "@/lib/db/monitoring";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { profileId: raw } = await params;
  const profileId = Number.parseInt(raw, 10);
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return NextResponse.json({ error: "Invalid profileId" }, { status: 400 });
  }

  const rangeRaw = req.nextUrl.searchParams.get("range");
  const rangeDays = rangeRaw ? Number.parseInt(rangeRaw, 10) : 30;
  if (!Number.isFinite(rangeDays) || rangeDays <= 0) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  try {
    const detail = await getProfileDetail(profileId, rangeDays);
    return NextResponse.json(detail);
  } catch (err) {
    console.error("getProfileDetail failed:", err);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}
