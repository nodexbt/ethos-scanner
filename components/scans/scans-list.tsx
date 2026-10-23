"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Search, Loader2, AlertTriangle, Shield, Wallet, FolderOpen, Trash2, Share2 } from "lucide-react";
import { EthosScoreIcon } from "@/components/ui/ethos-score-icon";

export interface InvestigationSummary {
  id: string;
  target: string;
  targetName: string | null;
  targetAvatar: string | null;
  savedAt: number;
  strongCount: number;
  possibleCount: number;
  score: number | null;
  shareId: string | null;
  isPublic: boolean;
  ownerProfileId: number | null;
  lastScannedBy: { displayName: string; avatarUrl: string; profileUrl: string } | null;
}

export const SORT_OPTIONS: { value: string; label: string; sort?: string; dir?: string }[] = [
  { value: "", label: "Default sort" },
  { value: "recent-desc", label: "Newest first", sort: "recent", dir: "desc" },
  { value: "recent-asc", label: "Oldest first", sort: "recent", dir: "asc" },
  { value: "strong-desc", label: "Most strong", sort: "strong", dir: "desc" },
  { value: "possible-desc", label: "Most possible", sort: "possible", dir: "desc" },
  { value: "score-desc", label: "Highest Ethos score", sort: "score", dir: "desc" },
  { value: "score-asc", label: "Lowest Ethos score", sort: "score", dir: "asc" },
];

export const SCORE_BANDS: { value: string; label: string; min?: number }[] = [
  { value: "", label: "Any score" },
  { value: "1400", label: "Ethos score > 1400", min: 1400 },
  { value: "1600", label: "Ethos score > 1600", min: 1600 },
  { value: "1800", label: "Ethos score > 1800", min: 1800 },
  { value: "2000", label: "Ethos score > 2000", min: 2000 },
];

/** Build the shared search/sort/filter query params from control state. */
export function listControlParams(c: {
  search: string;
  sortValue: string;
  flaggedOnly: boolean;
  scoreBand: string;
}): URLSearchParams {
  const p = new URLSearchParams();
  if (c.search.trim()) p.set("search", c.search.trim());
  const sort = SORT_OPTIONS.find((o) => o.value === c.sortValue);
  if (sort?.sort) {
    p.set("sort", sort.sort);
    if (sort.dir) p.set("dir", sort.dir);
  }
  if (c.flaggedOnly) p.set("flagged", "1");
  const band = SCORE_BANDS.find((b) => b.value === c.scoreBand);
  if (band?.min != null) p.set("minScore", String(band.min));
  return p;
}

/** Investigation id for a scan result: per-profile when the target has an
    Ethos profile, legacy per-address otherwise. Mirrors lib/scan-target. */

export function ScansListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-9 w-full max-w-sm bg-muted rounded-md animate-pulse" />
        <div className="h-4 w-16 bg-muted rounded animate-pulse" />
      </div>
      <div className="grid gap-2 min-w-0">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 sm:gap-4 rounded-lg border border-border bg-card/60 backdrop-blur-sm px-3 sm:px-4 py-3"
          >
            <div className="h-10 w-10 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-4 w-40 max-w-full bg-muted rounded animate-pulse" />
              <div className="h-3 w-72 max-w-full bg-muted rounded animate-pulse" />
            </div>
            <div className="hidden md:flex items-center gap-3 shrink-0">
              <div className="h-3 w-16 bg-muted rounded animate-pulse" />
              <div className="h-3 w-20 bg-muted rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ScansListProps {
  investigations: InvestigationSummary[];
  emptyLabel: string;
  search: string;
  onSearchChange: (value: string) => void;
  // Server-side sort/filter controls (shared across tabs).
  sortValue: string;
  onSortChange: (value: string) => void;
  flaggedOnly: boolean;
  onFlaggedChange: (value: boolean) => void;
  scoreBand: string;
  onScoreBandChange: (value: string) => void;
  currentInvestigationId: string | null;
  canDelete: (inv: InvestigationSummary) => boolean;
  onLoad: (inv: InvestigationSummary) => void;
  onDelete: (id: string) => void;
  /** Optional server-side pagination knobs — when provided, the list
   * renders a Load-more button that calls onLoadMore until investigations
   * reaches totalCount. */
  totalCount?: number;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  loadMoreBatchSize?: number;
}

