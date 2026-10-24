import { Shield, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Site footer shared by the landing page, the signed-in app, and the
 * public share page. Keep this the single place for the builder credit
 * and the Ethos link so copy stays consistent.
 */
export function AppFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "mt-8 pt-6 border-t border-border flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] text-muted-foreground",
        className
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <Shield className="h-3.5 w-3.5" />
        ethos.tools
        <span aria-hidden="true">·</span>
        <a
          href="https://x.com/nodexbt"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground hover:underline"
        >
          built by @nodexbt
        </a>
      </span>
      <a
        href="https://app.ethos.network/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
      >
        Built for Ethos Network
        <ArrowRight className="h-3 w-3" />
      </a>
    </footer>
  );
}
