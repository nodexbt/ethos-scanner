"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Loader2, AlertTriangle, Wallet, FolderOpen, History, Users, Activity, Network, ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { ClusterScanResult, LogEntry, ScanProgress } from "@/lib/cluster-scanner";
import type { ResolvedScanTarget } from "@/lib/scan-target";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { ShareDialog } from "@/components/results/share-dialog";
import { ResultView } from "@/components/results/result-view";
import { LinkCounts } from "@/components/scans/link-counts";
import { describeSignal, scoringSignals } from "@/lib/scan-utils";
import { AppFooter } from "@/components/app-footer";
import { ScanInput } from "@/components/scanner/scan-input";
import { ScanLog } from "@/components/scanner/scan-log";
import { AppHeader } from "@/components/app-header";
import { NetworkView } from "@/components/network/network-view";
import { useRouter } from "next/navigation";
import { ScansList, ScansListSkeleton, listControlParams, DEFAULT_SORT, DEFAULT_SCORE_BAND, type InvestigationSummary, type ScanScope } from "@/components/scans/scans-list";
import { SegmentedTab, SegmentedCount } from "@/components/ui/segmented";
import { AvatarImg } from "@/components/ui/avatar-img";

// --- Saved Investigations ---


type ActiveTab = "scanner" | "scans" | "network";

function investigationIdForResult(result: ClusterScanResult): string {
  return result.targetProfileId != null
    ? `scan-p${result.targetProfileId}`
    : `scan-${result.target.toLowerCase()}`;
}

/** Derive the active tab from a URL search string (?tab=...). Defaults to scanner. */
/** Derive (tab, scope) from the URL. Legacy ?tab=yours|all|verified map to
    the Scans tab with that scope so old links keep working. */
function tabFromSearch(search: string): { tab: ActiveTab; scope: ScanScope } {
  const q = new URLSearchParams(search);
  const t = q.get("tab");
  if (t === "yours" || t === "all" || t === "verified") return { tab: "scans", scope: t };
  const sc = q.get("scope");
  const scope: ScanScope = sc === "yours" || sc === "verified" ? sc : "all";
  return { tab: t === "scans" || t === "network" ? t : "scanner", scope };
}

