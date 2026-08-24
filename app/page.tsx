"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Loader2,
  AlertTriangle,
  Shield,
  Wallet,
  ExternalLink,
  ImagePlus,
  X,
  ClipboardPaste,
  FileText,
  Save,
  FolderOpen,
  Trash2,
  ChevronDown,
  ChevronRight,
  Copy,
  Share2,
  History,
  Users,
  Activity,
  Network,
  ArrowRight,
  LogOut,
  ShieldCheck,
  LineChart,
} from "lucide-react";
import Link from "next/link";
import {
  type ClusterScanResult,
  type ClusterCandidate,
  type LogEntry,
  type ScanProgress,
} from "@/lib/cluster-scanner";
import type { ResolvedScanTarget } from "@/lib/scan-target";
import { getAddressLabel } from "@/lib/known-addresses";
import { safeExternalUrl } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import DecryptedText from "@/components/ui/decrypted-text";
import { CandidateCard } from "@/components/results/candidate-card";
import { CandidateModal } from "@/components/results/candidate-modal";
import { ConnectionsCard } from "@/components/results/connections-card";
import { OverviewCard } from "@/components/results/overview-card";
import { ScanInput } from "@/components/scanner/scan-input";
import { ScanLog } from "@/components/scanner/scan-log";
import { EvidenceCard } from "@/components/evidence/evidence-card";
import { ResearchDisclaimer } from "@/components/results/research-disclaimer";
import { AppHeader } from "@/components/app-header";
import { LandingPage } from "@/components/landing/landing-page";
import { EthosScoreIcon } from "@/components/ui/ethos-score-icon";

// --- Saved Investigations ---

