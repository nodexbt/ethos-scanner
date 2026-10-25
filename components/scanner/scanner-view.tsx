"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Activity, AlertTriangle, ArrowRight, ChevronDown, ChevronRight, History, Loader2, Search, Users, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { AvatarImg } from "@/components/ui/avatar-img";
import { ScanInput } from "@/components/scanner/scan-input";
import { ScanLog } from "@/components/scanner/scan-log";
import { ResultView } from "@/components/results/result-view";
import { ShareDialog } from "@/components/results/share-dialog";
import { LinkCounts } from "@/components/scans/link-counts";
import { investigationHref, nameOf } from "@/components/scans/scans-list";
import { requestFor, useScan, type ScanRequest } from "@/components/scan/scan-provider";
import { type ClusterScanResult } from "@/lib/cluster-scanner";
import type { ResolvedScanTarget, ScanIdentifier } from "@/lib/scan-target";
import { downloadEvidence, type TwitterEvidence } from "@/lib/evidence-export";
import { scanPath } from "@/lib/utils";

type RouteScan =
  | { status: "loading" }
  | { status: "loaded"; investigationId: string; result: ClusterScanResult; scannedAt: string | null; twitterEvidence: TwitterEvidence | null }
  | { status: "missing"; investigationId: string; target: ResolvedScanTarget }
  | { status: "error"; message: string };

/**
 * The saved scan for this page's address. The route is the only thing that
 * decides which result is shown: a new address starts a new load, and the
 * old load is aborted rather than raced. It reloads when a scan of the same
 * investigation finishes (`reloadFor`).
 */
