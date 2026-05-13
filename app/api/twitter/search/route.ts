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
  /** How many tweets came back before the Ethos-profile filter, so the UI
   * can communicate "X non-Ethos tweets hidden" if useful. */
  rawCount: number;
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

  try {
    const upstream = await fetch(url.toString(), {
      headers: { "x-api-key": key },
      // Don't cache between users — query is unique per address, and
      // tweet results are time-sensitive.
      cache: "no-store",
    });

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
      const supabase = getSupabase();
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
    for (const t of rawTweets) {
      const handle = (t.author?.userName ?? "").toLowerCase();
      const ethos = ethosByHandle.get(handle);
      if (!ethos) continue;
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
    } satisfies TwitterSearchResult);
  } catch (err) {
    console.error("twitterapi.io fetch failed:", err);
    return NextResponse.json({ error: "Twitter search failed" }, { status: 502 });
  }
}
