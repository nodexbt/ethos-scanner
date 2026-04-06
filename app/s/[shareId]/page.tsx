"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Shield, Loader2, AlertTriangle, ExternalLink, Wallet } from "lucide-react";
import { type ClusterScanResult, type ClusterCandidate } from "@/lib/cluster-scanner";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAddressLabel } from "@/lib/known-addresses";
import { safeExternalUrl } from "@/lib/utils";
import { useParams } from "next/navigation";

export default function SharedInvestigation() {
  const params = useParams();
  const shareId = params.shareId as string;
  const [result, setResult] = useState<ClusterScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/share/${shareId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Investigation not found");
        return r.json();
      })
      .then((data) => setResult(data.clusterResult))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [shareId]);

  const getScoreBorderColor = (score: number): string => {
    if (score < 1200) return "ring-yellow-600";
    if (score < 1400) return "ring-gray-400";
    if (score < 1600) return "ring-sky-400";
    if (score < 1800) return "ring-blue-500";
    if (score < 2000) return "ring-blue-700";
    return "ring-green-600";
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

  const resolveAddressName = (addr: string): string => {
    if (!result) return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
    if (addr === result.target) return result.targetEthos?.displayName || `${addr.slice(0, 8)}...${addr.slice(-4)}`;
    for (const c of [...result.strongCluster, ...result.possibleCluster]) {
      if (c.wallets?.includes(addr) || c.address === addr) {
        return c.ethosProfile?.displayName || `${addr.slice(0, 8)}...${addr.slice(-4)}`;
      }
    }
    const fp = result.funderProfiles?.[addr];
    if (fp) return fp.displayName;
    const label = getAddressLabel(addr);
    if (label) return label;
    return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
  };

  const targetName = result?.targetEthos?.displayName || result?.target.slice(0, 10) + "...";

  const buildConnectionSummary = (candidate: ClusterCandidate): string[] => {
    const name = candidate.ethosProfile?.displayName || candidate.address.slice(0, 10) + "...";
    const lines: string[] = [];

    if (candidate.firstFunders && candidate.firstFunders.length > 0 && result) {
      for (const ff of candidate.firstFunders) {
        const funderName = resolveAddressName(ff.funder);
        const isFundedByTarget = ff.funder === result.target;
        const isFundedByResult = !isFundedByTarget && [...result.strongCluster, ...result.possibleCluster]
          .some((c) => c.address !== candidate.address && (c.wallets?.includes(ff.funder) || c.address === ff.funder));
        let fundedOthers = 0;
        for (const other of [...result.strongCluster, ...result.possibleCluster]) {
          if (other.address === candidate.address) continue;
          if (other.firstFunders?.some((f) => f.funder === ff.funder)) fundedOthers++;
        }
        const exchangeLabel = ff.funderLabel || getAddressLabel(ff.funder);
        if (isFundedByTarget) lines.push(`First funded by ${targetName} on ${ff.chain}.`);
        else if (isFundedByResult) lines.push(`First funded by ${funderName} (another result) on ${ff.chain}.`);
        else if (fundedOthers > 0) {
          if (exchangeLabel) lines.push(`First funded by the same ${exchangeLabel} address on ${ff.chain} as ${fundedOthers} other result${fundedOthers > 1 ? "s" : ""}.`);
          else lines.push(`First funded by ${funderName} on ${ff.chain}, which also funded ${fundedOthers} other result${fundedOthers > 1 ? "s" : ""}.`);
        }
      }
    }
    if (candidate.directCount > 0) {
      const parts: string[] = [];
      if (candidate.incomingCount > 0 && candidate.outgoingCount > 0) parts.push(`Sent ${candidate.outgoingCount} and received ${candidate.incomingCount} transaction${candidate.directCount > 1 ? "s" : ""} with ${targetName}`);
      else if (candidate.outgoingCount > 0) parts.push(`Sent ${candidate.outgoingCount} transaction${candidate.outgoingCount > 1 ? "s" : ""} to ${targetName}`);
      else parts.push(`Received ${candidate.incomingCount} transaction${candidate.incomingCount > 1 ? "s" : ""} from ${targetName}`);
      if (candidate.bidirectional) parts.push("funds flow both ways");
      if (candidate.repeatTransfer) parts.push("repeated pattern");
      lines.push(parts.join(", ") + ".");
    }
    if (candidate.sharedFundingSources.length > 0) lines.push(`${candidate.sharedFundingSources.length} address${candidate.sharedFundingSources.length > 1 ? "es" : ""} sent tokens to both ${name} and ${targetName}.`);
    if (candidate.sharedCexDeposits && candidate.sharedCexDeposits.length > 0) {
      for (const dep of candidate.sharedCexDeposits) {
        const others = dep.wallets.filter((w) => !(candidate.wallets || [candidate.address]).includes(w)).map((w) => resolveAddressName(w));
        if (others.length > 0) lines.push(`Same ${dep.exchange} deposit address as ${others.slice(0, 3).join(", ")} (likely same ${dep.exchange} account).`);
      }
    }
    if (candidate.invitedByTarget) lines.push(`Invited by ${targetName} on Ethos.`);
    if (candidate.invitedTarget) lines.push(`Invited ${targetName} on Ethos.`);
    if (candidate.mutualReviews) lines.push(`${name} and ${targetName} reviewed each other on Ethos.`);
    if (candidate.mutualVouches) lines.push(`${name} and ${targetName} vouched for each other on Ethos.`);
    return lines;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <Shield className="h-10 w-10 mx-auto mb-2" />
            <CardTitle>Investigation Not Found</CardTitle>
            <CardDescription>This shared investigation does not exist or is no longer public.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const renderCandidate = (candidate: ClusterCandidate) => (
    <div key={candidate.address} className="rounded-lg border border-border p-3 space-y-2.5">
      <div className="flex items-start gap-3">
        {candidate.ethosProfile?.avatarUrl && (
          <img src={candidate.ethosProfile.avatarUrl} alt={candidate.ethosProfile.displayName} className={`h-10 w-10 rounded-full ring-2 shrink-0 ${getScoreBorderColor(candidate.ethosProfile.score)}`} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{candidate.ethosProfile?.displayName || `${candidate.address.slice(0, 10)}...${candidate.address.slice(-6)}`}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${candidate.confidence === "high" ? "bg-red-500 text-white" : "bg-amber-500 text-white"}`}>
                score: {candidate.score}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground shrink-0">{candidate.networks.join(", ")}</div>
          </div>
          {candidate.ethosProfile && (
            <div className="text-xs text-muted-foreground">
              {candidate.ethosProfile.username && `@${candidate.ethosProfile.username} · `}
              Ethos score: {candidate.ethosProfile.score}
              {candidate.wallets && candidate.wallets.length > 1 && ` · ${candidate.wallets.length} wallets`}
            </div>
          )}
        </div>
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        {buildConnectionSummary(candidate).map((line, i) => (
          <div key={i} className="flex gap-1.5">
            <span className="text-muted-foreground shrink-0">-</span>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between pb-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6" />
            Shared Investigation
          </h1>
          <p className="text-sm text-muted-foreground">Read-only view of a sybil cluster scan.</p>
        </div>
        <ThemeToggle />
      </div>

      <div className="space-y-4">
        {/* Overview */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Scan Results</CardTitle>
            <CardDescription className="text-xs">
              Target: {result.target.slice(0, 10)}...{result.target.slice(-6)}
              {result.targetEthos && <> &middot; {result.targetEthos.displayName} (score: {result.targetEthos.score})</>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-border bg-muted/30 p-2 text-center">
                <div className="text-xl font-bold">{Object.values(result.networkStats).reduce((s, n) => s + n.txCount, 0)}</div>
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

            {result.targetEthos && (
              <div className="rounded-lg border border-border p-3 space-y-1">
                <div className="flex items-center gap-3">
                  {result.targetEthos.avatarUrl && (
                    <img src={result.targetEthos.avatarUrl} alt={result.targetEthos.displayName} className={`h-10 w-10 rounded-full ring-2 ${getScoreBorderColor(result.targetEthos.score)}`} />
                  )}
                  <div>
                    <a href={safeExternalUrl(result.targetEthos.profileUrl)} target="_blank" rel="noopener noreferrer" className="font-medium text-sm hover:underline inline-flex items-center gap-1">
                      {result.targetEthos.displayName} <ExternalLink className="h-3 w-3 opacity-50" />
                    </a>
                    <div className="text-xs text-muted-foreground">
                      {result.targetEthos.username && `@${result.targetEthos.username} · `}Score: {result.targetEthos.score}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Strong Cluster */}
        {result.strongCluster.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                {result.strongCluster.length} Strong Cluster Wallet{result.strongCluster.length !== 1 && "s"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {result.strongCluster.map(renderCandidate)}
            </CardContent>
          </Card>
        )}

        {/* Possible */}
        {result.possibleCluster.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                {result.possibleCluster.length} Possible Candidate{result.possibleCluster.length !== 1 && "s"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {result.possibleCluster.map(renderCandidate)}
            </CardContent>
          </Card>
        )}

        {result.strongCluster.length === 0 && result.possibleCluster.length === 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-5 w-5 text-green-500" />
                No Cluster Found
              </CardTitle>
              <CardDescription className="text-xs">No wallets scored high enough to be flagged.</CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}
