"use client";

import { useState, useRef } from "react";
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

export function ScanLog({ logs, scanning, progress, defaultExpanded = true }: ScanLogProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const logEndRef = useRef<HTMLDivElement>(null);

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
          {scanning && progress && (
            <span className="text-xs font-normal text-muted-foreground ml-auto">
              {progress.percent}%
              {progress.estimatedRemaining !== null && (
                <> &middot; ~{formatTime(progress.estimatedRemaining)} left</>
              )}
            </span>
          )}
          {!scanning && logs.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground ml-auto">
              {logs.length} entries
            </span>
          )}
        </button>
        {scanning && progress && (
          <div className="w-full bg-muted rounded-full h-1.5 mt-1">
            <div
              className="bg-primary h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        )}
      </CardHeader>
      {expanded && (
        <CardContent>
          <div className="bg-muted/50 rounded-lg p-3 max-h-[60vh] overflow-y-auto font-mono text-xs space-y-0.5">
            {logs.map((entry, i) => (
              <div key={i} className={getLogColor(entry.level)}>
                {entry.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
