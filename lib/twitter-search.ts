import { getSupabase } from "@/lib/db/supabase";

const TWITTERAPI_IO_BASE = "https://api.twitterapi.io";

interface RawAuthor {
  userName?: string;
  name?: string;
  profilePicture?: string;
  isBlueVerified?: boolean;
  isVerified?: boolean;
  followers?: number;
}

interface RawTweet {
  id?: string;
  url?: string;
  text?: string;
  createdAt?: string;
  likeCount?: number;
  replyCount?: number;
  retweetCount?: number;
  viewCount?: number;
  lang?: string;
  isReply?: boolean;
  author?: RawAuthor;
}

export interface TwitterTweet {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
  retweetCount: number;
  viewCount: number;
  isReply: boolean;
  author: {
    userName: string;
    name: string;
    profilePicture: string | null;
    isBlueVerified: boolean;
    followers: number;
  };
  /** Matched Ethos profile for the tweet's author, or null when the
   * author has no Ethos profile. */
  ethos: {
    profileId: number;
    displayName: string | null;
    avatarUrl: string | null;
    score: number | null;
    humanVerified: boolean;
  } | null;
}

export interface TwitterSearchResult {
  tweets: TwitterTweet[];
  rawCount: number;
  ethosCount: number;
}

export class TwitterSearchError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "TwitterSearchError";
  }
}

async function callUpstream(url: string, key: string): Promise<Response> {
  const MAX_ATTEMPTS = 4;
  let lastResp: Response | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "x-api-key": key },
        cache: "no-store",
      });
      if (resp.ok) return resp;
      const retriable = resp.status === 429 || resp.status >= 500;
      lastResp = resp;
      if (!retriable || attempt === MAX_ATTEMPTS - 1) return resp;
    } catch (err) {
      if (attempt === MAX_ATTEMPTS - 1) throw err;
    }
    const delay = 600 * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, delay));
  }
  return lastResp!;
}

/**
 * Search twitterapi.io's advanced_search for tweets containing the given
 * query (typically a wallet address). Returns all matched tweets with
 * each author resolved to its Ethos profile (or null). X handles are
 * case-insensitive but profile_latest stores original case, so the
 * lookup uses ILIKE.
 *
 * Throws TwitterSearchError on non-OK upstream responses (after retries
 * for 429/5xx). The caller decides whether to surface or swallow.
 */
export async function searchTweets(q: string): Promise<TwitterSearchResult> {
  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key) throw new TwitterSearchError("Twitter search not configured", 500);

  const url = new URL(`${TWITTERAPI_IO_BASE}/twitter/tweet/advanced_search`);
  url.searchParams.set("query", `"${q}"`);
  url.searchParams.set("queryType", "Latest");

  const upstream = await callUpstream(url.toString(), key);
  if (!upstream.ok) {
    const body = await upstream.text();
    console.error(`twitterapi.io returned ${upstream.status}: ${body.slice(0, 500)}`);
    // Pass the upstream status through (instead of a blanket 502) so the
    // failure is diagnosable from the network tab, and give 402 a message
    // that actually says what's wrong: the provider account is out of credits.
    const message =
      upstream.status === 402
        ? "Twitter search credits exhausted — recharge required"
        : `Twitter search failed (${upstream.status})`;
    throw new TwitterSearchError(message, upstream.status);
  }

  const raw = (await upstream.json()) as { tweets?: RawTweet[] };
  const rawTweets = raw.tweets ?? [];

  const handles = [
    ...new Set(
      rawTweets
        .map((t) => (t.author?.userName ?? "").toLowerCase())
        .filter((h) => h.length > 0 && /^[a-z0-9_]+$/.test(h))
    ),
  ];

  const supabase = getSupabase();
  const ethosByHandle = new Map<
    string,
    NonNullable<TwitterTweet["ethos"]>
  >();
  if (handles.length > 0) {
    const orFilter = handles.map((h) => `username.ilike.${h}`).join(",");
    const { data } = await supabase
      .from("profile_latest")
      .select("profile_id, username, display_name, avatar_url, score, human_verified")
      .or(orFilter);
    for (const row of (data ?? []) as {
      profile_id: number;
      username: string | null;
      display_name: string | null;
      avatar_url: string | null;
      score: number | null;
      human_verified: boolean | null;
    }[]) {
      if (!row.username) continue;
      ethosByHandle.set(row.username.toLowerCase(), {
        profileId: row.profile_id,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        score: row.score,
        humanVerified: Boolean(row.human_verified),
      });
    }
  }

  const tweets: TwitterTweet[] = [];
  let ethosCount = 0;
  for (const t of rawTweets) {
    const handle = (t.author?.userName ?? "").toLowerCase();
    const ethos = ethosByHandle.get(handle) ?? null;
    if (ethos) ethosCount += 1;
    tweets.push({
      id: t.id ?? "",
      url: t.url ?? "",
      text: t.text ?? "",
      createdAt: t.createdAt ?? "",
      likeCount: t.likeCount ?? 0,
      replyCount: t.replyCount ?? 0,
      retweetCount: t.retweetCount ?? 0,
      viewCount: t.viewCount ?? 0,
      isReply: Boolean(t.isReply),
      author: {
        userName: t.author?.userName ?? "",
        name: t.author?.name ?? "",
        profilePicture: t.author?.profilePicture ?? null,
        isBlueVerified: Boolean(t.author?.isBlueVerified || t.author?.isVerified),
        followers: t.author?.followers ?? 0,
      },
      ethos,
    });
  }

  return { tweets, rawCount: rawTweets.length, ethosCount };
}
