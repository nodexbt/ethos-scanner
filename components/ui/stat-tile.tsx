import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Icon, label and a big number; a skeleton until the value arrives. */
export function StatTile({
  icon: Icon,
  label,
  value,
  iconClass = "",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | null | undefined;
  iconClass?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} />
          {label}
        </div>
        <div className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">
          {value != null ? value.toLocaleString() : <Skeleton className="h-7 w-16" />}
        </div>
      </CardContent>
    </Card>
  );
}
