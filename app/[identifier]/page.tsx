"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { ProfileHeader } from "@/components/profile-header";
import { ProfileTabs } from "@/components/profile-tabs";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import {
  getCachedData,
  setCachedData,
  getProfileCacheKey,
  CacheDurations,
} from "@/lib/cache";
import type { EthosProfile } from "@/lib/types";

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const identifier = params?.identifier as string;
  const { saveSearch } = useRecentSearches();

  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<EthosProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isEthereumAddress = (value: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(value);
  };

  const fetchProfile = async (query: string) => {
    if (!query.trim()) {
      setError("Please enter an X username or EVM address");
      return;
    }

    const trimmedInput = query.trim();
    const cacheKey = getProfileCacheKey(trimmedInput);

    const cachedProfile = getCachedData<EthosProfile>(
      cacheKey,
      CacheDurations.PROFILE
    );

    if (cachedProfile) {
      setProfile(cachedProfile);
      setError(null);
      setLoading(false);
      saveSearch(cachedProfile, trimmedInput);
      if (trimmedInput !== identifier) {
        router.replace(`/${encodeURIComponent(trimmedInput)}`);
      }
      return;
    }

    setLoading(true);
    setError(null);
    setProfile(null);

    try {
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

      setCachedData(cacheKey, data);
      setProfile(data);
      saveSearch(data, trimmedInput);

      if (trimmedInput !== identifier) {
        router.replace(`/${encodeURIComponent(trimmedInput)}`);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (identifier) {
      fetchProfile(identifier);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier]);

  return (
    <div className="p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {profile && (
          <>
            <Card>
              <CardContent className="pt-6">
                <ProfileHeader profile={profile} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <ProfileTabs profile={profile} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
