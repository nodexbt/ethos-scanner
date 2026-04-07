import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/auth";
import {
  removeAllowedUser,
  updateAllowedUserNote,
} from "@/lib/db/allowed-users";

interface RouteContext {
  params: Promise<{ profileId: string }>;
}

function parseProfileId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

// DELETE /api/admin/users/[profileId] — remove from allowlist
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;

  const { profileId: raw } = await params;
  const profileId = parseProfileId(raw);
  if (profileId === null) {
    return NextResponse.json({ error: "Invalid profileId" }, { status: 400 });
  }

  // Prevent admins from removing themselves — easy way to lock yourself out.
  if (profileId === auth.profileId) {
    return NextResponse.json(
      { error: "Cannot remove yourself" },
      { status: 400 }
    );
  }

  try {
    await removeAllowedUser(profileId, auth.profileId);
  } catch (err) {
    console.error("removeAllowedUser failed:", err);
    return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// PATCH /api/admin/users/[profileId] — update note
// Body: { note: string | null }
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;

  const { profileId: raw } = await params;
  const profileId = parseProfileId(raw);
  if (profileId === null) {
    return NextResponse.json({ error: "Invalid profileId" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const data = body as Record<string, unknown>;
  if (data.note !== null && typeof data.note !== "string") {
    return NextResponse.json({ error: "Invalid note" }, { status: 400 });
  }
  if (typeof data.note === "string" && data.note.length > 500) {
    return NextResponse.json({ error: "note too long" }, { status: 400 });
  }

  try {
    await updateAllowedUserNote(
      profileId,
      data.note as string | null,
      auth.profileId
    );
  } catch (err) {
    console.error("updateAllowedUserNote failed:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
