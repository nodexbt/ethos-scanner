"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Home, Menu, X, Plus, LineChart } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

const RECENT_SEARCHES_KEY = "ethos-sybil-recent-searches";

interface RecentSearch {
  profileId: number;
  displayName: string;
  username: string | null;
  avatarUrl: string;
  score: number;
  timestamp: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (saved) setRecentSearches(JSON.parse(saved));
    } catch {}

    // Listen for storage changes (from the main page)
    const onStorage = () => {
      try {
        const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
        if (saved) setRecentSearches(JSON.parse(saved));
      } catch {}
    };
    window.addEventListener("storage", onStorage);

    // Also poll since storage events don't fire in the same tab
    const interval = setInterval(onStorage, 1000);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(interval);
    };
  }, []);

  const removeSearch = (profileId: number) => {
    try {
      const filtered = recentSearches.filter((s) => s.profileId !== profileId);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(filtered));
      setRecentSearches(filtered);
    } catch {}
  };

  const addToScan = (search: RecentSearch) => {
    window.dispatchEvent(
      new CustomEvent("ethos-add-profile", {
        detail: { username: search.username, profileId: search.profileId },
      })
    );
  };

  const navLinks = [
    { href: "/", label: "Home", icon: Home },
    { href: "/monitoring", label: "Monitoring", icon: LineChart },
  ];

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="fixed top-4 left-4 z-50 rounded-md border border-border bg-background p-2 md:hidden"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-40 flex h-screen w-64 flex-col border-r border-border bg-card transition-transform duration-200 md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Branding */}
        <div className="border-b border-border p-4">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight"
            onClick={() => setIsOpen(false)}
          >
            Ethos Scanner
          </Link>
        </div>

        {/* Recent searches */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {recentSearches.length > 0 && (
            <>
              <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">
                Recent
              </div>
              <div className="space-y-0.5">
                {recentSearches.map((search) => (
                  <div
                    key={search.profileId}
                    className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                  >
                    {search.avatarUrl && (
                      <img
                        src={search.avatarUrl}
                        alt={search.displayName}
                        className="h-6 w-6 shrink-0 rounded-full"
                      />
                    )}
                    <div className="min-w-0 flex-1 text-left">
                      <div className="truncate font-medium text-sm">
                        {search.displayName}
                      </div>
                      {search.username && (
                        <div className="truncate text-xs text-muted-foreground">
                          @{search.username}
                        </div>
                      )}
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        addToScan(search);
                      }}
                      className="shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted-foreground/10 cursor-pointer"
                      role="button"
                      tabIndex={0}
                      title="Add to scan"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          addToScan(search);
                        }
                      }}
                    >
                      <Plus className="h-3 w-3" />
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSearch(search.profileId);
                      }}
                      className="shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted-foreground/10 cursor-pointer"
                      role="button"
                      tabIndex={0}
                      title="Remove"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          removeSearch(search.profileId);
                        }
                      }}
                    >
                      <X className="h-3 w-3" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Navigation */}
        <nav className="space-y-0.5 border-t border-border px-3 py-3">
          {navLinks.map((link) => {
            const isActive =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Theme toggle */}
        <div className="border-t border-border p-4">
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
