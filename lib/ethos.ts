const ETHOS_API = "https://api.ethos.network/api/v2";
const HEADERS = {
  "X-Ethos-Client": "ethos-scanner@0.1.0",
};

export interface EthosProfile {
  id: number;
  profileId: number | null;
  displayName: string;
  username: string | null;
  avatarUrl: string;
  description: string | null;
  score: number;
  status: "ACTIVE" | "INACTIVE" | "MERGED";
  userkeys: string[];
  xpTotal: number;
  xpStreakDays: number;
  xpRemovedDueToAbuse: boolean;
  influenceFactor: number;
  influenceFactorPercentile: number;
  humanVerificationStatus: "VERIFIED" | null;
  validatorNftCount: number;
  links: {
    profile: string;
    scoreBreakdown: string;
  };
  stats: {
    review: {
      received: {
        negative: number;
        neutral: number;
        positive: number;
      };
    };
    vouch: {
      given: {
        amountWeiTotal: number;
        count: number;
      };
      received: {
        amountWeiTotal: number;
        count: number;
      };
    };
  };
}

export interface Invitation {
  id: number;
  senderProfileId: number;
  acceptedProfileId: number;
  level: number;
  user: {
    id: number;
    profileId: number | null;
    displayName: string;
    username: string | null;
    avatarUrl: string;
    score: number;
  };
}

export interface ReviewActivity {
  // "review" / "vouch" for active records; archived vouches come back as "unvouch".
  type: "review" | "vouch" | "unvouch";
  data: {
    id: number;
    authorProfileId: number;
    author: string;
    subject: string;
    score: "positive" | "neutral" | "negative";
    comment?: string;
    createdAt: number;
    archived: boolean;
  };
  // Canonical app.ethos.network URL for this activity.
  link?: string;
  // Unix seconds of the most recent event on this activity (creation, or archival for unvouches).
  timestamp?: number;
  author: {
    profileId: number;
    name: string;
    username: string | null;
    avatar: string;
  };
  subject: {
    profileId: number;
    name: string;
    username: string | null;
    avatar: string;
  };
}

export function isEthereumAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export async function fetchProfile(
  identifier: string
): Promise<EthosProfile | null> {
  let url: string;

  if (/^\d+$/.test(identifier)) {
    // GET user/by/profile/{id} returns 404 for every id as of Oct 2026;
    // the bulk POST still resolves ids, so use it for single lookups too.
    const [profile] = await fetchProfilesByIds([Number(identifier)]);
    return profile ?? null;
  } else if (isEthereumAddress(identifier)) {
    url = `${ETHOS_API}/user/by/address/${identifier}`;
  } else {
    url = `${ETHOS_API}/user/by/x/${encodeURIComponent(identifier)}`;
  }

  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) return null;
  return response.json();
}

/**
 * The profile attested to an X handle. Unlike fetchProfile it never reads
 * an all-digit handle (X allows "12345") as an Ethos profile id.
 */
export async function fetchProfileByX(handle: string): Promise<EthosProfile | null> {
  const response = await fetch(`${ETHOS_API}/user/by/x/${encodeURIComponent(handle)}`, { headers: HEADERS });
  if (!response.ok) return null;
  return response.json();
}

/** Bulk lookup Ethos profiles by wallet addresses (up to 500 at a time) */
export async function fetchProfilesByAddresses(
  addresses: string[],
  /** Called when a bulk batch fails (the per-address fallback still runs,
      but may miss profiles). Lets the scanner mark the result degraded. */
  onBatchError?: (reason: string) => void
): Promise<Map<string, EthosProfile>> {
  const result = new Map<string, EthosProfile>();
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()).filter(Boolean))];
  if (unique.length === 0) return result;

  const BATCH_SIZE = 500;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const chunk = unique.slice(i, i + BATCH_SIZE);
    try {
      const response = await fetch(`${ETHOS_API}/users/by/address`, {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: chunk }),
      });

      if (!response.ok) {
        onBatchError?.(`Ethos bulk lookup returned ${response.status} for ${chunk.length} addresses`);
        // Fallback: try individual lookups for this chunk
        for (const addr of chunk) {
          try {
            const profile = await fetchProfile(addr);
            if (profile && profile.profileId) {
              // Find which address this profile belongs to
              const wallets = getWalletAddresses(profile);
              for (const w of wallets) {
                if (chunk.includes(w)) result.set(w, profile);
              }
              // Also map by the queried address
              result.set(addr, profile);
            }
          } catch {
            // Skip
          }
        }
        continue;
      }

      const data = await response.json();
      const profiles: EthosProfile[] = Array.isArray(data) ? data : (data.values || []);

      for (const profile of profiles) {
        if (!profile || !profile.profileId) continue;
        // Map by all wallet addresses in userkeys
        const wallets = getWalletAddresses(profile);
        for (const w of wallets) {
          result.set(w, profile);
        }
      }
    } catch (err) {
      onBatchError?.(`Ethos bulk lookup threw for ${chunk.length} addresses: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

/**
 * Bulk lookup Ethos profiles by profile id. The API accepts at most 500 ids
 * per call and simply omits ids that don't exist. Throws on a non-OK
 * response so callers (the mirror sync) can retry rather than treat a
 * failed batch as "no such profiles".
 */
export const PROFILE_ID_BATCH_SIZE = 500;

export async function fetchProfilesByIds(profileIds: number[]): Promise<EthosProfile[]> {
  if (profileIds.length === 0) return [];
  if (profileIds.length > PROFILE_ID_BATCH_SIZE) {
    throw new Error(`fetchProfilesByIds: max ${PROFILE_ID_BATCH_SIZE} ids per call`);
  }
  const response = await fetch(`${ETHOS_API}/users/by/profile-id`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ profileIds }),
  });
  if (!response.ok) {
    throw new Error(`users/by/profile-id ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : (data.values ?? []);
}

export async function fetchInvitationTree(
  profileId: number
): Promise<Invitation[]> {
  const response = await fetch(
    `${ETHOS_API}/invitations/accepted/${profileId}/tree`,
    { headers: HEADERS }
  );
  if (!response.ok) return [];
  const data = await response.json();
  return data.values || data || [];
}

export async function fetchActivities(
  profileId: number,
  direction: "given" | "received",
  filter: string[] = ["review"],
  limit: number = 100
): Promise<ReviewActivity[]> {
  const response = await fetch(
    `${ETHOS_API}/activities/profile/${direction}`,
    {
      method: "POST",
      headers: {
        ...HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userkey: `profileId:${profileId}`,
        filter,
        limit,
      }),
    }
  );
  if (!response.ok) return [];
  const data = await response.json();
  return data.values || [];
}

/** Extract wallet addresses from a profile's userkeys */
export function getWalletAddresses(profile: EthosProfile): string[] {
  const wallets: string[] = [];
  for (const key of profile.userkeys) {
    // Format: "address:0x..."
    if (key.startsWith("address:")) {
      const addr = key.slice("address:".length);
      if (/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        wallets.push(addr.toLowerCase());
      }
    }
    // Also match raw 0x addresses just in case
    if (/^0x[a-fA-F0-9]{40}$/.test(key)) {
      wallets.push(key.toLowerCase());
    }
  }
  return [...new Set(wallets)];
}
