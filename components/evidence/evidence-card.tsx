"use client";

import { useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Search, ExternalLink, ImagePlus, X, ClipboardPaste } from "lucide-react";
import { type ClusterScanResult } from "@/lib/cluster-scanner";
import { HumanVerifiedBadge } from "@/components/ui/human-verified-badge";

interface EvidenceCardProps {
  result: ClusterScanResult;
  screenshots: Map<string, string>;
  onScreenshotUpload: (address: string, file: File) => void;
  onScreenshotRemove: (address: string) => void;
  onPaste: (address: string) => void;
}

export function EvidenceCard({
  result,
  screenshots,
  onScreenshotUpload,
  onScreenshotRemove,
  onPaste,
}: EvidenceCardProps) {
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const allCandidates = [...result.strongCluster, ...result.possibleCluster];
  if (allCandidates.length === 0) return null;

  const entries = [
    { address: result.target, label: "Target" as string | null, ethosProfile: result.targetEthos, confidence: null as string | null, score: null as number | null },
    ...allCandidates.map((c) => ({
      address: c.address,
      label: null as string | null,
      ethosProfile: c.ethosProfile,
      confidence: c.confidence as string | null,
      score: c.score as number | null,
    })),
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="h-5 w-5 text-muted-foreground" />
          X/Twitter Evidence
        </CardTitle>
        <CardDescription className="text-xs">
          Search X for each wallet address, then attach screenshots of the results. Generate an AI analysis prompt when done.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {entries.map((entry) => (
          <div key={entry.address} className="rounded-lg border border-border p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <a
                href={`https://x.com/search?q=%22${entry.address}%22&f=live`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs hover:underline flex-1 min-w-0"
              >
                <Search className="h-3 w-3 text-muted-foreground shrink-0" />
                {entry.label ? (
                  <span className="font-medium">{entry.label}</span>
                ) : entry.ethosProfile ? (
                  <span className="truncate inline-flex items-center gap-1">
                    {entry.ethosProfile.displayName}
                    {entry.ethosProfile.humanVerified && <HumanVerifiedBadge size={12} />}
                    {entry.ethosProfile.username && <span className="text-muted-foreground"> @{entry.ethosProfile.username}</span>}
                  </span>
                ) : (
                  <span className="font-mono truncate">{entry.address.slice(0, 14)}...{entry.address.slice(-6)}</span>
                )}
                <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
              </a>
              {entry.score !== null && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                  entry.confidence === "high" ? "bg-red-500 text-white" : "bg-amber-500 text-white"
                }`}>
                  {entry.score}
                </span>
              )}
              {!screenshots.has(entry.address) ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onPaste(entry.address)}
                    className="p-1.5 rounded hover:bg-muted transition-colors cursor-pointer"
                    title="Paste screenshot from clipboard"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => fileInputRefs.current.get(entry.address)?.click()}
                    className="p-1.5 rounded hover:bg-muted transition-colors cursor-pointer"
                    title="Upload screenshot"
                  >
                    <ImagePlus className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  <input
                    ref={(el) => { if (el) fileInputRefs.current.set(entry.address, el); }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onScreenshotUpload(entry.address, file);
                      e.target.value = "";
                    }}
                  />
                </div>
              ) : (
                <button
                  onClick={() => onScreenshotRemove(entry.address)}
                  className="p-1.5 rounded hover:bg-muted transition-colors cursor-pointer shrink-0"
                  title="Remove screenshot"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
            {screenshots.has(entry.address) && (
              <div className="relative">
                <img
                  src={screenshots.get(entry.address)}
                  alt={`X search results for ${entry.address}`}
                  className="rounded border border-border w-full max-h-48 object-cover object-top"
                />
                <div className="absolute top-1 right-1 bg-green-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-medium">
                  attached
                </div>
              </div>
            )}
          </div>
        ))}

        <div className="text-[10px] text-muted-foreground">
          Click the search icon to open X, then paste or upload a screenshot. If 2+ accounts posted the same address, it&apos;s likely a sybil cluster.
        </div>
      </CardContent>
    </Card>
  );
}
