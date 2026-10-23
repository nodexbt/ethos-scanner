"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AlertTriangle, Network, Users, GitBranch, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/app-footer";
import { EthosScoreIcon } from "@/components/ui/ethos-score-icon";
import { HumanVerifiedBadge } from "@/components/ui/human-verified-badge";
import { formatRelativeTime } from "@/lib/utils";
import type { NetworkOverview, NetworkProfile } from "@/lib/db/network";

function scanHref(p: NetworkProfile) {
  return `/scan/x/${p.username ?? p.profileId}`;
}

function ProfileRow({ p, right, href }: { p: NetworkProfile; right: React.ReactNode; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 hover:bg-muted/30 transition-colors">
      {p.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.avatarUrl} alt="" className="h-8 w-8 rounded-full shrink-0" loading="lazy" />
      ) : (
        <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate inline-flex items-center gap-1">
          {p.displayName ?? `profile ${p.profileId}`}
          {p.humanVerified && <HumanVerifiedBadge />}
        </div>
        <div className="text-xs text-muted-foreground truncate inline-flex items-center gap-1">
          {p.username ? `@${p.username}` : ""}
          {p.score != null && (
            <span className="inline-flex items-center gap-0.5">
              · {p.score}
              <EthosScoreIcon size={9} />
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-xs text-muted-foreground text-right">{right}</div>
    </Link>
  );
}

export default function NetworkPage() {
  const { data: session, status } = useSession();
  const [data, setData] = useState<NetworkOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch("/api/network")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? "Failed to load"))))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (status === "loading") return null;
  if (!session) {
    return (
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
        <AppHeader />
        <Card className="max-w-md mx-auto mt-12">
          <CardHeader className="text-center">
            <CardTitle>Sign in to view the network</CardTitle>
            <CardDescription>The connection graph is built from saved scans and is available to signed-in members.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <AppHeader />

      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Network className="h-5 w-5" />
          Network
        </h1>
        <p className="text-sm text-muted-foreground">
          What all saved scans add up to: the profiles most often linked, the scans that found the most, and the newest links.
        </p>
      </div>

      {error && <div className="text-sm text-red-500 mb-4">{error}</div>}

      {!data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {[
              { icon: Activity, label: "Profiles scanned", value: data.totals.profilesScanned },
              { icon: Users, label: "Profiles linked by a scan", value: data.totals.linkedProfiles },
              { icon: GitBranch, label: "Links in the graph", value: data.totals.edges },
              { icon: AlertTriangle, label: "Strong links", value: data.totals.strongEdges, cls: "text-red-500" },
            ].map((t) => (
              <Card key={t.label}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <t.icon className={`h-3.5 w-3.5 ${t.cls ?? ""}`} />
                    {t.label}
                  </div>
                  <div className="text-2xl font-bold mt-1 tabular-nums">{t.value.toLocaleString()}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Most linked</CardTitle>
                <CardDescription className="text-xs">Profiles flagged by the most other scans. Being here is evidence to read, not a verdict.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.mostLinked.map((p) => (
                  <ProfileRow
                    key={p.profileId}
                    p={p}
                    href={scanHref(p)}
                    right={
                      <>
                        <div className="text-foreground font-medium">{p.linkedBy} scans</div>
                        {p.strong > 0 && <div className="text-red-500">{p.strong} strong</div>}
                      </>
                    }
                  />
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Largest clusters</CardTitle>
                <CardDescription className="text-xs">Scans that found the most linked profiles.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.largestClusters.map((p) => (
                  <ProfileRow
                    key={p.profileId}
                    p={p}
                    href={scanHref(p)}
                    right={
                      <>
                        <div className="text-foreground font-medium">{p.links} links</div>
                        {p.strong > 0 && <div className="text-red-500">{p.strong} strong</div>}
                      </>
                    }
                  />
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Newest links</CardTitle>
                <CardDescription className="text-xs">The latest connections written by any saved scan.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.recent.map((e, i) => (
                  <Link key={`${e.investigationId}-${e.candidate.profileId}-${i}`} href={scanHref(e.source)} className="block rounded-lg border border-border px-3 py-2 hover:bg-muted/30 transition-colors text-xs">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-sm">{e.source.displayName ?? e.source.profileId}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-medium text-sm">{e.candidate.displayName ?? e.candidate.profileId}</span>
                      <span className={`ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white ${e.confidence === "high" ? "bg-red-500" : "bg-amber-500"}`}>
                        {e.confidence === "high" ? "strong" : "possible"} · {e.score}
                      </span>
                    </div>
                    <div className="text-muted-foreground mt-0.5">{formatRelativeTime(e.updatedAt)}</div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <AppFooter />
    </div>
  );
}
