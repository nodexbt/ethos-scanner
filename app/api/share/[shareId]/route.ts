import { NextRequest, NextResponse } from "next/server";
import { getInvestigationByShareId } from "@/lib/db/investigations";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  const { shareId } = await params;
  const investigation = await getInvestigationByShareId(shareId);
  if (!investigation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(investigation);
}
