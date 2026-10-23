import { fetchProfile, type EthosProfile } from "@/lib/ethos";
import { getInvestigation } from "@/lib/db/investigations";

export interface PublicLink {
  profileId: number;
  displayName: string;
  username: string | null;
  avatarUrl: string;
  ethosScore: number;
  confidence: "high" | "medium";
  linkStrength: number;
}

export interface PublicProfileSummary {
  profile: {
    profileId: number;
    displayName: string;
    username: string | null;
    avatarUrl: string;
    score: number;
    humanVerified: boolean;
  };
  scan: null | {
    scannedAt: string | null;
    strongCount: number;
    possibleCount: number;
    degraded: boolean;
    coverageNotes: number;
    links: PublicLink[];
  };
}

/**
 * Summary-only view of a profile's latest scan for the public page:
 * who is linked and how strongly, but none of the on-chain evidence.
 * `handle` is an X username or a numeric Ethos profile id.
 */
export async function getPublicProfileSummary(handle: string): Promise<PublicProfileSummary | null> {
  const id = handle.trim().replace(/^@/, "");
  if (!/^(\d{1,12}|[A-Za-z0-9_]{1,15})$/.test(id)) return null;

  let profile: EthosProfile | null = null;
  try {
    profile = await fetchProfile(id);
  } catch {
    profile = null;
  }
  if (!profile || !profile.profileId) return null;

  const investigation = await getInvestigation(`scan-p${profile.profileId}`);
  type Lite = { score: number; ethosProfile?: { profileId: number; displayName: string; username: string | null; avatarUrl: string; score: number } };
  const cr = investigation?.clusterResult as
    | { strongCluster?: Lite[]; possibleCluster?: Lite[]; degraded?: unknown; coverageNotes?: string[] }
    | null
    | undefined;

  const toLinks = (list: Lite[] | undefined, confidence: "high" | "medium"): PublicLink[] =>
    (list ?? [])
      .filter((c) => c.ethosProfile?.profileId)
      .map((c) => ({
        profileId: c.ethosProfile!.profileId,
        displayName: c.ethosProfile!.displayName,
        username: c.ethosProfile!.username,
        avatarUrl: c.ethosProfile!.avatarUrl,
        ethosScore: c.ethosProfile!.score,
        confidence,
        linkStrength: Math.round(c.score),
      }));

  return {
    profile: {
      profileId: profile.profileId,
      displayName: profile.displayName,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      score: profile.score,
      humanVerified: profile.humanVerificationStatus === "VERIFIED",
    },
    scan: cr
      ? {
          scannedAt: investigation?.updatedAt ?? null,
          strongCount: cr.strongCluster?.length ?? 0,
          possibleCount: cr.possibleCluster?.length ?? 0,
          degraded: Boolean(cr.degraded),
          coverageNotes: cr.coverageNotes?.length ?? 0,
          links: [...toLinks(cr.strongCluster, "high"), ...toLinks(cr.possibleCluster, "medium")],
        }
      : null,
  };
}
