"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FolderOpen, Loader2, Network, Search } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/app-footer";
import { SegmentedCount, SegmentedLink } from "@/components/ui/segmented";
import { ScanProvider, useScan } from "@/components/scan/scan-provider";

/**
 * Frame for every signed-in page: sign-in gate, header with navigation,
 * the shared scan state, and the footer. Signed-out visitors are sent to
 * /sign-in and brought back to the address they opened.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status !== "unauthenticated") return;
    const here = window.location.pathname + window.location.search;
    router.replace(`/sign-in?callbackUrl=${encodeURIComponent(here)}`);
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ScanProvider>
      <Frame>{children}</Frame>
    </ScanProvider>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const scan = useScan();
  const router = useRouter();
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-xl"
      >
        Skip to content
      </a>
      <AppHeader
        quotaKey={scan.quotaKey}
        nav={<NavTabs />}
        onLogoClick={() => {
          scan.reset();
          router.push("/scanner");
        }}
      />
      {/* The root layout owns <main>; this is the skip-link target. */}
      <div id="main" tabIndex={-1} className="outline-none">
        {children}
      </div>
      <AppFooter />
    </div>
  );
}

function NavTabs() {
  const pathname = usePathname() ?? "";
  const scan = useScan();
  const [scanTotal, setScanTotal] = useState(0);

  // Total for the Scans tab badge; refreshed whenever saved scans change.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/investigations?limit=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setScanTotal(Number(d.total) || 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scan.savedVersion]);

  const onScanner = pathname === "/scanner" || pathname.startsWith("/scan/");
  // Return to the result on screen rather than an empty scanner.
  const scannerHref = scan.resultPath ?? "/scanner";

  return (
    <nav aria-label="Main" className="flex items-center gap-2">
      <div className="inline-flex h-10 items-center gap-1 rounded-lg border border-border bg-card/70 p-1 backdrop-blur-sm">
        <SegmentedLink href={scannerHref} icon={Search} active={onScanner}>
          Scanner
        </SegmentedLink>
        <SegmentedLink href="/scans" icon={FolderOpen} active={pathname === "/scans"}>
          Scans
          <SegmentedCount value={scanTotal} />
        </SegmentedLink>
        <SegmentedLink href="/network" icon={Network} active={pathname === "/network"}>
          Network
        </SegmentedLink>
      </div>
      {/* A scan running off-screen: elsewhere in the app, or behind another result. */}
      {scan.scanning && !(onScanner && scan.screenIsScan) && (
        <button
          type="button"
          onClick={scan.showRunningScan}
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card/70 px-3 text-xs text-muted-foreground backdrop-blur-sm hover:text-foreground"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="max-w-[12rem] truncate">Scanning {scan.jobLabel || "…"}</span>
        </button>
      )}
    </nav>
  );
}
