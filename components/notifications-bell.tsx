"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { formatRelativeTime, scanHref } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Item {
  id: number;
  type: "new_links" | "watched_linked";
  investigationId: string | null;
  payload: {
    target?: { profileId: number; displayName: string; username: string | null };
    added?: { displayName: string; confidence: string }[];
    linked?: { displayName: string; confidence: string };
  };
  read: boolean;
  createdAt: string;
}

const POLL_MS = 60_000;

function describe(n: Item): string {
  const t = n.payload.target?.displayName ?? "a profile";
  if (n.type === "new_links") {
    const names = (n.payload.added ?? []).map((a) => a.displayName);
    const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
    return `${t} gained ${names.length} new link${names.length === 1 ? "" : "s"}: ${shown}`;
  }
  const l = n.payload.linked?.displayName ?? "a watched profile";
  const strength = n.payload.linked?.confidence === "high" ? "strong" : "possible";
  return `${l} has a ${strength} link in a scan of ${t}`;
}

/**
 * Header bell: unread badge and a menu of recent in-app alerts. Built on
 * the dropdown primitive, so it closes on Escape, keeps focus inside and
 * is announced. Alerts are marked read when the menu closes, after the
 * user has had a chance to see which ones were new.
 */
export function NotificationsBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);

  const load = async () => {
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setItems(d.items ?? []);
      setUnread(d.unread ?? 0);
    } catch {}
  };

  useEffect(() => {
    // First load is deferred a tick so no state is set synchronously in
    // the effect; afterwards poll on an interval.
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const onOpenChange = (open: boolean) => {
    if (open || unread === 0) return;
    fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    setUnread(0);
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
  };

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}
          className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell className="h-3.5 w-3.5" />
          {unread > 0 && (
            <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-96 w-80 overflow-y-auto">
        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Alerts</div>
        {items.length === 0 ? (
          <p className="px-2 pb-2 text-xs text-muted-foreground">
            Nothing yet. Watch a profile from its scan to get an alert when it gains a new link.
          </p>
        ) : (
          items.map((n) => (
            <DropdownMenuItem key={n.id} asChild className="block">
              <Link href={scanHref(n.payload.target)} className={n.read ? "text-muted-foreground" : "text-foreground"}>
                <span className="block">
                  {!n.read && <span className="sr-only">New: </span>}
                  {describe(n)}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{formatRelativeTime(n.createdAt)}</span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
