import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { listInvestigations, getInvestigationStats } from "@/lib/db/investigations";
import { parseListParams } from "@/lib/list-params";

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

// There is no POST. Scan results are written server-side by /api/scan, and
// X evidence is attached only by the operator-run backfill script
// (scripts/backfill/scan-verified.ts --twitter) through saveInvestigation.
// The old client POST let any signed-in user write arbitrary JSON into any
// investigation's twitter_evidence, which ends up verbatim in the evidence
// export; nothing in the UI called it any more, so it was removed.
