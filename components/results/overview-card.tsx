"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Save, Search, Share2, Copy, ChevronDown, ChevronRight, Wallet, FileText } from "lucide-react";
import { type ClusterScanResult } from "@/lib/cluster-scanner";
import { getScoreBorderColor, getExplorerAddressUrl } from "@/lib/scan-utils";
import { AddressDisplay } from "./address-display";
import { safeExternalUrl } from "@/lib/utils";

interface OverviewCardProps {
  result: ClusterScanResult;
  currentInvestigationId: string | null;
  scanning: boolean;
  onSave: () => void;
  onShare: () => void;
  onRescan: () => void;
  onCopyWallets: () => void;
  onExport: () => void;
}

export function OverviewCard({
  result,
  currentInvestigationId,
  scanning,
  onSave,
  onShare,
  onRescan,
  onCopyWallets,
  onExport,
}: OverviewCardProps) {
  const [showFirstFunders, setShowFirstFunders] = useState(false);

  const allResults = [...result.strongCluster, ...result.possibleCluster];
  const tName = result.targetEthos?.displayName || "Target";

  // Key findings data
  const fundedByTarget = allResults.filter((c) => c.signals.some((s) => s.type === "funded_by_target"));
  const sharedFF = allResults.filter((c) => c.sharedFirstFunder && !c.signals.some((s) => s.type === "funded_by_target"));
  const invitedBy = allResults.filter((c) => c.invitedByTarget);
  const mutualRev = allResults.filter((c) => c.mutualReviews);
  const mutualVou = allResults.filter((c) => c.mutualVouches);
  const withCex = allResults.filter((c) => c.sharedCexDeposits && c.sharedCexDeposits.length > 0);
  const multiHop = allResults.filter((c) => c.signals.some((s) => s.type === "multi_hop_funding"));
  const hasFindings = fundedByTarget.length > 0 || sharedFF.length > 0 || invitedBy.length > 0 || mutualRev.length > 0 || mutualVou.length > 0 || withCex.length > 0 || multiHop.length > 0;

  const nameLinks = (list: typeof allResults) => list.map((c, i) => {
    const name = c.ethosProfile?.displayName || c.address.slice(0, 10) + "...";
    const url = c.ethosProfile?.profileUrl || getExplorerAddressUrl(c.address);
    return (
      <span key={c.address}>
        {i > 0 && ", "}
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-foreground font-medium hover:underline">
          {name}
        </a>
      </span>
    );
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Cluster Scan Overview</CardTitle>
          <div className="flex items-center gap-1 flex-wrap justify-end">
            <Button
              onClick={(e) => {
                onCopyWallets();
                const btn = e.currentTarget;
                btn.dataset.copied = "true";
                setTimeout(() => { btn.dataset.copied = "false"; }, 1500);
              }}
              size="sm" variant="ghost" className="h-7 text-xs gap-1.5 data-[copied=true]:text-green-500"
              data-copied="false"
            >
              <Wallet className="h-3.5 w-3.5 [[data-copied=true]_&]:hidden" />
              <span className="hidden sm:inline [[data-copied=true]_&]:hidden">Copy Wallets</span>
              <span className="hidden [[data-copied=true]_&]:inline">Copied!</span>
            </Button>
            <Button onClick={onExport} size="sm" variant="ghost" className="h-7 text-xs gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export</span>
            </Button>
            <Button
              onClick={(e) => {
                onShare();
                const btn = e.currentTarget;
                btn.dataset.copied = "true";
                setTimeout(() => { btn.dataset.copied = "false"; }, 1500);
              }}
              size="sm" variant="ghost" className="h-7 text-xs gap-1.5 data-[copied=true]:text-green-500"
              data-copied="false"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline [[data-copied=true]_&]:hidden">Share</span>
              <span className="hidden [[data-copied=true]_&]:inline">Copied!</span>
            </Button>
            <Button onClick={onSave} size="sm" variant="ghost" className="h-7 text-xs gap-1.5">
              <Save className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{currentInvestigationId ? "Update" : "Save"}</span>
            </Button>
            <Button
              onClick={onRescan}
              size="sm" variant="ghost" className="h-7 text-xs gap-1.5"
              disabled={scanning}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Re-scan</span>
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs flex items-center gap-1.5">
          <span>Target:</span>
          <button
            onClick={(e) => {
              navigator.clipboard.writeText(result.target);
              const btn = e.currentTarget;
              btn.dataset.copied = "true";
              setTimeout(() => { btn.dataset.copied = "false"; }, 1500);
            }}
            className="font-mono hover:underline cursor-pointer inline-flex items-center gap-1 group data-[copied=true]:text-green-500"
            title="Click to copy full address"
            data-copied="false"
          >
            {result.target.slice(0, 10)}...{result.target.slice(-6)}
            <span className="group-data-[copied=true]:hidden"><Copy className="h-2.5 w-2.5 opacity-50" /></span>
            <span className="hidden group-data-[copied=true]:inline text-[10px] font-medium text-green-500">Copied!</span>
          </button>
          {result.targetEthos && (
            <span>&middot; Ethos: {result.targetEthos.displayName} (score: {result.targetEthos.score})</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg border border-border bg-muted/30 p-2 text-center">
            <div className="text-xl font-bold">{Object.keys(result.networkStats).length}</div>
            <div className="text-[10px] text-muted-foreground">Networks</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-2 text-center">
            <div className="text-xl font-bold">
              {Object.values(result.networkStats).reduce((s, n) => s + n.txCount, 0)}
            </div>
            <div className="text-[10px] text-muted-foreground">Transactions</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-2 text-center">
            <div className="text-xl font-bold text-red-500">{result.strongCluster.length}</div>
            <div className="text-[10px] text-red-500">Strong</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-2 text-center">
            <div className="text-xl font-bold text-amber-500">{result.possibleCluster.length}</div>
            <div className="text-[10px] text-amber-500">Possible</div>
          </div>
        </div>

        {/* Target Ethos Profile */}
        {result.targetEthos && (
          <div className="rounded-lg border border-border p-3 space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Target Ethos Profile</div>
            <div className="flex items-center gap-3">
              {result.targetEthos.avatarUrl && (
                <a href={safeExternalUrl(result.targetEthos.profileUrl)} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  <img
                    src={result.targetEthos.avatarUrl}
                    alt={result.targetEthos.displayName}
                    className={`h-10 w-10 rounded-full ring-2 ${getScoreBorderColor(result.targetEthos.score)}`}
                  />
                </a>
              )}
              <div className="flex-1 min-w-0">
                <a
                  href={safeExternalUrl(result.targetEthos.profileUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-sm hover:underline inline-flex items-center gap-1"
                >
                  {result.targetEthos.displayName}
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </a>
                <div className="text-xs text-muted-foreground">
                  {result.targetEthos.username && `@${result.targetEthos.username} · `}
                  Score: {result.targetEthos.score}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Key Findings */}
        {hasFindings && (
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Key Findings</div>
            {fundedByTarget.length > 0 && (
              <div className="text-xs text-muted-foreground flex gap-1.5">
                <span className="shrink-0">-</span>
                <span>{tName} first funded: {nameLinks(fundedByTarget)}</span>
              </div>
            )}
            {sharedFF.length > 0 && (
              <div className="text-xs text-muted-foreground flex gap-1.5">
                <span className="shrink-0">-</span>
                <span>Share the same first funder as {tName}: {nameLinks(sharedFF)}</span>
              </div>
            )}
            {invitedBy.length > 0 && (
              <div className="text-xs text-muted-foreground flex gap-1.5">
                <span className="shrink-0">-</span>
                <span>{tName} invited on Ethos: {nameLinks(invitedBy)}</span>
              </div>
            )}
            {mutualRev.length > 0 && (
              <div className="text-xs text-muted-foreground flex gap-1.5">
                <span className="shrink-0">-</span>
                <span>Mutual reviews with {tName}: {nameLinks(mutualRev)}</span>
              </div>
            )}
            {mutualVou.length > 0 && (
              <div className="text-xs text-muted-foreground flex gap-1.5">
                <span className="shrink-0">-</span>
                <span>Mutual vouches with {tName}: {nameLinks(mutualVou)}</span>
              </div>
            )}
            {withCex.length > 0 && (
              <div className="text-xs text-muted-foreground flex gap-1.5">
                <span className="shrink-0">-</span>
                <span>Share exchange deposit address: {nameLinks(withCex)}</span>
              </div>
            )}
            {multiHop.length > 0 && (
              <div className="text-xs text-muted-foreground flex gap-1.5">
                <span className="shrink-0">-</span>
                <span>Discovered via funding chain analysis: {nameLinks(multiHop)}</span>
              </div>
            )}
          </div>
        )}

        {/* Target first funders (collapsible) */}
        {result.targetFirstFunders && result.targetFirstFunders.length > 0 && (
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <button
              onClick={() => setShowFirstFunders(!showFirstFunders)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors w-full"
            >
              {showFirstFunders ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {result.targetEthos?.displayName || "Target"}&apos;s First Funders
            </button>
            {showFirstFunders && (
              <div className="space-y-1 pt-1">
                {result.targetFirstFunders.map((ff, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-16 shrink-0">{ff.chain}</span>
                      <AddressDisplay address={ff.funder} chain={ff.chain} result={result} />
                    </div>
                    <span className="text-muted-foreground">{parseFloat(String(ff.value)).toFixed(4)} ETH</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
