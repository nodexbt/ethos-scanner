"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Download, Globe, MoreHorizontal, Search, Share2, Wallet, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AvatarImg } from "@/components/ui/avatar-img";
import { HumanVerifiedBadge } from "@/components/ui/human-verified-badge";
import { EthosScoreIcon } from "@/components/ui/ethos-score-icon";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WatchButton } from "./watch-button";
import { type ClusterScanResult } from "@/lib/cluster-scanner";
import { getExplorerAddressUrl, getScoreBorderColor, shortAddress } from "@/lib/scan-utils";
import { formatRelativeTime, safeExternalUrl } from "@/lib/utils";

export interface ResultActions {
  /** Present in the signed-in app; enables Watch and Re-scan. */
  onRescan?: () => void;
  onShare?: () => void;
  onExport?: () => void;
}

/**
 * The scanned profile as the page heading: who it is, what was covered,
 * what was found, and every action on the result in one row.
 */
export function ResultHeader({
  result,
  scannedAt,
  scanning = false,
  isAdmin = false,
  actions = {},
}: {
  result: ClusterScanResult;
  scannedAt?: string | null;
  scanning?: boolean;
  isAdmin?: boolean;
  actions?: ResultActions;
}) {
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);

  const ethos = result.targetEthos;
  const wallets = result.targetWallets ?? [result.target];
  const networks = Object.values(result.networkStats);
  const failedNetworks = networks.filter((n) => n.failed).length;
  const transfers = networks.reduce((s, n) => s + n.txCount, 0);
  const coverage = result.coverageNotes ?? [];
  const strong = result.strongCluster.length;
  const possible = result.possibleCluster.length;

  const copyWallets = async () => {
    const all = [
      ...wallets,
      ...result.strongCluster.flatMap((c) => c.wallets || [c.address]),
      ...result.possibleCluster.flatMap((c) => c.wallets || [c.address]),
    ];
    try {
      await navigator.clipboard.writeText([...new Set(all)].join("\n"));
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 2000);
  };

  const actionClass = "h-8 px-2.5 text-xs";

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-4">
        {ethos ? (
          <AvatarImg
            src={ethos.avatarUrl}
            name={ethos.displayName}
            className={`h-14 w-14 sm:h-16 sm:w-16 rounded-full ring-2 shrink-0 text-lg ${getScoreBorderColor(ethos.score)}`}
          />
        ) : (
          <span className="h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-muted flex items-center justify-center shrink-0">
            <Wallet className="h-6 w-6 text-muted-foreground" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex flex-wrap items-center gap-2 break-words">
            {ethos ? ethos.displayName : <span className="font-mono">{shortAddress(result.target)}</span>}
            {ethos?.humanVerified && <HumanVerifiedBadge size={18} />}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            {ethos?.username && (
              <a href={safeExternalUrl(ethos.profileUrl)} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
                @{ethos.username}
              </a>
            )}
            {ethos && (
              <span className="inline-flex items-center gap-1">
                Ethos score <span className="text-foreground font-medium tabular-nums">{ethos.score}</span>
                <EthosScoreIcon size={10} />
              </span>
            )}
            {scannedAt && <span title={new Date(scannedAt).toLocaleString()}>scanned {formatRelativeTime(scannedAt)}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => setWalletsOpen((v) => !v)}
              aria-expanded={walletsOpen}
              className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
            >
              {wallets.length} wallet{wallets.length === 1 ? "" : "s"}
              {walletsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            <span className={failedNetworks > 0 ? "text-amber-600 dark:text-amber-500" : undefined}>
              {failedNetworks > 0 ? `${networks.length - failedNetworks} of ${networks.length} networks` : `${networks.length} networks`}
            </span>
            <span className="tabular-nums">{transfers.toLocaleString()} transfers</span>
            {isAdmin && result.usage && (
              <span className="tabular-nums" title={`${result.usage.alchemyCalls.toLocaleString()} Alchemy calls`}>
                {result.usage.computeUnits.toLocaleString()} CU
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto sm:ml-auto">
          {actions.onRescan && ethos?.profileId && <WatchButton profileId={ethos.profileId} className="h-8 px-2.5" />}
          {ethos?.username && (
            <Button asChild variant="ghost" size="sm" className={actionClass}>
              <a href={`/p/${ethos.username}`} target="_blank" rel="noopener noreferrer" title="Public summary page for this profile">
                <Globe className="h-3.5 w-3.5" />
                Public page
              </a>
            </Button>
          )}
          {actions.onShare && (
            <Button variant="ghost" size="sm" className={actionClass} onClick={actions.onShare} aria-haspopup="dialog">
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
          )}
          {actions.onRescan && (
            <Button variant="outline" size="sm" className={`${actionClass} bg-transparent`} onClick={actions.onRescan} disabled={scanning}>
              <Search className="h-3.5 w-3.5" />
              Re-scan
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={copyWallets}>
                <Copy />
                Copy all wallets
              </DropdownMenuItem>
              {actions.onExport && (
                <DropdownMenuItem onSelect={actions.onExport}>
                  <Download />
                  Export evidence
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {copied === "ok" ? "Wallets copied" : copied === "failed" ? "Couldn't copy" : ""}
          </span>
        </div>
      </div>

      {walletsOpen && (
        <ul className="mt-3 space-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2">
          {wallets.map((w) => (
            <li key={w} className="text-xs font-mono">
              <a href={getExplorerAddressUrl(w)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all hover:underline">
                {w}
                <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {strong + possible === 0 ? (
          <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">
            {result.degraded ? "No links in the data that loaded" : "No on-chain links found"}
          </span>
        ) : (
          <>
            <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">
              <span className="font-semibold text-red-600 dark:text-red-500 tabular-nums">{strong}</span> strong link{strong === 1 ? "" : "s"}
            </span>
            <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">
              <span className="font-semibold text-amber-600 dark:text-amber-500 tabular-nums">{possible}</span> possible link{possible === 1 ? "" : "s"}
            </span>
          </>
        )}
      </div>

      {coverage.length > 0 && (
        <div className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setCoverageOpen((v) => !v)}
            aria-expanded={coverageOpen}
            className="inline-flex items-center gap-1.5 hover:text-foreground cursor-pointer"
          >
            {coverageOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Coverage: {coverage.length} limit{coverage.length === 1 ? "" : "s"} applied to this scan
          </button>
          {coverageOpen && (
            <ul className="mt-2 list-disc space-y-0.5 pl-6">
              {coverage.map((c, i) => (
                <li key={i}>{c}.</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
