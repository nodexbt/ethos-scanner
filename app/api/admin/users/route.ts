import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/auth";
import { addAllowedUser, listAllowedUsers } from "@/lib/db/allowed-users";
import { fetchProfile } from "@/lib/ethos";

// GET /api/admin/users — list all allowlisted users (admin only)
export async function GET() {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;

  const users = await listAllowedUsers();
  return NextResponse.json(users);
}

// POST /api/admin/users — add a user by handle, profile ID, or address
// Body: { identifier: string, note?: string }
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;

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

  if (typeof data.identifier !== "string" || !data.identifier.trim()) {
    return NextResponse.json(
      { error: "identifier is required" },
      { status: 400 }
    );
  }
  // Strip leading @ from handles for convenience
  const identifier = data.identifier.trim().replace(/^@/, "");

  if (data.note !== undefined && data.note !== null && typeof data.note !== "string") {
    return NextResponse.json({ error: "Invalid note" }, { status: 400 });
  }
  const note = (data.note as string | null | undefined) ?? null;
  if (note && note.length > 500) {
    return NextResponse.json({ error: "note too long" }, { status: 400 });
  }

  // Resolve via Ethos so we capture display name + avatar and validate
  // that the profile actually exists.
  const ethos = await fetchProfile(identifier);
  if (!ethos) {
    return NextResponse.json(
      { error: `No Ethos profile found for "${identifier}"` },
      { status: 404 }
    );
  }
  if (ethos.profileId === null) {
    return NextResponse.json(
      { error: "Resolved Ethos record has no profileId (incomplete profile)" },
      { status: 422 }
    );
  }

  const user = await addAllowedUser({
    profileId: ethos.profileId,
    addedBy: auth.profileId,
    note,
    twitterUsername: ethos.username,
    displayName: ethos.displayName,
    avatarUrl: ethos.avatarUrl,
  });

  return NextResponse.json(user);
}
