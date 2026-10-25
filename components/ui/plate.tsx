import { cn } from "@/lib/utils";

/**
 * Backing for text that would otherwise sit straight on the dithered
 * background (section headings, list column headers, the footer).
 * Deliberately unlike a Card: no border, more opaque, tighter corners,
 * so it reads as a label rather than another panel.
 */
export function Plate({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-md bg-background/80 backdrop-blur-md", className)} {...props} />;
}
