import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { isTrustedOrigin } from "@/lib/origin";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isAdminProfileId } from "@/lib/admin";
import { isAllowed } from "@/lib/db/allowed-users";
import { meetsOpenAccessBar } from "@/lib/access";

export interface AuthedUser {
  profileId: number;
  twitterUsername: string | null;
  isAdmin: boolean;
}

/**
 * Require a valid, currently-allowlisted session for an API route.
 * Returns an AuthedUser if authorized, or a NextResponse error to
 * return directly if unauthorized.
 *
 * Re-checks the DB allowlist on every call (via short-lived cache in
 * lib/db/allowed-users) so users removed from the allowlist lose access
 * within ~10 seconds, even if their JWT is still valid.
 */
export async function requireAuth(): Promise<AuthedUser | NextResponse> {
  // Refuse requests another site made the browser send (see lib/origin.ts)
  // before touching the session at all.
  if (!isTrustedOrigin(await headers())) {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  }

  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // @ts-expect-error - ethos field added in session callback
  const ethos = session.user.ethos;
  const profileId = ethos?.profileId;
  if (typeof profileId !== "number") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Same OR-rule as login: open bar (validator, or verified + score) OR
  // manual allowlist.
  const eligible =
    meetsOpenAccessBar({
      score: ethos?.score,
      humanVerificationStatus: ethos?.humanVerificationStatus,
      validatorNftCount: ethos?.validatorNftCount,
    }) || (await isAllowed(profileId));
  if (!eligible) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  return {
    profileId,
    // @ts-expect-error - twitterUsername added in session callback
    twitterUsername: session.user.twitterUsername ?? null,
    isAdmin: isAdminProfileId(profileId),
  };
}

/**
 * Like requireAuth, but additionally requires the caller to be an admin.
 */
export async function requireAdmin(): Promise<AuthedUser | NextResponse> {
  const result = await requireAuth();
  if (result instanceof NextResponse) return result;
  if (!result.isAdmin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return result;
}

export function isAuthError(result: AuthedUser | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