export default function ScannerPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const [walletInput, setWalletInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clusterResult, setClusterResult] = useState<ClusterScanResult | null>(null);
  const [clusterLogs, setClusterLogs] = useState<LogEntry[]>([]);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);

  // Screenshot state: address -> data URL
  const [screenshots, setScreenshots] = useState<Map<string, string>>(new Map());
  // Twitter evidence from auto-search: address -> { tweets, rawCount, ... }.
  // Persisted with the investigation so saved scans retain their tweet evidence.
  // Shape mirrors TwitterSearchResult from /api/twitter/search.
  const [twitterEvidence, setTwitterEvidence] = useState<Record<string, unknown>>({});
  // Server-paginated scan lists (mirrors the verified tab): "all" is every
  // investigation, "yours" is owner-filtered server-side via scope=mine.
  const [allInvestigations, setAllInvestigations] = useState<InvestigationSummary[]>([]);
  const [allTotal, setAllTotal] = useState(0);
  const [allLoadingMore, setAllLoadingMore] = useState(false);
  const [yourInvestigations, setYourInvestigations] = useState<InvestigationSummary[]>([]);
  const [yourTotal, setYourTotal] = useState(0);
  const [yourLoadingMore, setYourLoadingMore] = useState(false);
  // Global signal sums for the scanner empty-state stat cards — computed
  // server-side so they cover every investigation, not just loaded pages.
  const [scanStats, setScanStats] = useState<{ strongSum: number; possibleSum: number } | null>(null);
  const [currentInvestigationId, setCurrentInvestigationId] = useState<string | null>(null);
  /** When the result on screen was produced; null while scanning. */
  const [resultScannedAt, setResultScannedAt] = useState<string | null>(null);
  /** Why the last scan wasn't saved (e.g. degraded over complete), if so. */
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  /** Bumped after each scan so the header refetches the daily quota. */
  const [quotaKey, setQuotaKey] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  /** null = follow the default: open until the user has scans of their own. */
  const [howItWorksChoice, setHowItWorksChoice] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("scanner");
  /** Which saved scans the Scans tab lists. Survives switching tabs. */
    const [scope, setScope] = useState<ScanScope>("all");
  const [verifiedInvestigations, setVerifiedInvestigations] = useState<InvestigationSummary[]>([]);
  const [verifiedTotal, setVerifiedTotal] = useState<number>(0);
  const [verifiedLoading, setVerifiedLoading] = useState(false);
  const [verifiedLoadingMore, setVerifiedLoadingMore] = useState(false);
  // True until the initial /api/investigations fetch settles, so the
  // yours/all tabs show a skeleton instead of a false "No scans yet".
  const [scansLoading, setScansLoading] = useState(true);
  const [investigationSearch, setInvestigationSearch] = useState("");
  // Server-side search/sort/filter controls, shared across the scan-list tabs.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortValue, setSortValue] = useState(DEFAULT_SORT);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [scoreBand, setScoreBand] = useState(DEFAULT_SCORE_BAND);


  useEffect(() => {
    Promise.all([
      loadScansPage("all", 0, true).then((page) => {
        if (page) {
          setAllInvestigations(page.rows);
          setAllTotal(page.total);
          if (page.stats) setScanStats(page.stats);
        }
      }),
      loadScansPage("mine", 0).then((page) => {
        if (page) {
          setYourInvestigations(page.rows);
          setYourTotal(page.total);
        }
      }),
    ]).finally(() => setScansLoading(false));

    // Warm the verified tab in the background, in parallel with yours/all, so
    // switching to it is instant instead of showing a first-open skeleton.
    // Fired outside the Promise.all above so it never gates the yours/all
    // loading state. The tab-open effect below then no-ops (rows already set).
    loadVerifiedPage(0).then((page) => {
      if (page) {
        setVerifiedInvestigations(page.rows);
        setVerifiedTotal(page.total);
      }
    });

    // Check if URL has a scan target to load — either /scan/0x<address>
    // or /scan/x/<handle>.
    const path = window.location.pathname;
    const addrMatch = path.match(/^\/scan\/(0x[a-fA-F0-9]{40})$/i);
    const handleMatch = path.match(/^\/scan\/x\/([A-Za-z0-9_]{1,15})$/);
    const urlTarget = addrMatch ? addrMatch[1].toLowerCase() : handleMatch ? `@${handleMatch[1]}` : null;
    if (urlTarget) {
      setWalletInput(urlTarget);
      setLoadingCached(true);
      resolveTarget(urlTarget)
        .then((resolved) => (resolved ? loadCachedScan(resolved) : null))
        .finally(() => setLoadingCached(false));
    }

    // Restore the active tab from the URL (?tab=scans|network).
    const initial = tabFromSearch(window.location.search);
    setActiveTab(initial.tab);
    setScope(initial.scope);
  }, []);

  // Signed-out visitors go to the sign-in page and come back to the exact
  // URL they opened (a /scan/x/<handle> deep link, a ?tab=... link).
  useEffect(() => {
    if (sessionStatus !== "unauthenticated") return;
    const here = window.location.pathname + window.location.search;
    router.replace(`/sign-in?callbackUrl=${encodeURIComponent(here)}`);
  }, [sessionStatus, router]);

  const [loadingCached, setLoadingCached] = useState(false);

  // Auto-persist Twitter evidence after Scan-all (or per-row ⚡) so users
  // don't lose paid tweet data by forgetting to hit Save. Debounced 2s so
  // a flurry of per-address updates during Scan-all collapses to a single
  // write. Skipped while a scan is running or before an investigation has
  // been created. Empty maps are sent through; the DB-layer merge protects
  // against wiping existing data.
  useEffect(() => {
    if (!currentInvestigationId || !clusterResult || scanning) return;
    if (Object.keys(twitterEvidence).length === 0) return;
    const t = setTimeout(() => {
      fetch("/api/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: currentInvestigationId, twitterEvidence }),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [twitterEvidence, currentInvestigationId, clusterResult, scanning]);

  const pushScanUrl = (target: ResolvedScanTarget) => {
    const url = target.ethos?.username
      ? `/scan/x/${target.ethos.username}`
      : `/scan/${target.primaryWallet.toLowerCase()}`;
    if (window.location.pathname !== url) {
      window.history.pushState({}, "", url);
    }
  };

  // Resolve free-form input (0x address, @handle, x.com / Ethos profile
  // URL) to the profile + wallet set server-side. Returns null (and sets
  // the error state) when nothing matches.
  const resolveTarget = async (input: string): Promise<ResolvedScanTarget | null> => {
    try {
      const resp = await fetch(`/api/resolve?q=${encodeURIComponent(input.trim())}`);
      if (resp.ok) return (await resp.json()) as ResolvedScanTarget;
      const data = await resp.json().catch(() => null);
      setError(data?.error || "Could not resolve that address or handle");
    } catch {
      setError("Could not resolve that address or handle");
    }
    return null;
  };

  // Switch tabs and reflect it in the URL so browser back/forward moves
  // between tabs. The scanner tab keeps any active /scan/:addr path; the
  // others live at /scanner?tab=....
  const selectTab = (tab: ActiveTab, nextScope: ScanScope = scope) => {
    setActiveTab(tab);
    setScope(nextScope);
    const scannerUrl = window.location.pathname.startsWith("/scan/")
      ? window.location.pathname
      : "/scanner";
    const url =
      tab === "scanner" ? scannerUrl
      : tab === "scans" ? `/scanner?tab=scans${nextScope === "all" ? "" : `&scope=${nextScope}`}`
      : "/scanner?tab=network";
    if (window.location.pathname + window.location.search !== url) {
      window.history.pushState({}, "", url);
    }
  };

  // A scan started earlier (other tab, or before a reload) keeps running
  // on the server; pick it up so the user sees it finish. Keyed on the
  // auth status, not the session object: next-auth hands out a new
  // session object on every window focus, which would re-run this and
  // clobber a scan this page is already watching.
  const watchingRef = useRef(false);
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/scan/jobs", { cache: "no-store" });
        if (!resp.ok) return;
        const { job } = await resp.json();
        if (!job || cancelled || watchingRef.current) return;
        setScanning(true);
        setWalletInput(job.targetInput ?? "");
        setClusterResult(null);
        setError(null);
        const done = await watchJob(job.id);
        if (cancelled) return;
        if (done) {
          setCurrentInvestigationId(done.investigationId);
          refreshInvestigations();
        }
        setScanning(false);
        setScanProgress(null);
        setQuotaKey((k) => k + 1);
      } catch {
        // No active job or not reachable — nothing to resume.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus]);

  // Keep the active tab in sync when the user navigates history (back/forward).
  useEffect(() => {
    const onPop = () => {
      const parsed = tabFromSearch(window.location.search);
      setActiveTab(parsed.tab);
      setScope(parsed.scope);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const loadCachedScan = async (target: ResolvedScanTarget) => {
    setLoadingCached(true);
    try {
      const resp = await fetch(`/api/investigations/${target.investigationId}`);
      if (resp.ok) {
        const data = await resp.json();
        setClusterResult(data.clusterResult);
        setCurrentInvestigationId(target.investigationId);
        setResultScannedAt(data.updatedAt ?? null);
        setSaveNotice(null);
        setScreenshots(new Map(Object.entries(data.screenshots || {})));
        setTwitterEvidence(
          (data.twitterEvidence as Record<string, unknown> | null) ?? {}
        );
        setClusterLogs([]);
        setError(null);
        setLoadingCached(false);
        pushScanUrl(target);
        return true;
      }
    } catch {}
    setLoadingCached(false);
    return false;
  };

  /** Sets come over the wire as arrays. */
  const hydrateResult = (raw: unknown): ClusterScanResult => {
    const { scanDurationMs: _dur, ...rest } = raw as ClusterScanResult & { scanDurationMs?: number };
    void _dur;
    const result = rest as ClusterScanResult;
    for (const c of [...result.strongCluster, ...result.possibleCluster]) {
      c.signalTypes = new Set(c.signalTypes as unknown as string[]);
    }
    return result;
  };

  /** Turn the server's save outcome into the on-screen notice. */
  const applySaved = (saved: { ok: boolean; code?: string } | null) => {
    setResultScannedAt(new Date().toISOString());
    if (!saved || saved.ok) setSaveNotice(null);
    else if (saved.code === "DEGRADED_NOT_SAVED")
      setSaveNotice("Not saved: this incomplete scan would have replaced a complete one. The previous result is kept; re-scan once the outage clears.");
    else setSaveNotice("Not saved: the server could not store the result. Results are shown for this session only.");
  };

  /**
   * Poll a background scan job until it finishes. Logs and progress are
   * mirrored into the same state the streaming path uses, so the UI is
   * identical. Resolves with the result (or null on failure).
   */
  const watchJob = async (jobId: string): Promise<{ result: ClusterScanResult; investigationId: string } | null> => {
    const POLL_MS = 1500;
    const MAX_CONSECUTIVE_FAILURES = 5;
    let failures = 0;
    watchingRef.current = true;
    try {
    for (;;) {
      let resp: Response | null = null;
      try {
        resp = await fetch(`/api/scan/jobs/${jobId}`, { cache: "no-store" });
      } catch {
        resp = null;
      }
      if (!resp || !resp.ok) {
        // A blip (deploy, network) shouldn't abandon a scan that is still
        // running on the server; give up only after several in a row.
        failures++;
        if (resp?.status === 404 || failures >= MAX_CONSECUTIVE_FAILURES) {
          setError(resp?.status === 404 ? "The scan job could not be found. Reload to check its status." : "Lost contact with the running scan. Reload to check its status.");
          return null;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      failures = 0;
      const job = await resp.json();
      setClusterLogs(job.logs ?? []);
      if (job.progress) setScanProgress(job.progress);
      if (job.status === "done") {
        const result = hydrateResult(job.result);
        setClusterResult(result);
        applySaved(job.saved);
        return { result, investigationId: job.investigationId as string };
      }
      if (job.status === "failed") {
        setError(job.error || "Scan failed");
        return null;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    } finally {
      watchingRef.current = false;
    }
  };

  const runFreshScan = async (target: ResolvedScanTarget) => {
    setScanning(true);
    setClusterResult(null);
    setResultScannedAt(null);
    setSaveNotice(null);
    setClusterLogs([]);
    setScanProgress(null);
    setError(null);
    setScreenshots(new Map());
    setCurrentInvestigationId(null);

    // Preserve any existing Twitter evidence for this target across rescans
    // so we don't burn API credits re-fetching tweets we already have. Falls
    // back to empty when this is a brand-new target.
    try {
      const resp = await fetch(`/api/investigations/${target.investigationId}`);
      if (resp.ok) {
        const data = await resp.json();
        setTwitterEvidence(
          (data.twitterEvidence as Record<string, unknown> | null) ?? {}
        );
      } else {
        setTwitterEvidence({});
      }
    } catch {
      setTwitterEvidence({});
    }

    let scanResult: ClusterScanResult | null = null;

    try {
      const resp = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Scan-Mode": "job" },
        // The server re-resolves the target itself; the primary wallet is
        // enough to identify the profile.
        body: JSON.stringify({ target: target.primaryWallet }),
      });

      if (!resp.ok && resp.status !== 202) {
        const data = await resp.json();
        setError(data.error || "Scan failed");
        return;
      }

      if (resp.status === 202) {
        // Background job: poll until it completes.
        const { jobId } = (await resp.json().catch(() => ({}))) as { jobId?: string };
        if (!jobId) {
          setError("The server accepted the scan but returned no job id.");
          return;
        }
        const done = await watchJob(jobId);
        scanResult = done?.result ?? null;
      } else {
        // Streaming fallback (before the scan_jobs migration is applied).
        const reader = resp.body?.getReader();
        if (!reader) {
          setError("Streaming not supported");
          return;
        }
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "log") setClusterLogs((prev) => [...prev, msg.data]);
              else if (msg.type === "progress") setScanProgress(msg.data);
              else if (msg.type === "result") {
                const result = hydrateResult(msg.data);
                setClusterResult(result);
                scanResult = result;
              } else if (msg.type === "saved") applySaved(msg.data);
              else if (msg.type === "error") setError(msg.data);
            } catch {
              // Skip malformed lines
            }
          }
        }
      }

      if (scanResult) {
        setCurrentInvestigationId(target.investigationId);
        pushScanUrl(target);
        refreshInvestigations();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cluster scan failed");
    } finally {
      setScanning(false);
      setScanProgress(null);
      setQuotaKey((k) => k + 1);
    }
  };

  const startScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = walletInput.trim();
    if (!input) {
      setError("Enter an EVM address (0x...) or an X handle (@name)");
      return;
    }

    await scanTargetInput(input);
  };

  /** Resolve free-form input and load the cached scan or run a fresh one. */
  const scanTargetInput = async (input: string) => {
    setWalletInput(input);
    const resolved = await resolveTarget(input);
    if (!resolved) return;

    // Check if we have a cached scan
    const cached = await loadCachedScan(resolved);
    if (cached) return;

    await runFreshScan(resolved);
  };

  /** Re-resolve free-form input (or an address) and run a fresh scan. */
  const rescanTarget = async (input: string) => {
    const resolved = await resolveTarget(input);
    if (resolved) await runFreshScan(resolved);
  };

  // Server-paginated fetch for the yours/all tabs — same { rows, total }
  // shape and load-more pattern as the verified tab below. scope=mine
  // filters to the caller's scans server-side; withStats piggybacks the
  // global signal sums for the scanner empty-state cards.
  const SCANS_PAGE_SIZE = 25;
  // Current control state as query params. Read fresh on each call so loaders
  // always reflect the active search/sort/filter.
  const controlParams = () =>
    listControlParams({ search: debouncedSearch, sortValue, flaggedOnly, scoreBand });
  const loadScansPage = async (
    scope: "all" | "mine",
    offset: number,
    withStats = false,
    limit: number = SCANS_PAGE_SIZE
  ) => {
    const params = controlParams();
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    if (scope === "mine") params.set("scope", "mine");
    if (withStats) params.set("stats", "1");
    const resp = await fetch(`/api/investigations?${params}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || !Array.isArray(data.rows)) return null;
    return {
      rows: data.rows as InvestigationSummary[],
      total: Number(data.total) || 0,
      stats: data.stats as { strongSum: number; possibleSum: number } | undefined,
    };
  };
  const loadMoreAll = async () => {
    if (allLoadingMore) return;
    setAllLoadingMore(true);
    const page = await loadScansPage("all", allInvestigations.length);
    if (page) {
      setAllInvestigations((prev) => [...prev, ...page.rows]);
      setAllTotal(page.total);
    }
    setAllLoadingMore(false);
  };
  const loadMoreYours = async () => {
    if (yourLoadingMore) return;
    setYourLoadingMore(true);
    const page = await loadScansPage("mine", yourInvestigations.length);
    if (page) {
      setYourInvestigations((prev) => [...prev, ...page.rows]);
      setYourTotal(page.total);
    }
    setYourLoadingMore(false);
  };

  // Refresh after save/delete/share: re-fetch as many rows as are currently
  // loaded (rounded up to a page, capped at the API's 200 max) so the user
  // doesn't lose their load-more position, plus fresh totals and stats.
  const refreshInvestigations = () => {
    const reload = (loaded: number) =>
      Math.min(200, Math.max(SCANS_PAGE_SIZE, Math.ceil(loaded / SCANS_PAGE_SIZE) * SCANS_PAGE_SIZE));
    loadScansPage("all", 0, true, reload(allInvestigations.length)).then((page) => {
      if (page) {
        setAllInvestigations(page.rows);
        setAllTotal(page.total);
        if (page.stats) setScanStats(page.stats);
      }
    });
    loadScansPage("mine", 0, false, reload(yourInvestigations.length)).then((page) => {
      if (page) {
        setYourInvestigations(page.rows);
        setYourTotal(page.total);
      }
    });
  };

  // Server-paginated fetch for the verified-scans tab. Initial load grabs
  // the first batch; Load-more appends another batch from the API. Cached
  // across tab switches so re-opening the tab is instant.
  const VERIFIED_PAGE_SIZE = 25;
  const loadVerifiedPage = async (offset: number) => {
    const params = controlParams();
    params.set("limit", String(VERIFIED_PAGE_SIZE));
    params.set("offset", String(offset));
    const resp = await fetch(`/api/investigations/verified?${params}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || !Array.isArray(data.rows)) return null;
    return { rows: data.rows as InvestigationSummary[], total: Number(data.total) || 0 };
  };
  const loadMoreVerified = async () => {
    if (verifiedLoadingMore) return;
    setVerifiedLoadingMore(true);
    const page = await loadVerifiedPage(verifiedInvestigations.length);
    if (page) {
      setVerifiedInvestigations((prev) => [...prev, ...page.rows]);
      setVerifiedTotal(page.total);
    }
    setVerifiedLoadingMore(false);
  };
  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(investigationSearch), 300);
    return () => clearTimeout(t);
  }, [investigationSearch]);

  // Refetch the active list tab's first page whenever the tab or any
  // search/sort/filter control changes. The initial mount load is handled by
  // the mount effect above, so skip the first run here to avoid a double fetch.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (activeTab !== "scans") return;
    if (scope === "all") {
      loadScansPage("all", 0, true).then((page) => {
        if (page) {
          setAllInvestigations(page.rows);
          setAllTotal(page.total);
          if (page.stats) setScanStats(page.stats);
        }
      });
    } else if (scope === "yours") {
      loadScansPage("mine", 0).then((page) => {
        if (page) {
          setYourInvestigations(page.rows);
          setYourTotal(page.total);
        }
      });
    } else {
      setVerifiedLoading(true);
      loadVerifiedPage(0)
        .then((page) => {
          if (page) {
            setVerifiedInvestigations(page.rows);
            setVerifiedTotal(page.total);
          }
        })
        .finally(() => setVerifiedLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, scope, debouncedSearch, sortValue, flaggedOnly, scoreBand]);

  const handleLoadInvestigation = async (inv: InvestigationSummary) => {
    const resp = await fetch(`/api/investigations/${inv.id}`);
    if (!resp.ok) return;
    const data = await resp.json();
    setClusterResult(data.clusterResult);
    setScreenshots(new Map(Object.entries(data.screenshots || {})));
    setTwitterEvidence(
      (data.twitterEvidence as Record<string, unknown> | null) ?? {}
    );
    setCurrentInvestigationId(inv.id);
    setResultScannedAt(data.updatedAt ?? null);
    setSaveNotice(null);
    setClusterLogs([]);
    setScanProgress(null);
    setWalletInput(inv.target);
    setError(null);
  };

  // Throws on failure so the confirmation dialog can show the error.
  const handleDeleteInvestigation = async (id: string) => {
    const resp = await fetch(`/api/investigations/${id}`, { method: "DELETE" });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error(data?.error || "Failed to delete scan");
    }
    refreshInvestigations();
    if (currentInvestigationId === id) setCurrentInvestigationId(null);
  };

  const exportInvestigation = () => {
    if (!clusterResult) return;

    const allCandidates = [...clusterResult.strongCluster, ...clusterResult.possibleCluster];

    // Build the prompt text
    let prompt = `Draft a slash report for the following subject based on the evidence provided.\n\n`;

    prompt += `## Subject\n`;
    prompt += `- Wallet: ${clusterResult.target}\n`;
    if (clusterResult.targetEthos) {
      prompt += `- Ethos Profile: ${clusterResult.targetEthos.displayName}`;
      if (clusterResult.targetEthos.username) prompt += ` (@${clusterResult.targetEthos.username})`;
      prompt += `\n- Ethos Profile URL: ${clusterResult.targetEthos.profileUrl}`;
      prompt += `\n- Credibility Score: ${clusterResult.targetEthos.score}\n`;
    }
    prompt += `\n`;

    prompt += `## On-Chain Evidence\n`;
    prompt += `- Networks scanned: ${Object.keys(clusterResult.networkStats).join(", ")}\n`;
    prompt += `- Total transactions analyzed: ${Object.values(clusterResult.networkStats).reduce((s, n) => s + n.txCount, 0)}\n`;
    prompt += `- Strong links: ${clusterResult.strongCluster.length}\n`;
    prompt += `- Possible links: ${clusterResult.possibleCluster.length}\n\n`;

    if (allCandidates.length > 0) {
      prompt += `### Linked Profiles\n`;
      for (const c of allCandidates) {
        const name = c.ethosProfile
          ? `${c.ethosProfile.displayName}${c.ethosProfile.username ? ` (@${c.ethosProfile.username})` : ""}`
          : c.address;
        prompt += `\n${name}\n`;
        prompt += `- Address: ${c.address}\n`;
        prompt += `- Link: ${c.confidence === "high" ? "strong" : "possible"} (link strength ${c.score})\n`;
        if (c.ethosProfile) {
          prompt += `- Ethos Profile URL: ${c.ethosProfile.profileUrl}\n`;
          prompt += `- Credibility Score: ${c.ethosProfile.score}\n`;
        }
        prompt += `- Active on: ${c.networks.join(", ")}\n`;
        const scored = scoringSignals(c);
        if (scored.length > 0) prompt += `- Why linked: ${scored.map((s) => `${describeSignal(s, c, clusterResult).title} (+${s.score})`).join("; ")}\n`;
        if (c.directCount > 0) {
          // Counts are from the subject's side: outgoing = the subject sent.
          prompt += `- Direct transfers with subject (context, not scored): ${c.directCount} (subject sent ${c.outgoingCount}, received ${c.incomingCount})`;
          prompt += `\n`;
        }
        if (c.sharedFundingSources.length > 0) prompt += `- Shared incoming senders (not first funders): ${c.sharedFundingSources.length}\n`;
        if (screenshots.has(c.address)) prompt += `- X/Twitter search screenshot attached (see image)\n`;
      }
    }

    const screenshotCount = screenshots.size;
    if (screenshotCount > 0) {
      prompt += `\n## Social Evidence\n`;
      prompt += `${screenshotCount} X/Twitter search screenshot(s) are attached alongside this prompt.\n`;
      prompt += `Examine whether multiple distinct X accounts have posted the same wallet address, which indicates coordinated behavior.\n`;
    }

    // Save prompt as text file
    const targetName = clusterResult.targetEthos?.username || clusterResult.target.slice(0, 10);
    const timestamp = new Date().toISOString().slice(0, 10);

    const promptBlob = new Blob([prompt], { type: "text/plain" });
    const promptUrl = URL.createObjectURL(promptBlob);
    const promptLink = document.createElement("a");
    promptLink.href = promptUrl;
    promptLink.download = `slash-evidence-${targetName}-${timestamp}.txt`;
    promptLink.click();
    URL.revokeObjectURL(promptUrl);

    // Save each screenshot as a separate file
    let imgIndex = 0;
    for (const [address, dataUrl] of screenshots) {
      imgIndex++;
      const candidateName = allCandidates.find((c) => c.address === address)?.ethosProfile?.username
        || address.slice(0, 10);

      // Convert data URL to blob
      const byteString = atob(dataUrl.split(",")[1]);
      const mimeType = dataUrl.split(",")[0].split(":")[1].split(";")[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const imgBlob = new Blob([ab], { type: mimeType });
      const ext = mimeType.split("/")[1] || "png";

      const imgUrl = URL.createObjectURL(imgBlob);
      const imgLink = document.createElement("a");
      imgLink.href = imgUrl;
      imgLink.download = `screenshot-${imgIndex}-${candidateName}.${ext}`;

      // Small delay between downloads so browser doesn't block them
      setTimeout(() => {
        imgLink.click();
        URL.revokeObjectURL(imgUrl);
      }, imgIndex * 200);
    }
  };


  // Collect all first funder addresses across all candidates to detect shared funders

  // Resolve a wallet address to a display name (check target, candidates, then funder profiles)

  // Render a wallet address with its Ethos profile name if available

  const hasResults = clusterResult !== null && !scanning;
  const howItWorksOpen = howItWorksChoice ?? (!scansLoading && yourTotal === 0);
  const setHowItWorksOpen = (open: boolean) => setHowItWorksChoice(open);
  const scanActive = scanning || hasResults || loadingCached;

  // @ts-expect-error - ethos field added in session callback
  const currentProfileId = (session?.user?.ethos?.profileId as number | undefined) ?? null;
  // @ts-expect-error - isAdmin field added in session callback
  const isAdmin = Boolean(session?.user?.isAdmin);
  const canDelete = (inv: InvestigationSummary) =>
    isAdmin || inv.ownerProfileId === null || inv.ownerProfileId === currentProfileId;

  // Loading, or signed out and about to be redirected to /sign-in.
  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <AppHeader
        quotaKey={quotaKey}
        nav={
        <div className="h-10 inline-flex items-center gap-1 bg-card/70 backdrop-blur-sm border border-border rounded-lg p-1">
          <SegmentedTab icon={Search} active={activeTab === "scanner"} onClick={() => selectTab("scanner")}>
            Scanner
          </SegmentedTab>
          <SegmentedTab icon={FolderOpen} active={activeTab === "scans"} onClick={() => selectTab("scans")}>
            Scans
            <SegmentedCount value={allTotal} />
          </SegmentedTab>
          <SegmentedTab icon={Network} active={activeTab === "network"} onClick={() => selectTab("network")}>
            Network
          </SegmentedTab>
        </div>
        }
        onLogoClick={() => {
          setActiveTab("scanner");
          setClusterResult(null);
          setClusterLogs([]);
          setScanProgress(null);
          setWalletInput("");
          setError(null);
          setCurrentInvestigationId(null);
          setScreenshots(new Map());
        setTwitterEvidence({});
          window.history.pushState({}, "", "/scanner");
        }}
      />

      {/* Scanner Tab */}
      {activeTab === "scanner" && (
      <div className="flex flex-col gap-4">
        {/* Input first, then the scan log, then results or the empty state. */}
        <div className="space-y-4">
          <ScanInput
            walletInput={walletInput}
            setWalletInput={setWalletInput}
            scanning={scanning}
            error={error}
            onSubmit={startScan}
            compact={scanActive}
          />

          {/* Expanded while running; collapses to its header row the moment
              the scan completes so results sit directly under the input.
              The key remount re-applies the default on each transition. */}
          <ScanLog
            key={scanning ? "live" : "done"}
            logs={clusterLogs}
            scanning={scanning}
            progress={scanProgress}
            defaultExpanded={scanning}
          />
        </div>

        {/* Results, or the empty state */}
        <div className="space-y-4">
          {/* Queued: the job is accepted but hasn't reported yet */}
          {scanning && clusterLogs.length === 0 && (
            <Card>
              <CardContent className="p-4 flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Scan queued — waiting for the first update from the server…
              </CardContent>
            </Card>
          )}

          {/* Errors that end a scan, shown where the results would be */}
          {!scanning && !hasResults && error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-500 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Loading skeleton */}
          {loadingCached && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              <Card>
                <CardHeader className="pb-3">
                  <div className="h-5 w-48 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-72 bg-muted rounded animate-pulse mt-2" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="rounded-lg border border-border bg-muted/30 p-2 text-center space-y-1">
                        <div className="h-6 w-8 bg-muted rounded animate-pulse mx-auto" />
                        <div className="h-2 w-12 bg-muted rounded animate-pulse mx-auto" />
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-border p-3 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted animate-pulse shrink-0" />
                    <div className="space-y-1.5">
                      <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-48 bg-muted rounded animate-pulse" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <div className="h-5 w-40 bg-muted rounded animate-pulse" />
                </CardHeader>
                <CardContent className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="rounded-lg border border-border p-3 space-y-2.5">
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-full bg-muted animate-pulse shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-4 w-36 bg-muted rounded animate-pulse" />
                          <div className="h-3 w-52 bg-muted rounded animate-pulse" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="h-3 w-full bg-muted rounded animate-pulse" />
                        <div className="h-3 w-3/4 bg-muted rounded animate-pulse" />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {hasResults && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
              <ResultView
                result={clusterResult}
                scannedAt={resultScannedAt}
                scanning={scanning}
                isAdmin={isAdmin}
                saveNotice={saveNotice}
                investigationId={currentInvestigationId}
                actions={{
                  onRescan: () => rescanTarget(clusterResult.target),
                  onShare: () => setShareOpen(true),
                  onExport: exportInvestigation,
                }}
                onScanProfile={scanTargetInput}
              />
            </motion.div>
          )}

          {/* Empty state */}
          {!scanning && !hasResults && !loadingCached && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: Activity, label: "Profiles scanned", value: allTotal, iconClass: "" },
                  { icon: AlertTriangle, label: "Strong links", value: scanStats?.strongSum ?? allInvestigations.reduce((sum, inv) => sum + inv.strongCount, 0), iconClass: "text-red-600 dark:text-red-500" },
                  { icon: Users, label: "Possible links", value: scanStats?.possibleSum ?? allInvestigations.reduce((sum, inv) => sum + inv.possibleCount, 0), iconClass: "text-amber-600 dark:text-amber-500" },
                ].map((stat) => (
                  <Card key={stat.label}>
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <stat.icon className={`h-3.5 w-3.5 shrink-0 ${stat.iconClass}`} />
                        {stat.label}
                      </div>
                      <div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums">{stat.value.toLocaleString()}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                {allInvestigations.length > 0 ? (
                  <Card>
                    <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-base flex items-center gap-2">
                        <History className="h-4 w-4" />
                        Recent scans
                      </CardTitle>
                      <button
                        onClick={() => selectTab("scans", "all")}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        View all
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {allInvestigations.slice(0, 5).map((inv) => (
                        <button
                          key={inv.id}
                          onClick={() => handleLoadInvestigation(inv)}
                          className="w-full flex items-center gap-3 rounded-lg border border-border bg-card/40 hover:bg-card/80 px-3 py-2.5 transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {inv.targetAvatar ? (
                            <AvatarImg src={inv.targetAvatar} name={inv.targetName} className="h-8 w-8 rounded-full shrink-0" />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                              <Wallet className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {inv.targetName || `${inv.target.slice(0, 10)}...${inv.target.slice(-6)}`}
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono truncate">{inv.target}</div>
                          </div>
                          <LinkCounts strong={inv.strongCount} possible={inv.possibleCount} className="shrink-0" />
                          {inv.lastScannedBy && (
                            <AvatarImg
                              src={inv.lastScannedBy.avatarUrl}
                              title={`Scanned by ${inv.lastScannedBy.displayName}`}
                              className="hidden sm:inline-flex h-4 w-4 rounded-full shrink-0"
                            />
                          )}
                        </button>
                      ))}
                    </CardContent>
                  </Card>
                ) : (
                  <div />
                )}

                {/* Open for new users; collapsed once you have scans of your own. */}
                <Card>
                  <CardHeader className={howItWorksOpen ? "pb-3" : undefined}>
                    <button
                      type="button"
                      onClick={() => setHowItWorksOpen(!howItWorksOpen)}
                      aria-expanded={howItWorksOpen}
                      className="flex w-full items-center gap-2 text-base font-semibold leading-none tracking-tight cursor-pointer hover:text-foreground/80 transition-colors"
                    >
                      {howItWorksOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      How it works
                    </button>
                  </CardHeader>
                  {howItWorksOpen && (
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                      {[
                        ["Multi-chain transaction scan", "Pulls transfer history across Ethereum, Base, Arbitrum, Optimism and Polygon for every wallet attested to the profile."],
                        ["Signal correlation", "Direct transfers find possible links; first funders, shared funding sources and exchange deposits score them."],
                        ["Link strength", "Strong when first funded by the profile or a linked wallet, or 15+ points across two signal types. Possible from 8 points."],
                      ].map(([title, body], n) => (
                        <div key={title} className="flex gap-3">
                          <div className="shrink-0 h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground">{n + 1}</div>
                          <div>
                            <div className="font-medium text-foreground">{title}</div>
                            <div className="text-xs">{body}</div>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  )}
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Scans tab: one list, fed by whichever scope is selected */}
      {activeTab === "scans" && (() => {
        const byScope = {
          all: { rows: allInvestigations, total: allTotal, loadMore: loadMoreAll, loadingMore: allLoadingMore, pageSize: SCANS_PAGE_SIZE, loading: scansLoading, emptyLabel: "No scans yet. Run one to get started." },
          yours: { rows: yourInvestigations, total: yourTotal, loadMore: loadMoreYours, loadingMore: yourLoadingMore, pageSize: SCANS_PAGE_SIZE, loading: scansLoading, emptyLabel: "You haven't run any scans yet." },
          verified: { rows: verifiedInvestigations, total: verifiedTotal, loadMore: loadMoreVerified, loadingMore: verifiedLoadingMore, pageSize: VERIFIED_PAGE_SIZE, loading: verifiedLoading, emptyLabel: "No human-verified profiles scanned yet." },
        }[scope];
        return byScope.loading && byScope.rows.length === 0 ? (
          <ScansListSkeleton />
        ) : (
          <ScansList
            investigations={byScope.rows}
            scope={scope}
            onScopeChange={(sc) => selectTab("scans", sc)}
            counts={{ all: allTotal, yours: yourTotal, verified: verifiedTotal }}
            emptyLabel={byScope.emptyLabel}
            search={investigationSearch}
            onSearchChange={setInvestigationSearch}
            sortValue={sortValue}
            onSortChange={setSortValue}
            flaggedOnly={flaggedOnly}
            onFlaggedChange={setFlaggedOnly}
            scoreBand={scoreBand}
            onScoreBandChange={setScoreBand}
            currentInvestigationId={currentInvestigationId}
            canDelete={canDelete}
            onLoad={(inv) => {
              handleLoadInvestigation(inv);
              selectTab("scanner");
            }}
            onDelete={handleDeleteInvestigation}
            totalCount={byScope.total}
            onLoadMore={byScope.loadMore}
            loadingMore={byScope.loadingMore}
            loadMoreBatchSize={byScope.pageSize}
          />
        );
      })()}

      {clusterResult && (
        <ShareDialog
          investigationId={currentInvestigationId || investigationIdForResult(clusterResult)}
          open={shareOpen}
          onOpenChange={setShareOpen}
          onChanged={refreshInvestigations}
        />
      )}

      {activeTab === "network" && <NetworkView />}

      <AppFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScansList: shared renderer for the "Your Scans" and "All Scans" tabs
// ---------------------------------------------------------------------------

/** Placeholder mirroring ScansList's layout (search bar + rows with avatar,
 * name/address lines, and meta column) shown while the first page loads, so
 * the tab doesn't flash its empty state during the initial fetch. */
