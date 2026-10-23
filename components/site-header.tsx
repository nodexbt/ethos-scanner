"use client";

import Link from "next/link";
import { Shield, ArrowRight } from "lucide-react";
import DecryptedText from "@/components/ui/decrypted-text";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Header for pages outside the signed-in app (share links, public
 * profile pages): wordmark linking home, a call to action, theme toggle.
 */
export function SiteHeader({ cta = "Run your own scan" }: { cta?: string | null }) {
  return (
    <div className="flex items-center justify-between pb-4">
      <Link
        href="/"
        className="group h-10 flex items-center gap-2 bg-card/70 backdrop-blur-sm border border-border rounded-lg px-3 hover:bg-card/90 hover:border-foreground/30 transition-colors min-w-0"
      >
        <Shield className="h-4.5 w-4.5 shrink-0" />
        <DecryptedText
          text="Ethos Scanner"
          speed={40}
          maxIterations={12}
          sequential
          revealDirection="start"
          animateOn="hover"
          replayInterval={30000}
          useOriginalCharsOnly={false}
          parentClassName="font-[family-name:var(--font-ibm-plex-mono)] font-semibold text-base tracking-tight"
          className="text-foreground"
          encryptedClassName="text-muted-foreground"
        />
      </Link>
      <div className="flex items-center gap-2">
        {cta && (
          <Link
            href="/"
            className="h-10 hidden sm:inline-flex items-center gap-1.5 bg-card/70 backdrop-blur-sm border border-border rounded-lg px-3 text-xs font-medium hover:bg-card/90 hover:border-foreground/30 transition-colors"
          >
            {cta}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
        <ThemeToggle />
      </div>
    </div>
  );
}
