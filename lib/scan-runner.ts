import { runClusterScan, type ClusterScanResult, type LogEntry, type ScanProgress } from "@/lib/cluster-scanner";
import type { ResolvedScanTarget } from "@/lib/scan-target";
import { saveInvestigation, DegradedOverwriteError } from "@/lib/db/investigations";
import { updateScanJob } from "@/lib/db/scan-jobs";

export type SavedOutcome = { ok: boolean; code?: string; message?: string };

/** Sets → arrays so the result can be stored and sent as JSON. */
export function serializeResult(result: ClusterScanResult, scanDurationMs: number) {
  return {
    ...result,
    scanDurationMs,
    strongCluster: result.strongCluster.map((c) => ({ ...c, signalTypes: [...c.signalTypes] })),
    possibleCluster: result.possibleCluster.map((c) => ({ ...c, signalTypes: [...c.signalTypes] })),
  };
}

/**
 * Run a scan for a resolved target and persist the result server-side.
 * Shared by the streaming route and the background job runner so both
 * paths save exactly the same thing.
 */
export async function executeScan(
  resolved: ResolvedScanTarget,
  requestedBy: number,
  baselineMs: number,
  hooks: { onLog?: (e: LogEntry) => void; onProgress?: (p: ScanProgress) => void } = {}
): Promise<{ serialized: ReturnType<typeof serializeResult>; saved: SavedOutcome }> {
  const scanStart = Date.now();
  const result = await runClusterScan(resolved, hooks.onLog, hooks.onProgress, baselineMs);
  const scanDurationMs = Date.now() - scanStart;
  const serialized = serializeResult(result, scanDurationMs);

  let saved: SavedOutcome;
  try {
    await saveInvestigation({
      id: resolved.investigationId,
      target: resolved.primaryWallet.toLowerCase(),
      targetName: result.targetEthos?.displayName ?? null,
      clusterResult: serialized,
      ownerProfileId: requestedBy,
      profileId: resolved.profileId,
      targetWallets: resolved.wallets,
      scanDurationMs,
    });
    saved = { ok: true };
  } catch (err) {
    if (err instanceof DegradedOverwriteError) {
      saved = { ok: false, code: "DEGRADED_NOT_SAVED", message: err.message };
    } else {
      console.error("scan save failed:", err);
      saved = { ok: false, code: "SAVE_FAILED", message: err instanceof Error ? err.message : "save failed" };
    }
  }
  return { serialized, saved };
}

/**
 * Background job runner. Writes logs/progress to the job row at most
 * every FLUSH_MS (plus a heartbeat), then the result and save outcome.
 */
export async function runScanJob(
  jobId: string,
  resolved: ResolvedScanTarget,
  requestedBy: number,
  baselineMs: number
): Promise<void> {
  const FLUSH_MS = 1000;
  const logs: LogEntry[] = [];
  let progress: ScanProgress | null = null;
  let dirty = false;
  let flushing: Promise<void> | null = null;
  let lastFlush = 0;

  const flush = async (force = false) => {
    if (!dirty && !force) return;
    if (!force && Date.now() - lastFlush < FLUSH_MS) return;
    if (flushing) return;
    dirty = false;
    lastFlush = Date.now();
    flushing = updateScanJob(jobId, {
      logs: [...logs],
      progress,
      heartbeat_at: new Date().toISOString(),
    }).finally(() => {
      flushing = null;
    });
    await flushing;
  };

  await updateScanJob(jobId, { status: "running", started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() });
  const ticker = setInterval(() => void flush(), FLUSH_MS);

  try {
    const { serialized, saved } = await executeScan(resolved, requestedBy, baselineMs, {
      onLog: (e) => {
        logs.push(e);
        dirty = true;
      },
      onProgress: (p) => {
        progress = p;
        dirty = true;
      },
    });
    clearInterval(ticker);
    if (flushing) await flushing;
    await updateScanJob(jobId, {
      status: "done",
      logs,
      progress,
      result: serialized,
      saved,
      heartbeat_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });
  } catch (err) {
    clearInterval(ticker);
    if (flushing) await flushing;
    await updateScanJob(jobId, {
      status: "failed",
      logs,
      progress,
      error: err instanceof Error ? err.message : "Scan failed",
      finished_at: new Date().toISOString(),
    });
  }
}
