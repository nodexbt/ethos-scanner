import { cn } from "@/lib/utils";

/** "strong · 15" / "possible · 8" badge used wherever a link is summarised. */
export function ConfidencePill({
  confidence,
  score,
  className,
}: {
  confidence: "high" | "medium";
  score?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset",
        confidence === "high"
          ? "bg-red-500/15 text-red-600 ring-red-500/40 dark:text-red-400"
          : "bg-amber-500/15 text-amber-700 ring-amber-500/40 dark:text-amber-400",
        className
      )}
    >
      {confidence === "high" ? "strong" : "possible"}
      {score != null && ` · ${score}`}
    </span>
  );
}
