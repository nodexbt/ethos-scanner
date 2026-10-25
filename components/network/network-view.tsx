"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Network, Users, GitBranch, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { EthosScoreIcon } from "@/components/ui/ethos-score-icon";
import { HumanVerifiedBadge } from "@/components/ui/human-verified-badge";
import { formatRelativeTime, scanHref } from "@/lib/utils";
import { ConfidencePill } from "@/components/ui/confidence-pill";
import type { NetworkOverview, NetworkProfile } from "@/lib/db/network";
import { AvatarImg } from "@/components/ui/avatar-img";
import { Plate } from "@/components/ui/plate";

function ProfileRow({ p, right }: { p: NetworkProfile; right: React.ReactNode }) {
  return (
    <Link href={scanHref(p)} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 hover:bg-muted/30 transition-colors">
      <AvatarImg src={p.avatarUrl} name={p.displayName} className="h-8 w-8 rounded-full shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate flex items-center gap-1">
          {p.displayName ?? `profile ${p.profileId}`}
          {p.humanVerified && <HumanVerifiedBadge />}
        </div>
        <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
          {p.username ? `@${p.username}` : ""}
          {p.score != null && (
            <span className="inline-flex items-center gap-0.5">
              {p.username ? "· " : ""}{p.score}
              <EthosScoreIcon size={9} />
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-xs text-muted-foreground text-right">{right}</div>
    </Link>
  );
}

// Last overview seen this session: re-entering the tab shows it at once
// while a fresh copy loads (the API itself is cached a minute).
let lastOverview: NetworkOverview | null = null;

export function NetworkView() {
  const [data, setData] = useState<NetworkOverview | null>(lastOverview);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/network")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? "Failed to load"))))
      .then((d) => {
        lastOverview = d;
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <Plate className="mb-4 px-4 py-3">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Network className="h-5 w-5" />
          Network
        </h1>
        <p className="text-sm text-muted-foreground">
          What all saved scans add up to: the profiles most often linked, the scans that found the most, and the newest links.
        </p>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-500">{error}</p>}
      </Plate>

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
              { icon: AlertTriangle, label: "Strong links", value: data.totals.strongEdges, cls: "text-red-600 dark:text-red-500" },
            ].map((t) => (
              <StatTile key={t.label} icon={t.icon} label={t.label} value={t.value} iconClass={t.cls} />
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
                    right={
                      <>
                        <div className="text-foreground font-medium">{p.linkedBy} scans</div>
                        {p.strong > 0 && <div className="text-red-600 dark:text-red-500">{p.strong} strong</div>}
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
                    right={
                      <>
                        <div className="text-foreground font-medium">{p.links} links</div>
                        {p.strong > 0 && <div className="text-red-600 dark:text-red-500">{p.strong} strong</div>}
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
                      <ConfidencePill confidence={e.confidence} score={e.score} className="ml-auto" />
                    </div>
                    <div className="text-muted-foreground mt-0.5">{formatRelativeTime(e.updatedAt)}</div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}

    </div>
  );
}
