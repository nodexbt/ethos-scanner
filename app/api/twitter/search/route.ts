import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { searchTweets, TwitterSearchError } from "@/lib/twitter-search";
import { TWITTER_SEARCH_ENABLED } from "@/lib/features";

// Re-exported so existing imports from
// "@/app/api/twitter/search/route" keep working.
export type { TwitterTweet, TwitterSearchResult } from "@/lib/twitter-search";

// GET /api/twitter/search?q=<address-or-keyword>
// Proxies to twitterapi.io's advanced search. Server-side so the API
// key never reaches the browser.
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (!TWITTER_SEARCH_ENABLED) {
    return NextResponse.json(
      { error: "Twitter search is temporarily disabled." },
      { status: 503 }
    );
  }

  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.length < 3 || q.length > 200) {
    return NextResponse.json({ error: "Missing or invalid q" }, { status: 400 });
  }

  try {
    const result = await searchTweets(q);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TwitterSearchError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("twitterapi.io fetch failed:", err);
    return NextResponse.json({ error: "Twitter search failed" }, { status: 502 });
  }
}
