"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ScansList,
  ScansListSkeleton,
  listControlParams,
  DEFAULT_SORT,
  DEFAULT_SCORE_BAND,
  type InvestigationSummary,
  type ScanScope,
} from "@/components/scans/scans-list";
import { useScan } from "@/components/scan/scan-provider";
import { Button } from "@/components/ui/button";
import { Plate } from "@/components/ui/plate";

const PAGE_SIZE = 25;
const EMPTY_LABEL: Record<ScanScope, string> = {
  all: "No scans yet. Run one to get started.",
  yours: "You haven't run any scans yet.",
  verified: "No human-verified profiles scanned yet.",
};

/** ?scope=mine|verified; "yours" is accepted for old links. */
function scopeFromParam(v: string | null): ScanScope {
  if (v === "mine" || v === "yours") return "yours";
  if (v === "verified") return "verified";
  return "all";
}

/** Saved scans, one scope at a time, with server-side search, sort and filters. */
export function ScansView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const scan = useScan();
  const { data: session } = useSession();
  // @ts-expect-error - ethos field added in session callback
  const myProfileId = (session?.user?.ethos?.profileId as number | undefined) ?? null;
  // @ts-expect-error - isAdmin field added in session callback
  const isAdmin = Boolean(session?.user?.isAdmin);

  const scope = scopeFromParam(params.get("scope"));
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortValue, setSortValue] = useState(DEFAULT_SORT);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [scoreBand, setScoreBand] = useState(DEFAULT_SCORE_BAND);

  const [rows, setRows] = useState<InvestigationSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [counts, setCounts] = useState<Record<ScanScope, number>>({ all: 0, yours: 0, verified: 0 });
  const loadedCount = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPage = useCallback(
    async (sc: ScanScope, offset: number, limit: number) => {
      const q = listControlParams({ search: debouncedSearch, sortValue, flaggedOnly, scoreBand });
      q.set("limit", String(limit));
      q.set("offset", String(offset));
      if (sc === "yours") q.set("scope", "mine");
      const base = sc === "verified" ? "/api/investigations/verified" : "/api/investigations";
      const resp = await fetch(`${base}?${q}`);
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!data || !Array.isArray(data.rows)) return null;
      return { rows: data.rows as InvestigationSummary[], total: Number(data.total) || 0 };
    },
    [debouncedSearch, sortValue, flaggedOnly, scoreBand]
  );

  // First page of the active scope (or as many rows as were loaded, after
  // a delete or share). The active scope's count comes from that page; the
  // other two are refetched only when the filters or saved data change.
  const queryKey = `${scope}|${debouncedSearch}|${sortValue}|${flaggedOnly}|${scoreBand}`;
  const filtersKey = `${debouncedSearch}|${sortValue}|${flaggedOnly}|${scoreBand}|${scan.savedVersion}`;
  const currentQuery = useRef(queryKey);
  useEffect(() => {
    currentQuery.current = queryKey;
  }, [queryKey]);
  const lastQuery = useRef("");
  const lastCountsKey = useRef("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const sameQuery = queryKey === lastQuery.current;
    lastQuery.current = queryKey;
    const limit = sameQuery ? Math.min(200, Math.max(PAGE_SIZE, Math.ceil(loadedCount.current / PAGE_SIZE) * PAGE_SIZE)) : PAGE_SIZE;
    // Keep the current rows on screen while a new query loads, so the
    // search box (and its focus) stays mounted.
    fetchPage(scope, 0, limit)
      .then((page) => {
        if (cancelled) return;
        if (!page) throw new Error("load failed");
        setRows(page.rows);
        setTotal(page.total);
        setCounts((c) => ({ ...c, [scope]: page.total }));
        setLoadError(null);
        loadedCount.current = page.rows.length;
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load scans. Check your connection and try again.");
      });
    if (filtersKey !== lastCountsKey.current) {
      lastCountsKey.current = filtersKey;
      (["all", "yours", "verified"] as const)
        .filter((sc) => sc !== scope)
        .forEach((sc) => {
          fetchPage(sc, 0, 1).then((page) => {
            if (!cancelled && page) setCounts((c) => ({ ...c, [sc]: page.total }));
          });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [queryKey, filtersKey, scope, fetchPage, retry]);

  const loadMore = async () => {
    if (loadingMore || !rows) return;
    const startedFor = queryKey;
    setLoadingMore(true);
    const page = await fetchPage(scope, rows.length, PAGE_SIZE);
    setLoadingMore(false);
    // Drop a page that belongs to a query the user has since changed.
    if (!page || currentQuery.current !== startedFor) return;
    setRows((prev) => [...(prev ?? []), ...page.rows]);
    setTotal(page.total);
    loadedCount.current += page.rows.length;
  };

  const deleteScan = async (id: string) => {
    const resp = await fetch(`/api/investigations/${id}`, { method: "DELETE" });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error(data?.error || "Failed to delete scan");
    }
    toast.success("Scan deleted");
    scan.notifySavedChanged(id);
  };

  if (!rows && loadError) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Plate className="flex flex-col items-center gap-3 px-6 py-5 text-sm text-muted-foreground" role="alert">
          <p>{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </Button>
        </Plate>
      </div>
    );
  }

  if (!rows) return <ScansListSkeleton />;


  return (
    <ScansList
      investigations={rows}
      scope={scope}
      onScopeChange={(sc) => router.replace(sc === "all" ? pathname : `${pathname}?scope=${sc === "yours" ? "mine" : sc}`, { scroll: false })}
      counts={counts}
      emptyLabel={EMPTY_LABEL[scope]}
      search={search}
      onSearchChange={setSearch}
      sortValue={sortValue}
      onSortChange={setSortValue}
      flaggedOnly={flaggedOnly}
      onFlaggedChange={setFlaggedOnly}
      scoreBand={scoreBand}
      onScoreBandChange={setScoreBand}
      currentInvestigationId={scan.investigationId}
      canDelete={(inv) => isAdmin || inv.ownerProfileId === null || inv.ownerProfileId === myProfileId}
      onDelete={deleteScan}
      totalCount={total}
      onLoadMore={loadMore}
      loadingMore={loadingMore}
      loadMoreBatchSize={PAGE_SIZE}
    />
  );
}
