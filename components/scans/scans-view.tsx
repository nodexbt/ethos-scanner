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
const SCOPES: ScanScope[] = ["all", "yours", "verified"];

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
  const { savedVersion, notifySavedChanged, viewing } = useScan();
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
  const [counts, setCounts] = useState<Record<ScanScope, number>>({ all: 0, yours: 0, verified: 0 });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // Aborted whenever the query changes, so a late page can't land in a new list.
  const queryCtl = useRef<AbortController | null>(null);
  const loadedCount = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPage = useCallback(
    async (sc: ScanScope, offset: number, limit: number, signal?: AbortSignal) => {
      const q = listControlParams({ search: debouncedSearch, sortValue, flaggedOnly, scoreBand });
      q.set("limit", String(limit));
      q.set("offset", String(offset));
      if (sc === "yours") q.set("scope", "mine");
      const base = sc === "verified" ? "/api/investigations/verified" : "/api/investigations";
      const resp = await fetch(`${base}?${q}`, { signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return { rows: (data.rows ?? []) as InvestigationSummary[], total: Number(data.total) || 0 };
    },
    [debouncedSearch, sortValue, flaggedOnly, scoreBand]
  );

  // Counts for the scope chips: when filters or saved scans change, not on a scope switch.
  useEffect(() => {
    const ctl = new AbortController();
    SCOPES.forEach((sc) => {
      fetchPage(sc, 0, 1, ctl.signal)
        .then((page) => setCounts((c) => ({ ...c, [sc]: page.total })))
        .catch(() => {});
    });
    return () => ctl.abort();
  }, [fetchPage, savedVersion]);

  // Rows for the open scope. After a delete or a finished scan, reload as
  // many rows as were showing so the user keeps their place.
  const lastQuery = useRef("");
  useEffect(() => {
    const ctl = new AbortController();
    queryCtl.current = ctl;
    const query = `${scope}|${debouncedSearch}|${sortValue}|${flaggedOnly}|${scoreBand}`;
    const sameQuery = query === lastQuery.current;
    lastQuery.current = query;
    const limit = sameQuery ? Math.min(200, Math.max(PAGE_SIZE, Math.ceil(loadedCount.current / PAGE_SIZE) * PAGE_SIZE)) : PAGE_SIZE;
    // The current rows stay on screen while this loads, so the search box keeps focus.
    fetchPage(scope, 0, limit, ctl.signal)
      .then((page) => {
        setRows(page.rows);
        setCounts((c) => ({ ...c, [scope]: page.total }));
        setLoadError(null);
        loadedCount.current = page.rows.length;
      })
      .catch(() => {
        if (!ctl.signal.aborted) setLoadError("Couldn't load scans. Check your connection and try again.");
      });
    return () => ctl.abort();
  }, [scope, debouncedSearch, sortValue, flaggedOnly, scoreBand, fetchPage, savedVersion, retry]);

  const loadMore = async () => {
    const ctl = queryCtl.current;
    if (loadingMore || !rows || !ctl) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(scope, rows.length, PAGE_SIZE, ctl.signal);
      setRows((prev) => [...(prev ?? []), ...page.rows]);
      setCounts((c) => ({ ...c, [scope]: page.total }));
      loadedCount.current += page.rows.length;
    } catch {
      // Aborted by a query change, or failed: the button stays for another try.
    } finally {
      setLoadingMore(false);
    }
  };

  const deleteScan = async (id: string) => {
    const resp = await fetch(`/api/investigations/${id}`, { method: "DELETE" });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error(data?.error || "Failed to delete scan");
    }
    toast.success("Scan deleted");
    notifySavedChanged();
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
      search={search}
      onSearchChange={setSearch}
      sortValue={sortValue}
      onSortChange={setSortValue}
      flaggedOnly={flaggedOnly}
      onFlaggedChange={setFlaggedOnly}
      scoreBand={scoreBand}
      onScoreBandChange={setScoreBand}
      currentInvestigationId={viewing?.investigationId ?? null}
      canDelete={(inv) => isAdmin || inv.ownerProfileId === null || inv.ownerProfileId === myProfileId}
      onDelete={deleteScan}
      totalCount={counts[scope]}
      onLoadMore={loadMore}
      loadingMore={loadingMore}
      loadMoreBatchSize={PAGE_SIZE}
    />
  );
}
