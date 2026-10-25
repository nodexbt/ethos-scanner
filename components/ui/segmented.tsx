"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * One option in a segmented control (header tabs, list scope chips).
 * The wrapper decides the size; this decides active/inactive styling.
 */
export function SegmentedTab({
  active,
  onClick,
  icon: Icon,
  children,
  size = "md",
  className,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center rounded-md transition-colors cursor-pointer whitespace-nowrap font-medium",
        size === "md" ? "h-8 gap-2 px-3 text-sm" : "h-8 gap-1.5 px-2.5 text-xs",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        className
      )}
    >
      {Icon && <Icon className={size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} />}
      {children}
    </button>
  );
}

/** Pill count shown inside a SegmentedTab. */
export function SegmentedCount({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  if (value <= 0) return null;
  return size === "md" ? (
    <span className="text-xs bg-background/70 border border-border px-1.5 py-0.5 rounded-full tabular-nums">{value.toLocaleString()}</span>
  ) : (
    <span className="tabular-nums text-[11px] text-muted-foreground">{value.toLocaleString()}</span>
  );
}

/**
 * A SegmentedTab that navigates: a real link, so middle-click and "open in
 * new tab" work and the current page is announced.
 */
export function SegmentedLink({
  href,
  active,
  icon: Icon,
  children,
  className,
}: {
  href: string;
  active: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        className
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </Link>
  );
}
