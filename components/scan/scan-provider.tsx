"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { type ClusterScanResult, type LogEntry, type ScanProgress } from "@/lib/cluster-scanner";
import type { ResolvedScanTarget } from "@/lib/scan-target";
import { describeSignal, scoringSignals } from "@/lib/scan-utils";

/**
 * The running scan and the result on screen, shared by every signed-in page.
 * It lives in the app layout, so a running scan keeps polling (and the
 * header can show it) while the user browses Scans or Network.
 *
 * Two things are kept apart on purpose:
 * - the job: the one scan this user has running (label, logs, progress);
 * - the screen: the result the scanner shows.
 * The job owns the screen only while `screenIsScan` is true. Opening any
 * other result takes the screen and leaves the job running in the
 * background; when it finishes the user gets a toast instead of being moved.
 *
 * Every screen change takes a generation number. A load that resolves after
 * a newer one started is dropped, so slow requests can't overwrite the
 * result (or the URL) the user moved on to.
 */
interface ScanState {
  /** Text in the scan box. */
  input: string;
  setInput: (v: string) => void;
  /** A scan of this user's is running (on screen or in the background). */
  scanning: boolean;
  /** What the running scan was started for, for the header indicator. */
  jobLabel: string;
  /** The running or just-finished scan is what the scanner shows. */
  screenIsScan: boolean;
  /** Loading a saved result. */
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
  /** Open a /scan/... deep link. Never starts a scan on its own. */
  openFromUrl: (input: string) => Promise<void>;
  rescan: (input: string) => Promise<void>;
  exportEvidence: () => Promise<void>;
  /** Clear the screen (logo click). A running scan continues in the background. */
  reset: () => void;
  /** Bring a background scan back onto the screen. */
  showRunningScan: () => void;
  /** Call after saved scans change elsewhere (delete, share). */
  notifySavedChanged: (deletedId?: string) => void;
}

const ScanContext = createContext<ScanState | null>(null);

export function useScan(): ScanState {
  const ctx = useContext(ScanContext);
  if (!ctx) throw new Error("useScan must be used inside ScanProvider");
  return ctx;
}

/** Address of a resolved target's result page. */
export function scanPathFor(target: { profileId?: number | null; ethos?: { username?: string | null } | null; primaryWallet: string }): string {
  if (target.ethos?.username) return `/scan/x/${target.ethos.username}`;
  if (target.profileId != null) return `/scan/p/${target.profileId}`;
  return `/scan/${target.primaryWallet.toLowerCase()}`;
}

