import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { listInvestigations, getInvestigationStats, mergeTwitterEvidence } from "@/lib/db/investigations";
import { parseListParams } from "@/lib/list-params";

// Cap on the serialized evidence payload (4 MB) to prevent runaway writes.
const MAX_TWITTER_EVIDENCE_BYTES = 4 * 1024 * 1024;

interface ResolvedProfile {
  displayName: string;
  avatarUrl: string;
  profileUrl: string;
}

// In-memory cache for resolved Ethos profiles, keyed by profileId.
// 5 minute TTL is fine — display name / avatar change rarely.
const profileCache = new Map<
  number,
  { data: ResolvedProfile | null; expires: number }
>();
const PROFILE_TTL_MS = 5 * 60 * 1000;

interface EthosBulkProfile {
  profileId: number | null;
  displayName: string;
  avatarUrl: string;
  links?: { profile?: string };
}

async function resolveProfiles(
  profileIds: number[]
): Promise<Map<number, ResolvedProfile | null>> {
  const out = new Map<number, ResolvedProfile | null>();
  const now = Date.now();
  const toFetch: number[] = [];

  for (const id of profileIds) {
    const cached = profileCache.get(id);
    if (cached && cached.expires > now) {
      out.set(id, cached.data);
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length === 0) return out;

  try {
    const resp = await fetch(
      "https://api.ethos.network/api/v2/users/by/profile-id",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ethos-Client": "ethos-scanner@0.1.0",
        },
        body: JSON.stringify({ profileIds: toFetch }),
      }
    );

    if (resp.ok) {
      const profiles: EthosBulkProfile[] = await resp.json();
      for (const p of profiles) {
        if (p.profileId === null || p.profileId === undefined) continue;
        const data: ResolvedProfile = {
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          profileUrl: p.links?.profile || "",
        };
        out.set(p.profileId, data);
        profileCache.set(p.profileId, {
          data,
          expires: now + PROFILE_TTL_MS,
        });
      }
    }
  } catch (err) {
    console.error("resolveProfiles failed:", err);
  }

  // Mark any IDs we asked for but didn't get back as null so we don't refetch
  // them in a tight loop.
  for (const id of toFetch) {
    if (!out.has(id)) {
      out.set(id, null);
      profileCache.set(id, { data: null, expires: now + PROFILE_TTL_MS });
    }
  }

  return out;
}

// GET /api/investigations?limit=25&offset=0[&scope=mine][&stats=1]
// Server-paginated like /api/investigations/verified — returns
// { rows, total } sorted by updated_at desc. scope=mine filters to the
// caller's own scans; stats=1 additionally returns global signal sums
// for the scanner empty-state cards.
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const url = req.nextUrl;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const scope = url.searchParams.get("scope");
  const withStats = url.searchParams.get("stats") === "1";

  const { rows: investigations, total } = await listInvestigations({
    limit,
    offset,
    ownerProfileId: scope === "mine" ? auth.profileId : null,
    ...parseListParams(url.searchParams),
  });
  const stats = withStats ? await getInvestigationStats() : undefined;

  // Scanner attribution is admin-only — non-admins should not see who scanned
  // a wallet. Skip the resolve step entirely for non-admins so we don't leak
  // profile IDs over the wire either.
  const resolved = auth.isAdmin
    ? await resolveProfiles([
        ...new Set(
          investigations
            .map((inv) => inv.lastScannedByProfileId)
            .filter((id): id is number => id !== null)
        ),
      ])
    : null;

  const enriched = investigations.map((inv) => {
    const { lastScannedByProfileId, ...rest } = inv;
    if (!auth.isAdmin) {
      return { ...rest, lastScannedByProfileId: null, lastScannedBy: null };
    }
    return {
      ...rest,
      lastScannedByProfileId,
      lastScannedBy:
        lastScannedByProfileId !== null
          ? resolved!.get(lastScannedByProfileId) ?? null
          : null,
    };
  });

  return NextResponse.json({ rows: enriched, total, ...(stats && { stats }) });
}

// POST /api/investigations — save/update
// POST /api/investigations — attach X/Twitter evidence to a saved scan.
// Scan results themselves are written server-side by /api/scan when a scan
// completes; clients can no longer submit a cluster result.
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
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

  if (typeof data.id !== "string" || !/^scan-(0x[a-f0-9]{40}|p\d{1,12})$/i.test(data.id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const id = data.id.toLowerCase().startsWith("scan-p")
    ? `scan-p${Number(data.id.slice(6))}`
    : data.id.toLowerCase();

  if (data.clusterResult !== undefined) {
    return NextResponse.json(
      { error: "Scan results are saved by the server; this endpoint only accepts twitterEvidence" },
      { status: 400 }
    );
  }
  if (!data.twitterEvidence || typeof data.twitterEvidence !== "object" || Array.isArray(data.twitterEvidence)) {
    return NextResponse.json({ error: "twitterEvidence required" }, { status: 400 });
  }
  if (JSON.stringify(data.twitterEvidence).length > MAX_TWITTER_EVIDENCE_BYTES) {
    return NextResponse.json({ error: "twitterEvidence too large" }, { status: 413 });
  }

  try {
    const ok = await mergeTwitterEvidence(id, data.twitterEvidence as Record<string, unknown>);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.error("mergeTwitterEvidence failed:", err);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
