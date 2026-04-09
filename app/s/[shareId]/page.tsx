"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Shield, Loader2, AlertTriangle } from "lucide-react";
import { type ClusterScanResult } from "@/lib/cluster-scanner";
import { ThemeToggle } from "@/components/theme-toggle";
import { useParams } from "next/navigation";
import Link from "next/link";
import DecryptedText from "@/components/ui/decrypted-text";
import { OverviewCard } from "@/components/results/overview-card";
import { CandidateCard } from "@/components/results/candidate-card";

// Header chip matching the home page wordmark — links back to "/" so visitors
// landing on a shared link have a clear path to the scanner.
function ShareHeader() {
  return (
    <div className="flex items-center justify-between pb-4">
      <Link
        href="/"
        className="group h-10 flex items-center gap-2 bg-card/70 backdrop-blur-sm border border-border rounded-lg px-3 hover:bg-card/90 hover:border-foreground/30 transition-colors min-w-0"
      >
        <Shield className="h-4.5 w-4.5 shrink-0" />
        <DecryptedText
          text="Ethos Scanner"
          speed={40}
          maxIterations={12}
          sequential
          revealDirection="start"
          animateOn="hover"
          replayInterval={30000}
          useOriginalCharsOnly={false}
          parentClassName="font-[family-name:var(--font-ibm-plex-mono)] font-semibold text-base tracking-tight"
          className="text-foreground"
          encryptedClassName="text-muted-foreground"
        />
      </Link>
      <ThemeToggle />
    </div>
  );
}

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

  if (loading) {
    return (
      <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto">
        <ShareHeader />
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto">
        <ShareHeader />
        <div className="flex items-center justify-center py-16">
          <Card className="w-full max-w-sm">
            <CardHeader className="text-center">
              <Shield className="h-10 w-10 mx-auto mb-2" />
              <CardTitle>Investigation Not Found</CardTitle>
              <CardDescription>This shared investigation does not exist or is no longer public.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  // Read-only "Copy Wallets" handler — operates only on already-loaded data,
  // so it's safe to expose on the public page. Share/Re-scan/Export are
  // intentionally omitted: a viewer landing here already has the share link,
  // can't trigger a new scan without auth, and Export pulls in evidence
  // screenshots that only exist in the owner's session.
  const handleCopyWallets = () => {
    const wallets = [
      result.target,
      ...result.strongCluster.flatMap((c) => c.wallets || [c.address]),
      ...result.possibleCluster.flatMap((c) => c.wallets || [c.address]),
    ];
    navigator.clipboard.writeText([...new Set(wallets)].join("\n"));
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto">
      <ShareHeader />

      <div className="bg-card/70 backdrop-blur-sm border border-border rounded-lg px-4 py-3 mb-4 space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Shared Investigation</h1>
        <p className="text-sm text-muted-foreground">Read-only view of a sybil cluster scan.</p>
      </div>

      <div className="space-y-4">
        <OverviewCard
          result={result}
          scanning={false}
          onCopyWallets={handleCopyWallets}
        />

        {result.strongCluster.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                {result.strongCluster.length} Strong Cluster Wallet{result.strongCluster.length !== 1 && "s"}
              </CardTitle>
            </CardHeader>
            <div className="px-6 pb-6 space-y-2">
              {result.strongCluster.map((c) => (
                <CandidateCard key={c.address} candidate={c} result={result} />
              ))}
            </div>
          </Card>
        )}

        {result.possibleCluster.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                {result.possibleCluster.length} Possible Candidate{result.possibleCluster.length !== 1 && "s"}
              </CardTitle>
            </CardHeader>
            <div className="px-6 pb-6 space-y-2">
              {result.possibleCluster.map((c) => (
                <CandidateCard key={c.address} candidate={c} result={result} />
              ))}
            </div>
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