interface InvestigationSummary {
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

type ActiveTab = "scanner" | "yours" | "all" | "verified";

// Sort options for the scan-list tabs. "" = the tab's natural default (recent
// for yours/all, most-flagged for verified) — sent as no sort param.
const SORT_OPTIONS: { value: string; label: string; sort?: string; dir?: string }[] = [
  { value: "", label: "Default sort" },
  { value: "recent-desc", label: "Newest first", sort: "recent", dir: "desc" },
  { value: "recent-asc", label: "Oldest first", sort: "recent", dir: "asc" },
  { value: "strong-desc", label: "Most strong", sort: "strong", dir: "desc" },
  { value: "possible-desc", label: "Most possible", sort: "possible", dir: "desc" },
  { value: "score-desc", label: "Highest score", sort: "score", dir: "desc" },
  { value: "score-asc", label: "Lowest score", sort: "score", dir: "asc" },
];

const SCORE_BANDS: { value: string; label: string; min?: number }[] = [
  { value: "", label: "Any score" },
  { value: "1400", label: "Score > 1400", min: 1400 },
  { value: "1600", label: "Score > 1600", min: 1600 },
  { value: "1800", label: "Score > 1800", min: 1800 },
  { value: "2000", label: "Score > 2000", min: 2000 },
];

/** Build the shared search/sort/filter query params from control state. */
function listControlParams(c: {
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
function investigationIdForResult(result: ClusterScanResult): string {
  return result.targetProfileId != null
    ? `scan-p${result.targetProfileId}`
    : `scan-${result.target.toLowerCase()}`;
}

/** Derive the active tab from a URL search string (?tab=...). Defaults to scanner. */
function tabFromSearch(search: string): ActiveTab {
  const t = new URLSearchParams(search).get("tab");
  return t === "yours" || t === "all" || t === "verified" ? t : "scanner";
}

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();
  const [walletInput, setWalletInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clusterResult, setClusterResult] = useState<ClusterScanResult | null>(null);
  const [clusterLogs, setClusterLogs] = useState<LogEntry[]>([]);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

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
  const [selectedCandidate, setSelectedCandidate] = useState<ClusterCandidate | null>(null);
  const [showFirstFunders, setShowFirstFunders] = useState(false);
  const [showPossible, setShowPossible] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("scanner");
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
  const [sortValue, setSortValue] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [scoreBand, setScoreBand] = useState("");
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const [twitterAuthError, setTwitterAuthError] = useState<string | null>(null);

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

    // Restore the active tab from the URL (?tab=yours|all|verified).
    setActiveTab(tabFromSearch(window.location.search));

    // Check for auth error in query string
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err === "NotEligible") {
      setTwitterAuthError(
        "Access requires an Ethos validator NFT, or a human-verified profile with a score of 1800 or higher."
      );
    } else if (err === "NotAllowlisted") {
      // Legacy error code — kept so old links still show a sensible message.
      setTwitterAuthError("Your Ethos profile is not on the allowlist.");
    } else if (err === "NoEthosProfile") {
      setTwitterAuthError("No Ethos profile found for your X account.");
    } else if (err === "NoUsername") {
      setTwitterAuthError("Could not read X username.");
    }
    if (err) {
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const [logExpanded, setLogExpanded] = useState(true);
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
        body: JSON.stringify({
          id: currentInvestigationId,
          target: clusterResult.target,
          targetName: clusterResult.targetEthos?.displayName ?? null,
          clusterResult,
          twitterEvidence,
        }),
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
  // others live at /?tab=... on the root.
  const selectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    const scannerUrl = window.location.pathname.startsWith("/scan/")
      ? window.location.pathname
      : "/";
    const url = tab === "scanner" ? scannerUrl : `/?tab=${tab}`;
    if (window.location.pathname + window.location.search !== url) {
      window.history.pushState({}, "", url);
    }
  };

  // Keep the active tab in sync when the user navigates history (back/forward).
  useEffect(() => {
    const onPop = () => setActiveTab(tabFromSearch(window.location.search));
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

  const runFreshScan = async (target: ResolvedScanTarget) => {
    setScanning(true);
    setClusterResult(null);
    setClusterLogs([]);
    setScanProgress(null);
    setError(null);
    setScreenshots(new Map());
    setCurrentInvestigationId(null);
    setLogExpanded(true);

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
    let scanDurationMs: number | null = null;

    try {
      const resp = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The server re-resolves the target itself; the primary wallet is
        // enough to identify the profile.
        body: JSON.stringify({ target: target.primaryWallet }),
      });

      if (!resp.ok) {
        const data = await resp.json();
        setError(data.error || "Scan failed");
        return;
      }

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
            if (msg.type === "log") {
              setClusterLogs((prev) => [...prev, msg.data]);
            } else if (msg.type === "progress") {
              setScanProgress(msg.data);
            } else if (msg.type === "result") {
              // Pull off scanDurationMs before storing in state — it's
              // metadata for the save call, not part of the cluster
              // result that gets persisted/displayed.
              const { scanDurationMs: dur, ...rest } = msg.data as ClusterScanResult & {
                scanDurationMs?: number;
              };
              const result = rest as ClusterScanResult;
              result.strongCluster.forEach((c) => {
                c.signalTypes = new Set(c.signalTypes as unknown as string[]);
              });
              result.possibleCluster.forEach((c) => {
                c.signalTypes = new Set(c.signalTypes as unknown as string[]);
              });
              setClusterResult(result);
              scanResult = result;
              if (typeof dur === "number") scanDurationMs = dur;
            } else if (msg.type === "error") {
              setError(msg.data);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Auto-save after scan completes
      if (scanResult) {
        const id = target.investigationId;
        await fetch("/api/investigations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            target: target.primaryWallet.toLowerCase(),
            targetName: (scanResult as ClusterScanResult).targetEthos?.displayName ?? null,
            clusterResult: scanResult,
            scanDurationMs,
          }),
        });
        setCurrentInvestigationId(id);
        pushScanUrl(target);
        refreshInvestigations();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cluster scan failed");
    } finally {
      setScanning(false);
      setScanProgress(null);
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

  const getScoreBorderColor = (score: number): string => {
    if (score < 1200) return "ring-yellow-600";
    if (score < 1400) return "ring-gray-400";
    if (score < 1600) return "ring-sky-400";
    if (score < 1800) return "ring-blue-500";
    if (score < 2000) return "ring-blue-700";
    return "ring-green-600";
  };

  const getLogColor = (level: LogEntry["level"]) => {
    switch (level) {
      case "success":
        return "text-green-600 dark:text-green-400";
      case "warn":
        return "text-amber-600 dark:text-amber-400 font-medium";
      case "error":
        return "text-red-600 dark:text-red-400";
      default:
        return "text-muted-foreground";
    }
  };

  const getExplorerAddressUrl = (address: string, chain?: string) => {
    switch (chain) {
      case "Base": return `https://basescan.org/address/${address}`;
      case "Arbitrum": return `https://arbiscan.io/address/${address}`;
      case "Optimism": return `https://optimistic.etherscan.io/address/${address}`;
      case "Polygon": return `https://polygonscan.com/address/${address}`;
      default: return `https://etherscan.io/address/${address}`;
    }
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
    if (activeTab === "all") {
      loadScansPage("all", 0, true).then((page) => {
        if (page) {
          setAllInvestigations(page.rows);
          setAllTotal(page.total);
          if (page.stats) setScanStats(page.stats);
        }
      });
    } else if (activeTab === "yours") {
      loadScansPage("mine", 0).then((page) => {
        if (page) {
          setYourInvestigations(page.rows);
          setYourTotal(page.total);
        }
      });
    } else if (activeTab === "verified") {
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
  }, [activeTab, debouncedSearch, sortValue, flaggedOnly, scoreBand]);

  const handleSaveInvestigation = async () => {
    if (!clusterResult) return;
    const id = currentInvestigationId || investigationIdForResult(clusterResult);
    await fetch("/api/investigations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        target: clusterResult.target,
        targetName: clusterResult.targetEthos?.displayName ?? null,
        clusterResult,
        screenshots: Object.fromEntries(screenshots),
        twitterEvidence,
      }),
    });
    setCurrentInvestigationId(id);
    refreshInvestigations();
  };

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
    setClusterLogs([]);
    setScanProgress(null);
    setWalletInput(inv.target);
    setError(null);
  };

  const handleDeleteInvestigation = async (id: string) => {
    await fetch(`/api/investigations/${id}`, { method: "DELETE" });
    refreshInvestigations();
    if (currentInvestigationId === id) setCurrentInvestigationId(null);
  };

  const handleShareInvestigation = async (id: string) => {
    const resp = await fetch(`/api/investigations/${id}`, { method: "PATCH" });
    if (!resp.ok) return;
    const { shareId } = await resp.json();
    const shareUrl = `${window.location.origin}/s/${shareId}`;
    navigator.clipboard.writeText(shareUrl);
    refreshInvestigations();
  };

  const handleScreenshotUpload = (address: string, file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setScreenshots((prev) => new Map(prev).set(address, dataUrl));
    };
    reader.readAsDataURL(file);
  };

  const removeScreenshot = (address: string) => {
    setScreenshots((prev) => {
      const next = new Map(prev);
      next.delete(address);
      return next;
    });
  };

  // Handle paste from clipboard for a specific wallet
  const handlePaste = (address: string) => {
    navigator.clipboard.read().then((items) => {
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          item.getType(imageType).then((blob) => {
            handleScreenshotUpload(address, new File([blob], "screenshot.png", { type: imageType }));
          });
          return;
        }
      }
    }).catch(() => {
      // Clipboard API not available or no image
    });
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
    prompt += `- Strong cluster wallets identified: ${clusterResult.strongCluster.length}\n`;
    prompt += `- Possible cluster candidates: ${clusterResult.possibleCluster.length}\n\n`;

    if (allCandidates.length > 0) {
      prompt += `### Linked Wallets\n`;
      for (const c of allCandidates) {
        const name = c.ethosProfile
          ? `${c.ethosProfile.displayName}${c.ethosProfile.username ? ` (@${c.ethosProfile.username})` : ""}`
          : c.address;
        prompt += `\n${name}\n`;
        prompt += `- Address: ${c.address}\n`;
        prompt += `- Cluster confidence: ${c.confidence} (score: ${c.score})\n`;
        if (c.ethosProfile) {
          prompt += `- Ethos Profile URL: ${c.ethosProfile.profileUrl}\n`;
          prompt += `- Credibility Score: ${c.ethosProfile.score}\n`;
        }
        prompt += `- Active on: ${c.networks.join(", ")}\n`;
        prompt += `- Signals detected: ${c.signals.map((s) => `${s.type} (${s.score > 0 ? "+" : ""}${s.score})`).join(", ")}\n`;
        if (c.directCount > 0) {
          prompt += `- Direct transfers with subject: ${c.directCount} (in: ${c.incomingCount}, out: ${c.outgoingCount})`;
          if (c.bidirectional) prompt += ` -- bidirectional`;
          if (c.repeatTransfer) prompt += ` -- repeated`;
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

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  };

  const targetName = clusterResult?.targetEthos?.displayName || clusterResult?.target.slice(0, 10) + "...";

  // Collect all first funder addresses across all candidates to detect shared funders
  const allCandidateFirstFunderAddrs = new Set<string>();
  if (clusterResult) {
    for (const c of [...clusterResult.strongCluster, ...clusterResult.possibleCluster]) {
      for (const ff of c.firstFunders || []) {
        allCandidateFirstFunderAddrs.add(ff.funder);
      }
    }
  }

  // Resolve a wallet address to a display name (check target, candidates, then funder profiles)
  const resolveAddressName = (addr: string): string => {
    if (!clusterResult) return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
    if (addr === clusterResult.target) {
      return clusterResult.targetEthos?.displayName || `${addr.slice(0, 8)}...${addr.slice(-4)}`;
    }
    for (const c of [...clusterResult.strongCluster, ...clusterResult.possibleCluster]) {
      if (c.wallets?.includes(addr) || c.address === addr) {
        return c.ethosProfile?.displayName || `${addr.slice(0, 8)}...${addr.slice(-4)}`;
      }
    }
    const funderProfile = clusterResult.funderProfiles?.[addr];
    if (funderProfile) return funderProfile.displayName;
    const knownLabel = getAddressLabel(addr);
    if (knownLabel) return knownLabel;
    return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
  };

  const buildConnectionSummary = (candidate: ClusterCandidate): string[] => {
    const name = candidate.ethosProfile?.displayName || candidate.address.slice(0, 10) + "...";
    const lines: string[] = [];

    // First funder - show if meaningful
    if (candidate.firstFunders && candidate.firstFunders.length > 0 && clusterResult) {
      for (const ff of candidate.firstFunders) {
        const funderName = resolveAddressName(ff.funder);
        const isFundedByTarget = ff.funder === clusterResult.target;
        const isFundedByResult = !isFundedByTarget && [...clusterResult.strongCluster, ...clusterResult.possibleCluster]
          .some((c) => c.address !== candidate.address && (c.wallets?.includes(ff.funder) || c.address === ff.funder));

        let fundedOthers = 0;
        for (const other of [...clusterResult.strongCluster, ...clusterResult.possibleCluster]) {
          if (other.address === candidate.address) continue;
          if (other.firstFunders?.some((f) => f.funder === ff.funder)) fundedOthers++;
        }

        const exchangeLabel = ff.funderLabel || getAddressLabel(ff.funder);

        if (isFundedByTarget) {
          lines.push(`First funded by ${targetName} on ${ff.chain}.`);
        } else if (isFundedByResult) {
          lines.push(`First funded by ${funderName} (another result) on ${ff.chain}.`);
        } else if (candidate.sharedFirstFunder && ff.funder === clusterResult.targetFirstFunders?.find((f) => f.funder === ff.funder)?.funder) {
          if (exchangeLabel) {
            lines.push(`Same ${exchangeLabel} withdrawal address as ${targetName} on ${ff.chain} (likely same ${exchangeLabel} account).`);
          } else {
            lines.push(`Same first funder as ${targetName} on ${ff.chain}.`);
          }
        } else if (fundedOthers > 0) {
          if (exchangeLabel) {
            lines.push(`First funded by the same ${exchangeLabel} address on ${ff.chain} as ${fundedOthers} other result${fundedOthers > 1 ? "s" : ""} (likely same ${exchangeLabel} account).`);
          } else {
            lines.push(`First funded by ${funderName} on ${ff.chain}, which also funded ${fundedOthers} other result${fundedOthers > 1 ? "s" : ""}.`);
          }
        }
      }
    } else if (candidate.sharedFirstFunder) {
      lines.push(`Same first funder as ${targetName} on at least one chain.`);
    }

    // Direct transfers
    if (candidate.directCount > 0) {
      const parts: string[] = [];
      if (candidate.incomingCount > 0 && candidate.outgoingCount > 0) {
        parts.push(`Sent ${candidate.outgoingCount} and received ${candidate.incomingCount} transaction${candidate.directCount > 1 ? "s" : ""} with ${targetName}`);
      } else if (candidate.outgoingCount > 0) {
        parts.push(`Sent ${candidate.outgoingCount} transaction${candidate.outgoingCount > 1 ? "s" : ""} to ${targetName}`);
      } else {
        parts.push(`Received ${candidate.incomingCount} transaction${candidate.incomingCount > 1 ? "s" : ""} from ${targetName}`);
      }
      if (candidate.bidirectional) parts.push("funds flow both ways");
      if (candidate.repeatTransfer) parts.push("repeated pattern");
      lines.push(parts.join(", ") + ".");
    }

    // Shared incoming senders
    if (candidate.sharedFundingSources.length > 0) {
      lines.push(`${candidate.sharedFundingSources.length} address${candidate.sharedFundingSources.length > 1 ? "es" : ""} sent tokens to both ${name} and ${targetName}.`);
    }

    // Shared CEX deposit addresses
    if (candidate.sharedCexDeposits && candidate.sharedCexDeposits.length > 0) {
      for (const dep of candidate.sharedCexDeposits) {
        const others = dep.wallets
          .filter((w) => !(candidate.wallets || [candidate.address]).includes(w))
          .map((w) => resolveAddressName(w));
        if (others.length > 0) {
          lines.push(`Same ${dep.exchange} deposit address as ${others.slice(0, 3).join(", ")}${others.length > 3 ? ` and ${others.length - 3} more` : ""} (likely same ${dep.exchange} account).`);
        }
      }
    }

    // Multi-hop funding
    if (candidate.signals.some((s) => s.type === "multi_hop_funding")) {
      const detail = candidate.signals.find((s) => s.type === "multi_hop_funding")?.details || "";
      lines.push(`Discovered via multi-hop funding analysis: ${detail}.`);
    }

    // Ethos social signals
    if (candidate.invitedByTarget && candidate.invitedTarget) {
      lines.push(`Mutual invitation: ${targetName} invited ${name} and ${name} invited ${targetName} on Ethos.`);
    } else if (candidate.invitedByTarget) {
      lines.push(`Invited by ${targetName} on Ethos.`);
    } else if (candidate.invitedTarget) {
      lines.push(`Invited ${targetName} on Ethos.`);
    }

    if (candidate.mutualReviews) {
      lines.push(`${name} and ${targetName} reviewed each other on Ethos.`);
    }

    if (candidate.mutualVouches) {
      lines.push(`${name} and ${targetName} vouched for each other on Ethos.`);
    }

    return lines;
  };

  // Render a wallet address with its Ethos profile name if available
  const renderAddress = (addr: string, chain?: string) => {
    const name = resolveAddressName(addr);
    const isResolved = name !== `${addr.slice(0, 8)}...${addr.slice(-4)}`;
    const funderProfile = clusterResult?.funderProfiles?.[addr];
    const knownLabel = getAddressLabel(addr);
    return (
      <span className="inline-flex items-center gap-1.5">
        {isResolved && funderProfile && (
          <a href={safeExternalUrl(funderProfile.profileUrl)} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
            {name}
          </a>
        )}
        {isResolved && !funderProfile && knownLabel && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-muted/30 font-medium">{knownLabel}</span>
        )}
        {isResolved && !funderProfile && !knownLabel && (
          <span className="font-medium">{name}</span>
        )}
        <a
          href={getExplorerAddressUrl(addr, chain)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-muted-foreground hover:underline"
        >
          {addr.slice(0, 8)}...{addr.slice(-4)} <ExternalLink className="inline h-2.5 w-2.5 opacity-50" />
        </a>
      </span>
    );
  };

  const hasResults = clusterResult !== null && !scanning;

  // @ts-expect-error - ethos field added in session callback
  const currentProfileId = (session?.user?.ethos?.profileId as number | undefined) ?? null;
  // @ts-expect-error - isAdmin field added in session callback
  const isAdmin = Boolean(session?.user?.isAdmin);
  const yourScansCount = yourTotal;
  const canDelete = (inv: InvestigationSummary) =>
    isAdmin || inv.ownerProfileId === null || inv.ownerProfileId === currentProfileId;

  // Loading state
  if (sessionStatus === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not logged in — public landing page
  if (!session) {
    return <LandingPage authError={twitterAuthError} />;
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <AppHeader
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
          window.history.pushState({}, "", "/");
        }}
      />

      {/* Tabs */}
      <div className="mb-4 -mx-1 px-1 overflow-x-auto scrollbar-hide">
        <div className="inline-flex items-center gap-1 bg-card/70 backdrop-blur-sm border border-border rounded-lg p-1">
          <button
            onClick={() => selectTab("scanner")}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === "scanner"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Search className="h-4 w-4" />
            Scanner
          </button>
          <button
            onClick={() => selectTab("yours")}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === "yours"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <History className="h-4 w-4" />
            Your Scans
            {yourScansCount > 0 && (
              <span className="text-xs bg-background/70 border border-border px-1.5 py-0.5 rounded-full">{yourScansCount}</span>
            )}
          </button>
          <button
            onClick={() => selectTab("all")}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === "all"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <FolderOpen className="h-4 w-4" />
            All Scans
            {allTotal > 0 && (
              <span className="text-xs bg-background/70 border border-border px-1.5 py-0.5 rounded-full">{allTotal}</span>
            )}
          </button>
          <button
            onClick={() => selectTab("verified")}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === "verified"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            Human Verified
            {verifiedTotal > 0 && (
              <span className="text-xs bg-background/70 border border-border px-1.5 py-0.5 rounded-full">{verifiedTotal}</span>
            )}
          </button>
        </div>
      </div>

      {/* Scanner Tab */}
      {activeTab === "scanner" && (
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-6 gap-4">
        {/* Left column: How it works (empty state) + Input + Log */}
        <div className="space-y-4">
          {/* "How it works" lives above the scan input as the explainer
              for the tool. Hidden once a scan starts or results exist —
              past that point it's just noise. */}
          {!scanning && !hasResults && !loadingCached && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Network className="h-4 w-4" />
                  How it works
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="flex gap-3">
                  <div className="shrink-0 h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground">1</div>
                  <div>
                    <div className="font-medium text-foreground">Multi-chain transaction scan</div>
                    <div className="text-xs">Pulls transfer history across Ethereum, Base, Arbitrum, Optimism, and Polygon.</div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="shrink-0 h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground">2</div>
                  <div>
                    <div className="font-medium text-foreground">Signal correlation</div>
                    <div className="text-xs">Identifies direct transfers, shared funding sources, and CEX deposit patterns.</div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="shrink-0 h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground">3</div>
                  <div>
                    <div className="font-medium text-foreground">Cluster scoring</div>
                    <div className="text-xs">Wallets matching multiple signal types are flagged as strong cluster candidates.</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <ScanInput
            walletInput={walletInput}
            setWalletInput={setWalletInput}
            scanning={scanning}
            error={error}
            onSubmit={startScan}
          />

          <ScanLog
            logs={clusterLogs}
            scanning={scanning}
            progress={scanProgress}
          />
        </div>

        {/* Right column: Results */}
        <div className="space-y-4">
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

          <AnimatePresence>
          {hasResults && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              {/* Overview */}
              {/* Overview */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <OverviewCard
                result={clusterResult}
                scanning={scanning}
                onShare={() => {
                  const id = currentInvestigationId || investigationIdForResult(clusterResult);
                  handleShareInvestigation(id);
                }}
                onRescan={() => rescanTarget(clusterResult.target)}
                onCopyWallets={() => {
                  const wallets = [
                    ...(clusterResult.targetWallets ?? [clusterResult.target]),
                    ...clusterResult.strongCluster.flatMap((c) => c.wallets || [c.address]),
                    ...clusterResult.possibleCluster.flatMap((c) => c.wallets || [c.address]),
                  ];
                  navigator.clipboard.writeText([...new Set(wallets)].join("\n"));
                }}
                onExport={exportInvestigation}
              />
              </motion.div>

              {/* Strong Cluster */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}>
              <Card>
                <CardHeader className={clusterResult.strongCluster.length === 0 ? "pb-6" : "pb-3"}>
                  <CardTitle className="text-base flex items-center gap-2">
                    {clusterResult.strongCluster.length > 0 ? (
                      <>
                        <AlertTriangle className="h-5 w-5 text-red-500" />
                        {clusterResult.strongCluster.length} Strong Cluster Wallet{clusterResult.strongCluster.length !== 1 && "s"}
                      </>
                    ) : (
                      <>
                        <Shield className="h-5 w-5 text-green-500" />
                        No Strong Cluster Found
                      </>
                    )}
                  </CardTitle>
                  {clusterResult.strongCluster.length === 0 && (
                    <CardDescription className="text-xs">
                      No wallets scored high enough across multiple signal types.
                    </CardDescription>
                  )}
                </CardHeader>
                {clusterResult.strongCluster.length > 0 && (
                  <CardContent className="space-y-2">
                    {clusterResult.strongCluster.map((candidate) => (
                      <CandidateCard
                        key={candidate.address}
                        candidate={candidate}
                        result={clusterResult}
                        onSelect={setSelectedCandidate}
                      />
                    ))}
                  </CardContent>
                )}
              </Card>
              </motion.div>

              {/* Possible Candidates */}
              {clusterResult.possibleCluster.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}>
                <Card>
                  <CardHeader className={showPossible ? "pb-3" : ""}>
                    <button
                      onClick={() => setShowPossible(!showPossible)}
                      className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight cursor-pointer hover:text-foreground/80 transition-colors w-full"
                    >
                      {showPossible ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                      {clusterResult.possibleCluster.length} Possible Candidate{clusterResult.possibleCluster.length !== 1 && "s"}
                    </button>
                  </CardHeader>
                  {showPossible && (
                  <CardContent className="space-y-2">
                    {clusterResult.possibleCluster.map((candidate) => (
                      <CandidateCard
                        key={candidate.address}
                        candidate={candidate}
                        result={clusterResult}
                        onSelect={setSelectedCandidate}
                      />
                    ))}
                  </CardContent>
                  )}
                </Card>
              </motion.div>
              )}

              {/* Second-degree connections from other saved scans */}
              {currentInvestigationId && !scanning && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}>
                  <ConnectionsCard
                    investigationId={currentInvestigationId}
                    scanning={scanning}
                    onScanProfile={scanTargetInput}
                  />
                </motion.div>
              )}

              {/* Manual Checks + Evidence Collection */}
              {/* Evidence Collection */}
              {(clusterResult.strongCluster.length > 0 || clusterResult.possibleCluster.length > 0) && (
                <EvidenceCard
                  result={clusterResult}
                  screenshots={screenshots}
                  onScreenshotUpload={handleScreenshotUpload}
                  onScreenshotRemove={removeScreenshot}
                  onPaste={handlePaste}
                  initialTwitterEvidence={twitterEvidence}
                  onTwitterEvidenceChange={setTwitterEvidence}
                />
              )}

              {/* Interpretation caveats — shown for clean results too, since
                  "no cluster" is not proof of innocence. */}
              {!scanning && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}>
                  <ResearchDisclaimer />
                </motion.div>
              )}
            </motion.div>
          )}
          </AnimatePresence>

          {/* Empty state */}
          {!scanning && !hasResults && !loadingCached && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Activity className="h-3.5 w-3.5" />
                      Total Scans
                    </div>
                    <div className="text-2xl font-bold mt-1 tabular-nums">
                      {allTotal}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                      Strong Clusters
                    </div>
                    <div className="text-2xl font-bold mt-1 tabular-nums">
                      {scanStats?.strongSum ?? allInvestigations.reduce((sum, inv) => sum + inv.strongCount, 0)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Users className="h-3.5 w-3.5 text-amber-500" />
                      Possible Matches
                    </div>
                    <div className="text-2xl font-bold mt-1 tabular-nums">
                      {scanStats?.possibleSum ?? allInvestigations.reduce((sum, inv) => sum + inv.possibleCount, 0)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Recent scans */}
              {allInvestigations.length > 0 && (
                <Card>
                  <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base flex items-center gap-2">
                      <History className="h-4 w-4" />
                      Recent Scans
                    </CardTitle>
                    <button
                      onClick={() => selectTab("all")}
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
                        className="w-full group flex items-center gap-3 rounded-lg border border-border bg-card/40 hover:bg-card/80 px-3 py-2.5 transition-colors text-left cursor-pointer"
                      >
                        {inv.targetAvatar ? (
                          <img loading="lazy" decoding="async"
                            src={inv.targetAvatar}
                            alt=""
                            className="h-8 w-8 rounded-full shrink-0"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <Wallet className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">
                            {inv.targetName || `${inv.target.slice(0, 10)}...${inv.target.slice(-6)}`}
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono truncate">
                            {inv.target}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
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
                            <Shield className="h-3 w-3 text-green-500" />
                          )}
                          {inv.lastScannedBy && (
                            <img loading="lazy" decoding="async"
                              src={inv.lastScannedBy.avatarUrl}
                              alt=""
                              title={`Scanned by ${inv.lastScannedBy.displayName}`}
                              className="h-4 w-4 rounded-full"
                            />
                          )}
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}

            </div>
          )}
        </div>
      </div>
      )}

      {/* Your Scans / All Scans Tab */}
      {(activeTab === "yours" || activeTab === "all") && (scansLoading && allInvestigations.length === 0 ? (
        <ScansListSkeleton />
      ) : (
        <ScansList
          investigations={activeTab === "yours" ? yourInvestigations : allInvestigations}
          emptyLabel={
            activeTab === "yours"
              ? "You haven't run any scans yet."
              : "No scans yet. Run one to get started."
          }
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
            setActiveTab("scanner");
          }}
          onDelete={handleDeleteInvestigation}
          totalCount={activeTab === "yours" ? yourTotal : allTotal}
          onLoadMore={activeTab === "yours" ? loadMoreYours : loadMoreAll}
          loadingMore={activeTab === "yours" ? yourLoadingMore : allLoadingMore}
          loadMoreBatchSize={SCANS_PAGE_SIZE}
        />
      ))}

      {/* Human Verified Tab — scans whose target is the primary wallet of an
          Ethos human-verified profile. Sorted by strong-cluster count desc on
          the server so the most-flagged accounts surface first. */}
      {activeTab === "verified" && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-card p-3 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-foreground/90">
              <span className="font-medium">Heads up:</span> cluster signals can produce false
              positives. A wallet appearing here doesn&apos;t prove sybil behaviour — it just means
              the scanner found at least one shared funder, CEX deposit, or first-funder pattern.
              Open a row and review the evidence before drawing conclusions.
            </div>
          </div>
          {verifiedLoading && verifiedInvestigations.length === 0 ? (
            <ScansListSkeleton />
          ) : (
            <ScansList
              investigations={verifiedInvestigations}
              emptyLabel="No human-verified profiles scanned yet."
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
                setActiveTab("scanner");
              }}
              onDelete={handleDeleteInvestigation}
              totalCount={verifiedTotal}
              onLoadMore={loadMoreVerified}
              loadingMore={verifiedLoadingMore}
              loadMoreBatchSize={VERIFIED_PAGE_SIZE}
            />
          )}
        </div>
      )}

      {/* Candidate Detail Modal */}
      <AnimatePresence>
        {selectedCandidate && clusterResult && (
          <CandidateModal
            candidate={selectedCandidate}
            result={clusterResult}
            onClose={() => setSelectedCandidate(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScansList: shared renderer for the "Your Scans" and "All Scans" tabs
// ---------------------------------------------------------------------------

/** Placeholder mirroring ScansList's layout (search bar + rows with avatar,
 * name/address lines, and meta column) shown while the first page loads, so
 * the tab doesn't flash its empty state during the initial fetch. */
function ScansListSkeleton({ rows = 8 }: { rows?: number }) {
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

function ScansList({
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
  const selectClass =
    "h-9 rounded-md border border-border bg-card px-2.5 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary";

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
        <select
          aria-label="Sort scans"
          value={sortValue}
          onChange={(e) => onSortChange(e.target.value)}
          className={selectClass}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          aria-label="Filter by score"
          value={scoreBand}
          onChange={(e) => onScoreBandChange(e.target.value)}
          className={selectClass}
        >
          {SCORE_BANDS.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>
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
              <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                {inv.score != null && (
                  <span className="flex items-center gap-0.5 tabular-nums" title="Ethos score">
                    {inv.score}
                    <EthosScoreIcon size={9} className="ml-0.5" />
                  </span>
                )}
                {inv.strongCount > 0 && (
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-red-500" />
                    {inv.strongCount} strong
                  </span>
                )}
                {inv.possibleCount > 0 && (
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    {inv.possibleCount} possible
                  </span>
                )}
                {inv.strongCount === 0 && inv.possibleCount === 0 && (
                  <span className="flex items-center gap-1">
                    <Shield className="h-3 w-3 text-green-500" />
                    Clean
                  </span>
                )}
                {inv.isPublic && (
                  <span className="flex items-center gap-1">
                    <Share2 className="h-3 w-3" />
                    Shared
                  </span>
                )}
                {inv.lastScannedBy && (
                  <span
                    className="flex items-center gap-1.5"
                    title={`Scanned by ${inv.lastScannedBy.displayName}`}
                  >
                    <span className="hidden lg:inline">scanned by</span>
                    <img loading="lazy" decoding="async"
                      src={inv.lastScannedBy.avatarUrl}
                      alt=""
                      className="h-4 w-4 rounded-full"
                    />
                    <span className="hidden lg:inline truncate max-w-24 text-foreground">
                      {inv.lastScannedBy.displayName}
                    </span>
                  </span>
                )}
                <span>{new Date(inv.savedAt).toLocaleDateString()}</span>
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
