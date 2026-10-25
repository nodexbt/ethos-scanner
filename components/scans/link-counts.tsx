import { cn } from "@/lib/utils";

/** "4 strong · 5 possible" as tinted pills, matching the link badges. */
export function LinkCounts({ strong, possible, className }: { strong: number; possible: number; className?: string }) {
  if (strong === 0 && possible === 0) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)} title="The scan found no on-chain links. That is not proof the profile is independent.">
        No links
      </span>
    );
  }
  const pill = "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset whitespace-nowrap";
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {strong > 0 && <span className={cn(pill, "bg-red-500/15 text-red-600 ring-red-500/40 dark:text-red-400")}>{strong} strong</span>}
      {possible > 0 && <span className={cn(pill, "bg-amber-500/15 text-amber-700 ring-amber-500/40 dark:text-amber-400")}>{possible} possible</span>}
    </span>
  );
}