function useRouteScan(target: ScanIdentifier | undefined, reloadFor: Record<string, number>): RouteScan | null {
  const [state, setState] = useState<{ key: string; scan: RouteScan } | null>(null);
  const key = target ? `${target.kind}:${target.value}` : "";
  const loadedId = state?.key === key && "investigationId" in state.scan ? state.scan.investigationId : null;
  const reloadKey = loadedId ? reloadFor[loadedId] ?? 0 : 0;

  useEffect(() => {
    if (!target) return;
    const ctl = new AbortController();
    const set = (scan: RouteScan) => {
      if (!ctl.signal.aborted) setState({ key, scan });
    };
    const resolve = async (): Promise<ResolvedScanTarget> => {
      const r = await fetch(`/api/resolve?kind=${target.kind}&value=${encodeURIComponent(target.value)}`, { signal: ctl.signal });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "No Ethos profile or valid address found");
      return r.json();
    };
    (async () => {
      try {
        // A profile id names its saved scan directly; everything else resolves first.
        let resolved: ResolvedScanTarget | null = null;
        let id = target.kind === "profileId" ? `scan-p${target.value}` : null;
        if (!id) {
          resolved = await resolve();
          id = resolved.investigationId;
        }
        const resp = await fetch(`/api/investigations/${id}`, { signal: ctl.signal });
        if (resp.ok) {
          const data = await resp.json();
          const result = data.clusterResult as ClusterScanResult;
          set({ status: "loaded", investigationId: id, result, scannedAt: data.updatedAt ?? null, twitterEvidence: data.twitterEvidence ?? null });
          // Show the handle address without a navigation (no remount, no refetch).
          const canonical = scanPath({ username: result.targetEthos?.username, profileId: result.targetProfileId, wallet: result.target });
          if (!ctl.signal.aborted && window.location.pathname !== canonical) window.history.replaceState(null, "", canonical);
          return;
        }
        set({ status: "missing", investigationId: id, target: resolved ?? (await resolve()) });
      } catch (e) {
        set({ status: "error", message: (e as Error).message });
      }
    })();
    return () => ctl.abort();
    // `target` is captured through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadKey]);

  if (!target) return null;
  // A new address shows loading until its own load lands; the old result never leaks.
  return state?.key === key ? state.scan : { status: "loading" };
}

/** Text for the scan box on a deep link. */
function labelFor(target: ScanIdentifier | undefined): string {
  if (!target) return "";
  return target.kind === "handle" ? `@${target.value}` : target.kind === "address" ? target.value : "";
}

/**
 * The scanner. With a target (a /scan/... address) it shows that profile's
 * saved result, or the running scan of it; without one, the start screen.
 */
export function ScannerView({ target }: { target?: ScanIdentifier }) {
  const scan = useScan();
  const pathname = usePathname();
  const { data: session } = useSession();
  // @ts-expect-error - isAdmin field added in session callback
  const isAdmin = Boolean(session?.user?.isAdmin);
  const [input, setInput] = useState(() => labelFor(target));
  const [inputError, setInputError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const route = useRouteScan(target, scan.finished);

  const investigationId = route && "investigationId" in route ? route.investigationId : null;
  const jobHere = !!scan.job && !!investigationId && scan.job.investigationId === investigationId;
  const failureHere = scan.failure && scan.failure.investigationId === investigationId ? scan.failure.message : null;

  // Tell the shell what is on screen: for the header indicator, the Scanner
  // tab's return address, and whether a finished scan needs a toast.
  const { setViewing } = scan;
  useEffect(() => {
    setViewing({ investigationId, path: pathname });
  }, [setViewing, investigationId, pathname]);
  useEffect(() => () => setViewing(null), [setViewing]);

  const submit = async (value: string) => {
    setSubmitting(true);
    setInputError(null);
    const err = await scan.openOrScan(value);
    setSubmitting(false);
    if (err) setInputError(err);
  };
  const start = async (req: ScanRequest) => {
    const err = await scan.startScan(req);
    if (err) toast.error(err);
  };

  const loaded = route?.status === "loaded" && !jobHere ? route : null;
  const finishedLog = scan.lastLog && scan.lastLog.investigationId === investigationId ? scan.lastLog.logs : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-4">
        <ScanInput
          walletInput={input}
          setWalletInput={setInput}
          scanning={submitting || jobHere}
          error={inputError}
          onSubmit={(e) => {
            e.preventDefault();
            void submit(input);
          }}
          compact={!!target}
        />
        {jobHere ? (
          <ScanLog key="live" logs={scan.job!.logs} scanning progress={scan.job!.progress} defaultExpanded />
        ) : (
          finishedLog && <ScanLog key="done" logs={finishedLog} scanning={false} progress={null} defaultExpanded={false} />
        )}
      </div>

      <div className="space-y-4">
        {jobHere && scan.job!.logs.length === 0 && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              Scan queued. Waiting for the first update from the server…
            </CardContent>
          </Card>
        )}

        {!jobHere && (failureHere || route?.status === "error") && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-500" />
            <span>{failureHere ?? (route?.status === "error" ? route.message : "")}</span>
          </div>
        )}

        {!jobHere && route?.status === "loading" && <ResultSkeleton />}

        {!jobHere && route?.status === "missing" && (
          <NotScannedYet target={route.target} busy={!!scan.job} onScan={() => void start(requestFor(route.target))} />
        )}

        {loaded && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
            <ResultView
              result={loaded.result}
              scannedAt={loaded.scannedAt}
              isAdmin={isAdmin}
              investigationId={loaded.investigationId}
              actions={{
                onRescan: () =>
                  void start({
                    primaryWallet: loaded.result.targetWallets?.[0] ?? loaded.result.target,
                    investigationId: loaded.investigationId,
                    path: pathname,
                    label: loaded.result.targetEthos?.username ? `@${loaded.result.targetEthos.username}` : loaded.result.target,
                  }),
                onShare: () => setShareOpen(true),
                onExport: () => {
                  downloadEvidence(loaded.result, loaded.twitterEvidence);
                  toast.success("Evidence file downloaded");
                },
              }}
              onScanProfile={(value) => void submit(value)}
            />
            <ShareDialog investigationId={loaded.investigationId} open={shareOpen} onOpenChange={setShareOpen} />
          </motion.div>
        )}

        {!target && <StartScreen />}
      </div>
    </div>
  );
}

