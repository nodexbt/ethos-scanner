import { NextRequest, NextResponse } from "next/server";
import { getInvestigationByShareId } from "@/lib/db/investigations";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  // Rate limit by IP: 60 requests per minute. Prevents share-id enumeration.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (!rateLimit(`share:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { shareId } = await params;
  // Reject malformed share IDs outright (they're always lowercase alphanumeric, 22 chars)
  if (!/^[a-z0-9]{10,32}$/.test(shareId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const investigation = await getInvestigationByShareId(shareId);
  if (!investigation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(investigation);
}
