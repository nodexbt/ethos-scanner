"use client";

import { ChevronLeft, ChevronRight, ExternalLink, Search, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AvatarImg } from "@/components/ui/avatar-img";
import { HumanVerifiedBadge } from "@/components/ui/human-verified-badge";
import { ConfidencePill } from "@/components/ui/confidence-pill";
import { type ClusterCandidate, type ClusterScanResult, type Signal } from "@/lib/cluster-scanner";
import {
  describeSignal,
  formatFunderAmount,
  getExplorerAddressUrl,
  resolveAddressName,
  scoringSignals,
  shortAddress,
  targetLabel,
} from "@/lib/scan-utils";
import { safeExternalUrl } from "@/lib/utils";
import { AddressDisplay } from "./address-display";
import { EthosScore } from "@/components/ui/ethos-score";
import { levelVars } from "@/lib/ethos-levels";

interface CandidateModalProps {
  /** The candidate to show. Stays the last opened one while `open` is
      false so the close animation has content to render. */
  candidate: ClusterCandidate;
  open: boolean;
  result: ClusterScanResult;
  onClose: () => void;
  /** Where this candidate sits in the visible list, for previous/next. */
  position?: { index: number; total: number } | null;
  onPrev?: () => void;
  onNext?: () => void;
  /** Scan the linked profile. Omitted on read-only pages. */
  onScanProfile?: (input: string) => void;
}

const MAX_SENDERS_SHOWN = 5;

/**
 * The evidence behind one link: scoring signals first and in plain
 * English, then context that never changes the score, then first funders.
 */
