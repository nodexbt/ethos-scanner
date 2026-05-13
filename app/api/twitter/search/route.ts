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
  /** Tweets returned by upstream before any filtering. */
  rawCount: number;
  /** Tweets whose author was an Ethos profile (subset of rawCount). */
  ethosCount: number;
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

  // twitterapi.io's advanced_search accepts the same operators as Twitter's
  // search UI; quoting wallet addresses prevents accidental tokenization.
  const url = new URL(`${TWITTERAPI_IO_BASE}/twitter/tweet/advanced_search`);
  url.searchParams.set("query", `"${q}"`);
  url.searchParams.set("queryType", "Latest");

  // Retry with exponential backoff on 429 (rate limit), 5xx, or network
  // error. twitterapi.io's free tier has a sliding-window rate limit
  // that's tighter than their docs suggest in practice, so we need a
  // few attempts to get through during a bulk Scan-All.
  async function callUpstream(): Promise<Response> {
    const MAX_ATTEMPTS = 4;
    let lastResp: Response | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const resp = await fetch(url.toString(), {
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
    const upstream = await callUpstream();

    if (!upstream.ok) {
      const body = await upstream.text();
      console.error(`twitterapi.io returned ${upstream.status}: ${body.slice(0, 500)}`);
      return NextResponse.json(
        { error: `Twitter search failed (${upstream.status})` },
        { status: 502 }
      );
    }

    const raw = (await upstream.json()) as { tweets?: RawTweet[] };
    const rawTweets = raw.tweets ?? [];

    // Resolve each tweet author to an Ethos profile (if any). X handles are
    // case-insensitive but profile_latest stores them with their original
    // case, so the comparison has to be case-insensitive. We build an OR of
    // ILIKE conditions — handle bodies are restricted to [A-Za-z0-9_] so
    // there's no escaping risk. Authors with no Ethos profile pass through
    // with ethos: null.
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

    return NextResponse.json({
      tweets,
      rawCount: rawTweets.length,
      ethosCount,
    } satisfies TwitterSearchResult);
  } catch (err) {
    console.error("twitterapi.io fetch failed:", err);
    return NextResponse.json({ error: "Twitter search failed" }, { status: 502 });
  }
}
