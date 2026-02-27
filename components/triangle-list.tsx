"use client";

interface TriangleNode {
  id: string;
  name: string;
  username?: string | null;
}

interface TriangleItem {
  nodes: [TriangleNode, TriangleNode, TriangleNode];
  suspicionScore?: number;
  timeSpanHours?: number | null;
}

interface TriangleListProps {
  triangles: TriangleItem[];
  rootName?: string;
}

export function TriangleList({ triangles, rootName }: TriangleListProps) {
  if (triangles.length === 0) return null;

  const sorted = [...triangles].sort(
    (a, b) => (b.suspicionScore ?? 0) - (a.suspicionScore ?? 0)
  );

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

          return (
            <div
              key={idx}
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5"
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
