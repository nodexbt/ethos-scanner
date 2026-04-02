import { NextRequest, NextResponse } from "next/server";
import {
  getInvestigation,
  deleteInvestigation,
} from "@/lib/db/investigations";

// GET /api/investigations/[id] — load one with screenshots
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const investigation = getInvestigation(id);
  if (!investigation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(investigation);
}

// DELETE /api/investigations/[id] — delete one
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  deleteInvestigation(id);
  return NextResponse.json({ ok: true });
}
