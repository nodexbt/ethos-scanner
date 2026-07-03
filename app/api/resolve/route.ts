import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { resolveScanTarget } from "@/lib/scan-target";

/**
 * Resolve free-form scan input (0x address, @handle, x.com / Ethos
 * profile URL) to a profile + wallet set before scanning. No quota:
 * this is a cheap Ethos API lookup the client uses to preview the
 * target and find cached investigations.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const q = req.nextUrl.searchParams.get("q");
  if (!q) {
    return NextResponse.json({ error: "Missing q parameter" }, { status: 400 });
  }

  const target = await resolveScanTarget(q);
  if (!target) {
    return NextResponse.json(
      { error: "No Ethos profile or valid address found for that input" },
      { status: 404 }
    );
  }

  return NextResponse.json(target);
}
