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
        "px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white whitespace-nowrap",
        confidence === "high" ? "bg-red-500" : "bg-amber-500",
        className
      )}
    >
      {confidence === "high" ? "strong" : "possible"}
      {score != null && ` · ${score}`}
    </span>
  );
}
