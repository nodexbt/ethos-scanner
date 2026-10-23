"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { type DegradedInfo } from "@/lib/cluster-scanner";

interface DegradedBannerProps {
  degraded?: DegradedInfo;
  /** Extra line, e.g. "not saved over your previous complete scan". */
  notice?: string | null;
  /** Deliberate limits hit during the scan (e.g. a per-chain candidate
      cap). Informational — the scan is complete as designed. */
  coverage?: string[];
}

/**
 * Shown above results when a scan lost a data source mid-way. Without it
 * a scan that hit an Alchemy or Ethos outage looks identical to a clean
 * one, which is the most dangerous outcome for a tool whose "no results"
 * is read as a verdict.
 */
export function DegradedBanner({ degraded, notice, coverage }: DegradedBannerProps) {
  const [open, setOpen] = useState(false);
  const hasCoverage = !!coverage && coverage.length > 0;
  if (!degraded && !notice && !hasCoverage) return null;

  // Coverage notes alone are informational, not a warning.
  if (!degraded && !notice) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground space-y-0.5">
        {coverage!.map((c, i) => (
          <p key={i}>{c}.</p>
        ))}
      </div>
    );
  }

  const failed = degraded?.failedNetworks ?? [];
  const headline = failed.length > 0
    ? `Partial results: ${failed.join(", ")} returned incomplete data.`
    : "Partial results: a lookup failed during this scan.";

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          {degraded && (
            <p className="font-medium text-foreground">{headline}</p>
          )}
          {degraded && (
            <p className="text-xs text-muted-foreground">
              Connections on the affected sources may be missing. Treat an empty result as inconclusive and re-scan later.
            </p>
          )}
          {notice && <p className="text-xs text-foreground">{notice}</p>}
          {hasCoverage && coverage!.map((c, i) => (
            <p key={`c${i}`} className="text-xs text-muted-foreground">{c}.</p>
          ))}
          {degraded && degraded.reasons.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {open ? "Hide details" : `Details (${degraded.reasons.length})`}
            </button>
          )}
          {open && degraded && (
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {degraded.reasons.map((r, i) => (
                <li key={i} className="break-words">{r}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