/** Address of a finished result, for scans resumed without a resolved target. */
function pathOfResult(result: ClusterScanResult): string {
  const username = result.targetEthos?.username;
  if (username) return `/scan/x/${username}`;
  if (result.targetProfileId != null) return `/scan/p/${result.targetProfileId}`;
  return `/scan/${result.target.toLowerCase()}`;
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

const SAVE_NOTICE: Record<string, string> = {
  DEGRADED_NOT_SAVED: "Not saved: this incomplete scan would have replaced a complete one. The previous result is kept; re-scan once the outage clears.",
};
const saveNoticeFor = (saved: { ok: boolean; code?: string } | null) =>
  !saved || saved.ok ? null : SAVE_NOTICE[saved.code ?? ""] ?? "Not saved: the server could not store the result. Results are shown for this session only.";

type JobOutcome = { result: ClusterScanResult; investigationId: string; saved: { ok: boolean; code?: string } | null };

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [input, setInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [jobLabel, setJobLabel] = useState("");
  const [screenIsScan, setScreenIsScanState] = useState(false);
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

  const screenGen = useRef(0);
  const screenIsScanRef = useRef(false);
  const jobCtl = useRef<AbortController | null>(null);

  const setScreenIsScan = (v: boolean) => {
    screenIsScanRef.current = v;
    setScreenIsScanState(v);
  };
  /** Take the screen for a new load; any older in-flight load becomes stale. */
  const claimScreen = (forScan: boolean) => {
    screenGen.current += 1;
    setScreenIsScan(forScan);
    return screenGen.current;
  };
  const isCurrent = (gen: number) => gen === screenGen.current;

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

  // Stop polling if the provider goes away (sign out, leaving the app).
  useEffect(() => () => jobCtl.current?.abort(), []);

  /** Resolve free-form input server-side; throws with a readable message. */
  const resolveTarget = async (raw: string): Promise<ResolvedScanTarget> => {
    let resp: Response;
    try {
      resp = await fetch(`/api/resolve?q=${encodeURIComponent(raw.trim())}`);
    } catch {
      throw new Error("Could not resolve that address or handle");
    }
    if (resp.ok) return (await resp.json()) as ResolvedScanTarget;
    const data = await resp.json().catch(() => null);
    throw new Error(data?.error || "Could not resolve that address or handle");
  };

  /** Show a saved result. "stale" means a newer screen change won. */
  const loadSaved = async (target: ResolvedScanTarget, mode: "push" | "replace", gen: number): Promise<"loaded" | "missing" | "stale"> => {
    setLoadingCached(true);
    try {
      const resp = await fetch(`/api/investigations/${target.investigationId}`);
      if (!isCurrent(gen)) return "stale";
      if (!resp.ok) return "missing";
      const data = await resp.json();
      if (!isCurrent(gen)) return "stale";
      setResult(data.clusterResult);
      setInvestigationId(target.investigationId);
      setScannedAt(data.updatedAt ?? null);
      setSaveNotice(null);
      setError(null);
      if (target.ethos?.username) setInput(`@${target.ethos.username}`);
      showResultAt(scanPathFor(target), mode);
      return "loaded";
    } catch {
      return isCurrent(gen) ? "missing" : "stale";
    } finally {
      if (isCurrent(gen)) setLoadingCached(false);
    }
  };

  /** Poll a background scan job until it finishes, fails, or is aborted. */
  const watchJob = async (jobId: string): Promise<JobOutcome | null> => {
    jobCtl.current?.abort();
    const ctl = new AbortController();
    jobCtl.current = ctl;
    const POLL_MS = 1500;
    const MAX_CONSECUTIVE_FAILURES = 5;
    let failures = 0;
    const sleep = () => new Promise((r) => setTimeout(r, POLL_MS));
    for (;;) {
      if (ctl.signal.aborted) return null;
      let resp: Response | null = null;
      try {
        resp = await fetch(`/api/scan/jobs/${jobId}`, { cache: "no-store", signal: ctl.signal });
      } catch {
        resp = null;
      }
      if (ctl.signal.aborted) return null;
      if (!resp || !resp.ok) {
        // A blip (deploy, network) shouldn't abandon a scan that is still
        // running on the server; give up only after several in a row.
        failures++;
        if (resp?.status === 404 || failures >= MAX_CONSECUTIVE_FAILURES) {
          setError(resp?.status === 404 ? "The scan job could not be found. Reload to check its status." : "Lost contact with the running scan. Reload to check its status.");
          return null;
        }
        await sleep();
        continue;
      }
      failures = 0;
      const job = await resp.json();
      if (ctl.signal.aborted) return null;
      setLogs(job.logs ?? []);
      if (job.progress) setProgress(job.progress);
      if (job.status === "done") {
        return { result: hydrateResult(job.result), investigationId: job.investigationId as string, saved: job.saved ?? null };
      }
      if (job.status === "failed") {
        setError(job.error || "Scan failed");
        return null;
      }
      await sleep();
    }
  };

  /** Apply a finished scan: on screen if it still owns the screen, else as a toast. */
  const finishScan = (outcome: JobOutcome | null, label: string) => {
    if (jobCtl.current?.signal.aborted) return;
    jobCtl.current = null;
    setScanning(false);
    setProgress(null);
    setQuotaKey((k) => k + 1);
    if (!outcome) return;
    setSavedVersion((v) => v + 1);
    const path = pathOfResult(outcome.result);
    if (screenIsScanRef.current) {
      setResult(outcome.result);
      setInvestigationId(outcome.investigationId);
      setScannedAt(new Date().toISOString());
      setSaveNotice(saveNoticeFor(outcome.saved));
      showResultAt(path, "replace");
    } else {
      toast.success(`Scan of ${label || outcome.result.targetEthos?.displayName || "your target"} finished`, {
        action: { label: "Open", onClick: () => router.push(path) },
      });
    }
  };

  /** Streaming fallback for servers without the scan_jobs table. */
  const readStream = async (resp: Response, investigationIdForTarget: string): Promise<JobOutcome | null> => {
    const reader = resp.body?.getReader();
    if (!reader) {
      setError("Streaming not supported");
      return null;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let streamed: ClusterScanResult | null = null;
    let saved: JobOutcome["saved"] = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "log") setLogs((prev) => [...prev, msg.data]);
          else if (msg.type === "progress") setProgress(msg.data);
          else if (msg.type === "result") streamed = hydrateResult(msg.data);
          else if (msg.type === "saved") saved = msg.data;
          else if (msg.type === "error") setError(msg.data);
        } catch {
          // Skip malformed lines.
        }
      }
    }
    return streamed ? { result: streamed, investigationId: investigationIdForTarget, saved } : null;
  };

  const runFreshScan = async (target: ResolvedScanTarget, label: string) => {
    claimScreen(true);
    setScanning(true);
    setJobLabel(label);
    setResult(null);
    setScannedAt(null);
    setSaveNotice(null);
    setLogs([]);
    setProgress(null);
    setError(null);
    setInvestigationId(null);
    setResultPath(null);

    let outcome: JobOutcome | null = null;
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
        outcome = await watchJob(jobId);
      } else {
        outcome = await readStream(resp, target.investigationId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cluster scan failed");
    } finally {
      finishScan(outcome, label);
    }
  };

  const scanInput = async (raw: string) => {
    const value = raw.trim();
    setInput(value);
    if (!value) {
      setError("Enter an EVM address (0x...) or an X handle (@name)");
      return;
    }
    const gen = claimScreen(false);
    setError(null);
    let resolved: ResolvedScanTarget;
    try {
      resolved = await resolveTarget(value);
    } catch (e) {
      if (isCurrent(gen)) setError((e as Error).message);
      return;
    }
    if (!isCurrent(gen)) return;
    const outcome = await loadSaved(resolved, "push", gen);
    if (outcome !== "missing" || !isCurrent(gen)) return;
    await runFreshScan(resolved, value);
  };

  const openFromUrl = async (raw: string) => {
    const gen = claimScreen(false);
    setInput(raw.startsWith("@") || raw.startsWith("0x") ? raw : "");
    setError(null);
    setResult(null);
    setLoadingCached(true);
    let resolved: ResolvedScanTarget;
    try {
      resolved = await resolveTarget(raw);
    } catch (e) {
      if (!isCurrent(gen)) return;
      setLoadingCached(false);
      setError((e as Error).message);
      setResultPath(window.location.pathname);
      return;
    }
    if (!isCurrent(gen)) return;
    // Deep links never start a paid scan: show the saved result, or leave
    // the input filled in for the user to confirm.
    const outcome = await loadSaved(resolved, "replace", gen);
    if (outcome === "missing" && isCurrent(gen)) {
      setInput(resolved.ethos?.username ? `@${resolved.ethos.username}` : resolved.primaryWallet);
      setResultPath(window.location.pathname);
    }
  };

  const rescan = async (raw: string) => {
    const gen = claimScreen(false);
    try {
      const resolved = await resolveTarget(raw);
      if (isCurrent(gen)) await runFreshScan(resolved, resolved.ethos?.username ? `@${resolved.ethos.username}` : raw);
    } catch (e) {
      if (isCurrent(gen)) setError((e as Error).message);
    }
  };

  const reset = () => {
    claimScreen(false);
    setResult(null);
    setInput("");
    setError(null);
    setInvestigationId(null);
    setResultPath(null);
    setSaveNotice(null);
    setLoadingCached(false);
  };

  const showRunningScan = () => {
    claimScreen(true);
    setResult(null);
    setInvestigationId(null);
    setResultPath(null);
    setError(null);
    setInput(jobLabel);
    router.push("/scanner");
  };

  const notifySavedChanged = (deletedId?: string) => {
    setSavedVersion((v) => v + 1);
    if (deletedId && deletedId === investigationId) setInvestigationId(null);
  };

  const exportEvidence = async () => {
    if (!result) return;
    // X search evidence is stored with the saved scan; read it fresh so the
    // export includes whatever was collected, even after a re-scan.
    let twitterEvidence: Record<string, { tweets?: { url: string; author?: { userName?: string } }[] }> = {};
    if (investigationId) {
      try {
        const resp = await fetch(`/api/investigations/${investigationId}`);
        if (resp.ok) twitterEvidence = (await resp.json()).twitterEvidence ?? {};
      } catch {
        // Export without it.
      }
    }

    const all = [...result.strongCluster, ...result.possibleCluster];
    let prompt = `Draft a slash report for the following subject based on the evidence provided.\n\n`;
    prompt += `## Subject\n- Wallet: ${result.target}\n`;
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
        prompt += `\n${name}\n- Address: ${c.address}\n`;
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

    // Social evidence: X posts that mention the scanned wallets.
    const mentions = Object.entries(twitterEvidence)
      .map(([address, ev]) => ({ address, tweets: ev?.tweets ?? [] }))
      .filter((m) => m.tweets.length > 0);
    if (mentions.length > 0) {
      prompt += `\n## Social Evidence\n`;
      prompt += `X posts that mention these wallets. Several distinct accounts posting the same address can indicate coordination.\n`;
      for (const m of mentions) {
        const authors = [...new Set(m.tweets.map((t) => t.author?.userName).filter(Boolean))];
        prompt += `\n- ${m.address}: ${m.tweets.length} post${m.tweets.length === 1 ? "" : "s"}${authors.length ? ` by @${authors.join(", @")}` : ""}\n`;
        for (const t of m.tweets.slice(0, 5)) prompt += `  - ${t.url}\n`;
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
  // on the server; pick it up. It takes the screen only if nothing has
  // claimed it yet. Child effects run first, so a deep link opened on this
  // same load has already claimed it and keeps it.
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    let cancelled = false;
    const genAtStart = 0;
    (async () => {
      try {
        const resp = await fetch("/api/scan/jobs", { cache: "no-store" });
        if (!resp.ok) return;
        const { job } = await resp.json();
        if (!job || cancelled || jobCtl.current) return;
        const label = job.targetInput ?? "";
        setScanning(true);
        setJobLabel(label);
        setLogs([]);
        if (screenGen.current === genAtStart) {
          claimScreen(true);
          setInput(label);
          setResult(null);
          setError(null);
        }
        const outcome = await watchJob(job.id);
        if (!cancelled) finishScan(outcome, label);
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
    input, setInput, scanning, jobLabel, screenIsScan, loadingCached, error, result, logs, progress, investigationId,
    scannedAt, saveNotice, resultPath, savedVersion, quotaKey, scanInput, openFromUrl, rescan, exportEvidence, reset,
    showRunningScan, notifySavedChanged,
  };
  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}
