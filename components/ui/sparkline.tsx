interface SparklineProps {
  points: (number | null)[];
  width?: number;
  height?: number;
  className?: string;
  strokeWidth?: number;
}

/**
 * Minimal inline-SVG line chart. Null points are treated as gaps — the line
 * breaks rather than interpolating — so an "absent day" in profile_daily
 * doesn't get plotted as a zero.
 */
export function Sparkline({
  points,
  width = 240,
  height = 48,
  className,
  strokeWidth = 1.5,
}: SparklineProps) {
  const defined = points.filter((p): p is number => p != null);
  if (defined.length < 2) {
    return (
      <div
        className={`flex items-center justify-center text-[10px] text-muted-foreground ${className ?? ""}`}
        style={{ width, height }}
      >
        Not enough data
      </div>
    );
  }

  const min = Math.min(...defined);
  const max = Math.max(...defined);
  const range = max - min || 1;

  // Break the path into separate segments wherever we hit a null, so gaps
  // render as literal gaps rather than a line connecting across them.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p == null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    const x = points.length === 1 ? width / 2 : (i / (points.length - 1)) * width;
    const y = height - ((p - min) / range) * (height - strokeWidth * 2) - strokeWidth;
    current.push(`${current.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      {segments.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
