"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Watch / unwatch a profile. Self-contained: loads its own state so any
 * surface (overview card, lists) can drop it in with just a profile id.
 * Watching a profile queues in-app alerts when a scan links it to a new
 * profile, or when it is newly linked in someone else's scan.
 */
export function WatchButton({ profileId, className = "" }: { profileId: number; className?: string }) {
  const [watching, setWatching] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/watchlist?profileId=${profileId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setWatching(Boolean(d.watching));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const toggle = async () => {
    if (watching === null || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, watch: !watching }),
      });
      if (r.ok) setWatching(!watching);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={watching === null || busy}
      title={watching ? "Stop watching this profile" : "Get an alert when this profile gains a new link"}
      className={cn(
        "h-7 px-2 inline-flex items-center gap-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer disabled:cursor-default",
        watching ? "text-foreground bg-muted hover:bg-muted/70" : "hover:bg-muted",
        className
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : watching ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      {watching ? "Watching" : "Watch"}
    </button>
  );
}
