import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { listInvestigations, saveInvestigation } from "@/lib/db/investigations";

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

// GET /api/investigations — list all
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const investigations = await listInvestigations();

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

  return NextResponse.json(enriched);
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

  // ID must be of the form `scan-0x<40 hex>` to prevent arbitrary key writes.
  if (typeof data.id !== "string" || !/^scan-0x[a-f0-9]{40}$/i.test(data.id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // target must match the ID's address
  if (typeof data.target !== "string" || !/^0x[a-f0-9]{40}$/i.test(data.target)) {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }
  if (data.id.toLowerCase() !== `scan-${data.target.toLowerCase()}`) {
    return NextResponse.json({ error: "id/target mismatch" }, { status: 400 });
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

  if (data.aiAnalysis !== null && data.aiAnalysis !== undefined && typeof data.aiAnalysis !== "string") {
    return NextResponse.json({ error: "Invalid aiAnalysis" }, { status: 400 });
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
      id: data.id,
      target: data.target.toLowerCase(),
      targetName: (data.targetName as string | null) ?? null,
      clusterResult: data.clusterResult,
      aiAnalysis: (data.aiAnalysis as string | null) ?? null,
      ownerProfileId: auth.profileId,
      scanDurationMs,
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
