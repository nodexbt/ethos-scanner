"use client";

import { useState, useCallback, useEffect } from "react";
import type { RecentSearch, EthosProfile } from "@/lib/types";

const STORAGE_KEY = "ethos-recent-searches";
const MAX_RECENT = 10;
const SYNC_EVENT = "recent-searches-updated";

function readFromStorage(): RecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function useRecentSearches() {
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(readFromStorage);

  const reload = useCallback(() => {
    setRecentSearches(readFromStorage());
  }, []);

  const saveSearch = useCallback((profile: EthosProfile, query: string) => {
    const newSearch: RecentSearch = {
      query,
      displayName: profile.displayName,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      timestamp: Date.now(),
    };

    try {
      const prev = readFromStorage();
      const filtered = prev.filter(
        (s) => s.query.toLowerCase() !== query.toLowerCase()
      );
      const updated = [newSearch, ...filtered].slice(0, MAX_RECENT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setRecentSearches(updated);
      window.dispatchEvent(new Event(SYNC_EVENT));
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const removeSearch = useCallback((query: string) => {
    setRecentSearches((prev) => {
      const updated = prev.filter(
        (s) => s.query.toLowerCase() !== query.toLowerCase()
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(new Event(SYNC_EVENT));
      return updated;
    });
  }, []);

  // Listen for sync events from other components
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, [reload]);

  return { recentSearches, reload, saveSearch, removeSearch };
}
