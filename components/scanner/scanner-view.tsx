"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, ArrowRight, ChevronDown, ChevronRight, History, Loader2, Users, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AvatarImg } from "@/components/ui/avatar-img";
import { ScanInput } from "@/components/scanner/scan-input";
import { ScanLog } from "@/components/scanner/scan-log";
import { ResultView } from "@/components/results/result-view";
import { ShareDialog } from "@/components/results/share-dialog";
import { LinkCounts } from "@/components/scans/link-counts";
import { investigationHref, type InvestigationSummary } from "@/components/scans/scans-list";
import { useScan } from "@/components/scan/scan-provider";
import { type ClusterScanResult } from "@/lib/cluster-scanner";

function investigationIdFor(result: ClusterScanResult): string {
  return result.targetProfileId != null ? `scan-p${result.targetProfileId}` : `scan-${result.target.toLowerCase()}`;
}

/**
 * The scanner: input, live scan log, and either the result or the start
 * screen. `target` comes from a /scan/... deep link.
 */
export function ScannerView({ target }: { target?: string }) {
  const scan = useScan();
  const pathname = usePathname();
  const { data: session } = useSession();
  // @ts-expect-error - isAdmin field added in session callback
  const isAdmin = Boolean(session?.user?.isAdmin);
  const [shareOpen, setShareOpen] = useState(false);

  // Open a deep link unless it is already the result on screen. The ref
  // keeps re-renders during the load from requesting it again. A running
  // scan doesn't block this: it continues in the background.
  const { openFromUrl, resultPath } = scan;
  const requestedPath = useRef<string | null>(null);
  useEffect(() => {
    if (!target || pathname === resultPath || requestedPath.current === pathname) return;
    requestedPath.current = pathname;
    void openFromUrl(target);
  }, [target, pathname, resultPath, openFromUrl]);

  // The running scan is shown only while it owns the screen.
  const scanOnScreen = scan.scanning && scan.screenIsScan;
  const result = scan.result;
  const hasResults = result !== null && !scanOnScreen;
  const active = scanOnScreen || hasResults || scan.loadingCached;

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-4">
        <ScanInput
          walletInput={scan.input}
          setWalletInput={scan.setInput}
          scanning={scanOnScreen}
          error={scan.error}
          onSubmit={(e) => {
            e.preventDefault();
            void scan.scanInput(scan.input);
          }}
          compact={active}
        />
        {/* Expanded while running; collapses once the scan completes so
            results sit directly under the input. */}
        <ScanLog
          key={scanOnScreen ? "live" : "done"}
          logs={scan.screenIsScan ? scan.logs : []}
          scanning={scanOnScreen}
          progress={scan.progress}
          defaultExpanded={scanOnScreen}
        />
      </div>

      <div className="space-y-4">
        {scanOnScreen && scan.logs.length === 0 && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              Scan queued. Waiting for the first update from the server…
            </CardContent>
          </Card>
        )}

        {!scanOnScreen && !hasResults && scan.error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-500" />
            <span>{scan.error}</span>
          </div>
        )}

        {scan.loadingCached && !result && <ResultSkeleton />}

        {hasResults && result && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
            <ResultView
              result={result}
              scannedAt={scan.scannedAt}
              scanning={scanOnScreen}
              isAdmin={isAdmin}
              saveNotice={scan.saveNotice}
              investigationId={scan.investigationId}
              actions={{
                onRescan: () => void scan.rescan(result.target),
                onShare: () => setShareOpen(true),
                onExport: () => void scan.exportEvidence(),
              }}
              onScanProfile={(input) => void scan.scanInput(input)}
            />
            <ShareDialog
              investigationId={scan.investigationId || investigationIdFor(result)}
              open={shareOpen}
              onOpenChange={setShareOpen}
              onChanged={() => scan.notifySavedChanged()}
            />
          </motion.div>
        )}

        {!active && !scan.error && <StartScreen savedVersion={scan.savedVersion} />}
      </div>
    </div>
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

interface StartData {
  recent: InvestigationSummary[];
  total: number;
  stats: { strongSum: number; possibleSum: number } | null;
  mine: number;
}

/** Shown before any scan: totals, recent scans and the explainer. */
function StartScreen({ savedVersion }: { savedVersion: number }) {
  const [data, setData] = useState<StartData | null>(null);
  /** null = default: open until the user has scans of their own. */
  const [howChoice, setHowChoice] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/investigations?limit=5&stats=1").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/investigations?limit=1&scope=mine").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([all, mine]) => {
        if (cancelled) return;
        setData({
          recent: (all?.rows as InvestigationSummary[]) ?? [],
          total: Number(all?.total) || 0,
          stats: all?.stats ?? null,
          mine: Number(mine?.total) || 0,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [savedVersion]);

  const howOpen = howChoice ?? (data !== null && data.mine === 0);
  const stats = [
    { icon: Activity, label: "Profiles scanned", value: data?.total, iconClass: "" },
    { icon: AlertTriangle, label: "Strong links", value: data?.stats?.strongSum, iconClass: "text-red-600 dark:text-red-500" },
    { icon: Users, label: "Possible links", value: data?.stats?.possibleSum, iconClass: "text-amber-600 dark:text-amber-500" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <stat.icon className={`h-3.5 w-3.5 shrink-0 ${stat.iconClass}`} />
                {stat.label}
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">
                {stat.value != null ? stat.value.toLocaleString() : <Skeleton className="h-7 w-16" />}
              </div>
            </CardContent>
          </Card>
        ))}
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
            {!data &&
              [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[54px] w-full" />)}
            {data?.recent.length === 0 && <p className="text-sm text-muted-foreground">No scans yet.</p>}
            {data?.recent.map((inv) => (
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
                  <span className="block truncate text-sm font-medium">
                    {inv.targetName || `${inv.target.slice(0, 10)}...${inv.target.slice(-6)}`}
                  </span>
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
