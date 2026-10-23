"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

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

function scanHref(target?: { username: string | null; profileId: number }) {
  if (!target) return "/";
  return `/scan/x/${target.username ?? target.profileId}`;
}

function describe(n: Item): string {
  const t = n.payload.target?.displayName ?? "a profile";
  if (n.type === "new_links") {
    const names = (n.payload.added ?? []).map((a) => a.displayName);
    const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
    return `${t} gained ${names.length} new link${names.length === 1 ? "" : "s"}: ${shown}`;
  }
  const l = n.payload.linked?.displayName ?? "a watched profile";
  const strength = n.payload.linked?.confidence === "high" ? "strong" : "possible";
  return `${l} was linked (${strength}) in a scan of ${t}`;
}

/** Header bell: unread badge, dropdown of recent in-app alerts. */
export function NotificationsBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
      setUnread(0);
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    }
  };

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={toggle}
        title="Alerts for profiles you watch"
        className="h-7 w-7 relative flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <Bell className="h-3.5 w-3.5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-semibold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-80 max-h-96 overflow-y-auto rounded-lg border border-border bg-background shadow-xl p-1">
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">Alerts</div>
          {items.length === 0 ? (
            <div className="px-2 pb-2 text-xs text-muted-foreground">
              Nothing yet. Watch a profile from its scan overview to get alerted when it gains a new link.
            </div>
          ) : (
            items.map((n) => (
              <Link
                key={n.id}
                href={scanHref(n.payload.target)}
                onClick={() => setOpen(false)}
                className={`block rounded-md px-2 py-1.5 text-xs hover:bg-muted ${n.read ? "text-muted-foreground" : "text-foreground"}`}
              >
                <div>{describe(n)}</div>
                <div className="text-[10px] text-muted-foreground/70 mt-0.5">{formatRelativeTime(n.createdAt)}</div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
