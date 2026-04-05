"use client";

import { type ClusterCandidate, type ClusterScanResult } from "@/lib/cluster-scanner";
import { getScoreBorderColor, buildConnectionSummary } from "@/lib/scan-utils";

interface CandidateCardProps {
  candidate: ClusterCandidate;
  result: ClusterScanResult;
  onClick: () => void;
}

export function CandidateCard({ candidate, result, onClick }: CandidateCardProps) {
  return (
    <div
      onClick={onClick}
      className="rounded-lg border border-border p-3 space-y-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-start gap-3">
        {candidate.ethosProfile?.avatarUrl && (
          <img
            src={candidate.ethosProfile.avatarUrl}
            alt={candidate.ethosProfile.displayName}
            className={`h-10 w-10 rounded-full ring-2 shrink-0 ${getScoreBorderColor(candidate.ethosProfile.score)}`}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">
                {candidate.ethosProfile?.displayName || `${candidate.address.slice(0, 10)}...${candidate.address.slice(-6)}`}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                candidate.confidence === "high" ? "bg-red-500 text-white" : "bg-amber-500 text-white"
              }`}>
                score: {candidate.score}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground shrink-0">
              {candidate.networks.join(", ")}
            </div>
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
        {buildConnectionSummary(candidate, result).map((line, i) => (
          <div key={i} className="flex gap-1.5">
            <span className="text-muted-foreground shrink-0">-</span>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
