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
const MAX_PROFILES = 50; // Allow up to 50 profiles to investigate
const MIN_CONNECTIONS_FOR_DISCOVERY = 2; // Minimum connections to cluster profiles to auto-discover
const STORAGE_KEY = "ethos-cluster-profiles";
const MAX_EXPANSION_DEPTH = 3;
const MAX_DISCOVERED_PER_LEVEL = 100; // Allow discovering up to 100 profiles per expansion level

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
  const [expansionDepth, setExpansionDepth] = useState(2); // How many levels deep to expand
  const [currentLevel, setCurrentLevel] = useState(0); // Progress indicator
  const [loadingFromUrl, setLoadingFromUrl] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedProfiles, setCopiedProfiles] = useState(false);

  // Combined profiles for visualization
  const allProfiles = [...profiles, ...discoveredProfiles];

  // Helper to check if string is ethereum address
  const isEthereumAddress = (value: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(value);
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

  const addProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    // Check if already at max
    if (profiles.length >= MAX_PROFILES) {
      setError(`Maximum ${MAX_PROFILES} profiles allowed`);
      return;
    }

    setAddingProfile(true);
    setError(null);

    try {
      // Check cache first
      const cacheKey = getProfileCacheKey(trimmedInput);
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

      // Fetch from API
      let url: string;
      if (isEthereumAddress(trimmedInput)) {
        url = `https://api.ethos.network/api/v2/user/by/address/${trimmedInput}`;
      } else {
        url = `https://api.ethos.network/api/v2/user/by/x/${trimmedInput}`;
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

  // Helper: Fetch connections for a set of profile IDs
  const fetchConnectionsForProfiles = async (
    profileIds: number[],
    knownProfileIds: Set<number>
  ): Promise<{
    reviews: ReviewActivity[];
    vouches: Vouch[];
    externalConnections: Map<number, {
      connectedTo: Set<number>;
      reviews: ReviewActivity[];
      vouches: Vouch[];
    }>;
  }> => {
    const reviews: ReviewActivity[] = [];
    const vouches: Vouch[] = [];
    const externalConnections = new Map<number, {
      connectedTo: Set<number>;
      reviews: ReviewActivity[];
      vouches: Vouch[];
    }>();

    await Promise.all(profileIds.map(async (profileId) => {
      const userkey = `profileId:${profileId}`;

      // Fetch reviews given
      try {
        const response = await fetch(
          "https://api.ethos.network/api/v2/activities/profile/given",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Ethos-Client": "ethos-scanner@0.1.0",
            },
            body: JSON.stringify({ userkey, filter: ["review"], limit: 100 }),
          }
        );
        if (response.ok) {
          const data = await response.json();
          data.values?.forEach((review: ReviewActivity) => {
            const targetId = review.subject.profileId;
            if (!targetId) return;
            if (knownProfileIds.has(targetId)) {
              reviews.push(review);
            } else {
              if (!externalConnections.has(targetId)) {
                externalConnections.set(targetId, { connectedTo: new Set(), reviews: [], vouches: [] });
              }
              externalConnections.get(targetId)!.connectedTo.add(profileId);
              externalConnections.get(targetId)!.reviews.push(review);
            }
          });
        }
      } catch (err) {
        console.error("Error fetching given reviews", profileId, err);
      }

      // Fetch reviews received
      try {
        const response = await fetch(
          "https://api.ethos.network/api/v2/activities/profile/received",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Ethos-Client": "ethos-scanner@0.1.0",
            },
            body: JSON.stringify({ userkey, filter: ["review"], limit: 100 }),
          }
        );
        if (response.ok) {
          const data = await response.json();
          data.values?.forEach((review: ReviewActivity) => {
            const authorId = review.author.profileId;
            if (!authorId) return;
            if (knownProfileIds.has(authorId)) {
              if (!reviews.some(r => r.data.id === review.data.id)) {
                reviews.push(review);
              }
            } else {
              if (!externalConnections.has(authorId)) {
                externalConnections.set(authorId, { connectedTo: new Set(), reviews: [], vouches: [] });
              }
              externalConnections.get(authorId)!.connectedTo.add(profileId);
              externalConnections.get(authorId)!.reviews.push(review);
            }
          });
        }
      } catch (err) {
        console.error("Error fetching received reviews", profileId, err);
      }

      // Fetch vouches given
      try {
        const response = await fetch(
          "https://api.ethos.network/api/v2/vouches",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Ethos-Client": "ethos-scanner@0.1.0",
            },
            body: JSON.stringify({ authorProfileIds: [profileId], limit: 100 }),
          }
        );
        if (response.ok) {
          const data = await response.json();
          data.values?.forEach((vouch: Vouch) => {
            const targetId = vouch.subjectProfileId;
            if (!targetId) return;
            if (knownProfileIds.has(targetId)) {
              vouches.push(vouch);
            } else {
              if (!externalConnections.has(targetId)) {
                externalConnections.set(targetId, { connectedTo: new Set(), reviews: [], vouches: [] });
              }
              externalConnections.get(targetId)!.connectedTo.add(profileId);
              externalConnections.get(targetId)!.vouches.push(vouch);
            }
          });
        }
      } catch (err) {
        console.error("Error fetching given vouches", profileId, err);
      }

      // Fetch vouches received
      try {
        const response = await fetch(
          "https://api.ethos.network/api/v2/vouches",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Ethos-Client": "ethos-scanner@0.1.0",
            },
            body: JSON.stringify({ subjectProfileIds: [profileId], limit: 100 }),
          }
        );
        if (response.ok) {
          const data = await response.json();
          data.values?.forEach((vouch: Vouch) => {
            const authorId = vouch.authorProfileId;
            if (!authorId) return;
            if (knownProfileIds.has(authorId)) {
              if (!vouches.some(v => v.authorProfileId === vouch.authorProfileId && v.subjectProfileId === vouch.subjectProfileId)) {
                vouches.push(vouch);
              }
            } else {
              if (!externalConnections.has(authorId)) {
                externalConnections.set(authorId, { connectedTo: new Set(), reviews: [], vouches: [] });
              }
              externalConnections.get(authorId)!.connectedTo.add(profileId);
              externalConnections.get(authorId)!.vouches.push(vouch);
            }
          });
        }
      } catch (err) {
        console.error("Error fetching received vouches", profileId, err);
      }
    }));

    return { reviews, vouches, externalConnections };
  };

  // Helper: Fetch profile data for a list of profile IDs
  const fetchProfileData = async (profileIds: number[], level: number): Promise<EthosProfile[]> => {
    const profiles: EthosProfile[] = [];
    await Promise.all(profileIds.map(async (profileId) => {
      try {
        const cacheKey = `cache-profile-id-${profileId}`;
        const cached = getCachedData<EthosProfile>(cacheKey, CacheDurations.PROFILE);
        if (cached) {
          profiles.push({ ...cached, isDiscovered: true, discoveryLevel: level });
          return;
        }
        const response = await fetch(
          `https://api.ethos.network/api/v2/user/by/profile/${profileId}`,
          { headers: { "X-Ethos-Client": "ethos-scanner@0.1.0" } }
        );
        if (response.ok) {
          const profile: EthosProfile = await response.json();
          setCachedData(cacheKey, profile);
          profiles.push({ ...profile, isDiscovered: true, discoveryLevel: level });
        }
      } catch (err) {
        console.error("Error fetching profile", profileId, err);
      }
    }));
    return profiles;
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
      const allVouches: Vouch[] = [];

      // Profiles to scan at each level (start with submitted profiles)
      let profilesToScan = profiles.map(p => p.profileId!);

      // Iterative multi-level expansion
      for (let level = 1; level <= expansionDepth; level++) {
        setCurrentLevel(level);

        // Fetch connections for current level's profiles
        const { reviews, vouches, externalConnections } = await fetchConnectionsForProfiles(
          profilesToScan,
          allKnownIds
        );

        // Add internal connections to results
        reviews.forEach(r => {
          if (!allReviews.some(existing => existing.data.id === r.data.id)) {
            allReviews.push(r);
          }
        });
        vouches.forEach(v => {
          if (!allVouches.some(existing =>
            existing.authorProfileId === v.authorProfileId &&
            existing.subjectProfileId === v.subjectProfileId
          )) {
            allVouches.push(v);
          }
        });

        // Find new profiles connected to 2+ known profiles
        const newDiscoveredIds: number[] = [];
        externalConnections.forEach((data, externalId) => {
          if (data.connectedTo.size >= MIN_CONNECTIONS_FOR_DISCOVERY && !allKnownIds.has(externalId)) {
            newDiscoveredIds.push(externalId);
          }
        });

        // Limit discoveries per level to avoid runaway expansion
        const limitedDiscoveredIds = newDiscoveredIds.slice(0, MAX_DISCOVERED_PER_LEVEL);

        if (limitedDiscoveredIds.length === 0) {
          // No more profiles to discover, stop expansion early
          break;
        }

        // Fetch profile data for newly discovered profiles
        const newProfiles = await fetchProfileData(limitedDiscoveredIds, level);
        allDiscovered.push(...newProfiles);

        // Add newly discovered IDs to known set
        limitedDiscoveredIds.forEach(id => allKnownIds.add(id));

        // Add connections involving discovered profiles
        externalConnections.forEach((data, externalId) => {
          if (allKnownIds.has(externalId)) {
            data.reviews.forEach(review => {
              if (allKnownIds.has(review.author.profileId) && allKnownIds.has(review.subject.profileId)) {
                if (!allReviews.some(r => r.data.id === review.data.id)) {
                  allReviews.push(review);
                }
              }
            });
            data.vouches.forEach(vouch => {
              if (allKnownIds.has(vouch.authorProfileId) && allKnownIds.has(vouch.subjectProfileId)) {
                if (!allVouches.some(v =>
                  v.authorProfileId === vouch.authorProfileId &&
                  v.subjectProfileId === vouch.subjectProfileId
                )) {
                  allVouches.push(vouch);
                }
              }
            });
          }
        });

        // Next level will scan the newly discovered profiles
        profilesToScan = limitedDiscoveredIds;
      }

      setDiscoveredProfiles(allDiscovered);
      setReviews(allReviews);
      setVouches(allVouches);
      setInvestigated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setInvestigating(false);
      setCurrentLevel(0);
    }
  };

  const totalConnections = reviews.length + vouches.length;
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
              Enter {MIN_PROFILES}-{MAX_PROFILES} profiles to investigate their connections on Ethos.
              Supports X usernames or wallet addresses.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Input form */}
            <form onSubmit={addProfile} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Enter X username or wallet address"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="pl-10"
                  disabled={addingProfile || profiles.length >= MAX_PROFILES}
                />
              </div>
              <Button
                type="submit"
                disabled={addingProfile || !input.trim() || profiles.length >= MAX_PROFILES}
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
                    Added Profiles ({profiles.length}/{MAX_PROFILES})
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
                      {profile.avatarUrl && (
                        <img
                          src={profile.avatarUrl}
                          alt={profile.displayName}
                          className="h-6 w-6 shrink-0 rounded-full"
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
                    Connected to 2+ cluster profiles
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {discoveredProfiles.map((profile) => (
                    <div
                      key={profile.profileId}
                      className="group flex items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm"
                    >
                      {profile.avatarUrl && (
                        <img
                          src={profile.avatarUrl}
                          alt={profile.displayName}
                          className="h-6 w-6 shrink-0 rounded-full ring-2 ring-amber-400"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {profile.displayName}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          Score: {profile.score}
                          {profile.discoveryLevel && (
                            <span className="ml-1 text-amber-600 dark:text-amber-400">
                              • L{profile.discoveryLevel}
                            </span>
                          )}
                        </div>
                      </div>
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

            {/* Expansion depth control */}
            {profiles.length >= MIN_PROFILES && (
              <div className="space-y-2 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-muted-foreground">
                    Network Expansion Depth
                  </div>
                  <div className="text-sm font-medium">
                    {expansionDepth} level{expansionDepth > 1 ? "s" : ""}
                  </div>
                </div>
                <input
                  type="range"
                  min="1"
                  max={MAX_EXPANSION_DEPTH}
                  value={expansionDepth}
                  onChange={(e) => setExpansionDepth(Number(e.target.value))}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                  disabled={investigating}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1 (Direct only)</span>
                  <span>2 (2nd degree)</span>
                  <span>3 (Deep scan)</span>
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
                  {currentLevel > 0 ? `Scanning level ${currentLevel}...` : "Starting..."}
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
                  />
                )}
              </CardContent>
            </Card>

            {/* Profile List */}
            {allProfiles.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Connected Profiles ({allProfiles.length})</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyAllProfiles}
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
                    All profiles in this cluster sorted by connection count
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {allProfiles
                      .map(profile => ({
                        ...profile,
                        connectionCount: getConnectionCount(profile.profileId!)
                      }))
                      .sort((a, b) => b.connectionCount - a.connectionCount)
                      .map((profile) => (
                        <div
                          key={profile.profileId}
                          className={`flex items-center gap-3 p-3 rounded-lg border ${
                            profile.isDiscovered
                              ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
                              : "bg-background"
                          }`}
                        >
                          {profile.avatarUrl && (
                            <img
                              src={profile.avatarUrl}
                              alt={profile.displayName}
                              className={`h-10 w-10 rounded-full ${
                                profile.isDiscovered ? "ring-2 ring-amber-400" : ""
                              }`}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">
                                {profile.displayName}
                              </span>
                              {profile.isDiscovered && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">
                                  L{profile.discoveryLevel}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {profile.username && <span>@{profile.username} · </span>}
                              Score: {profile.score}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold">{profile.connectionCount}</div>
                            <div className="text-xs text-muted-foreground">connections</div>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}
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
