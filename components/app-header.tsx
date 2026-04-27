"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Shield, ShieldCheck, LineChart, LogOut, Search } from "lucide-react";
import DecryptedText from "@/components/ui/decrypted-text";
import { ThemeToggle } from "@/components/theme-toggle";

interface AppHeaderProps {
  /**
   * When present, the Ethos Scanner logo renders as a <button> that invokes
   * this handler instead of a <Link>. The home page uses it to reset in-page
   * state; other pages leave it undefined so the logo just links back to "/".
   */
  onLogoClick?: () => void;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Treat as active when pathname starts with this prefix, falls back to href. */
  matchPrefix?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Scanner", icon: Search, matchPrefix: "exact" },
  { href: "/monitoring", label: "Monitoring", icon: LineChart, matchPrefix: "/monitoring" },
];

function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false;
  if (item.matchPrefix === "exact") return pathname === item.href;
  return pathname.startsWith(item.matchPrefix ?? item.href);
}

export function AppHeader({ onLogoClick }: AppHeaderProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  // @ts-expect-error - isAdmin field added in session callback
  const isAdmin = Boolean(session?.user?.isAdmin);

  const logoContent = (
    <>
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
    </>
  );

  const logoClasses =
    "group h-10 flex items-center gap-2 bg-card/70 backdrop-blur-sm border border-border rounded-lg px-3 hover:bg-card/90 hover:border-foreground/30 transition-colors cursor-pointer min-w-0 shrink-0";

  return (
    <div className="flex items-center justify-between gap-3 pb-4">
      {onLogoClick ? (
        <button onClick={onLogoClick} className={logoClasses}>
          {logoContent}
        </button>
      ) : (
        <Link href="/" className={logoClasses}>
          {logoContent}
        </Link>
      )}

      {/* Primary nav. Pill-styled to match the logo and session containers
          so all three sit at the same visual weight in the header. */}
      <nav className="hidden sm:flex h-10 items-center gap-1 bg-card/70 backdrop-blur-sm border border-border rounded-lg p-1 shrink-0">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`h-8 inline-flex items-center gap-1.5 px-3 text-sm rounded-md transition-colors ${
                active
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end shrink-0">
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
                <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-semibold tabular-nums">
                  {/* @ts-expect-error - ethos field added in session callback */}
                  {session.user.ethos.score}
                </span>
              )}
            </div>
            {/* Mobile-only nav: under sm the main nav is hidden, so surface
                Monitoring as an icon in the session pill there. */}
            <Link
              href="/monitoring"
              title="Monitoring dashboard"
              className={`sm:hidden h-7 w-7 flex items-center justify-center rounded transition-colors ${
                pathname?.startsWith("/monitoring")
                  ? "bg-muted text-foreground"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
              }`}
            >
              <LineChart className="h-3.5 w-3.5" />
            </Link>
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
