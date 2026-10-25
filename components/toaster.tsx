"use client";

import { MotionConfig } from "framer-motion";
import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/components/theme-provider";

/** One place for small confirmations ("Link copied", "Scan deleted"). */
export function Toaster() {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      toastOptions={{ classNames: { toast: "!bg-background !text-foreground !border-border !shadow-xl" } }}
    />
  );
}

/** Framer animations follow the OS "reduce motion" setting. */
export function ReducedMotion({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
