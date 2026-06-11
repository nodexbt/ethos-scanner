import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import {
  getInvestigation,
  deleteInvestigation,
  shareInvestigation,
  getInvestigationOwner,
} from "@/lib/db/investigations";

// GET /api/investigations/[id] — load one
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;
  const investigation = await getInvestigation(id);
  if (!investigation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(investigation);
}

// DELETE /api/investigations/[id] — delete one (owner only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;
  const owner = await getInvestigationOwner(id);
  // Legacy ownerless rows were backfilled, so a null owner means the row
  // doesn't exist or is unclaimed — either way, only admins may act on it.
  if (!auth.isAdmin && owner !== auth.profileId) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  await deleteInvestigation(id);
  return NextResponse.json({ ok: true });
}

// PATCH /api/investigations/[id] — share (owner only)
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;
  const owner = await getInvestigationOwner(id);
  if (!auth.isAdmin && owner !== auth.profileId) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const shareId = await shareInvestigation(id);
  if (!shareId) {
    return NextResponse.json({ error: "Failed to share" }, { status: 500 });
  }
  return NextResponse.json({ shareId });
}
