import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { listInvestigations, getInvestigationStats, saveInvestigation } from "@/lib/db/investigations";
import { parseListParams } from "@/lib/list-params";
import { verifyProfileWallet } from "@/lib/scan-target";

// Cap on the serialized cluster result size (2 MB). Larger payloads are rejected
// to prevent DB bloat / DoS via arbitrary writes.
const MAX_CLUSTER_RESULT_BYTES = 2 * 1024 * 1024;

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

  // ID must be `scan-0x<40 hex>` (unattested wallet) or `scan-p<profileId>`
  // (Ethos profile) to prevent arbitrary key writes.
  if (typeof data.id !== "string" || !/^scan-(0x[a-f0-9]{40}|p\d{1,12})$/i.test(data.id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  if (typeof data.target !== "string" || !/^0x[a-f0-9]{40}$/i.test(data.target)) {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }

  // Canonicalize the id so case variants (scan-P123, scan-0xABC…) can't
  // create shadow rows that bypass the owner/PK guards, which key on the
  // exact id string.
  let id: string;
  let profileId: number | null = null;
  let targetWallets: string[] | null = null;

  // For profile-keyed ids, verify server-side that the target address is
  // actually attested to that profile — the client-supplied clusterResult
  // is not trusted for this. For legacy address ids, the target must match
  // the id's address.
  const profileMatch = data.id.match(/^scan-p(\d{1,12})$/i);
  if (profileMatch) {
    profileId = Number(profileMatch[1]);
    id = `scan-p${profileId}`;
    targetWallets = await verifyProfileWallet(profileId, data.target);
    if (!targetWallets) {
      return NextResponse.json({ error: "id/target mismatch" }, { status: 400 });
    }
  } else {
    id = `scan-${data.target.toLowerCase()}`;
    if (data.id.toLowerCase() !== id) {
      return NextResponse.json({ error: "id/target mismatch" }, { status: 400 });
    }
  }

  if (data.targetName !== null && typeof data.targetName !== "string") {
    return NextResponse.json({ error: "Invalid targetName" }, { status: 400 });
  }
  if (typeof data.targetName === "string" && data.targetName.length > 200) {
    return NextResponse.json({ error: "targetName too long" }, { status: 400 });
  }

  // clusterResult must be an object and under the size cap
  if (!data.clusterResult || typeof data.clusterResult !== "object") {
    return NextResponse.json({ error: "Invalid clusterResult" }, { status: 400 });
  }
  const serializedSize = JSON.stringify(data.clusterResult).length;
  if (serializedSize > MAX_CLUSTER_RESULT_BYTES) {
    return NextResponse.json({ error: "clusterResult too large" }, { status: 413 });
  }

  // twitterEvidence is the cross-cluster tweet search payload. Optional;
  // when present must be a plain object map (address → result). Cap the
  // serialized size at 4 MB to prevent runaway saves on big clusters.
  let twitterEvidence: Record<string, unknown> | undefined;
  if (data.twitterEvidence !== undefined && data.twitterEvidence !== null) {
    if (typeof data.twitterEvidence !== "object" || Array.isArray(data.twitterEvidence)) {
      return NextResponse.json({ error: "Invalid twitterEvidence" }, { status: 400 });
    }
    const serialized = JSON.stringify(data.twitterEvidence);
    if (serialized.length > 4 * 1024 * 1024) {
      return NextResponse.json({ error: "twitterEvidence too large" }, { status: 413 });
    }
    twitterEvidence = data.twitterEvidence as Record<string, unknown>;
  }

  // scan_duration_ms is optional and only set when the client is
  // saving fresh scan results (not when manually editing). Sanity-cap
  // to 10 minutes so a wildly wrong value can't poison the rolling
  // average — real scans are 30s-3min.
  let scanDurationMs: number | null = null;
  if (data.scanDurationMs != null) {
    if (typeof data.scanDurationMs !== "number" || !Number.isFinite(data.scanDurationMs)) {
      return NextResponse.json({ error: "Invalid scanDurationMs" }, { status: 400 });
    }
    if (data.scanDurationMs > 0 && data.scanDurationMs < 10 * 60 * 1000) {
      scanDurationMs = Math.round(data.scanDurationMs);
    }
  }

  try {
    await saveInvestigation({
      id,
      target: data.target.toLowerCase(),
      targetName: (data.targetName as string | null) ?? null,
      clusterResult: data.clusterResult,
      ownerProfileId: auth.profileId,
      profileId,
      targetWallets,
      scanDurationMs,
      twitterEvidence,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Not authorized")) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    console.error("saveInvestigation failed:", err);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
