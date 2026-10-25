import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import {
  getInvestigation,
  deleteInvestigation,
  shareInvestigation,
  unshareInvestigation,
  getInvestigationShare,
  getInvestigationOwner,
} from "@/lib/db/investigations";

// GET /api/investigations/[id] — load one
// GET /api/investigations/[id]?fields=share — just its sharing state
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;
  if (req.nextUrl.searchParams.get("fields") === "share") {
    const share = await getInvestigationShare(id);
    if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      isPublic: share.isPublic,
      shareId: share.isPublic ? share.shareId : null,
      canManage: auth.isAdmin || share.ownerProfileId === auth.profileId,
    });
  }
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
  try {
    await deleteInvestigation(id);
  } catch {
    return NextResponse.json({ error: "Failed to delete scan" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// PATCH /api/investigations/[id] — share (owner only).
// Body { "public": false } stops sharing; no body (or true) shares.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;
  const owner = await getInvestigationOwner(id);
  if (!auth.isAdmin && owner !== auth.profileId) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { public?: unknown } | null;
  if (body?.public === false) {
    if (!(await unshareInvestigation(id))) {
      return NextResponse.json({ error: "Failed to stop sharing" }, { status: 500 });
    }
    return NextResponse.json({ isPublic: false, shareId: null });
  }

  const shareId = await shareInvestigation(id);
  if (!shareId) {
    return NextResponse.json({ error: "Failed to share" }, { status: 500 });
  }
  return NextResponse.json({ isPublic: true, shareId });
}
