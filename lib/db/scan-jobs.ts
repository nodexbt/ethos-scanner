import { getSupabase } from "./supabase";
import type { LogEntry, ScanProgress } from "@/lib/cluster-scanner";

export type ScanJobStatus = "queued" | "running" | "done" | "failed";

export interface ScanJob {
  id: string;
  investigationId: string;
  targetInput: string;
  requestedBy: number;
  status: ScanJobStatus;
  progress: ScanProgress | null;
  logs: LogEntry[];
  result: unknown | null;
  saved: { ok: boolean; code?: string; message?: string } | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  finishedAt: string | null;
}

/** A running job whose heartbeat is older than this is considered dead
    (the serverless invocation hit its limit or crashed). */
export const STALE_AFTER_MS = 6 * 60 * 1000;

/** Thrown when the scan_jobs table doesn't exist yet (migration not run). */
export class ScanJobsUnavailable extends Error {
  constructor() {
    super("scan_jobs table not available");
    this.name = "ScanJobsUnavailable";
  }
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42P01" || /scan_jobs/.test(error.message ?? "") && /not find|does not exist|schema cache/.test(error.message ?? ""));
}

function toJob(row: Record<string, unknown>): ScanJob {
  return {
    id: row.id as string,
    investigationId: row.investigation_id as string,
    targetInput: row.target_input as string,
    requestedBy: row.requested_by as number,
    status: row.status as ScanJobStatus,
    progress: (row.progress as ScanProgress | null) ?? null,
    logs: (row.logs as LogEntry[] | null) ?? [],
    result: row.result ?? null,
    saved: (row.saved as ScanJob["saved"]) ?? null,
    error: (row.error as string | null) ?? null,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string | null) ?? null,
    heartbeatAt: (row.heartbeat_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
  };
}

export async function createScanJob(input: {
  investigationId: string;
  targetInput: string;
  requestedBy: number;
}): Promise<ScanJob> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("scan_jobs")
    .insert({
      investigation_id: input.investigationId,
      target_input: input.targetInput,
      requested_by: input.requestedBy,
      status: "queued",
    })
    .select("*")
    .single();
  if (error) {
    if (isMissingTable(error)) throw new ScanJobsUnavailable();
    throw new Error(`createScanJob: ${error.message}`);
  }
  return toJob(data as Record<string, unknown>);
}

export async function getScanJob(id: string): Promise<ScanJob | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("scan_jobs").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const job = toJob(data as Record<string, unknown>);
  return await markIfStale(job);
}

/** The caller's most recent job that is still queued or running. */
export async function getActiveScanJob(requestedBy: number): Promise<ScanJob | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("scan_jobs")
    .select("*")
    .eq("requested_by", requestedBy)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new ScanJobsUnavailable();
    return null;
  }
  if (!data) return null;
  const job = await markIfStale(toJob(data as Record<string, unknown>));
  return job.status === "queued" || job.status === "running" ? job : null;
}

/** A job whose worker stopped reporting is failed, not stuck forever. */
async function markIfStale(job: ScanJob): Promise<ScanJob> {
  if (job.status !== "running" && job.status !== "queued") return job;
  const last = new Date(job.heartbeatAt ?? job.startedAt ?? job.createdAt).getTime();
  if (Date.now() - last < STALE_AFTER_MS) return job;
  const error = "The scan stopped reporting progress and was marked failed (server time limit or crash). Please try again.";
  await updateScanJob(job.id, { status: "failed", error, finished_at: new Date().toISOString() });
  return { ...job, status: "failed", error };
}

export async function updateScanJob(
  id: string,
  patch: Partial<{
    status: ScanJobStatus;
    progress: ScanProgress | null;
    logs: LogEntry[];
    result: unknown;
    saved: ScanJob["saved"];
    error: string | null;
    started_at: string;
    heartbeat_at: string;
    finished_at: string;
  }>
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("scan_jobs").update(patch).eq("id", id);
  if (error) console.error("updateScanJob error:", error.message);
}
