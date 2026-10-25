"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { type LogEntry, type ScanProgress } from "@/lib/cluster-scanner";
import type { ResolvedScanTarget } from "@/lib/scan-target";
import { pathForInvestigationId, scanPath } from "@/lib/utils";
import type { InvestigationSummary } from "@/components/scans/scans-list";

/**
 * The user's running scan and app-wide saved-scan data, shared by every
 * signed-in page. Which result is on screen is not kept here: each scan
 * page loads the result for its own address. A scan is "on screen" when
 * the page shows the same investigation, which pages read via `viewing`.
 */

/** What a scan needs to start; built from a resolved target or a loaded result. */
export interface ScanRequest {
  primaryWallet: string;
  investigationId: string;
  /** Canonical address of the result page. */
  path: string;
  /** Shown in the header indicator and toasts, e.g. "@handle". */
  label: string;
}

export interface RunningJob extends ScanRequest {
  logs: LogEntry[];
  progress: ScanProgress | null;
}

interface Summary {
  total: number;
  recent: InvestigationSummary[];
  stats: { strongSum: number; possibleSum: number } | null;
}

interface ScanState {
  job: RunningJob | null;
  /** The last finished scan's log, so its page can still show it collapsed. */
  lastLog: { investigationId: string; logs: LogEntry[] } | null;
  /** Bumped per investigation when its scan finishes, so its page reloads. */
  finished: Record<string, number>;
  /** The last scan that failed (cleared when another starts); pages show it if it is theirs. */
  failure: { investigationId: string; message: string } | null;
  /** Totals and recent scans for the nav badge and the start screen. */
  summary: Summary | null;
  /** Bumped whenever the set of saved scans changes (scan saved, deleted). */
  savedVersion: number;
  /** Bumped after each scan so the header refetches the daily quota. */
  quotaKey: number;
  /** The investigation the scanner currently shows, and the address it uses. */
  viewing: { investigationId: string | null; path: string } | null;
  setViewing: (v: { investigationId: string | null; path: string } | null) => void;
  /** Resolve input, then open its saved result or start a scan. Returns an error message, if any. */
  openOrScan: (input: string) => Promise<string | null>;
  /** Start a scan. Returns an error message if the server refused it. */
  startScan: (req: ScanRequest) => Promise<string | null>;
  notifySavedChanged: () => void;
}

const ScanContext = createContext<ScanState | null>(null);

export function useScan(): ScanState {
  const ctx = useContext(ScanContext);
  if (!ctx) throw new Error("useScan must be used inside ScanProvider");
  return ctx;
}

/** The request for a resolved target. */
export function requestFor(t: ResolvedScanTarget, label?: string): ScanRequest {
  return {
    primaryWallet: t.primaryWallet,
    investigationId: t.investigationId,
    path: scanPath({ username: t.ethos?.username, profileId: t.profileId, wallet: t.primaryWallet }),
    label: label ?? (t.ethos?.username ? `@${t.ethos.username}` : t.primaryWallet),
  };
}

