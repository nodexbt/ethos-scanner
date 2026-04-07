"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { type LogEntry, type ScanProgress } from "@/lib/cluster-scanner";
import { formatTime, getLogColor } from "@/lib/scan-utils";

interface ScanLogProps {
  logs: LogEntry[];
  scanning: boolean;
  progress: ScanProgress | null;
  defaultExpanded?: boolean;
}

const MIN_REMAINING_MS = 1_000;

/**
 * Drives the displayed countdown and percent purely from wall-clock
 * elapsed time vs the server-provided baseline. The server reports
 * `totalEstimatedMs` once at scan start (from a rolling average of
 * recent scan durations) and the client takes over from there: a
 * 250ms interval recomputes `elapsed` and re-renders the countdown.
 *
 * No rate calculation, no spike filter, no per-step recomputation —
 * the math is just `Math.max(MIN, baseline - elapsed)`. The bar and
 * timer move at exactly the rate of real time, monotonically, until
 * the scan ends or the baseline is exceeded (in which case the timer
 * floors at 1s and the bar caps at 99%).
 */
function useElapsedCountdown(
  totalEstimatedMs: number | null,
  scanning: boolean
): { remainingMs: number; percent: number } | null {
  const [state, setState] = useState<{ remainingMs: number; percent: number } | null>(
    null
  );

  // Single effect handles the lifecycle: anchor a start time, run a
  // 250ms interval that recomputes the state, tear it all down when
  // scanning ends. Date.now() is only called inside the interval
  // callback (not during render) to satisfy the react-hooks purity
  // rule about impure-functions-in-render.
  useEffect(() => {
    if (!scanning || totalEstimatedMs === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(null);
      return;
    }
    const start = Date.now();
    // Set initial state immediately so the bar renders at 0% from the
    // moment the scan begins, instead of waiting 250ms for the first
    // interval tick. The interval callback then takes over from here.
    setState({ remainingMs: totalEstimatedMs, percent: 0 });
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const remainingMs = Math.max(MIN_REMAINING_MS, totalEstimatedMs - elapsed);
      const percent = Math.min(99, Math.round((elapsed / totalEstimatedMs) * 100));
      setState({ remainingMs, percent });
    }, 250);
    return () => clearInterval(interval);
  }, [scanning, totalEstimatedMs]);

  return state;
}

export function ScanLog({ logs, scanning, progress, defaultExpanded = true }: ScanLogProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const countdown = useElapsedCountdown(
    progress?.totalEstimatedMs ?? null,
    scanning
  );

  // Auto-scroll to the bottom whenever new log entries arrive while a
  // scan is in progress. Only runs while scanning so a user reviewing
  // a finished scan can scroll up freely without getting yanked back.
  useEffect(() => {
    if (!scanning || !expanded) return;
    const el = logContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, scanning, expanded]);

  if (logs.length === 0) return null;

  return (
    <Card>
      <CardHeader className={expanded ? "pb-2" : ""}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight cursor-pointer hover:text-foreground/80 transition-colors w-full"
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : (expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
          Scan Log
          {scanning && countdown && (
            <span className="text-xs font-normal text-muted-foreground ml-auto tabular-nums">
              {countdown.percent}% &middot; ~{formatTime(countdown.remainingMs)} left
            </span>
          )}
          {!scanning && logs.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground ml-auto">
              {logs.length} entries
            </span>
          )}
        </button>
        {scanning && countdown && (
          <div className="w-full bg-muted rounded-full h-1.5 mt-1">
            <div
              className="bg-primary h-1.5 rounded-full transition-[width] duration-200 ease-linear"
              style={{ width: `${countdown.percent}%` }}
            />
          </div>
        )}
      </CardHeader>
      {expanded && (
        <CardContent>
          <div
            ref={logContainerRef}
            className="bg-muted/50 rounded-lg p-3 max-h-[60vh] overflow-y-auto font-mono text-xs space-y-0.5"
          >
            {logs.map((entry, i) => (
              <div key={i} className={getLogColor(entry.level)}>
                {entry.message}
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
