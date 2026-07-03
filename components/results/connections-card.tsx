"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Network, Search, ArrowRight, ArrowLeft } from "lucide-react";
import { EthosScoreIcon } from "@/components/ui/ethos-score-icon";
import { HumanVerifiedBadge } from "@/components/ui/human-verified-badge";

interface Edge {
  sourceProfileId: number;
  candidateProfileId: number;
  investigationId: string;
  confidence: "high" | "medium";
  score: number;
}

interface ProfileInfo {
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  score: number | null;
  humanVerified: boolean;
}

interface ConnectionsResponse {
  sourceProfileId: number | null;
  edges: Edge[];
  profiles: Record<number, ProfileInfo>;
}

interface ConnectionsCardProps {
  investigationId: string;
  /** Kick off a scan for a profile surfaced here. Receives a scan input
      string (@handle or profile id) the resolver understands. */
  onScanProfile?: (input: string) => void;
  scanning?: boolean;
}

/**
 * Second-degree connections derived from other saved scans: which
 * profiles this investigation's candidates are connected to in the rest
 * of the saved-investigation graph. Reads the edge graph only — costs no
 * scan quota until the user explicitly clicks "Scan".
 */
export function ConnectionsCard({ investigationId, onScanProfile, scanning }: ConnectionsCardProps) {
  const [data, setData] = useState<ConnectionsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/investigations/${investigationId}/connections`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [investigationId]);

  if (!data || data.edges.length === 0) return null;

  const profileLabel = (pid: number) => {
    const p = data.profiles[pid];
    return p?.displayName || p?.username || `profile #${pid}`;
  };

  const scanInputFor = (pid: number) => {
    const p = data.profiles[pid];
    return p?.username ? `@${p.username}` : String(pid);
  };

  const renderProfile = (pid: number) => {
    const p = data.profiles[pid];
    return (
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        {p?.avatarUrl && (
          <img
            loading="lazy"
            decoding="async"
            src={p.avatarUrl}
            alt=""
            className="h-4 w-4 rounded-full"
          />
        )}
        {profileLabel(pid)}
        {p?.humanVerified && <HumanVerifiedBadge />}
        {p?.score != null && (
          <span className="inline-flex items-center gap-0.5 text-muted-foreground font-normal">
            ({p.score}
            <EthosScoreIcon size={8} />)
          </span>
        )}
      </span>
    );
  };

  // Group by the profile from this investigation the edge touches.
  const sourcePid = data.sourceProfileId;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Network className="h-4 w-4" />
          Second-Degree Connections
        </CardTitle>
        <CardDescription className="text-xs">
          Connections found by other saved scans involving this cluster&apos;s profiles.
          No quota is spent until you scan one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {data.edges.map((e) => {
          // Which side is "new information" relative to this investigation?
          const outgoing = e.sourceProfileId !== sourcePid ? e.sourceProfileId : null;
          const otherPid =
            e.candidateProfileId === sourcePid ? e.sourceProfileId : e.candidateProfileId;
          return (
            <div
              key={`${e.sourceProfileId}-${e.candidateProfileId}`}
              className="flex items-center justify-between gap-2 text-xs text-muted-foreground rounded-md border border-border px-2.5 py-1.5"
            >
              <span className="flex items-center gap-1.5 flex-wrap min-w-0">
                {renderProfile(e.sourceProfileId)}
                {outgoing !== null ? (
                  <ArrowRight className="h-3 w-3 shrink-0" />
                ) : (
                  <ArrowLeft className="h-3 w-3 shrink-0" />
                )}
                {renderProfile(e.candidateProfileId)}
                <span
                  className={
                    e.confidence === "high" ? "text-red-500" : "text-amber-500"
                  }
                >
                  {e.confidence === "high" ? "strong" : "possible"}
                </span>
              </span>
              {onScanProfile && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] gap-1 shrink-0"
                  disabled={scanning}
                  onClick={() => onScanProfile(scanInputFor(otherPid))}
                  title={`Scan ${profileLabel(otherPid)}`}
                >
                  <Search className="h-3 w-3" />
                  Scan
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
