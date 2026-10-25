"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Globe, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ShareState {
  isPublic: boolean;
  shareId: string | null;
  canManage: boolean;
}

/**
 * Share a saved scan. Sharing makes the full result readable by anyone
 * with the link, so it is an explicit step that says so, and it can be
 * undone. Every outcome is reported, including failures.
 */
export function ShareDialog({
  investigationId,
  open,
  onOpenChange,
  onChanged,
}: {
  investigationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after sharing is turned on or off, e.g. to refresh lists. */
  onChanged?: () => void;
}) {
  // Keyed by investigation so reopening for another scan starts fresh.
  const [loaded, setLoaded] = useState<{ id: string; state: ShareState | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const current = loaded?.id === investigationId ? loaded : null;
  const state = current?.state ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/investigations/${investigationId}?fields=share`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "This scan is not saved, so it can't be shared yet." : "Could not load sharing settings.");
        return (await r.json()) as ShareState;
      })
      .then((s) => !cancelled && setLoaded({ id: investigationId, state: s, error: null }))
      .catch((e: Error) => !cancelled && setLoaded({ id: investigationId, state: null, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [open, investigationId]);

  const shareUrl = state?.shareId ? `${window.location.origin}/s/${state.shareId}` : null;

  const setPublic = async (makePublic: boolean) => {
    setBusy(true);
    setActionError(null);
    try {
      const r = await fetch(`/api/investigations/${investigationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public: makePublic }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? "Something went wrong");
      setLoaded({ id: investigationId, state: { isPublic: d.isPublic, shareId: d.shareId, canManage: true }, error: null });
      toast.success(makePublic ? "Public link created" : "Stopped sharing. The link no longer works.");
      setCopied(false);
      onChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setActionError("Couldn't copy automatically. Select the link and copy it.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setActionError(null);
          setCopied(false);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {state?.isPublic ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            Share this scan
          </DialogTitle>
          <DialogDescription>
            A shared scan can be opened by anyone with the link, without signing in. They see every linked
            profile and the evidence behind each link.
          </DialogDescription>
        </DialogHeader>

        {!current ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : current.error ? (
          <p className="text-sm text-red-600 dark:text-red-500">{current.error}</p>
        ) : state && !state.canManage && !state.isPublic ? (
          <p className="text-sm text-muted-foreground">Only the person who ran this scan, or an admin, can share it.</p>
        ) : state?.isPublic && shareUrl ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} className="h-9 font-mono text-xs" aria-label="Share link" />
              <Button type="button" size="sm" variant="outline" onClick={copy} className="shrink-0">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">This scan is public. Stop sharing to make the link stop working.</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">This scan is private.</p>
        )}

        {actionError && <p className="text-sm text-red-600 dark:text-red-500">{actionError}</p>}

        {state?.canManage && (
          <DialogFooter>
            {state.isPublic ? (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setPublic(false)}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Stop sharing
              </Button>
            ) : (
              <Button type="button" size="sm" disabled={busy} onClick={() => setPublic(true)}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Create public link
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
