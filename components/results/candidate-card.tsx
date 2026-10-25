"use client";

import { memo } from "react";
import { type ClusterCandidate, type ClusterScanResult } from "@/lib/cluster-scanner";
import { getScoreBorderColor, buildConnectionSummary } from "@/lib/scan-utils";
import { HumanVerifiedBadge } from "@/components/ui/human-verified-badge";
import { EthosScoreIcon } from "@/components/ui/ethos-score-icon";
import { AvatarImg } from "@/components/ui/avatar-img";

interface CandidateCardProps {
  candidate: ClusterCandidate;
  result: ClusterScanResult;
  // Optional — when omitted (e.g. on the public share page) the card renders
  // as a static read-only block instead of a clickable modal trigger.
  // Takes the candidate (rather than a per-card closure) so callers can pass
  // a stable handler and memo() actually skips re-renders.
  onSelect?: (candidate: ClusterCandidate) => void;
}

export const CandidateCard = memo(function CandidateCard({
  candidate,
  result,
  onSelect,
}: CandidateCardProps) {
  // A real <button> when it opens the evidence dialog, so keyboard and
  // screen-reader users can reach it; a plain block on read-only pages.
  // The card holds no other interactive elements, so nesting is safe.
  const Wrapper = onSelect ? "button" : "div";
  return (
    <Wrapper
      {...(onSelect && {
        type: "button" as const,
        onClick: () => onSelect(candidate),
        "aria-haspopup": "dialog" as const,
      })}
      className={`block w-full text-left rounded-lg border border-border p-3 space-y-2.5 ${
        onSelect
          ? "cursor-pointer hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          : ""
      }`}
    >
      <div className="flex items-start gap-3">
        {candidate.ethosProfile?.avatarUrl && (
          <AvatarImg
            src={candidate.ethosProfile.avatarUrl}
            name={candidate.ethosProfile.displayName}
            className={`h-10 w-10 rounded-full ring-2 shrink-0 ${getScoreBorderColor(candidate.ethosProfile.score)}`}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm inline-flex items-center gap-1">
                {candidate.ethosProfile?.displayName || `${candidate.address.slice(0, 10)}...${candidate.address.slice(-6)}`}
                {candidate.ethosProfile?.humanVerified && <HumanVerifiedBadge />}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                candidate.confidence === "high" ? "bg-red-500 text-white" : "bg-amber-500 text-white"
              }`}>
                link strength {candidate.score}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground shrink-0">
              {candidate.networks.join(", ")}
            </div>
          </div>
          {candidate.ethosProfile && (
            <div className="text-xs text-muted-foreground inline-flex items-center gap-0.5 flex-wrap">
              {candidate.ethosProfile.username && (
                <span>{`@${candidate.ethosProfile.username} · `}</span>
              )}
              <span className="inline-flex items-center gap-0.5">
                Ethos score: {candidate.ethosProfile.score}
                <EthosScoreIcon size={9} className="ml-0.5" />
              </span>
              {candidate.wallets && candidate.wallets.length > 1 && (
                <span>{` · ${candidate.wallets.length} wallets`}</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        {buildConnectionSummary(candidate, result).map((line, i) => (
          <div key={i} className="flex gap-1.5">
            <span className="text-muted-foreground shrink-0">-</span>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </Wrapper>
  );
});
