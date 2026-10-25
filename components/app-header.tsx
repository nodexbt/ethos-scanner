"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Shield, ShieldCheck, LogOut } from "lucide-react";
import DecryptedText from "@/components/ui/decrypted-text";
import { ThemeToggle } from "@/components/theme-toggle";
import { EthosScoreIcon } from "@/components/ui/ethos-score-icon";
import { NotificationsBell } from "@/components/notifications-bell";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface AppHeaderProps {
  /**
   * When present, the ethos.tools wordmark renders as a <button> that invokes
   * this handler instead of a <Link>. The home page uses it to reset in-page
   * state; other pages leave it undefined so the logo just links back to "/".
   */
  onLogoClick?: () => void;
  /** Primary navigation (tabs) rendered inline between the logo and the
      account controls. Wraps to its own row on narrow screens. */
  nav?: React.ReactNode;
  /** Bump to refetch the daily scan quota (e.g. after a scan completes). */
  quotaKey?: number;
}

interface Quota {
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
}

export function AppHeader({ onLogoClick, nav, quotaKey = 0 }: AppHeaderProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [quota, setQuota] = useState<Quota | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch("/api/scan/quota")
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => {
        if (!cancelled && q) setQuota(q as Quota);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, quotaKey]);
  // @ts-expect-error - isAdmin field added in session callback
  const isAdmin = Boolean(session?.user?.isAdmin);

  const logoContent = (
    <>
      <Shield className="h-4.5 w-4.5 shrink-0" />
      <DecryptedText
        text="ethos.tools"
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
    </>
  );

  const logoClasses =
    "group h-10 flex items-center gap-2 bg-card/70 backdrop-blur-sm border border-border rounded-lg px-3 hover:bg-card/90 hover:border-foreground/30 transition-colors cursor-pointer min-w-0 shrink-0";

  return (
    <div className="flex items-center gap-3 pb-4 flex-wrap">
      {onLogoClick ? (
        <button onClick={onLogoClick} className={logoClasses}>
          {logoContent}
        </button>
      ) : (
        <Link href="/scanner" className={logoClasses}>
          {logoContent}
        </Link>
      )}

      {nav && (
        // Takes the remaining width on large screens and scrolls inside it,
        // so the account controls never wrap to a second row; on narrow
        // screens it drops to its own full-width row.
        <div className="order-last basis-full lg:order-none lg:basis-0 lg:flex-1 min-w-0 overflow-x-auto scrollbar-hide">
          {nav}
        </div>
      )}

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end shrink-0">
        {session && (
          <div className="h-10 flex items-center gap-2 bg-card/70 backdrop-blur-sm border border-border rounded-lg pl-1 pr-1 sm:pr-2">
            {session.user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt=""
                className="h-7 w-7 rounded-md shrink-0"
              />
            ) : (
              <div className="h-7 w-7 rounded-md bg-muted shrink-0" />
            )}
            <div className="hidden sm:flex items-center gap-1.5 text-xs">
              <span className="font-medium truncate max-w-30">
                {session.user?.name || "Admin"}
              </span>
              {/* @ts-expect-error - ethos field added in session callback */}
              {session.user?.ethos?.score !== undefined && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] font-semibold tabular-nums">
                  {/* @ts-expect-error - ethos field added in session callback */}
                  {session.user.ethos.score}
                  <EthosScoreIcon size={9} />
                </span>
              )}
            </div>
            {quota && (
              <Tooltip>
              <TooltipTrigger asChild>
              <span
                className={`hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums ${
                  !quota.unlimited && quota.remaining === 0
                    ? "bg-red-500/15 text-red-500"
                    : !quota.unlimited && quota.remaining <= 5
                      ? "bg-amber-500/15 text-amber-500"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {quota.unlimited ? "∞ scans" : `${quota.remaining} scan${quota.remaining === 1 ? "" : "s"} left`}
              </span>
              </TooltipTrigger>
              <TooltipContent>
                {quota.unlimited ? "Admins have no daily scan limit" : `${quota.used} of ${quota.limit} scans used today · resets 00:00 UTC`}
              </TooltipContent>
              </Tooltip>
            )}
            <NotificationsBell />
            {isAdmin && (
              <Link
                href="/admin/users"
                title="Admin: manage allowlist"
                className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${
                  pathname?.startsWith("/admin")
                    ? "bg-muted text-foreground"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
              </Link>
            )}
            <button
              onClick={() => signOut()}
              title="Sign out"
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <ThemeToggle />
      </div>
    </div>
  );
}
