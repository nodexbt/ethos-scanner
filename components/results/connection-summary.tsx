"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddressDisplay } from "./address-display";
import { type ClusterScanResult } from "@/lib/cluster-scanner";
import { CONNECTION_TYPES, connectionPhrase, formatFunderAmount, targetLabel } from "@/lib/scan-utils";

/**
 * How the linked profiles connect, as counts per scoring signal. Each count
 * filters the link list. Context signals are summarised on one quiet line,
 * since they never change a score.
 */
export function HowTheyConnect({
  result,
  filter,
  onFilter,
}: {
  result: ClusterScanResult;
  filter: string | null;
  onFilter: (type: string | null) => void;
}) {
  const all = [...result.strongCluster, ...result.possibleCluster];
  if (all.length === 0) return null;
  const t = targetLabel(result);
  const counts = CONNECTION_TYPES.map((type) => ({
    type,
    n: all.filter((c) => c.signals.some((s) => s.type === type && s.score > 0)).length,
  })).filter((x) => x.n > 0);
  const invited = all.filter((c) => c.invitedByTarget || c.invitedTarget).length;
  const reviews = all.filter((c) => c.mutualReviews).length;
  const vouches = all.filter((c) => c.mutualVouches).length;
  const context = [
    invited > 0 && `${invited} invited by or invited ${t}`,
    reviews > 0 && `${reviews} reviewed each other on Ethos`,
    vouches > 0 && `${vouches} vouched for each other`,
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">How they connect</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-border bg-muted/30 p-1">
          {counts.map(({ type, n }) => (
            <button
              key={type}
              type="button"
              aria-pressed={filter === type}
              onClick={() => onFilter(filter === type ? null : type)}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted aria-pressed:bg-muted cursor-pointer"
            >
              <span className="min-w-6 font-semibold tabular-nums">{n}</span>
              <span>{connectionPhrase(type, t)}</span>
            </button>
          ))}
          {context.length > 0 && (
            <p className="mx-2.5 mt-1 border-t border-border pt-2 pb-1.5 text-xs text-muted-foreground">
              Context, not scored: {context.join(" · ")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** The scanned profile's own first funders, one per chain. */
export function TargetFirstFunders({ result }: { result: ClusterScanResult }) {
  const funders = result.targetFirstFunders ?? [];
  if (funders.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{targetLabel(result)}&apos;s first funders</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-1 text-xs">
          {funders.map((ff, i) => (
            <div key={`${ff.chain}-${i}`} className="flex items-center gap-3 border-t border-border py-1.5 first:border-t-0">
              <span className="w-16 shrink-0 text-muted-foreground">{ff.chain}</span>
              <span className="min-w-0 flex-1 truncate">
                <AddressDisplay address={ff.funder} chain={ff.chain} result={result} />
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{formatFunderAmount(ff)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