function NotScannedYet({ target, busy, onScan }: { target: ResolvedScanTarget; busy: boolean; onScan: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 p-5">
        {target.ethos && <AvatarImg src={target.ethos.avatarUrl} name={target.ethos.displayName} className="h-12 w-12 shrink-0 rounded-full" />}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{target.ethos?.displayName ?? target.primaryWallet}</div>
          <p className="text-sm text-muted-foreground">No saved scan yet. A scan takes up to a couple of minutes and uses one of your daily scans.</p>
        </div>
        <Button onClick={onScan} disabled={busy} title={busy ? "Another scan of yours is still running" : undefined}>
          <Search className="h-4 w-4" />
          Scan now
        </Button>
      </CardContent>
    </Card>
  );
}

function ResultSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Card className="p-5">
        <div className="flex gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
        </div>
      </Card>
      <Card className="space-y-2 p-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </Card>
    </div>
  );
}

/** Shown before any scan: totals, recent scans and the explainer. */
function StartScreen() {
  const { summary, savedVersion } = useScan();
  const [mine, setMine] = useState<number | null>(null);
  /** null = default: open until the user has scans of their own. */
  const [howChoice, setHowChoice] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/investigations?limit=1&scope=mine")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setMine(Number(d.total) || 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [savedVersion]);

  const howOpen = howChoice ?? mine === 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile icon={Activity} label="Profiles scanned" value={summary?.total} />
        <StatTile icon={AlertTriangle} label="Strong links" value={summary?.stats?.strongSum} iconClass="text-red-600 dark:text-red-500" />
        <StatTile icon={Users} label="Possible links" value={summary?.stats?.possibleSum} iconClass="text-amber-600 dark:text-amber-500" />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              Recent scans
            </CardTitle>
            <Link href="/scans" className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
              View all
              <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {!summary && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[54px] w-full" />)}
            {summary?.recent.length === 0 && <p className="text-sm text-muted-foreground">No scans yet.</p>}
            {summary?.recent.map((inv) => (
              <Link
                key={inv.id}
                href={investigationHref(inv)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2.5 text-left transition-colors hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {inv.targetAvatar ? (
                  <AvatarImg src={inv.targetAvatar} name={inv.targetName} className="h-8 w-8 shrink-0 rounded-full" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{nameOf(inv)}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{inv.target}</span>
                </span>
                <LinkCounts strong={inv.strongCount} possible={inv.possibleCount} className="shrink-0" />
                {inv.lastScannedBy && (
                  <AvatarImg
                    src={inv.lastScannedBy.avatarUrl}
                    title={`Scanned by ${inv.lastScannedBy.displayName}`}
                    className="hidden h-4 w-4 shrink-0 rounded-full sm:inline-flex"
                  />
                )}
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className={howOpen ? "pb-3" : undefined}>
            <button
              type="button"
              onClick={() => setHowChoice(!howOpen)}
              aria-expanded={howOpen}
              className="flex w-full cursor-pointer items-center gap-2 text-base font-semibold leading-none tracking-tight transition-colors hover:text-foreground/80"
            >
              {howOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              How it works
            </button>
          </CardHeader>
          {howOpen && (
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {[
                ["Multi-chain transaction scan", "Pulls transfer history across Ethereum, Base, Arbitrum, Optimism and Polygon for every wallet attested to the profile."],
                ["Signal correlation", "Direct transfers find possible links; first funders, shared funding sources and exchange deposits score them."],
                ["Link strength", "Strong when first funded by the profile or a linked wallet, or 15+ points across two signal types. Possible from 8 points."],
              ].map(([title, body], n) => (
                <div key={title} className="flex gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">{n + 1}</div>
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
  );
}