export function ScansList({
  investigations,
  emptyLabel,
  search,
  onSearchChange,
  sortValue,
  onSortChange,
  flaggedOnly,
  onFlaggedChange,
  scoreBand,
  onScoreBandChange,
  currentInvestigationId,
  canDelete,
  onLoad,
  onDelete,
  totalCount,
  onLoadMore,
  loadingMore,
  loadMoreBatchSize = 50,
}: ScansListProps) {
  // Search/sort/filter are all applied server-side now, so this list renders
  // exactly the rows it was given for the current query.
  const displayedTotal = totalCount ?? investigations.length;
  const hasRemoteMore =
    onLoadMore != null && totalCount != null && investigations.length < totalCount;
  const filtersActive = flaggedOnly || scoreBand !== "" || search.trim() !== "";

  return (
    <div className="space-y-4">
      {/* Search + controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[10rem] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name or address..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select label="Sort scans" value={sortValue} options={SORT_OPTIONS} onChange={onSortChange} />
        <Select label="Filter by score" value={scoreBand} options={SCORE_BANDS} onChange={onScoreBandChange} />
        <button
          onClick={() => onFlaggedChange(!flaggedOnly)}
          className={`h-9 rounded-md border px-2.5 text-xs cursor-pointer inline-flex items-center gap-1.5 transition-colors ${
            flaggedOnly
              ? "border-red-500/50 bg-red-500/10 text-red-500"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
          title="Show only scans with at least one strong or possible cluster"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Flagged only
        </button>
        <span className="text-sm text-muted-foreground ml-auto">
          {displayedTotal.toLocaleString()} {filtersActive ? "match" : "scan"}
          {displayedTotal === 1 ? "" : filtersActive ? "es" : "s"}
        </span>
      </div>

      {investigations.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm gap-2">
          <FolderOpen className="h-8 w-8" />
          <p>{filtersActive ? "No scans match these filters." : emptyLabel}</p>
        </div>
      ) : (
        <div className="grid gap-2 min-w-0">
          <div className="hidden md:flex items-center gap-4 px-4 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            <span className="w-10 shrink-0" />
            <span className="flex-1">Profile</span>
            <div className="grid grid-cols-[4.5rem_8.5rem_10rem_5.5rem] gap-3 shrink-0">
              <span>Ethos</span>
              <span>Links</span>
              <span>Scanned by</span>
              <span>Date</span>
            </div>
            <span className="w-7 shrink-0" />
          </div>
          {investigations.map((inv) => (
            <div
              key={inv.id}
              className={`group flex items-center gap-3 sm:gap-4 min-w-0 rounded-lg border border-border bg-card/60 backdrop-blur-sm px-3 sm:px-4 py-3 transition-colors ${
                currentInvestigationId === inv.id ? "border-primary bg-primary/10" : "hover:bg-card/80"
              }`}
            >
              {inv.targetAvatar ? (
                <img loading="lazy" decoding="async"
                  src={inv.targetAvatar}
                  alt={inv.targetName || ""}
                  className="h-10 w-10 rounded-full shrink-0"
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Wallet className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <button
                onClick={() => onLoad(inv)}
                className="flex-1 min-w-0 text-left cursor-pointer"
              >
                <div className="font-medium truncate">
                  {inv.targetName || `${inv.target.slice(0, 10)}...${inv.target.slice(-6)}`}
                </div>
                <div className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                  {inv.target}
                </div>
              </button>
              {/* Fixed-width columns so values line up down the list. */}
              <div className="hidden md:grid md:grid-cols-[4.5rem_8.5rem_10rem_5.5rem] items-center gap-3 text-xs text-muted-foreground shrink-0">
                <span className="flex items-center gap-0.5 tabular-nums" title="Ethos score">
                  {inv.score != null ? (
                    <>
                      {inv.score}
                      <EthosScoreIcon size={9} className="ml-0.5" />
                    </>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  {inv.strongCount > 0 && (
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-red-500" />
                      {inv.strongCount}
                    </span>
                  )}
                  {inv.possibleCount > 0 && (
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      {inv.possibleCount}
                    </span>
                  )}
                  {inv.strongCount === 0 && inv.possibleCount === 0 && (
                    <span className="flex items-center gap-1" title="The scan found no on-chain links. That is not proof of innocence.">
                      <Shield className="h-3 w-3" />
                      No links
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1.5 min-w-0">
                  {inv.lastScannedBy ? (
                    <>
                      <img loading="lazy" decoding="async"
                        src={inv.lastScannedBy.avatarUrl}
                        alt=""
                        className="h-4 w-4 rounded-full shrink-0"
                      />
                      <span className="truncate text-foreground" title={`Scanned by ${inv.lastScannedBy.displayName}`}>
                        {inv.lastScannedBy.displayName}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground/70">automated</span>
                  )}
                </span>
                <span className="flex items-center gap-1.5 tabular-nums whitespace-nowrap">
                  {inv.isPublic && <Share2 className="h-3 w-3" aria-label="Shared" />}
                  {new Date(inv.savedAt).toLocaleDateString()}
                </span>
              </div>
              {canDelete(inv) && (
                <button
                  onClick={() => onDelete(inv.id)}
                  className="shrink-0 p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity cursor-pointer"
                  title="Delete scan"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          ))}
          {hasRemoteMore && (
            <button
              onClick={() => onLoadMore?.()}
              disabled={loadingMore}
              className="mt-1 mx-auto text-xs text-muted-foreground hover:text-foreground bg-card border border-border rounded-md px-3 py-2 cursor-pointer disabled:opacity-60 disabled:cursor-wait inline-flex items-center gap-2"
            >
              {loadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
              Load {Math.min(loadMoreBatchSize, (totalCount ?? 0) - investigations.length)} more · {(totalCount ?? 0) - investigations.length} remaining
            </button>
          )}
        </div>
      )}
    </div>
  );
}
