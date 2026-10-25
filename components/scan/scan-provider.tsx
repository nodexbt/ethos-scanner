"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { type ClusterScanResult, type LogEntry, type ScanProgress } from "@/lib/cluster-scanner";
import type { ResolvedScanTarget } from "@/lib/scan-target";
import { describeSignal, scoringSignals } from "@/lib/scan-utils";

/**
 * The scan in progress and the result on screen, shared by every signed-in
 * page. It lives in the app layout, so a running scan keeps polling (and
 * the header can show it) while the user browses Scans or Network.
 */
interface ScanState {
  input: string;
  setInput: (v: string) => void;
  scanning: boolean;
  /** Loading a saved result (no new scan). */
  loadingCached: boolean;
  error: string | null;
  result: ClusterScanResult | null;
  logs: LogEntry[];
  progress: ScanProgress | null;
  investigationId: string | null;
  scannedAt: string | null;
  saveNotice: string | null;
  /** The /scan/... address of the result on screen, if any. */
  resultPath: string | null;
  /** Bumped whenever saved scans change (scan saved, deleted, shared). */
  savedVersion: number;
  /** Bumped after each scan so the header refetches the daily quota. */
  quotaKey: number;
  /** Resolve free-form input; open its saved result or run a fresh scan. */
  scanInput: (input: string) => Promise<void>;
  /** Open a /scan/... deep link without scanning unless nothing is saved. */
  openFromUrl: (input: string) => Promise<void>;
  rescan: (input: string) => Promise<void>;
  exportEvidence: () => void;
  /** Clear the result and input (logo click). */
  reset: () => void;
  /** Call after saved scans change elsewhere (delete, share). */
  notifySavedChanged: (deletedId?: string) => void;
}

const ScanContext = createContext<ScanState | null>(null);

export function useScan(): ScanState {
  const ctx = useContext(ScanContext);
  if (!ctx) throw new Error("useScan must be used inside ScanProvider");
  return ctx;
}

/** For components that also render outside the signed-in layout. */
export function useScanOptional(): ScanState | null {
  return useContext(ScanContext);
}

/** Address of a resolved target's result page. */
export function scanPathFor(target: { ethos?: { username?: string | null } | null; primaryWallet: string }): string {
  return target.ethos?.username ? `/scan/x/${target.ethos.username}` : `/scan/${target.primaryWallet.toLowerCase()}`;
}

/** Address of a finished result, for scans resumed without a resolved target. */
function pathOfResult(result: ClusterScanResult): string {
  const username = result.targetEthos?.username;
  return username ? `/scan/x/${username}` : `/scan/${result.target.toLowerCase()}`;
}

const isScannerPath = (p: string) => p === "/scanner" || p.startsWith("/scan/");

