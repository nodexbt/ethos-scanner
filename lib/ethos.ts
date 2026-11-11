const ETHOS_API = "https://api.ethos.network/api/v2";
const HEADERS = {
  "X-Ethos-Client": "ethos-scanner@0.1.0",
};
/** Every Ethos call gives up after this long; a hung socket must not stall
    a scan while its heartbeat keeps saying "running". */
const REQUEST_TIMEOUT_MS = 20_000;

function ethosFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...HEADERS, ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

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
    return fetchProfileByX(identifier);
  }

  const response = await ethosFetch(url);
  if (!response.ok) return null;
  return response.json();
}

/**
 * The profile attested to an X handle. Unlike fetchProfile it never reads
 * an all-digit handle (X allows "12345") as an Ethos profile id.
 */
export async function fetchProfileByX(handle: string): Promise<EthosProfile | null> {
  const response = await ethosFetch(`${ETHOS_API}/user/by/x/${encodeURIComponent(handle)}`);
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
    const profiles = await fetchAddressBatch(chunk, onBatchError);
    for (const profile of profiles) {
      if (!profile || !profile.profileId) continue;
      // Map by all wallet addresses in userkeys
      for (const w of getWalletAddresses(profile)) result.set(w, profile);
    }
  }

  return result;
}

const BULK_ATTEMPTS = 3;

/**
 * One bulk address batch, retried with backoff on 429/5xx. On a rate limit
 * the old code fell back to one request per address: up to 500 sequential
 * calls against an API that had just asked us to slow down. Now the batch
 * is retried a few times and, if it still fails, reported through
 * onBatchError so the scan is marked degraded instead of quietly losing
 * every candidate in the chunk.
 */
async function fetchAddressBatch(
  chunk: string[],
  onBatchError?: (reason: string) => void
): Promise<EthosProfile[]> {
  let reason = "";
  for (let attempt = 1; attempt <= BULK_ATTEMPTS; attempt++) {
    try {
      const response = await ethosFetch(`${ETHOS_API}/users/by/address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: chunk }),
      });
      if (response.ok) {
        const data = await response.json();
        const profiles = Array.isArray(data) ? data : data?.values;
        if (!Array.isArray(profiles)) {
          // A 200 with an unexpected body is a failure, not "no profiles".
          reason = `Ethos bulk lookup returned an unexpected body for ${chunk.length} addresses`;
          break;
        }
        return profiles as EthosProfile[];
      }
      reason = `Ethos bulk lookup returned ${response.status} for ${chunk.length} addresses`;
      const retriable = response.status === 429 || response.status >= 500;
      if (!retriable) break;
    } catch (err) {
      reason = `Ethos bulk lookup threw for ${chunk.length} addresses: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (attempt < BULK_ATTEMPTS) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
  }
  onBatchError?.(reason);
  return [];
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
  const response = await ethosFetch(`${ETHOS_API}/users/by/profile-id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const response = await ethosFetch(`${ETHOS_API}/invitations/accepted/${profileId}/tree`);
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
  const response = await ethosFetch(
    `${ETHOS_API}/activities/profile/${direction}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
