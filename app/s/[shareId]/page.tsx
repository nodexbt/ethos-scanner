"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Shield } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { type ClusterScanResult } from "@/lib/cluster-scanner";
import { useParams } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { AppFooter } from "@/components/app-footer";
import { ResultView } from "@/components/results/result-view";
import { Plate } from "@/components/ui/plate";

export default function SharedInvestigation() {
  const params = useParams();
  const shareId = params.shareId as string;
  const [result, setResult] = useState<ClusterScanResult | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/share/${shareId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Investigation not found");
        return r.json();
      })
      .then((data) => {
        setResult(data.clusterResult);
        setScannedAt(data.updatedAt ?? null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [shareId]);

  if (loading) {
    return (
      <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto">
        <SiteHeader />
        {/* Title block */}
        <div className="bg-card/70 backdrop-blur-sm border border-border rounded-lg px-4 py-3 mb-4 space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="space-y-4">
          {/* Overview card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </CardContent>
          </Card>
          {/* Cluster rows */}
          <Card>
            <CardHeader className="pb-3">
              <Skeleton className="h-5 w-44" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <Skeleton className="h-4 w-36 max-w-full" />
                    <Skeleton className="h-3 w-52 max-w-full" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto">
        <SiteHeader />
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

  // Read-only: no Share, Re-scan, Watch or Export, and no scanning from the
  // evidence dialog. Copy wallets only uses data already on the page.
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <SiteHeader />
      <Plate className="mb-3 inline-block px-2.5 py-1 text-xs text-muted-foreground">Shared scan · read-only</Plate>
      <ResultView result={result} scannedAt={scannedAt} />
      <AppFooter />
    </div>
  );
}
