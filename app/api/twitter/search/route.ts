import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
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
  /** Matched Ethos profile for the tweet's author. Always non-null in
   * responses because we filter out tweets from non-Ethos accounts. */
  ethos: {
    profileId: number;
    displayName: string | null;
    avatarUrl: string | null;
    score: number | null;
    humanVerified: boolean;
  };
}

export interface TwitterSearchResult {
  tweets: TwitterTweet[];
  /** Tweets returned by upstream before any filtering. */
  rawCount: number;
  /** Tweets whose author was an Ethos profile (subset of rawCount). */
  ethosCount: number;
  /** Tweets dropped because the author owns the searched wallet. */
  selfMentionCount: number;
}

// GET /api/twitter/search?q=<address-or-keyword>
// Proxies to twitterapi.io's advanced search. Server-side so the API
// key never reaches the browser.
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key) {
    return NextResponse.json({ error: "Twitter search not configured" }, { status: 500 });
  }

  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.length < 3 || q.length > 200) {
    return NextResponse.json({ error: "Missing or invalid q" }, { status: 400 });
  }

  // 3 pages × 20 tweets = ~60 tweets per search. We exclude the owner's
  // handle(s) from the query directly via `-from:`, which means we don't
  // need to paginate deep just to skip past the owner's repeated self-
  // mentions of their own wallet.
  const MAX_PAGES = 3;

  // Look up the wallet's owner profile(s) before searching, so we can both
  // exclude them from the query (no wasted pagination on their self-
  // mentions) and use them as the canonical self-mention filter below.
  const supabase = getSupabase();
  const ownerProfileIds = new Set<number>();
  const ownerHandles: string[] = [];
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
    const { data: ownerRows } = await supabase
      .from("profile_addresses")
      .select("profile_id")
      .eq("address", q.toLowerCase());
    for (const row of (ownerRows ?? []) as { profile_id: number }[]) {
      ownerProfileIds.add(row.profile_id);
    }
    if (ownerProfileIds.size > 0) {
      const { data: handleRows } = await supabase
        .from("profile_latest")
        .select("username")
        .in("profile_id", [...ownerProfileIds]);
      for (const row of (handleRows ?? []) as { username: string | null }[]) {
        if (row.username) ownerHandles.push(row.username);
      }
    }
  }

  // twitterapi.io's advanced_search accepts the same operators as Twitter's
  // search UI; quoting wallet addresses prevents accidental tokenization,
  // and `-from:` excludes the owner's own tweets so we get cross-mentions
  // from other Ethos profiles instead of pages of self-mentions.
  const queryTerms = [`"${q}"`, ...ownerHandles.map((h) => `-from:${h}`)];
  const fullQuery = queryTerms.join(" ");
  function buildUrl(cursor: string | null): string {
    const url = new URL(`${TWITTERAPI_IO_BASE}/twitter/tweet/advanced_search`);
    url.searchParams.set("query", fullQuery);
    url.searchParams.set("queryType", "Latest");
    if (cursor) url.searchParams.set("cursor", cursor);
    return url.toString();
  }

  // Retry with exponential backoff on 429 (rate limit), 5xx, or network
  // error. twitterapi.io's free tier has a sliding-window rate limit
  // that's tighter than their docs suggest in practice, so we need a
  // few attempts to get through during a bulk Scan-All.
  async function callUpstream(href: string): Promise<Response> {
    const MAX_ATTEMPTS = 4;
    let lastResp: Response | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const resp = await fetch(href, {
          headers: { "x-api-key": key! },
          cache: "no-store",
        });
        if (resp.ok) return resp;
        const retriable = resp.status === 429 || resp.status >= 500;
        lastResp = resp;
        if (!retriable || attempt === MAX_ATTEMPTS - 1) return resp;
      } catch (err) {
        if (attempt === MAX_ATTEMPTS - 1) throw err;
      }
      // Exponential backoff: 600ms, 1.5s, 3s
      const delay = 600 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
    return lastResp!;
  }

  try {
    const rawTweets: RawTweet[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const upstream = await callUpstream(buildUrl(cursor));
      if (!upstream.ok) {
        // Fail the whole request if the FIRST page errored; otherwise
        // keep what we have so far rather than dropping everything.
        if (page === 0) {
          const body = await upstream.text();
          console.error(`twitterapi.io returned ${upstream.status}: ${body.slice(0, 500)}`);
          return NextResponse.json(
            { error: `Twitter search failed (${upstream.status})` },
            { status: 502 }
          );
        }
        break;
      }
      const pageJson = (await upstream.json()) as {
        tweets?: RawTweet[];
        has_next_page?: boolean;
        next_cursor?: string;
      };
      if (pageJson.tweets?.length) rawTweets.push(...pageJson.tweets);
      if (!pageJson.has_next_page || !pageJson.next_cursor) break;
      cursor = pageJson.next_cursor;
    }

    // Resolve each tweet author to an Ethos profile (if any). profile_latest
    // stores the username case as Ethos has it; we lowercase both sides to
    // match X's case-insensitive handle semantics.
    const handles = [
      ...new Set(
        rawTweets
          .map((t) => (t.author?.userName ?? "").toLowerCase())
          .filter((h) => h.length > 0)
      ),
    ];

    const ethosByHandle = new Map<
      string,
      TwitterTweet["ethos"]
    >();
    if (handles.length > 0) {
      const { data } = await supabase
        .from("profile_latest")
        .select("profile_id, username, display_name, avatar_url, score, human_verified")
        .in("username", handles);
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
    let selfMentionCount = 0;
    for (const t of rawTweets) {
      const handle = (t.author?.userName ?? "").toLowerCase();
      const ethos = ethosByHandle.get(handle);
      if (!ethos) continue;
      ethosCount += 1;
      // Drop self-mentions — the author owns the address they tweeted.
      if (ownerProfileIds.has(ethos.profileId)) {
        selfMentionCount += 1;
        continue;
      }
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

    return NextResponse.json({
      tweets,
      rawCount: rawTweets.length,
      ethosCount,
      selfMentionCount,
    } satisfies TwitterSearchResult);
  } catch (err) {
    console.error("twitterapi.io fetch failed:", err);
    return NextResponse.json({ error: "Twitter search failed" }, { status: 502 });
  }
}
