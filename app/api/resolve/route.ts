import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { resolveIdentifier, resolveScanTarget, type ScanIdentifier } from "@/lib/scan-target";

/**
 * Resolve free-form scan input (0x address, @handle, x.com / Ethos
 * profile URL) to a profile + wallet set before scanning. No quota:
 * this is a cheap Ethos API lookup the client uses to preview the
 * target and find cached investigations.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  // Either free text (?q=) or a typed identifier from a route
  // (?kind=handle|profileId|address&value=…), so routes never round-trip
  // through the text parser.
  const params = req.nextUrl.searchParams;
  const q = params.get("q");
  const kind = params.get("kind");
  const value = params.get("value") ?? "";
  let typed: ScanIdentifier | null = null;
  if (kind === "handle" && /^[A-Za-z0-9_]{1,15}$/.test(value)) typed = { kind, value };
  else if (kind === "profileId" && /^\d{1,12}$/.test(value)) typed = { kind, value };
  else if (kind === "address" && /^0x[a-fA-F0-9]{40}$/.test(value)) typed = { kind, value: value.toLowerCase() };
  if (!q && !typed) {
    return NextResponse.json({ error: "Missing q, or kind and value" }, { status: 400 });
  }

  const target = typed ? await resolveIdentifier(typed) : await resolveScanTarget(q!);
  if (!target) {
    return NextResponse.json(
      { error: "No Ethos profile or valid address found for that input" },
      { status: 404 }
    );
  }

  return NextResponse.json(target);
}