/** Sets come over the wire as arrays. */
function hydrateResult(raw: unknown): ClusterScanResult {
  const { scanDurationMs: _dur, ...rest } = raw as ClusterScanResult & { scanDurationMs?: number };
  void _dur;
  const result = rest as ClusterScanResult;
  for (const c of [...result.strongCluster, ...result.possibleCluster]) {
    c.signalTypes = new Set(c.signalTypes as unknown as string[]);
  }
  return result;
}

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [input, setInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [loadingCached, setLoadingCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClusterScanResult | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [investigationId, setInvestigationId] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState(0);
  const [quotaKey, setQuotaKey] = useState(0);
  const watchingRef = useRef(false);

  /** Point the address bar at the result, but never pull the user off another page. */
  const showResultAt = useCallback(
    (path: string, mode: "push" | "replace") => {
      setResultPath(path);
      if (window.location.pathname === path || !isScannerPath(window.location.pathname)) return;
      if (mode === "push") router.push(path, { scroll: false });
      else router.replace(path, { scroll: false });
    },
    [router]
  );

  // Resolve free-form input (0x address, @handle, x.com / Ethos profile
  // URL) server-side. Returns null and sets the error when nothing matches.
  const resolveTarget = async (raw: string): Promise<ResolvedScanTarget | null> => {
    try {
      const resp = await fetch(`/api/resolve?q=${encodeURIComponent(raw.trim())}`);
      if (resp.ok) return (await resp.json()) as ResolvedScanTarget;
      const data = await resp.json().catch(() => null);
      setError(data?.error || "Could not resolve that address or handle");
    } catch {
      setError("Could not resolve that address or handle");
    }
    return null;
  };

  const loadSaved = async (target: ResolvedScanTarget, mode: "push" | "replace"): Promise<boolean> => {
    setLoadingCached(true);
    try {
      const resp = await fetch(`/api/investigations/${target.investigationId}`);
      if (resp.ok) {
        const data = await resp.json();
        setResult(data.clusterResult);
        setInvestigationId(target.investigationId);
        setScannedAt(data.updatedAt ?? null);
        setSaveNotice(null);
        setLogs([]);
        setProgress(null);
        setError(null);
        showResultAt(scanPathFor(target), mode);
        return true;
      }
    } catch {
      // Fall through to "not saved".
    } finally {
      setLoadingCached(false);
    }
    return false;
  };

  /** Turn the server's save outcome into the on-screen notice. */
  const applySaved = (saved: { ok: boolean; code?: string } | null) => {
    setScannedAt(new Date().toISOString());
    if (!saved || saved.ok) setSaveNotice(null);
    else if (saved.code === "DEGRADED_NOT_SAVED")
      setSaveNotice("Not saved: this incomplete scan would have replaced a complete one. The previous result is kept; re-scan once the outage clears.");
    else setSaveNotice("Not saved: the server could not store the result. Results are shown for this session only.");
  };

  /** Poll a background scan job until it finishes. */
  const watchJob = async (jobId: string): Promise<{ result: ClusterScanResult; investigationId: string } | null> => {
    const POLL_MS = 1500;
    const MAX_CONSECUTIVE_FAILURES = 5;
    let failures = 0;
    watchingRef.current = true;
    try {
      for (;;) {
        let resp: Response | null = null;
        try {
          resp = await fetch(`/api/scan/jobs/${jobId}`, { cache: "no-store" });
        } catch {
          resp = null;
        }
        if (!resp || !resp.ok) {
          // A blip (deploy, network) shouldn't abandon a scan that is still
          // running on the server; give up only after several in a row.
          failures++;
          if (resp?.status === 404 || failures >= MAX_CONSECUTIVE_FAILURES) {
            setError(resp?.status === 404 ? "The scan job could not be found. Reload to check its status." : "Lost contact with the running scan. Reload to check its status.");
            return null;
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
          continue;
        }
        failures = 0;
        const job = await resp.json();
        setLogs(job.logs ?? []);
        if (job.progress) setProgress(job.progress);
        if (job.status === "done") {
          const r = hydrateResult(job.result);
          setResult(r);
          applySaved(job.saved);
          return { result: r, investigationId: job.investigationId as string };
        }
        if (job.status === "failed") {
          setError(job.error || "Scan failed");
          return null;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } finally {
      watchingRef.current = false;
    }
  };

  const finishScan = (done: { investigationId: string; result?: ClusterScanResult } | null, path: string | null) => {
    if (done) {
      setInvestigationId(done.investigationId);
      const to = path ?? (done.result ? pathOfResult(done.result) : null);
      if (to) showResultAt(to, "replace");
      setSavedVersion((v) => v + 1);
    }
    setScanning(false);
    setProgress(null);
    setQuotaKey((k) => k + 1);
  };

  const runFreshScan = async (target: ResolvedScanTarget) => {
    setScanning(true);
    setResult(null);
    setScannedAt(null);
    setSaveNotice(null);
    setLogs([]);
    setProgress(null);
    setError(null);
    setInvestigationId(null);
    setResultPath(null);

    let done: { investigationId: string } | null = null;
    try {
      const resp = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Scan-Mode": "job" },
        // The server re-resolves the target; the primary wallet identifies it.
        body: JSON.stringify({ target: target.primaryWallet }),
      });

      if (!resp.ok && resp.status !== 202) {
        const data = await resp.json().catch(() => null);
        setError(data?.error || "Scan failed");
        return;
      }

      if (resp.status === 202) {
        const { jobId } = (await resp.json().catch(() => ({}))) as { jobId?: string };
        if (!jobId) {
          setError("The server accepted the scan but returned no job id.");
          return;
        }
        done = await watchJob(jobId);
      } else {
        // Streaming fallback for servers without the scan_jobs table.
        const reader = resp.body?.getReader();
        if (!reader) {
          setError("Streaming not supported");
          return;
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let streamed: ClusterScanResult | null = null;
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "log") setLogs((prev) => [...prev, msg.data]);
              else if (msg.type === "progress") setProgress(msg.data);
              else if (msg.type === "result") {
                streamed = hydrateResult(msg.data);
                setResult(streamed);
              } else if (msg.type === "saved") applySaved(msg.data);
              else if (msg.type === "error") setError(msg.data);
            } catch {
              // Skip malformed lines.
            }
          }
        }
        if (streamed) done = { investigationId: target.investigationId };
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cluster scan failed");
    } finally {
      finishScan(done, done ? scanPathFor(target) : null);
    }
  };

  const scanInput = async (raw: string) => {
    const value = raw.trim();
    setInput(value);
    if (!value) {
      setError("Enter an EVM address (0x...) or an X handle (@name)");
      return;
    }
    setError(null);
    const resolved = await resolveTarget(value);
    if (!resolved) return;
    if (await loadSaved(resolved, "push")) return;
    await runFreshScan(resolved);
  };

  const openFromUrl = async (raw: string) => {
    setInput(raw);
    setError(null);
    setLoadingCached(true);
    const resolved = await resolveTarget(raw);
    if (!resolved) {
      setLoadingCached(false);
      setResultPath(window.location.pathname);
      return;
    }
    // Deep links never start a paid scan on their own: show the saved
    // result, or leave the input filled in for the user to confirm.
    if (!(await loadSaved(resolved, "replace"))) {
      setResult(null);
      setResultPath(window.location.pathname);
    }
  };

  const rescan = async (raw: string) => {
    const resolved = await resolveTarget(raw);
    if (resolved) await runFreshScan(resolved);
  };

  const reset = () => {
    setResult(null);
    setLogs([]);
    setProgress(null);
    setInput("");
    setError(null);
    setInvestigationId(null);
    setResultPath(null);
    setSaveNotice(null);
  };

  const notifySavedChanged = (deletedId?: string) => {
    setSavedVersion((v) => v + 1);
    if (deletedId && deletedId === investigationId) setInvestigationId(null);
  };

  const exportEvidence = () => {
    if (!result) return;
    const all = [...result.strongCluster, ...result.possibleCluster];
    let prompt = `Draft a slash report for the following subject based on the evidence provided.\n\n`;
    prompt += `## Subject\n`;
    prompt += `- Wallet: ${result.target}\n`;
    if (result.targetEthos) {
      prompt += `- Ethos Profile: ${result.targetEthos.displayName}`;
      if (result.targetEthos.username) prompt += ` (@${result.targetEthos.username})`;
      prompt += `\n- Ethos Profile URL: ${result.targetEthos.profileUrl}`;
      prompt += `\n- Credibility Score: ${result.targetEthos.score}\n`;
    }
    prompt += `\n## On-Chain Evidence\n`;
    prompt += `- Networks scanned: ${Object.keys(result.networkStats).join(", ")}\n`;
    prompt += `- Total transactions analyzed: ${Object.values(result.networkStats).reduce((s, n) => s + n.txCount, 0)}\n`;
    prompt += `- Strong links: ${result.strongCluster.length}\n`;
    prompt += `- Possible links: ${result.possibleCluster.length}\n\n`;
    if (all.length > 0) {
      prompt += `### Linked Profiles\n`;
      for (const c of all) {
        const name = c.ethosProfile
          ? `${c.ethosProfile.displayName}${c.ethosProfile.username ? ` (@${c.ethosProfile.username})` : ""}`
          : c.address;
        prompt += `\n${name}\n`;
        prompt += `- Address: ${c.address}\n`;
        prompt += `- Link: ${c.confidence === "high" ? "strong" : "possible"} (link strength ${c.score})\n`;
        if (c.ethosProfile) {
          prompt += `- Ethos Profile URL: ${c.ethosProfile.profileUrl}\n`;
          prompt += `- Credibility Score: ${c.ethosProfile.score}\n`;
        }
        prompt += `- Active on: ${c.networks.join(", ")}\n`;
        const scored = scoringSignals(c);
        if (scored.length > 0) prompt += `- Why linked: ${scored.map((s) => `${describeSignal(s, c, result).title} (+${s.score})`).join("; ")}\n`;
        if (c.directCount > 0) {
          // Counts are from the subject's side: outgoing = the subject sent.
          prompt += `- Direct transfers with subject (context, not scored): ${c.directCount} (subject sent ${c.outgoingCount}, received ${c.incomingCount})\n`;
        }
        if (c.sharedFundingSources.length > 0) prompt += `- Shared incoming senders (not first funders): ${c.sharedFundingSources.length}\n`;
      }
    }
    const name = result.targetEthos?.username || result.target.slice(0, 10);
    const blob = new Blob([prompt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `slash-evidence-${name}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Evidence file downloaded");
  };

  // A scan started earlier (another tab, or before a reload) keeps running
  // on the server; pick it up so the user sees it finish. Keyed on the auth
  // status: next-auth hands out a new session object on every window focus.
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/scan/jobs", { cache: "no-store" });
        if (!resp.ok) return;
        const { job } = await resp.json();
        if (!job || cancelled || watchingRef.current) return;
        setScanning(true);
        setInput(job.targetInput ?? "");
        setResult(null);
        setError(null);
        const done = await watchJob(job.id);
        if (cancelled) return;
        finishScan(done, null);
      } catch {
        // No active job, or not reachable: nothing to resume.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus]);

  const value: ScanState = {
    input, setInput, scanning, loadingCached, error, result, logs, progress, investigationId, scannedAt,
    saveNotice, resultPath, savedVersion, quotaKey, scanInput, openFromUrl, rescan, exportEvidence, reset,
    notifySavedChanged,
  };
  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}
