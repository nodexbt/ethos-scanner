"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search, Home, Users, Menu, X } from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import { useRecentSearches } from "@/hooks/use-recent-searches";

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const { recentSearches, removeSearch } = useRecentSearches();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed) {
      router.push(`/${encodeURIComponent(trimmed)}`);
      setInput("");
      setIsOpen(false);
    }
  };

  const navLinks = [
    { href: "/", label: "Home", icon: Home },
    { href: "/cluster", label: "Cluster Investigation", icon: Users },
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

        {/* Search */}
        <div className="p-4">
          <form onSubmit={handleSearch}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search profile..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="pl-10 h-9 text-sm"
              />
            </div>
          </form>
        </div>

        {/* Recent searches */}
        <div className="flex-1 overflow-y-auto px-3">
          {recentSearches.length > 0 && (
            <>
              <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">
                Recent
              </div>
              <div className="space-y-0.5">
                {recentSearches.map((search) => (
                  <button
                    key={search.query}
                    onClick={() => {
                      router.push(
                        `/${encodeURIComponent(search.query)}`
                      );
                      setIsOpen(false);
                    }}
                    className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted cursor-pointer"
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
                        removeSearch(search.query);
                      }}
                      className="shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted-foreground/10 cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          removeSearch(search.query);
                        }
                      }}
                    >
                      <X className="h-3 w-3" />
                    </div>
                  </button>
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
