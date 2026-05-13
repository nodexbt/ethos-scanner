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

  // One-shot retry — when scanning many candidates back-to-back the
  // upstream occasionally rejects rapid sequential requests (rate
  // limiting + the connection pool sometimes returns a 5xx). A single
  // backoff retry handles both cases without complicating callers.
  async function callUpstream(): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetch(url.toString(), {
          headers: { "x-api-key": key! },
          cache: "no-store",
        });
        if (resp.ok) return resp;
        if (resp.status < 500 && resp.status !== 429) return resp;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        return resp;
      } catch (err) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        throw err;
      }
    }
    throw new Error("unreachable");
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

    const supabase = getSupabase();

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

    // If the searched address is attested to one or more Ethos profiles
    // (i.e. a known wallet of that profile), we drop tweets from those
    // profiles — a user tweeting their own wallet isn't a sybil signal.
    const ownerProfileIds = new Set<number>();
    if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
      const { data: ownersData } = await supabase
        .from("profile_addresses")
        .select("profile_id")
        .eq("address", q.toLowerCase());
      for (const row of (ownersData ?? []) as { profile_id: number }[]) {
        ownerProfileIds.add(row.profile_id);
      }
    }

    const tweets: TwitterTweet[] = [];
    for (const t of rawTweets) {
      const handle = (t.author?.userName ?? "").toLowerCase();
      const ethos = ethosByHandle.get(handle);
      if (!ethos) continue;
      // Drop self-mentions — the author owns the address they tweeted.
      if (ownerProfileIds.has(ethos.profileId)) continue;
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
