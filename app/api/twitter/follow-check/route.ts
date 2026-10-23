import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { checkFollowRelationship, TwitterSearchError } from "@/lib/twitter-search";
import { TWITTER_SEARCH_ENABLED } from "@/lib/features";

export type { FollowRelationship } from "@/lib/twitter-search";

// GET /api/twitter/follow-check?source=<handle>&target=<handle>
// Proxies to twitterapi.io's check_follow_relationship. Server-side so the
// API key never reaches the browser. A single call returns both directions.
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  // Same provider as tweet search; disabled while that account is unfunded.
  if (!TWITTER_SEARCH_ENABLED) {
    return NextResponse.json(
      { error: "Follow checks are disabled while the X data provider is unfunded." },
      { status: 503 }
    );
  }

  const source = req.nextUrl.searchParams.get("source") ?? "";
  const target = req.nextUrl.searchParams.get("target") ?? "";
  if (!source || !target) {
    return NextResponse.json(
      { error: "Both source and target handles are required" },
      { status: 400 }
    );
  }

  try {
    const result = await checkFollowRelationship(source, target);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TwitterSearchError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("twitterapi.io follow-check failed:", err);
    return NextResponse.json({ error: "Follow check failed" }, { status: 502 });
  }
}