export function CandidateModal({ candidate, open, result, onClose, position, onPrev, onNext, onScanProfile }: CandidateModalProps) {
  const e = candidate.ethosProfile;
  const name = e?.displayName || shortAddress(candidate.address);
  const t = targetLabel(result);
  const wallets = candidate.wallets?.length ? candidate.wallets : [candidate.address];
  const scoring = scoringSignals(candidate);
  const canStep = !!position && position.total > 1;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100%-2rem)] max-w-2xl max-h-[95vh] sm:max-h-[85vh] overflow-y-auto p-0 gap-0 rounded-xl sm:rounded-xl"
        onKeyDown={(ev) => {
          if (!canStep) return;
          if (ev.key === "ArrowRight") { ev.preventDefault(); onNext?.(); }
          if (ev.key === "ArrowLeft") { ev.preventDefault(); onPrev?.(); }
        }}
      >
        <DialogDescription className="sr-only">
          Evidence behind the link between {name} and {t}.
        </DialogDescription>

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-background p-4 sm:p-5 rounded-t-xl">
          <AvatarImg
            src={e?.avatarUrl}
            name={e?.displayName}
            className={`h-12 w-12 rounded-full shrink-0 text-base ${e ? "level-ring ring-2" : ""}`}
            style={e ? levelVars(e.score) : undefined}
          />
          <div className="min-w-0 flex-1">
            <DialogTitle asChild>
              <h2 className="text-lg font-semibold leading-tight flex flex-wrap items-center gap-1.5 break-words">
                {name}
                {e?.humanVerified && <HumanVerifiedBadge size={16} />}
              </h2>
            </DialogTitle>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-sm text-muted-foreground">
              {e?.username && <span>@{e.username}</span>}
              {e && (
                <span className="inline-flex items-center gap-1">
                  Ethos score <EthosScore score={e.score} />
                </span>
              )}
              <span>{candidate.networks.join(", ")}</span>
            </div>
            <div className="mt-1.5">
              <ConfidencePill confidence={candidate.confidence === "high" ? "high" : "medium"} score={candidate.score} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {canStep && (
              <>
                <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={onPrev} aria-label="Previous linked profile">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="hidden sm:inline min-w-12 text-center text-xs text-muted-foreground tabular-nums">
                  {position!.index + 1} of {position!.total}
                </span>
                <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={onNext} aria-label="Next linked profile">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
            <DialogClose className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-muted transition-colors cursor-pointer" aria-label="Close">
              <X className="h-4 w-4" />
            </DialogClose>
          </div>
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          {/* Next steps */}
          <div className="flex flex-wrap gap-2">
            {onScanProfile && (
              <Button size="sm" className="h-8 text-xs" onClick={() => onScanProfile(e?.username ? `@${e.username}` : candidate.address)}>
                <Search className="h-3.5 w-3.5" />
                Scan {e?.displayName?.split(" ")[0] || "this wallet"}
              </Button>
            )}
            {e?.profileUrl && (
              <Button asChild variant="outline" size="sm" className="h-8 text-xs bg-transparent">
                <a href={safeExternalUrl(e.profileUrl)} target="_blank" rel="noopener noreferrer">
                  Ethos profile <ExternalLink className="h-3 w-3 opacity-60" />
                </a>
              </Button>
            )}
            <Button asChild variant="outline" size="sm" className="h-8 text-xs bg-transparent">
              <a href={`https://x.com/search?q=${encodeURIComponent(wallets.join(" OR "))}&f=live`} target="_blank" rel="noopener noreferrer">
                Search X <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            </Button>
            {wallets.map((w) => (
              <Button key={w} asChild variant="outline" size="sm" className="h-8 text-xs font-mono bg-transparent">
                <a href={getExplorerAddressUrl(w, candidate.networks[0])} target="_blank" rel="noopener noreferrer">
                  {shortAddress(w)} <ExternalLink className="h-3 w-3 opacity-60" />
                </a>
              </Button>
            ))}
          </div>

          {/* Scoring evidence */}
          <section>
            <h3 className="mb-2 flex items-baseline justify-between text-sm font-semibold">
              Why they&apos;re linked
              <span className="text-xs font-normal text-muted-foreground">{candidate.score} points</span>
            </h3>
            <div className="space-y-1.5">
              {scoring.length === 0 && (
                <p className="text-sm text-muted-foreground">No scoring signals. This profile is shown for context only.</p>
              )}
              {scoring.map((s, i) => (
                <ScoringSignal key={`${s.type}-${i}`} signal={s} candidate={candidate} result={result} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Strong: first funded by {t} or a linked wallet, or 15+ points across two signal types. Possible: 8+ points.
            </p>
          </section>

          {/* Context */}
          <ContextSection candidate={candidate} result={result} name={name} />

          {/* First funders */}
          {candidate.firstFunders && candidate.firstFunders.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">First funders</h3>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-1 text-xs">
                {candidate.firstFunders.map((ff, i) => (
                  <div key={`${ff.chain}-${i}`} className="flex items-center gap-3 border-t border-border py-1.5 first:border-t-0">
                    <span className="w-16 shrink-0 text-muted-foreground">{ff.chain}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <AddressDisplay address={ff.funder} chain={ff.chain} result={result} />
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{formatFunderAmount(ff)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScoringSignal({ signal, candidate, result }: { signal: Signal; candidate: ClusterCandidate; result: ClusterScanResult }) {
  const text = describeSignal(signal, candidate, result);
  const own = candidate.wallets?.length ? candidate.wallets : [candidate.address];
  return (
    <div className="flex items-baseline gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <span className="w-8 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">+{signal.score}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{text.title}</div>
        <div className="text-xs text-muted-foreground">{text.detail}</div>

        {signal.type === "shared_incoming_sender" && candidate.sharedFundingSources.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {candidate.sharedFundingSources.slice(0, MAX_SENDERS_SHOWN).map((addr) => (
              <li key={addr}><AddressDisplay address={addr} result={result} /></li>
            ))}
            {candidate.sharedFundingSources.length > MAX_SENDERS_SHOWN && (
              <li className="text-muted-foreground">and {candidate.sharedFundingSources.length - MAX_SENDERS_SHOWN} more</li>
            )}
          </ul>
        )}

        {signal.type === "shared_cex_deposit" && (candidate.sharedCexDeposits?.length ?? 0) > 0 && (
          <ul className="mt-1.5 space-y-1 text-xs">
            {candidate.sharedCexDeposits!.map((dep, i) => {
              const others = dep.wallets.filter((w) => !own.includes(w)).map((w) => resolveAddressName(w, result));
              return (
                <li key={i} className="text-muted-foreground">
                  {dep.exchange} deposit address{" "}
                  <a href={getExplorerAddressUrl(dep.depositAddress, dep.network)} target="_blank" rel="noopener noreferrer" className="font-mono text-foreground hover:underline">
                    {shortAddress(dep.depositAddress)}
                  </a>{" "}
                  on {dep.network}
                  {others.length > 0 && <>, also used by {others.join(", ")}</>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ContextSection({ candidate, result, name }: { candidate: ClusterCandidate; result: ClusterScanResult; name: string }) {
  const t = targetLabel(result);
  const items: React.ReactNode[] = [];

  if (candidate.directCount > 0) {
    // Counts are from the scanned profile's side: outgoing = it sent.
    const n = candidate.directCount;
    let line = `${n} transfer${n === 1 ? "" : "s"} directly between them`;
    if (candidate.outgoingCount > 0 && candidate.incomingCount > 0) {
      line += `: ${t} sent ${candidate.outgoingCount} and received ${candidate.incomingCount}`;
    } else if (candidate.outgoingCount > 0) {
      line += `, all sent by ${t}`;
    } else {
      line += `, all sent to ${t}`;
    }
    items.push(`${line}.`);
  }
  if (candidate.invitedByTarget) items.push(`${t} invited ${name} to Ethos.`);
  if (candidate.invitedTarget) items.push(`${name} invited ${t} to Ethos.`);
  for (const type of ["mutual_reviews", "mutual_vouches"] as const) {
    const flag = type === "mutual_reviews" ? candidate.mutualReviews : candidate.mutualVouches;
    if (!flag) continue;
    const verb = type === "mutual_reviews" ? "reviewed" : "vouched for";
    const signal = candidate.signals.find((s) => s.type === type);
    items.push(
      <>
        They {verb} each other on Ethos.
        {signal?.mutual && <MutualLinks signal={signal} kind={type === "mutual_reviews" ? "review" : "vouch"} targetName={t} candidateName={name} />}
      </>
    );
  }
  if (items.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 flex items-baseline justify-between text-sm font-semibold">
        Context
        <span className="text-xs font-normal text-muted-foreground">not scored</span>
      </h3>
      <ul className="text-sm text-muted-foreground">
        {items.map((item, i) => (
          <li key={i} className="border-t border-border py-1.5 first:border-t-0">{item}</li>
        ))}
      </ul>
    </section>
  );
}

function formatActivityDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Both directions of a mutual review or vouch, with date and archived state. */
function MutualLinks({ signal, kind, targetName, candidateName }: { signal: Signal; kind: "review" | "vouch"; targetName: string; candidateName: string }) {
  if (!signal.mutual) return null;
  const rows = [
    { label: `${targetName}'s ${kind}`, ref: signal.mutual.fromTarget },
    { label: `${candidateName}'s ${kind}`, ref: signal.mutual.fromCandidate },
  ];
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {rows.map((row, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {row.ref.url ? (
            <a href={safeExternalUrl(row.ref.url)} target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2 hover:no-underline">
              {row.label}
            </a>
          ) : (
            <span>{row.label}</span>
          )}
          {row.ref.date > 0 && <span>{formatActivityDate(row.ref.date)}</span>}
          {row.ref.archived && <span className="rounded border border-border px-1 text-[11px] uppercase tracking-wide">{kind === "vouch" ? "withdrawn" : "archived"}</span>}
        </span>
      ))}
    </span>
  );
}
