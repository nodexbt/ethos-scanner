import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getInvestigation, deleteInvestigation, shareInvestigation } from "@/lib/db/investigations";

// GET /api/investigations/[id] — load one
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const investigation = await getInvestigation(id);
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
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  await deleteInvestigation(id);
  return NextResponse.json({ ok: true });
}

// PATCH /api/investigations/[id] — share
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const shareId = await shareInvestigation(id);
  if (!shareId) {
    return NextResponse.json({ error: "Failed to share" }, { status: 500 });
  }
  return NextResponse.json({ shareId });
}
