"use client";

import { memo } from "react";
import { AlertTriangle, Shield, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AvatarImg } from "@/components/ui/avatar-img";
import { HumanVerifiedBadge } from "@/components/ui/human-verified-badge";
import { ConfidencePill } from "@/components/ui/confidence-pill";
import { type ClusterCandidate, type ClusterScanResult } from "@/lib/cluster-scanner";
import { describeSignal, getScoreBorderColor, scoringSignals, shortAddress } from "@/lib/scan-utils";

/** One linked profile: who, how strongly, and the strongest reason. */
export const LinkRow = memo(function LinkRow({
  candidate,
  result,
  onSelect,
}: {
  candidate: ClusterCandidate;
  result: ClusterScanResult;
  onSelect: (candidate: ClusterCandidate) => void;
}) {
  const e = candidate.ethosProfile;
  const reasons = scoringSignals(candidate).map((s) => describeSignal(s, candidate, result).short);
  return (
    <button
      type="button"
      onClick={() => onSelect(candidate)}
      aria-haspopup="dialog"
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2.5 text-left transition-colors hover:bg-card/80 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <AvatarImg
        src={e?.avatarUrl}
        name={e?.displayName}
        className={`h-9 w-9 rounded-full shrink-0 ${e ? `ring-2 ${getScoreBorderColor(e.score)}` : ""}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{e?.displayName || shortAddress(candidate.address)}</span>
          {e?.humanVerified && <HumanVerifiedBadge />}
          <ConfidencePill confidence={candidate.confidence === "high" ? "high" : "medium"} score={candidate.score} />
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {reasons.length > 0 ? (
            <>
              <span className="text-foreground">{reasons[0]}</span>
              {reasons.length > 1 && ` · ${reasons.slice(1).join(" · ")}`}
            </>
          ) : (
            "Context signals only"
          )}
        </span>
      </span>
      {e?.username && <span className="hidden sm:block shrink-0 max-w-[10rem] truncate text-xs text-muted-foreground">@{e.username}</span>}
      <span className="hidden sm:block shrink-0 text-[11px] text-muted-foreground">{candidate.networks.join(", ")}</span>
    </button>
  );
});

/** Every linked profile, strong first, with an optional active filter. */
export function LinkList({
  result,
  strong,
  possible,
  filterLabel,
  onClearFilter,
  onSelect,
}: {
  result: ClusterScanResult;
  /** Already filtered lists. */
  strong: ClusterCandidate[];
  possible: ClusterCandidate[];
  filterLabel: string | null;
  onClearFilter: () => void;
  onSelect: (candidate: ClusterCandidate) => void;
}) {
  const total = result.strongCluster.length + result.possibleCluster.length;

  if (total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {result.degraded ? <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500" /> : <Shield className="h-5 w-5" />}
            {result.degraded ? "No links in the data that loaded" : "No linked profiles found"}
          </CardTitle>
          <CardDescription className="text-xs">
            {result.degraded
              ? "The scan was incomplete, so this is inconclusive rather than clean."
              : "No wallet scored high enough across the on-chain signals. That is not proof the profile is independent."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const divider = (label: string, n: number) => (
    <div className="flex items-center gap-2.5 pt-1.5 text-[11px] uppercase tracking-wide text-muted-foreground after:h-px after:flex-1 after:bg-border">
      {label} · {n}
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3 flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Linked profiles</CardTitle>
        {filterLabel && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-2.5 pr-1 text-xs">
            {filterLabel}
            <button
              type="button"
              onClick={onClearFilter}
              aria-label="Clear filter"
              className="h-5 w-5 inline-flex items-center justify-center rounded-full hover:bg-muted cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {strong.length > 0 && divider("Strong", strong.length)}
        {strong.map((c) => (
          <LinkRow key={c.address} candidate={c} result={result} onSelect={onSelect} />
        ))}
        {possible.length > 0 && divider("Possible", possible.length)}
        {possible.map((c) => (
          <LinkRow key={c.address} candidate={c} result={result} onSelect={onSelect} />
        ))}
      </CardContent>
    </Card>
  );
}
