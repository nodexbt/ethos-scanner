/**
 * X/Twitter search via twitterapi.io. Disabled by default while the provider
 * account is unfunded — it returns 402 "Credits is not enough. Please
 * recharge", which surfaces as failed scans in the UI. Re-enable by setting
 *   NEXT_PUBLIC_TWITTER_SEARCH_ENABLED=true
 * once a funded key is in place — no code change needed. The NEXT_PUBLIC_
 * prefix is required so the client can hide the search UI, not just the API.
 *
 * Note: this does NOT gate the manual backfill script (scripts/backfill),
 * which is operator-run and hits twitterapi.io directly.
 */
export const TWITTER_SEARCH_ENABLED =
  process.env.NEXT_PUBLIC_TWITTER_SEARCH_ENABLED === "true";
