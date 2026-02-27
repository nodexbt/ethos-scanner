"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface TriangleNode {
  id: string;
  name: string;
  username?: string | null;
}

interface TriangleItem {
  nodes: [TriangleNode, TriangleNode, TriangleNode];
  suspicionScore?: number;
  timeSpanHours?: number | null;
  suspiciousReasons?: string[];
}

interface TriangleListProps {
  triangles: TriangleItem[];
  rootName?: string;
}

export function TriangleList({ triangles, rootName }: TriangleListProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (triangles.length === 0) return null;

  const sorted = [...triangles].sort(
    (a, b) => (b.suspicionScore ?? 0) - (a.suspicionScore ?? 0)
  );

  const toggle = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="font-mono text-xs text-muted-foreground mb-0.5">
        [TRIANGLE_LIST]
      </div>
      <div className="font-semibold text-sm text-foreground mb-4">
        ALL TRIANGLE PATTERNS
      </div>
      <div className="space-y-2">
        {sorted.map((triangle, idx) => {
          const num = String(idx + 1).padStart(3, "0");
          const cycle = [...triangle.nodes, triangle.nodes[0]];
          const reasons = triangle.suspiciousReasons ?? [];
          const timeSpan = triangle.timeSpanHours;
          const isOpen = expanded.has(idx);
          const hasDetails = reasons.length > 0 || timeSpan != null;

          return (
            <div
              key={idx}
              className="rounded-lg border border-border bg-muted/40"
            >
              <button
                onClick={() => hasDetails && toggle(idx)}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left ${
                  hasDetails ? "cursor-pointer" : "cursor-default"
                }`}
              >
                <span className="font-mono text-xs text-muted-foreground shrink-0">
                  [{num}]
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {cycle.map((node, i) => {
                    const isRoot =
                      rootName != null &&
                      (node.name === rootName ||
                        node.username === rootName);
                    const isLast = i === cycle.length - 1;

                    return (
                      <span key={`${node.id}-${i}`} className="flex items-center gap-1.5">
                        <span
                          className={`inline-block rounded px-2.5 py-1 text-xs font-medium ${
                            isRoot
                              ? "bg-background text-foreground border border-border shadow-sm"
                              : "bg-muted-foreground/15 text-muted-foreground"
                          }`}
                        >
                          {node.name}
                        </span>
                        {!isLast && (
                          <span className="text-muted-foreground/50 text-xs">→</span>
                        )}
                      </span>
                    );
                  })}
                </div>
                {hasDetails && (
                  <ChevronDown
                    className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                )}
              </button>
              {isOpen && hasDetails && (
                <div className="border-t border-border px-3 py-2.5 space-y-2">
                  {timeSpan != null && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium">Time span:</span>
                      <span className="font-mono">
                        {timeSpan < 24
                          ? `${timeSpan.toFixed(1)} hours`
                          : `${(timeSpan / 24).toFixed(1)} days`}
                      </span>
                    </div>
                  )}
                  {reasons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {reasons.map((reason, i) => (
                        <span
                          key={i}
                          className="inline-block rounded bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-500"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
