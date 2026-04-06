import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isAdminProfileId } from "@/lib/admin";

export interface AuthedUser {
  profileId: number;
  twitterUsername: string | null;
  isAdmin: boolean;
}

/**
 * Parses the ETHOS_PROFILE_ALLOWLIST env var fresh on every call,
 * so allowlist changes take effect immediately (no redeploy required
 * if you update the env var at runtime) and sessions are re-validated
 * on every request.
 */
function getAllowlist(): number[] {
  return (process.env.ETHOS_PROFILE_ALLOWLIST || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/**
 * Require a valid, currently-allowlisted session for an API route.
 * Returns an AuthedUser if authorized, or a NextResponse error to
 * return directly if unauthorized.
 *
 * Re-checks the allowlist on every call so users removed from the
 * allowlist lose access immediately, even if their JWT is still valid.
 */
export async function requireAuth(): Promise<AuthedUser | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // @ts-expect-error - ethos field added in session callback
  const profileId = session.user.ethos?.profileId;
  if (typeof profileId !== "number") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const allowlist = getAllowlist();
  if (!allowlist.includes(profileId)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  return {
    profileId,
    // @ts-expect-error - twitterUsername added in session callback
    twitterUsername: session.user.twitterUsername ?? null,
    isAdmin: isAdminProfileId(profileId),
  };
}

export function isAuthError(result: AuthedUser | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