/** Resolve free-form input server-side; throws with a readable message. */
export async function resolveInput(q: string): Promise<ResolvedScanTarget> {
  let resp: Response;
  try {
    resp = await fetch(`/api/resolve?q=${encodeURIComponent(q.trim())}`);
  } catch {
    throw new Error("Could not resolve that address or handle");
  }
  if (resp.ok) return (await resp.json()) as ResolvedScanTarget;
  const data = await resp.json().catch(() => null);
  throw new Error(data?.error || "Could not resolve that address or handle");
}

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [job, setJob] = useState<RunningJob | null>(null);
  const [lastLog, setLastLog] = useState<ScanState["lastLog"]>(null);
  const [finished, setFinished] = useState<Record<string, number>>({});
  const [failure, setFailure] = useState<ScanState["failure"]>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [savedVersion, setSavedVersion] = useState(0);
  const [quotaKey, setQuotaKey] = useState(0);
  const [viewing, setViewing] = useState<ScanState["viewing"]>(null);
  const jobCtl = useRef<AbortController | null>(null);
  // Read inside the polling loop, which outlives renders.
  const viewingRef = useRef(viewing);
  useEffect(() => {
    viewingRef.current = viewing;
  }, [viewing]);

  // Stop polling if the provider goes away (sign out, leaving the app).
  useEffect(() => () => jobCtl.current?.abort(), []);

  // One fetch for the nav total, recent scans and stats, per change in saved scans.
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    let cancelled = false;
    fetch("/api/investigations?limit=5&stats=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setSummary({ total: Number(d.total) || 0, recent: d.rows ?? [], stats: d.stats ?? null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [savedVersion, sessionStatus]);

  /** Poll a job until it ends. Returns true when it finished with a result. */
  const watch = useCallback(async (jobId: string, req: ScanRequest): Promise<void> => {
    jobCtl.current?.abort();
    const ctl = new AbortController();
    jobCtl.current = ctl;
    const MAX_CONSECUTIVE_FAILURES = 5;
    let failures = 0;
    let seenLogs = -1;
    // Slower while the tab is hidden; nobody is watching the log.
    const sleep = () => new Promise((r) => setTimeout(r, document.hidden ? 5000 : 1500));
    let outcome: { ok: true } | { ok: false; message: string } | null = null;
    for (;;) {
      if (ctl.signal.aborted) return;
      let resp: Response | null = null;
      try {
        resp = await fetch(`/api/scan/jobs/${jobId}`, { cache: "no-store", signal: ctl.signal });
      } catch {
        resp = null;
      }
      if (ctl.signal.aborted) return;
      if (!resp || !resp.ok) {
        // A blip (deploy, network) shouldn't abandon a scan that is still
        // running on the server; give up only after several in a row.
        failures++;
        if (resp?.status === 404 || failures >= MAX_CONSECUTIVE_FAILURES) {
          outcome = { ok: false, message: resp?.status === 404 ? "The scan job could not be found. Reload to check its status." : "Lost contact with the running scan. Reload to check its status." };
          break;
        }
        await sleep();
        continue;
      }
      failures = 0;
      const data = await resp.json();
      if (ctl.signal.aborted) return;
      const logs: LogEntry[] = data.logs ?? [];
      // Only re-render consumers when something new arrived.
      if (logs.length !== seenLogs || data.progress) {
        seenLogs = logs.length;
        setJob((j) => (j ? { ...j, logs, progress: data.progress ?? j.progress } : j));
      }
      if (data.status === "done") {
        // Finished but not stored (e.g. a degraded scan never replaces a
        // complete one): the page reloads the previous result, so say why.
        if (data.saved && !data.saved.ok) {
          setFailure({
            investigationId: req.investigationId,
            message:
              data.saved.code === "DEGRADED_NOT_SAVED"
                ? "The new scan was incomplete, so it was not saved. Showing the previous complete result; re-scan once the outage clears."
                : "The new scan could not be saved. Showing the last saved result.",
          });
        }
        outcome = { ok: true };
        setLastLog({ investigationId: data.investigationId ?? req.investigationId, logs });
        break;
      }
      if (data.status === "failed") {
        outcome = { ok: false, message: data.error || "Scan failed" };
        break;
      }
      await sleep();
    }
    jobCtl.current = null;
    setJob(null);
    setQuotaKey((k) => k + 1);
    const onScreen = viewingRef.current?.investigationId === req.investigationId;
    if (outcome?.ok) {
      setFinished((f) => ({ ...f, [req.investigationId]: (f[req.investigationId] ?? 0) + 1 }));
      setSavedVersion((v) => v + 1);
      if (!onScreen) {
        toast.success(`Scan of ${req.label} finished`, { action: { label: "Open", onClick: () => router.push(req.path) } });
      }
    } else if (outcome) {
      setFailure({ investigationId: req.investigationId, message: outcome.message });
      if (!onScreen) toast.error(`Scan of ${req.label} failed: ${outcome.message}`);
    }
  }, [router]);

  const startScan = useCallback(async (req: ScanRequest): Promise<string | null> => {
    let resp: Response;
    try {
      resp = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Scan-Mode": "job" },
        // The server re-resolves the target; the primary wallet identifies it.
        body: JSON.stringify({ target: req.primaryWallet }),
      });
    } catch {
      return "Could not reach the server.";
    }
    if (resp.status !== 202) {
      const data = await resp.json().catch(() => null);
      return data?.error || "The scan could not be started.";
    }
    const { jobId } = (await resp.json().catch(() => ({}))) as { jobId?: string };
    if (!jobId) return "The server accepted the scan but returned no job id.";
    setFailure(null);
    setLastLog(null);
    setJob({ ...req, logs: [], progress: null });
    if (window.location.pathname !== req.path) router.push(req.path, { scroll: false });
    void watch(jobId, req);
    return null;
  }, [router, watch]);

  const openOrScan = useCallback(async (input: string): Promise<string | null> => {
    const value = input.trim();
    if (!value) return "Enter an EVM address (0x...) or an X handle (@name)";
    let target: ResolvedScanTarget;
    try {
      target = await resolveInput(value);
    } catch (e) {
      return (e as Error).message;
    }
    const req = requestFor(target);
    // Saved already? Open it; its page loads the result. Otherwise scan.
    const exists = await fetch(`/api/investigations/${target.investigationId}?fields=share`).then((r) => r.ok).catch(() => false);
    if (exists) {
      router.push(req.path);
      return null;
    }
    return startScan(req);
  }, [router, startScan]);

  // A scan started earlier (another tab, or before a reload) keeps running
  // on the server; re-attach to it. Whether it shows is up to the page.
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/scan/jobs", { cache: "no-store" });
        if (!resp.ok) return;
        const { job: active } = await resp.json();
        if (!active || cancelled || jobCtl.current) return;
        const req: ScanRequest = {
          primaryWallet: "",
          investigationId: active.investigationId,
          path: pathForInvestigationId(active.investigationId),
          label: active.targetInput ?? "",
        };
        setJob({ ...req, logs: [], progress: null });
        void watch(active.id, req);
      } catch {
        // No active job, or not reachable: nothing to resume.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, watch]);

  const notifySavedChanged = useCallback(() => setSavedVersion((v) => v + 1), []);

  const value = useMemo<ScanState>(
    () => ({
      job, lastLog, finished, failure, summary, savedVersion, quotaKey, viewing, setViewing,
      openOrScan, startScan, notifySavedChanged,
    }),
    [job, lastLog, finished, failure, summary, savedVersion, quotaKey, viewing, openOrScan, startScan, notifySavedChanged]
  );
  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}
