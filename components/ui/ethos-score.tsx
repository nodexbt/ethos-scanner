import { cn } from "@/lib/utils";
import { ethosLevel, levelVars } from "@/lib/ethos-levels";
import { EthosScoreIcon } from "@/components/ui/ethos-score-icon";

/**
 * An Ethos score in its level's colour, as on Ethos itself, followed by the
 * Ethos mark. Hover shows the level name.
 */
export function EthosScore({ score, size = 9, className }: { score: number; size?: number; className?: string }) {
  return (
    <span
      className={cn("level-text inline-flex items-center gap-0.5 font-semibold tabular-nums", className)}
      style={levelVars(score)}
      title={`Ethos score ${score} · ${ethosLevel(score).name}`}
    >
      {score}
      <EthosScoreIcon size={size} />
    </span>
  );
}
