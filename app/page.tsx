"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Search, Loader2, User, ExternalLink, X } from "lucide-react";
import { InvitationMap } from "@/components/invitation-map";
import { VouchesMap } from "@/components/vouches-map";
import { ReviewsMap } from "@/components/reviews-map";
import { ThemeToggle } from "@/components/theme-toggle";

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
}

interface RecentSearch {
  query: string;
  displayName: string;
  username: string | null;
  avatarUrl: string;
  timestamp: number;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<EthosProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);

  // Load recent searches from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("ethos-recent-searches");
    if (stored) {
      try {
        setRecentSearches(JSON.parse(stored));
      } catch (e) {
        // Invalid JSON, ignore
      }
    }
  }, []);

  // Save recent searches to localStorage
  const saveRecentSearch = (profile: EthosProfile, query: string) => {
    const newSearch: RecentSearch = {
      query,
      displayName: profile.displayName,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      timestamp: Date.now(),
    };

    setRecentSearches((prev) => {
      // Remove duplicates and limit to 10 most recent
      const filtered = prev.filter((s) => s.query.toLowerCase() !== query.toLowerCase());
      const updated = [newSearch, ...filtered].slice(0, 10);
      localStorage.setItem("ethos-recent-searches", JSON.stringify(updated));
      return updated;
    });
  };

  // Remove a recent search
  const removeRecentSearch = (query: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRecentSearches((prev) => {
      const updated = prev.filter((s) => s.query.toLowerCase() !== query.toLowerCase());
      localStorage.setItem("ethos-recent-searches", JSON.stringify(updated));
      return updated;
    });
  };

  // Search using a recent search query
  const searchRecent = async (query: string) => {
    setInput(query);
    setLoading(true);
    setError(null);
    setProfile(null);

    try {
      const trimmedInput = query.trim();
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
          setError("Profile not found. Please check the username or address.");
        } else {
          setError(`Failed to fetch profile: ${response.statusText}`);
        }
        return;
      }

      const data = await response.json();
      setProfile(data);
      saveRecentSearch(data, query);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setLoading(false);
    }
  };

  const isEthereumAddress = (value: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(value);
  };

  const fetchProfile = async () => {
    if (!input.trim()) {
      setError("Please enter an X username or EVM address");
      return;
    }

    setLoading(true);
    setError(null);
    setProfile(null);

    try {
      const trimmedInput = input.trim();
      let url: string;

      if (isEthereumAddress(trimmedInput)) {
        // Use address endpoint
        url = `https://api.ethos.network/api/v2/user/by/address/${trimmedInput}`;
      } else {
        // Use X username endpoint
        url = `https://api.ethos.network/api/v2/user/by/x/${trimmedInput}`;
      }

      const response = await fetch(url, {
        headers: {
          "X-Ethos-Client": "ethos-scanner@0.1.0",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          setError("Profile not found. Please check the username or address.");
        } else {
          setError(`Failed to fetch profile: ${response.statusText}`);
        }
        return;
      }

      const data = await response.json();
      setProfile(data);
      saveRecentSearch(data, trimmedInput);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchProfile();
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="relative">
          <div className="absolute top-0 right-0">
            <ThemeToggle />
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">Ethos Scanner</h1>
            <p className="text-muted-foreground">
              Look up Ethos Network profiles by X username or EVM address
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Search Profile</CardTitle>
            <CardDescription>
              Enter an X (Twitter) username or an Ethereum wallet address
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="e.g., VitalikButerin or 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    className="pl-10"
                    disabled={loading}
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Searching...
                    </>
                  ) : (
                    "Search"
                  )}
                </Button>
              </div>
            </form>

            {error && (
              <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {recentSearches.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-sm font-medium text-muted-foreground">
                  Recent Searches
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {recentSearches.map((search, index) => (
                    <button
                      key={index}
                      onClick={() => searchRecent(search.query)}
                      disabled={loading}
                      className="group flex min-w-0 shrink-0 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {search.avatarUrl && (
                        <img
                          src={search.avatarUrl}
                          alt={search.displayName}
                          className="h-6 w-6 shrink-0 rounded-full"
                        />
                      )}
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate font-medium">
                          {search.displayName}
                        </div>
                        {search.username && (
                          <div className="truncate text-xs text-muted-foreground">
                            @{search.username}
                          </div>
                        )}
                      </div>
                      <div
                        onClick={(e) => removeRecentSearch(search.query, e)}
                        className="shrink-0 cursor-pointer rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted"
                        aria-label="Remove from recent searches"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            removeRecentSearch(search.query, e as any);
                          }
                        }}
                      >
                        <X className="h-3 w-3" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {profile && (
          <Card>
            <CardHeader>
              <div className="flex items-start gap-4">
                {profile.avatarUrl && (
                  <img
                    src={profile.avatarUrl}
                    alt={profile.displayName}
                    className="h-16 w-16 rounded-full"
                  />
                )}
                <div className="flex-1">
                  <CardTitle className="flex items-center gap-2">
                    {profile.displayName}
                    {profile.username && (
                      <span className="text-muted-foreground font-normal">
                        @{profile.username}
                      </span>
                    )}
                  </CardTitle>
                  {profile.description && (
                    <CardDescription className="mt-2">
                      {profile.description}
                    </CardDescription>
                  )}
                </div>
                <a
                  href={profile.links.profile}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  <ExternalLink className="h-5 w-5" />
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">
                    Credibility Score
                  </div>
                  <div className="text-3xl font-bold">{profile.score}</div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">
                    Status
                  </div>
                  <div className="text-lg font-semibold capitalize">
                    {profile.status.toLowerCase()}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">
                    Total XP
                  </div>
                  <div className="text-2xl font-semibold">
                    {profile.xpTotal.toLocaleString()}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">
                    XP Streak
                  </div>
                  <div className="text-2xl font-semibold">
                    {profile.xpStreakDays} days
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">
                    Influence Factor
                  </div>
                  <div className="text-lg font-semibold">
                    {profile.influenceFactor.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {profile.influenceFactorPercentile.toFixed(1)}th percentile
                  </div>
                </div>
                {profile.profileId && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-muted-foreground">
                      Profile ID
                    </div>
                    <div className="text-lg font-semibold">
                      {profile.profileId}
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t pt-6">
                <h3 className="mb-4 text-lg font-semibold">Reviews Received</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Positive</div>
                    <div className="text-xl font-semibold text-green-600">
                      {profile.stats.review.received.positive}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Neutral</div>
                    <div className="text-xl font-semibold text-gray-600">
                      {profile.stats.review.received.neutral}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Negative</div>
                    <div className="text-xl font-semibold text-red-600">
                      {profile.stats.review.received.negative}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="mb-4 text-lg font-semibold">Vouches</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Given</div>
                    <div className="text-lg font-semibold">
                      {profile.stats.vouch.given.count} vouches
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(
                        Number(profile.stats.vouch.given.amountWeiTotal) /
                        1e18
                      ).toFixed(4)}{" "}
                      ETH
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Received</div>
                    <div className="text-lg font-semibold">
                      {profile.stats.vouch.received.count} vouches
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(
                        Number(profile.stats.vouch.received.amountWeiTotal) /
                        1e18
                      ).toFixed(4)}{" "}
                      ETH
                    </div>
                  </div>
                </div>
              </div>

              {profile.userkeys.length > 0 && (
                <div className="border-t pt-6">
                  <h3 className="mb-4 text-lg font-semibold">User Keys</h3>
                  <div className="flex flex-wrap gap-2">
                    {profile.userkeys.map((key, index) => (
                      <span
                        key={index}
                        className="rounded-md bg-muted px-2 py-1 text-xs font-mono"
                      >
                        {key}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-6">
                <h3 className="mb-4 text-lg font-semibold">Invitation Network</h3>
                <InvitationMap
                  userId={profile.id}
                  profileId={profile.profileId}
                  userName={profile.displayName}
                  avatarUrl={profile.avatarUrl}
                />
              </div>

              <div className="border-t pt-6">
                <h3 className="mb-4 text-lg font-semibold">Reviews Network</h3>
                <ReviewsMap
                  userId={profile.id}
                  profileId={profile.profileId}
                  userName={profile.displayName}
                  avatarUrl={profile.avatarUrl}
                />
              </div>

              <div className="border-t pt-6">
                <h3 className="mb-4 text-lg font-semibold">Vouches Network</h3>
                <VouchesMap
                  userId={profile.id}
                  profileId={profile.profileId}
                  userName={profile.displayName}
                  avatarUrl={profile.avatarUrl}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <a
                  href={profile.links.profile}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" className="w-full">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View Full Profile
                  </Button>
                </a>
                <a
                  href={profile.links.scoreBreakdown}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" className="w-full">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Score Breakdown
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
