"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Search, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

interface RecentSearch {
  query: string;
  displayName: string;
  username: string | null;
  avatarUrl: string;
  timestamp: number;
}

export default function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const [input, setInput] = useState("");
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);

  // Load recent searches from localStorage
  const loadRecentSearches = () => {
    const stored = localStorage.getItem("ethos-recent-searches");
    if (stored) {
      try {
        setRecentSearches(JSON.parse(stored));
      } catch (e) {
        // Invalid JSON, ignore
      }
    }
  };

  // Load recent searches on mount and when pathname changes to home
  useEffect(() => {
    loadRecentSearches();
  }, [pathname]);

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
  const searchRecent = (query: string) => {
    const trimmedInput = query.trim();
    if (trimmedInput) {
      router.push(`/${encodeURIComponent(trimmedInput)}`);
    }
  };



  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    if (trimmedInput) {
      router.push(`/${encodeURIComponent(trimmedInput)}`);
    }
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
                  />
                </div>
                <Button type="submit">
                  Search
                </Button>
              </div>
            </form>

            {recentSearches.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-sm font-medium text-muted-foreground">
                  Recent Searches
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {recentSearches.slice(0, 5).map((search, index) => (
                    <button
                      key={index}
                      onClick={() => searchRecent(search.query)}
                      className="group flex min-w-0 shrink-0 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted cursor-pointer"
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

      </div>
    </div>
  );
}
