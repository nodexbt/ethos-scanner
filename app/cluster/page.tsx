"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Search, Loader2, X, Plus, ArrowLeft, Users, Share2, Check, Copy } from "lucide-react";
import Link from "next/link";
import { ClusterMap } from "@/components/cluster-map";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  getCachedData,
  setCachedData,
  getProfileCacheKey,
  CacheDurations,
} from "@/lib/cache";

interface EthosProfile {
  id: number;
  profileId: number | null;
  displayName: string;
  username: string | null;
  avatarUrl: string;
  description: string | null;
  score: number;
  status: "ACTIVE" | "INACTIVE" | "MERGED";
  userkeys: string[];
  xpTotal: number;
  xpStreakDays: number;
  xpRemovedDueToAbuse: boolean;
  influenceFactor: number;
  influenceFactorPercentile: number;
  links: {
    profile: string;
    scoreBreakdown: string;
  };
  stats: {
    review: {
      received: {
        negative: number;
        neutral: number;
        positive: number;
      };
    };
    vouch: {
      given: {
        amountWeiTotal: number;
        count: number;
      };
      received: {
        amountWeiTotal: number;
        count: number;
      };
    };
  };
  isDiscovered?: boolean; // Auto-discovered via network expansion
  discoveryLevel?: number; // Which expansion level discovered this profile (1, 2, 3...)
}

interface ReviewActivity {
  type: "review";
  data: {
    id: number;
    authorProfileId: number;
    author: string;
    subject: string;
    score: "positive" | "neutral" | "negative";
    comment?: string;
    createdAt: number;
    archived: boolean;
  };
  author: {
    profileId: number;
    name: string;
    username: string | null;
    avatar: string;
  };
  subject: {
    profileId: number;
    name: string;
    username: string | null;
    avatar: string;
  };
}

interface Vouch {
  authorProfileId: number;
  subjectProfileId: number;
  balance?: string;
  authorUser?: {
    displayName: string;
    username: string | null;
    avatarUrl: string;
    score: number;
  };
  subjectUser?: {
    displayName: string;
    username: string | null;
    avatarUrl: string;
    score: number;
  };
}

const MIN_PROFILES = 2;
const DEFAULT_MIN_CONNECTIONS = 5; // Default minimum connections to cluster profiles to auto-discover
const STORAGE_KEY = "ethos-cluster-profiles";
const MAX_EXPANSION_DEPTH = 1; // Only level 1 for now
const MAX_DISCOVERED_PROFILES = 100; // Limit discovered profiles to top 100 most connected
const REVIEWS_BATCH_SIZE = 100; // Fetch reviews in batches of 100 to be gentle on the API
const MAX_REVIEWS_PER_PROFILE = 300; // Maximum reviews to fetch per profile

function ClusterPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [input, setInput] = useState("");
  const [profiles, setProfiles] = useState<EthosProfile[]>([]); // Submitted profiles
  const [discoveredProfiles, setDiscoveredProfiles] = useState<EthosProfile[]>([]); // Auto-discovered
  const [addingProfile, setAddingProfile] = useState(false);
  const [investigating, setInvestigating] = useState(false);
  const [investigated, setInvestigated] = useState(false);
  const [reviews, setReviews] = useState<ReviewActivity[]>([]);
  const [vouches, setVouches] = useState<Vouch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expansionDepth] = useState(MAX_EXPANSION_DEPTH); // How many levels deep to expand (fixed to 1 for now)
  const [currentLevel, setCurrentLevel] = useState(0); // Progress indicator
  const [minConnections, setMinConnections] = useState(DEFAULT_MIN_CONNECTIONS); // Min connections to discover
  const [loadingFromUrl, setLoadingFromUrl] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedProfiles, setCopiedProfiles] = useState(false);
  const [minConnectionsToShow, setMinConnectionsToShow] = useState(0); // Filter for profile list display (defaults to show all)
  const [showOnlyBidirectional, setShowOnlyBidirectional] = useState(true); // Filter to show only profiles that both gave AND received (enabled by default)

  // Combined profiles for visualization
  const allProfiles = [...profiles, ...discoveredProfiles];

  // Helper to check if string is ethereum address
  const isEthereumAddress = (value: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(value);
  };

  // Helper to get score-based border color (matches Ethos Network colors)
  const getScoreBorderColor = (score: number): string => {
    if (score < 1200) return "ring-yellow-600"; // Yellow - Low score
    if (score < 1400) return "ring-gray-400"; // Gray - Neutral
    if (score < 1600) return "ring-sky-400"; // Light blue
    if (score < 1800) return "ring-blue-500"; // Medium blue
    if (score < 2000) return "ring-blue-700"; // Dark blue
    return "ring-green-600"; // Green - Excellent
  };

  // Helper to extract identifier from URL (Ethos profile URL or Twitter URL)
  const extractIdentifierFromUrl = (input: string): string => {
    // Ethos profile URL for Twitter: https://app.ethos.network/profile/x/username
    const ethosTwitterMatch = input.match(/app\.ethos\.network\/profile\/x\/([^/?#]+)/i);
    if (ethosTwitterMatch) return ethosTwitterMatch[1];

    // Ethos profile URL for wallet: https://app.ethos.network/profile/0x...
    const ethosWalletMatch = input.match(/app\.ethos\.network\/profile\/(0x[a-fA-F0-9]{40})/i);
    if (ethosWalletMatch) return ethosWalletMatch[1];

    // Twitter/X URL: https://twitter.com/username or https://x.com/username
    const twitterMatch = input.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/i);
    if (twitterMatch) return twitterMatch[1];

    // Return as-is if not a URL
    return input;
  };

  // Load profiles from URL params or localStorage on mount
  useEffect(() => {
    const loadProfilesFromUrl = async (identifiers: string) => {
      // Identifiers are comma-separated usernames or addresses
      const ids = identifiers.split(",").map(id => decodeURIComponent(id.trim())).filter(id => id.length > 0);
      if (ids.length === 0) return false;

      setLoadingFromUrl(true);
      const loadedProfiles: EthosProfile[] = [];

      await Promise.all(ids.map(async (identifier) => {
        try {
          const cacheKey = getProfileCacheKey(identifier);
          const cached = getCachedData<EthosProfile>(cacheKey, CacheDurations.PROFILE);
          if (cached && cached.profileId) {
            loadedProfiles.push(cached);
            return;
          }

          // Determine API endpoint based on identifier type
          let url: string;
          if (isEthereumAddress(identifier)) {
            url = `https://api.ethos.network/api/v2/user/by/address/${identifier}`;
          } else {
            url = `https://api.ethos.network/api/v2/user/by/x/${identifier}`;
          }

          const response = await fetch(url, {
            headers: { "X-Ethos-Client": "ethos-scanner@0.1.0" }
          });
          if (response.ok) {
            const profile: EthosProfile = await response.json();
            if (profile.profileId) {
              setCachedData(cacheKey, profile);
              loadedProfiles.push(profile);
            }
          }
        } catch (err) {
          console.error("Error loading profile from URL", identifier, err);
        }
      }));

      if (loadedProfiles.length > 0) {
        setProfiles(loadedProfiles);
        setLoadingFromUrl(false);
        return true;
      }
      setLoadingFromUrl(false);
      return false;
    };

    const urlProfiles = searchParams.get("profiles");
    if (urlProfiles) {
      loadProfilesFromUrl(urlProfiles);
    } else {
      // Fall back to localStorage
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setProfiles(parsed);
          }
        }
      } catch (e) {
        // Invalid JSON, ignore
      }
    }
  }, [searchParams]);

  // Save profiles to localStorage when they change
  useEffect(() => {
    try {
      if (profiles.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      // Storage error, ignore
    }
  }, [profiles]);

  // Generate shareable URL using usernames or addresses
  const getShareUrl = useCallback(() => {
    if (profiles.length === 0) return "";

    // Extract identifier for each profile (prefer username, fall back to address from userkeys)
    const identifiers = profiles.map(p => {
      // If has username, use it
      if (p.username) return p.username;

      // Look for ethereum address in userkeys
      const addressKey = p.userkeys?.find(k => k.startsWith("0x") || k.includes("address:"));
      if (addressKey) {
        return addressKey.startsWith("address:") ? addressKey.replace("address:", "") : addressKey;
      }

      // Fallback to first userkey
      if (p.userkeys && p.userkeys.length > 0) {
        const key = p.userkeys[0];
        // Handle x.com/username format
        if (key.includes("x.com/")) return key.split("x.com/")[1];
        return key;
      }

      return null;
    }).filter(Boolean);

    if (identifiers.length === 0) return "";

    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    return `${baseUrl}/cluster?profiles=${identifiers.map(i => encodeURIComponent(i!)).join(",")}`;
  }, [profiles]);

  // Copy share URL to clipboard
  const copyShareUrl = async () => {
    const url = getShareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL", err);
    }
  };

  // Copy all profile URLs to clipboard
  const copyAllProfiles = async () => {
    const urls = allProfiles
      .map(p => p.links?.profile || `https://ethos.network/profile/${p.profileId}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(urls);
      setCopiedProfiles(true);
      setTimeout(() => setCopiedProfiles(false), 2000);
    } catch (err) {
      console.error("Failed to copy profiles", err);
    }
  };

  // Get connection count for a profile
  const getConnectionCount = useCallback((profileId: number) => {
    let count = 0;
    reviews.forEach(r => {
      if (r.author.profileId === profileId || r.subject.profileId === profileId) count++;
    });
    vouches.forEach(v => {
      if (v.authorProfileId === profileId || v.subjectProfileId === profileId) count++;
    });
    return count;
  }, [reviews, vouches]);

  // Get detailed connection info for a profile (given vs received)
  const getConnectionDetails = useCallback((profileId: number) => {
    let given = 0;
    let received = 0;
    reviews.forEach(r => {
      if (r.author.profileId === profileId) given++;
      if (r.subject.profileId === profileId) received++;
    });
    return { given, received, isBidirectional: given > 0 && received > 0 };
  }, [reviews]);

  const addProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    // Extract identifier from URL if provided
    const identifier = extractIdentifierFromUrl(trimmedInput);

    setAddingProfile(true);
    setError(null);

    try {
      // Check cache first
      const cacheKey = getProfileCacheKey(identifier);
      const cached = getCachedData<EthosProfile>(cacheKey, CacheDurations.PROFILE);

      if (cached) {
        // Check for duplicates
        if (profiles.some(p => p.profileId === cached.profileId)) {
          setError("Profile already added");
          return;
        }
        if (cached.profileId === null) {
          setError("Profile is not initialized on Ethos");
          return;
        }
        setProfiles([...profiles, cached]);
        setInput("");
        setInvestigated(false);
        return;
      }

      // Fetch from API - try profile ID first if numeric, otherwise try username/address
      let url: string;
      if (/^\d+$/.test(identifier)) {
        // Numeric - could be Ethos profile ID
        url = `https://api.ethos.network/api/v2/user/by/profile/${identifier}`;
      } else if (isEthereumAddress(identifier)) {
        url = `https://api.ethos.network/api/v2/user/by/address/${identifier}`;
      } else {
        url = `https://api.ethos.network/api/v2/user/by/x/${identifier}`;
      }

      const response = await fetch(url, {
        headers: {
          "X-Ethos-Client": "ethos-scanner@0.1.0",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          setError("Profile not found");
        } else {
          setError(`Failed to fetch profile: ${response.statusText}`);
        }
        return;
      }

      const data: EthosProfile = await response.json();

      // Check for duplicates
      if (profiles.some(p => p.profileId === data.profileId)) {
        setError("Profile already added");
        return;
      }

      if (data.profileId === null) {
        setError("Profile is not initialized on Ethos");
        return;
      }

      // Cache the profile
      setCachedData(cacheKey, data);

      setProfiles([...profiles, data]);
      setInput("");
      setInvestigated(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setAddingProfile(false);
    }
  };

  const removeProfile = (profileId: number, isDiscovered: boolean = false) => {
    if (isDiscovered) {
      setDiscoveredProfiles(discoveredProfiles.filter(p => p.profileId !== profileId));
    } else {
      setProfiles(profiles.filter(p => p.profileId !== profileId));
      setDiscoveredProfiles([]); // Reset discovered when removing submitted profile
    }
    setInvestigated(false);
  };

  const clearAllProfiles = () => {
    setProfiles([]);
    setDiscoveredProfiles([]);
    setReviews([]);
    setVouches([]);
    setInvestigated(false);
    setError(null);
  };

  // Helper: Fetch reviews with pagination (batches of 100, up to 1000 total)
  const fetchReviewsPaginated = async (
    url: string,
    userkey: string
  ): Promise<ReviewActivity[]> => {
    const allReviews: ReviewActivity[] = [];
    let offset = 0;

    while (offset < MAX_REVIEWS_PER_PROFILE) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ethos-Client": "ethos-scanner@0.1.0",
          },
          body: JSON.stringify({
            userkey,
            filter: ["review"],
            limit: REVIEWS_BATCH_SIZE,
            pagination: { offset, limit: REVIEWS_BATCH_SIZE }
          }),
        });

        if (!response.ok) break;

        const data = await response.json();
        const reviews = data.values || [];
        allReviews.push(...reviews);

        // Stop if we got fewer than batch size (no more data)
        if (reviews.length < REVIEWS_BATCH_SIZE) break;

        offset += REVIEWS_BATCH_SIZE;
      } catch (err) {
        console.error("Error fetching reviews batch", err);
        break;
      }
    }

    return allReviews;
  };

  // Helper: Fetch review connections for a set of profile IDs (reviews only)
  const fetchReviewsForProfiles = async (
    profileIds: number[],
    knownProfileIds: Set<number>
  ): Promise<{
    reviews: ReviewActivity[];
    externalConnections: Map<number, {
      connectedTo: Set<number>;
      reviews: ReviewActivity[];
      username: string | null; // Twitter handle for fetching full profile
    }>;
  }> => {
    const reviews: ReviewActivity[] = [];
    const externalConnections = new Map<number, {
      connectedTo: Set<number>;
      reviews: ReviewActivity[];
      username: string | null;
    }>();

    await Promise.all(profileIds.map(async (profileId) => {
      const userkey = `profileId:${profileId}`;

      // Fetch reviews given (paginated)
      try {
        const givenReviews = await fetchReviewsPaginated(
          "https://api.ethos.network/api/v2/activities/profile/given",
          userkey
        );
        givenReviews.forEach((review: ReviewActivity) => {
          const targetId = review.subject.profileId;
          if (!targetId) return;
          if (knownProfileIds.has(targetId)) {
            reviews.push(review);
          } else {
            if (!externalConnections.has(targetId)) {
              externalConnections.set(targetId, {
                connectedTo: new Set(),
                reviews: [],
                username: review.subject.username || null,
              });
            }
            externalConnections.get(targetId)!.connectedTo.add(profileId);
            externalConnections.get(targetId)!.reviews.push(review);
            // Update username if we get one
            if (review.subject.username && !externalConnections.get(targetId)!.username) {
              externalConnections.get(targetId)!.username = review.subject.username;
            }
          }
        });
      } catch (err) {
        console.error("Error fetching given reviews", profileId, err);
      }

      // Fetch reviews received (paginated)
      try {
        const receivedReviews = await fetchReviewsPaginated(
          "https://api.ethos.network/api/v2/activities/profile/received",
          userkey
        );
        receivedReviews.forEach((review: ReviewActivity) => {
          const authorId = review.author.profileId;
          if (!authorId) return;
          if (knownProfileIds.has(authorId)) {
            if (!reviews.some(r => r.data.id === review.data.id)) {
              reviews.push(review);
            }
          } else {
            if (!externalConnections.has(authorId)) {
              externalConnections.set(authorId, {
                connectedTo: new Set(),
                reviews: [],
                username: review.author.username || null,
              });
            }
            externalConnections.get(authorId)!.connectedTo.add(profileId);
            externalConnections.get(authorId)!.reviews.push(review);
            // Update username if we get one
            if (review.author.username && !externalConnections.get(authorId)!.username) {
              externalConnections.get(authorId)!.username = review.author.username;
            }
          }
        });
      } catch (err) {
        console.error("Error fetching received reviews", profileId, err);
      }
    }));

    return { reviews, externalConnections };
  };

  const investigateCluster = async () => {
    if (profiles.length < MIN_PROFILES) {
      setError(`Add at least ${MIN_PROFILES} profiles to investigate`);
      return;
    }

    setInvestigating(true);
    setCurrentLevel(0);
    setError(null);
    setReviews([]);
    setVouches([]);
    setDiscoveredProfiles([]);

    try {
      // Track all known profile IDs (submitted + discovered)
      const allKnownIds = new Set(profiles.map(p => p.profileId!));
      const allDiscovered: EthosProfile[] = [];
      const allReviews: ReviewActivity[] = [];

      // Profiles to scan at each level (start with submitted profiles)
      let profilesToScan = profiles.map(p => p.profileId!);

      // Iterative multi-level expansion (reviews only for discovery)
      for (let level = 1; level <= expansionDepth; level++) {
        setCurrentLevel(level);

        // Fetch review connections for current level's profiles
        const { reviews, externalConnections } = await fetchReviewsForProfiles(
          profilesToScan,
          allKnownIds
        );

        // Add internal connections to results
        reviews.forEach(r => {
          if (!allReviews.some(existing => existing.data.id === r.data.id)) {
            allReviews.push(r);
          }
        });

        // Find new profiles connected to N+ known profiles that have a username
        // Only profiles with usernames can be fetched properly
        const discoveredWithUsernames: { id: number; username: string; connectionCount: number }[] = [];
        externalConnections.forEach((data, externalId) => {
          if (data.connectedTo.size >= minConnections && !allKnownIds.has(externalId)) {
            // Only include profiles with valid profileId and a username
            if (externalId > 0 && data.username) {
              discoveredWithUsernames.push({
                id: externalId,
                username: data.username,
                connectionCount: data.connectedTo.size
              });
            }
          }
        });

        // Sort by connection count and limit to top N most connected
        discoveredWithUsernames.sort((a, b) => b.connectionCount - a.connectionCount);
        const limitedDiscovered = discoveredWithUsernames.slice(0, MAX_DISCOVERED_PROFILES);

        if (limitedDiscovered.length === 0) {
          // No more profiles to discover, stop expansion early
          break;
        }

        // Fetch full profile data using Twitter usernames
        // This gets accurate scores and filters out uninitialized profiles
        const newProfiles: EthosProfile[] = [];
        await Promise.all(limitedDiscovered.map(async ({ id, username }) => {
          try {
            const response = await fetch(
              `https://api.ethos.network/api/v2/user/by/x/${username}`,
              {
                headers: { "X-Ethos-Client": "ethos-scanner@0.1.0" }
              }
            );
            if (response.ok) {
              const profile: EthosProfile = await response.json();
              // Only include profiles with valid data (initialized)
              if (profile.profileId && profile.displayName) {
                newProfiles.push({
                  ...profile,
                  isDiscovered: true,
                  discoveryLevel: level,
                });
              }
            }
          } catch (err) {
            // Profile doesn't exist or is uninitialized, skip it
            console.error("Error fetching discovered profile", username, err);
          }
        }));
        allDiscovered.push(...newProfiles);

        // Add successfully fetched profile IDs to known set (only initialized profiles)
        const fetchedIds = newProfiles.map(p => p.profileId!);
        fetchedIds.forEach(id => allKnownIds.add(id));

        // Add review connections involving discovered profiles
        externalConnections.forEach((data, externalId) => {
          if (allKnownIds.has(externalId)) {
            data.reviews.forEach(review => {
              if (allKnownIds.has(review.author.profileId) && allKnownIds.has(review.subject.profileId)) {
                if (!allReviews.some(r => r.data.id === review.data.id)) {
                  allReviews.push(review);
                }
              }
            });
          }
        });

        // Next level will scan the successfully fetched profiles
        profilesToScan = fetchedIds;
      }

      // Final pass: Fetch inter-connections between all discovered profiles
      // This finds connections between discovered profiles themselves
      if (allDiscovered.length > 0) {
        setCurrentLevel(expansionDepth + 1); // Indicate final pass in progress
        const discoveredIds = allDiscovered.map(p => p.profileId!);
        const { reviews: interReviews } = await fetchReviewsForProfiles(
          discoveredIds,
          allKnownIds
        );
        interReviews.forEach(r => {
          if (!allReviews.some(existing => existing.data.id === r.data.id)) {
            allReviews.push(r);
          }
        });
      }

      setDiscoveredProfiles(allDiscovered);
      setReviews(allReviews);
      setVouches([]); // Vouches not used for cluster discovery
      setInvestigated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setInvestigating(false);
      setCurrentLevel(0);
    }
  };

  const totalConnections = reviews.length;
  const positiveReviews = reviews.filter(r => r.data.score === "positive").length;
  const neutralReviews = reviews.filter(r => r.data.score === "neutral").length;
  const negativeReviews = reviews.filter(r => r.data.score === "negative").length;

  return (
    <div className="min-h-screen p-4 md:p-8 relative">
      <div className="fixed top-4 right-4 md:top-8 md:right-8 z-10">
        <ThemeToggle />
      </div>
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Search
        </Button>

        {/* Input Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Cluster Investigation
            </CardTitle>
            <CardDescription>
              Enter {MIN_PROFILES}+ profiles to investigate their connections on Ethos.
              Supports X usernames, wallet addresses, Ethos profile URLs, or Twitter URLs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Input form */}
            <form onSubmit={addProfile} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Username, address, or profile URL"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="pl-10"
                  disabled={addingProfile}
                />
              </div>
              <Button
                type="submit"
                disabled={addingProfile || !input.trim()}
              >
                {addingProfile ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add
              </Button>
            </form>

            {/* Error message */}
            {error && (
              <div className="text-sm text-red-500">{error}</div>
            )}

            {/* Loading from URL indicator */}
            {loadingFromUrl && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading profiles from shared link...
              </div>
            )}

            {/* Added profiles */}
            {profiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-muted-foreground">
                    Added Profiles ({profiles.length})
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={copyShareUrl}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy shareable link"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 text-green-500" />
                          <span className="text-green-500">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Share2 className="h-3 w-3" />
                          Share
                        </>
                      )}
                    </button>
                    <button
                      onClick={clearAllProfiles}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {profiles.map((profile) => (
                    <div
                      key={profile.profileId}
                      className="group flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm"
                    >
                      <Link
                        href={`/${encodeURIComponent(profile.username || profile.profileId!.toString())}`}
                        className="flex items-center gap-2 min-w-0 hover:opacity-80"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {profile.avatarUrl && (
                          <img
                            src={profile.avatarUrl}
                            alt={profile.displayName}
                            className={`h-6 w-6 shrink-0 rounded-full ring-2 ${getScoreBorderColor(profile.score)}`}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {profile.displayName}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            Score: {profile.score}
                          </div>
                        </div>
                      </Link>
                      <button
                        onClick={() => removeProfile(profile.profileId!)}
                        className="shrink-0 cursor-pointer rounded p-1 hover:bg-muted"
                        aria-label="Remove profile"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Discovered profiles (after investigation) */}
            {discoveredProfiles.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <div className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  Discovered Profiles ({discoveredProfiles.length})
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    Connected to {minConnections}+ cluster profiles
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {discoveredProfiles.map((profile) => (
                    <div
                      key={profile.profileId}
                      className="group flex items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm"
                    >
                      <Link
                        href={`/${encodeURIComponent(profile.username || profile.profileId!.toString())}`}
                        className="flex items-center gap-2 min-w-0 hover:opacity-80"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {profile.avatarUrl && (
                          <img
                            src={profile.avatarUrl}
                            alt={profile.displayName}
                            className={`h-6 w-6 shrink-0 rounded-full ring-2 ${getScoreBorderColor(profile.score)}`}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {profile.displayName}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            Score: {profile.score}
                          </div>
                        </div>
                      </Link>
                      <button
                        onClick={() => removeProfile(profile.profileId!, true)}
                        className="shrink-0 cursor-pointer rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                        aria-label="Remove discovered profile"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Scan settings */}
            {profiles.length >= MIN_PROFILES && (
              <div className="space-y-4 pt-2 border-t">
                {/* Min connections control */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-muted-foreground">
                      Min Connections to Discover
                    </div>
                    <div className="text-sm font-medium">
                      {minConnections}+ connections
                    </div>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="5"
                    value={minConnections}
                    onChange={(e) => setMinConnections(Number(e.target.value))}
                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                    disabled={investigating}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>2 (Loose)</span>
                    <span>3</span>
                    <span>5 (Tight)</span>
                  </div>
                </div>
              </div>
            )}

            {/* Investigate button */}
            <Button
              onClick={investigateCluster}
              disabled={profiles.length < MIN_PROFILES || investigating}
              className="w-full"
            >
              {investigating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {currentLevel > expansionDepth
                    ? "Fetching inter-connections..."
                    : currentLevel > 0
                    ? `Scanning level ${currentLevel}...`
                    : "Starting..."}
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Investigate Cluster
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Results */}
        {investigated && (
          <>
            {/* Stats Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Cluster Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                  <div className="space-y-1">
                    <div className="text-2xl font-bold">{profiles.length}</div>
                    <div className="text-xs text-muted-foreground">Submitted</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                      {discoveredProfiles.length}
                    </div>
                    <div className="text-xs text-muted-foreground">Discovered</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-2xl font-bold">{totalConnections}</div>
                    <div className="text-xs text-muted-foreground">Connections</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-2xl font-bold">{reviews.length}</div>
                    <div className="text-xs text-muted-foreground">
                      Reviews ({positiveReviews}+ / {neutralReviews}~ / {negativeReviews}-)
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-2xl font-bold">{vouches.length}</div>
                    <div className="text-xs text-muted-foreground">Vouches</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Network Map */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Connection Map</CardTitle>
                <CardDescription>
                  Visualizing connections between {allProfiles.length} profiles
                  {discoveredProfiles.length > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {" "}({discoveredProfiles.length} discovered)
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {totalConnections === 0 ? (
                  <div className="flex items-center justify-center h-64 text-muted-foreground">
                    No connections found between these profiles
                  </div>
                ) : (
                  <ClusterMap
                    profiles={allProfiles}
                    reviews={reviews}
                    vouches={vouches}
                    showOnlyBidirectional={showOnlyBidirectional}
                  />
                )}
              </CardContent>
            </Card>

            {/* Profile List */}
            {allProfiles.length > 0 && (() => {
              // Calculate connection counts and bidirectional info
              const profilesWithCounts = allProfiles
                .map(profile => {
                  const details = getConnectionDetails(profile.profileId!);
                  return {
                    ...profile,
                    connectionCount: getConnectionCount(profile.profileId!),
                    given: details.given,
                    received: details.received,
                    isBidirectional: details.isBidirectional
                  };
                })
                .sort((a, b) => b.connectionCount - a.connectionCount);

              const maxConnections = profilesWithCounts[0]?.connectionCount || 0;
              const filteredProfiles = profilesWithCounts.filter(
                p => p.connectionCount >= minConnectionsToShow &&
                     (!showOnlyBidirectional || p.isBidirectional)
              );

              return (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        Connected Profiles ({filteredProfiles.length}
                        {(minConnectionsToShow > 0 || showOnlyBidirectional) && ` of ${allProfiles.length}`})
                      </CardTitle>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const urls = filteredProfiles
                            .map(p => p.links?.profile || `https://ethos.network/profile/${p.profileId}`)
                            .join("\n");
                          navigator.clipboard.writeText(urls);
                          setCopiedProfiles(true);
                          setTimeout(() => setCopiedProfiles(false), 2000);
                        }}
                        className="gap-2"
                      >
                        {copiedProfiles ? (
                          <>
                            <Check className="h-4 w-4 text-green-500" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" />
                            Copy All
                          </>
                        )}
                      </Button>
                    </div>
                    <CardDescription>
                      Profiles sorted by connection count. Filter to find core cluster members.
                    </CardDescription>

                    {/* Filters */}
                    <div className="pt-3 space-y-4">
                      {/* Bidirectional filter toggle */}
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showOnlyBidirectional}
                          onChange={(e) => setShowOnlyBidirectional(e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium">Participants only</span>
                          <span className="block text-xs text-muted-foreground">
                            Hide profiles that only received reviews (likely targets, not cluster members)
                          </span>
                        </div>
                      </label>

                      {/* Min connections slider */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Min connections to show</span>
                          <span className="font-medium">{minConnectionsToShow}+</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max={Math.max(50, Math.floor(maxConnections / 2))}
                          value={minConnectionsToShow}
                          onChange={(e) => setMinConnectionsToShow(Number(e.target.value))}
                          className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>All</span>
                          <span>Core cluster</span>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {filteredProfiles.map((profile) => (
                        <Link
                          key={profile.profileId}
                          href={`/${encodeURIComponent(profile.username || profile.profileId!.toString())}`}
                          className={`flex items-center gap-3 p-3 rounded-lg border hover:opacity-80 transition-opacity ${
                            profile.isDiscovered
                              ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
                              : "bg-background"
                          }`}
                        >
                          {profile.avatarUrl && (
                            <img
                              src={profile.avatarUrl}
                              alt={profile.displayName}
                              className={`h-10 w-10 rounded-full ring-2 ${getScoreBorderColor(profile.score)}`}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">
                                {profile.displayName}
                              </span>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {profile.username && <span>@{profile.username} · </span>}
                              Score: {profile.score}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold">{profile.connectionCount}</div>
                            <div className="text-xs text-muted-foreground">
                              <span className="text-green-600 dark:text-green-400">{profile.given}→</span>
                              {" / "}
                              <span className="text-blue-600 dark:text-blue-400">←{profile.received}</span>
                            </div>
                          </div>
                        </Link>
                      ))}
                      {filteredProfiles.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                          No profiles match the filter.
                          {showOnlyBidirectional && " Try unchecking 'Participants only' or"}
                          {!showOnlyBidirectional && " Try"} lowering the minimum connections.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}

export default function ClusterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen p-4 md:p-8 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <ClusterPageContent />
    </Suspense>
  );
}
