import { NextRequest, after } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { resolveScanTarget } from "@/lib/scan-target";
import { getRecentScanAverageMs } from "@/lib/db/investigations";
import { consumeDailyScanQuota } from "@/lib/db/scan-quota";
import { createScanJob, getActiveScanJob, ScanJobsUnavailable } from "@/lib/db/scan-jobs";
import { executeScan, runScanJob } from "@/lib/scan-runner";

export const maxDuration = 300; // 5 min: covers the job that runs after the response

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * POST /api/scan — start a scan.
 *
 * Normal path: enqueue a scan_jobs row, kick off the runner after the
 * response (Next `after()`), and return 202 { jobId }. The client polls
 * GET /api/scan/jobs/{id}. Results are saved server-side.
 *
 * Fallback (scan_jobs table not yet migrated): run inline and stream
 * NDJSON log/progress/result/saved events, as before.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  // Accept an address, @handle, or profile URL; resolve server-side to the
  // profile's full attested-wallet set (don't trust a client wallet list).
  const { target } = await req.json();
  const resolved = typeof target === "string" ? await resolveScanTarget(target) : null;
  if (!resolved) {
    return json({ error: "No Ethos profile or valid address found for that input" }, 400);
  }

  // A browser tab loaded before the job system shipped still expects the
  // NDJSON stream. Only clients that declare job support get a job id;
  // everyone else gets the stream, which is also saved server-side.
  const clientSupportsJobs = req.headers.get("x-scan-mode") === "job";

  // One active scan per user: hand back the running job instead of
  // starting (and charging for) a second one.
  let jobsAvailable = clientSupportsJobs;
  try {
    const active = await getActiveScanJob(auth.profileId);
    if (active) return json({ jobId: active.id, reused: true }, 202);
  } catch (err) {
    if (err instanceof ScanJobsUnavailable) jobsAvailable = false;
    else throw err;
  }

  // Daily scan cap (durable, per UTC day). Checked after address validation so
  // malformed requests don't burn quota; admins are exempt.
  if (!auth.isAdmin) {
    const quota = await consumeDailyScanQuota(auth.profileId);
    if (!quota.allowed) {
      return json({ error: `Daily scan limit reached (${quota.limit}/day). Try again tomorrow.` }, 429);
    }
  }

  // Stable ETA baseline for the whole scan, from recent scan history.
  const baselineMs = await getRecentScanAverageMs();

  if (jobsAvailable) {
    try {
      const job = await createScanJob({
        investigationId: resolved.investigationId,
        targetInput: target,
        requestedBy: auth.profileId,
      });
      after(() => runScanJob(job.id, resolved, auth.profileId, baselineMs));
      return json({ jobId: job.id }, 202);
    } catch (err) {
      if (!(err instanceof ScanJobsUnavailable)) throw err;
      // fall through to streaming
    }
  }

  // --- Streaming fallback ---------------------------------------------
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify({ type, data }) + "\n"));
      try {
        const { serialized, saved } = await executeScan(resolved, auth.profileId, baselineMs, {
          onLog: (e) => send("log", e),
          onProgress: (p) => send("progress", p),
        });
        send("result", serialized);
        send("saved", saved);
      } catch (err) {
        send("error", err instanceof Error ? err.message : "Scan failed");
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
