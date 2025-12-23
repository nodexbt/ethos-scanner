interface CacheEntry<T> {
  data: T;
  timestamp: number;
  version: string; // For cache invalidation when data structure changes
}

const CACHE_VERSION = "1.0";
const DEFAULT_TTL = 3600000; // 1 hour in milliseconds

export const CacheDurations = {
  PROFILE: 3600000,        // 1 hour
  INVITATIONS: 43200000,   // 12 hours
  VOUCHES: 43200000,       // 12 hours
  REVIEWS: 43200000,       // 12 hours
} as const;

/**
 * Get data from localStorage cache
 */
export function getCachedData<T>(
  key: string,
  ttl: number = DEFAULT_TTL
): T | null {
  if (typeof window === "undefined") return null;

  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    const entry: CacheEntry<T> = JSON.parse(cached);

    // Check version
    if (entry.version !== CACHE_VERSION) {
      localStorage.removeItem(key);
      return null;
    }

    // Check if expired
    const isExpired = Date.now() - entry.timestamp > ttl;
    if (isExpired) {
      localStorage.removeItem(key);
      return null;
    }

    return entry.data;
  } catch (error) {
    console.error("Cache read error:", error);
    return null;
  }
}

/**
 * Set data in localStorage cache
 */
export function setCachedData<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;

  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };

    localStorage.setItem(key, JSON.stringify(entry));
  } catch (error) {
    // Handle quota exceeded or other errors
    console.error("Cache write error:", error);
    
    // Try to clear old cache entries if quota exceeded
    if (error instanceof Error && error.name === "QuotaExceededError") {
      clearOldCacheEntries();
      // Try one more time
      try {
        const entry: CacheEntry<T> = {
          data,
          timestamp: Date.now(),
          version: CACHE_VERSION,
        };
        localStorage.setItem(key, JSON.stringify(entry));
      } catch (retryError) {
        console.error("Cache write retry failed:", retryError);
      }
    }
  }
}

/**
 * Remove a specific cache entry
 */
export function removeCachedData(key: string): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error("Cache remove error:", error);
  }
}

/**
 * Clear all cache entries (keeps non-cache items like recent searches)
 */
export function clearAllCache(): void {
  if (typeof window === "undefined") return;

  try {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (
        key.startsWith("cache-profile-") ||
        key.startsWith("cache-invitations-") ||
        key.startsWith("cache-vouches-") ||
        key.startsWith("cache-reviews-")
      ) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.error("Cache clear error:", error);
  }
}

/**
 * Clear old cache entries (older than 7 days)
 */
function clearOldCacheEntries(): void {
  if (typeof window === "undefined") return;

  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

  try {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith("cache-")) {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry = JSON.parse(cached);
            if (Date.now() - entry.timestamp > maxAge) {
              localStorage.removeItem(key);
            }
          }
        } catch (error) {
          // Invalid entry, remove it
          localStorage.removeItem(key);
        }
      }
    });
  } catch (error) {
    console.error("Old cache cleanup error:", error);
  }
}

/**
 * Generate cache key for profile data
 */
export function getProfileCacheKey(identifier: string): string {
  return `cache-profile-${identifier.toLowerCase()}`;
}

/**
 * Generate cache key for invitations
 */
export function getInvitationsCacheKey(profileId: number): string {
  return `cache-invitations-${profileId}`;
}

/**
 * Generate cache key for vouches
 */
export function getVouchesCacheKey(profileId: number, type: "given" | "received"): string {
  return `cache-vouches-${profileId}-${type}`;
}

/**
 * Generate cache key for reviews
 */
export function getReviewsCacheKey(profileId: number, type: "given" | "received"): string {
  return `cache-reviews-${profileId}-${type}`;
}

