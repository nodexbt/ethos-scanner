"use client";

import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SegmentedTab, SegmentedCount } from "@/components/ui/segmented";
import { Search, Loader2, AlertTriangle, Wallet, FolderOpen, Trash2, Share2, History, ShieldCheck } from "lucide-react";
import { EthosScoreIcon } from "@/components/ui/ethos-score-icon";
import { AvatarImg } from "@/components/ui/avatar-img";
import { Plate } from "@/components/ui/plate";
import { LinkCounts } from "./link-counts";

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

/** Address of a saved scan: profile scans by id (the scanner then switches
    to the handle), raw-wallet scans by address. */
export function investigationHref(inv: { id: string; target: string }): string {
  const profileId = inv.id.match(/^scan-p(\d+)$/)?.[1];
  return profileId ? `/scan/x/${profileId}` : `/scan/${inv.target.toLowerCase()}`;
}

export const DEFAULT_SORT = "default";
export const DEFAULT_SCORE_BAND = "any";

/** Scope chips: which saved scans are listed. */
const SCOPES = [
  ["all", "All", FolderOpen],
  ["yours", "Mine", History],
  ["verified", "Human verified", ShieldCheck],
] as const;

const SORT_OPTIONS: { value: string; label: string; sort?: string; dir?: string }[] = [
  { value: "default", label: "Default sort" },
  { value: "recent-desc", label: "Newest first", sort: "recent", dir: "desc" },
  { value: "recent-asc", label: "Oldest first", sort: "recent", dir: "asc" },
  { value: "strong-desc", label: "Most strong", sort: "strong", dir: "desc" },
  { value: "possible-desc", label: "Most possible", sort: "possible", dir: "desc" },
  { value: "score-desc", label: "Highest Ethos score", sort: "score", dir: "desc" },
  { value: "score-asc", label: "Lowest Ethos score", sort: "score", dir: "asc" },
];

