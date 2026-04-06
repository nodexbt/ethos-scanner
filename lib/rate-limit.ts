/**
 * Simple in-memory token bucket rate limiter.
 *
 * Caveat: on serverless platforms (Vercel), each instance has its own
 * memory, so the real limit is (configured limit) × (number of warm
 * instances). For a small allowlisted tool this is still an effective
 * speed bump against abuse. Upgrade to Redis/Upstash if you scale up.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodic cleanup to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 60_000).unref?.();

/**
 * Check if `key` has exceeded `limit` requests in the last `windowMs`.
 * Returns true if allowed, false if rate limited.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}