const SCORE_BANDS: { value: string; label: string; min?: number }[] = [
  { value: "any", label: "Any score" },
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

function OptionSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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

export type ScanScope = "all" | "yours" | "verified";

interface ScansListProps {
  investigations: InvestigationSummary[];
  /** Which saved scans are listed; chips switch between them. */
  scope: ScanScope;
  onScopeChange: (scope: ScanScope) => void;
  counts: Record<ScanScope, number>;
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
  /** Deletes the scan; throws on failure so the dialog can show it. */
  onDelete: (id: string) => Promise<void>;
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
  scope,
  onScopeChange,
  counts,
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
  const filtersActive = flaggedOnly || scoreBand !== DEFAULT_SCORE_BAND || search.trim() !== "";
  // The scan awaiting delete confirmation; kept while the dialog animates out.
  const [pendingDelete, setPendingDelete] = useState<InvestigationSummary | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const nameOf = (inv: InvestigationSummary) =>
    inv.targetName || `${inv.target.slice(0, 10)}...${inv.target.slice(-6)}`;

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
        <div className="inline-flex h-9 items-center rounded-md border border-border bg-card p-0.5">
          {SCOPES.map(([key, label, Icon]) => (
            <SegmentedTab key={key} size="sm" icon={Icon} active={scope === key} onClick={() => onScopeChange(key)}>
              {label}
              <SegmentedCount size="sm" value={counts[key]} />
            </SegmentedTab>
          ))}
        </div>
        <OptionSelect label="Sort scans" value={sortValue} options={SORT_OPTIONS} onChange={onSortChange} />
        <OptionSelect label="Filter by score" value={scoreBand} options={SCORE_BANDS} onChange={onScoreBandChange} />
        <button
          onClick={() => onFlaggedChange(!flaggedOnly)}
          className={`h-9 rounded-md border px-2.5 text-xs cursor-pointer inline-flex items-center gap-1.5 transition-colors ${
            flaggedOnly
              ? "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-500"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
          title="Show only scans with at least one strong or possible cluster"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Flagged only
        </button>
        <Plate className="ml-auto px-2.5 py-1 text-sm text-muted-foreground">
          {displayedTotal.toLocaleString()} {filtersActive ? "match" : "scan"}
          {displayedTotal === 1 ? "" : filtersActive ? "es" : "s"}
        </Plate>
      </div>

      {investigations.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <Plate className="flex flex-col items-center gap-2 px-6 py-5 text-sm text-muted-foreground">
            <FolderOpen className="h-8 w-8" />
            <p>{filtersActive ? "No scans match these filters." : emptyLabel}</p>
          </Plate>
        </div>
      ) : (
        <div className="grid gap-2 min-w-0">
          <Plate className="hidden md:flex items-center gap-4 px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <span className="w-10 shrink-0" />
            <span className="flex-1">Profile</span>
            <div className="grid grid-cols-[4.5rem_10.5rem_9rem_5.5rem] gap-3 shrink-0">
              <span>Ethos</span>
              <span>Links</span>
              <span>Scanned by</span>
              <span>Date</span>
            </div>
            <span className="w-7 shrink-0" />
          </Plate>
          {investigations.map((inv) => (
            <div
              key={inv.id}
              className={`group relative flex items-center gap-3 sm:gap-4 min-w-0 rounded-lg border border-border bg-card/60 backdrop-blur-sm px-3 sm:px-4 py-3 transition-colors ${
                currentInvestigationId === inv.id ? "border-primary bg-primary/10" : "hover:bg-card/80"
              }`}
            >
              {inv.targetAvatar ? (
                <AvatarImg src={inv.targetAvatar} name={inv.targetName} className="h-10 w-10 rounded-full shrink-0" />
              ) : (
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Wallet className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              {/* The whole row opens the scan (stretched link); delete sits above it. */}
              <Link
                href={investigationHref(inv)}
                className="flex-1 min-w-0 text-left after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
              >
                <div className="font-medium truncate">
                  {inv.targetName || `${inv.target.slice(0, 10)}...${inv.target.slice(-6)}`}
                </div>
                <div className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                  {inv.target}
                </div>
                {/* Phones hide the columns; keep the essentials on a second line. */}
                <div className="md:hidden mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {inv.score != null && (
                    <span className="inline-flex items-center gap-0.5 tabular-nums">
                      {inv.score}
                      <EthosScoreIcon size={9} className="ml-0.5" />
                    </span>
                  )}
                  <LinkCounts strong={inv.strongCount} possible={inv.possibleCount} />
                </div>
              </Link>
              {/* Fixed-width columns so values line up down the list. */}
              <div className="hidden md:grid md:grid-cols-[4.5rem_10.5rem_9rem_5.5rem] items-center gap-3 text-xs text-muted-foreground shrink-0">
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
                <LinkCounts strong={inv.strongCount} possible={inv.possibleCount} />
                <span className="flex items-center gap-1.5 min-w-0">
                  {inv.lastScannedBy ? (
                    <>
                      <AvatarImg src={inv.lastScannedBy.avatarUrl} className="h-4 w-4 rounded-full shrink-0" />
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
              {/* Fixed trailing slot so columns line up whether or not a row is
                  deletable. Always visible on touch screens; on desktop it
                  appears on hover or keyboard focus. */}
              <div className="shrink-0 h-7 w-7 flex items-center justify-center">
                {canDelete(inv) && (
                  <button
                    type="button"
                    onClick={() => {
                      setPendingDelete(inv);
                      setConfirmOpen(true);
                    }}
                    className="relative z-10 h-7 w-7 flex items-center justify-center rounded md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 hover:bg-muted transition-opacity cursor-pointer"
                    title="Delete scan"
                    aria-label={`Delete scan of ${nameOf(inv)}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
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

      {pendingDelete && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Delete this scan?"
          description={
            <>
              The saved result for <span className="font-medium text-foreground">{nameOf(pendingDelete)}</span>{" "}
              will be removed for everyone, along with its links in the network graph and any share link. This
              can&apos;t be undone.
            </>
          }
          confirmLabel="Delete scan"
          onConfirm={() => onDelete(pendingDelete.id)}
        />
      )}
    </div>
  );
}
