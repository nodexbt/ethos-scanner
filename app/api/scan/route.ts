import { NextRequest } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { runClusterScan } from "@/lib/cluster-scanner";
import { resolveScanTarget } from "@/lib/scan-target";
import { getRecentScanAverageMs, saveInvestigation, DegradedOverwriteError } from "@/lib/db/investigations";
import { consumeDailyScanQuota } from "@/lib/db/scan-quota";

export const maxDuration = 300; // 5 min timeout for long scans

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  // The only scan limit is the durable daily quota below. The old
  // in-memory 10/hour limiter was per serverless instance and invisible
  // to users, so it was removed.

  // Accept an address, @handle, or profile URL; resolve server-side to the
  // profile's full attested-wallet set (don't trust a client wallet list).
  // One scan = one daily-quota unit regardless of how many wallets the
  // profile has.
  const { target } = await req.json();
  const resolved = typeof target === "string" ? await resolveScanTarget(target) : null;
  if (!resolved) {
    return new Response(
      JSON.stringify({ error: "No Ethos profile or valid address found for that input" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Daily scan cap (durable, per UTC day). Checked after address validation so
  // malformed requests don't burn quota; admins are exempt.
  if (!auth.isAdmin) {
    const quota = await consumeDailyScanQuota(auth.profileId);
    if (!quota.allowed) {
      return new Response(
        JSON.stringify({
          error: `Daily scan limit reached (${quota.limit}/day). Try again tomorrow.`,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Fetch the baseline ETA from recent scan history before we start.
  // The estimator uses this as a stable totalEstimatedMs for the entire
  // scan rather than recomputing rate per step. Cached server-side so
  // a burst of scans doesn't hit the DB on each one.
  const baselineMs = await getRecentScanAverageMs();

  // Stream logs + final result as newline-delimited JSON
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const scanStart = Date.now();
      try {
        const result = await runClusterScan(
          resolved,
          (logEntry) => {
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "log", data: logEntry }) + "\n")
            );
          },
          (progress) => {
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "progress", data: progress }) + "\n")
            );
          },
          baselineMs
        );

        const scanDurationMs = Date.now() - scanStart;

        // Serialize the result (convert Sets to arrays). Includes the
        // measured duration so the client can persist it via the save
        // endpoint, feeding tomorrow's rolling average.
        const serialized = {
          ...result,
          scanDurationMs,
          strongCluster: result.strongCluster.map((c) => ({
            ...c,
            signalTypes: [...c.signalTypes],
          })),
          possibleCluster: result.possibleCluster.map((c) => ({
            ...c,
            signalTypes: [...c.signalTypes],
          })),
        };

        controller.enqueue(
          encoder.encode(JSON.stringify({ type: "result", data: serialized }) + "\n")
        );

        // Persist server-side: the client never submits a result, so a
        // saved investigation always reflects what the scanner produced.
        let saved: { ok: boolean; code?: string; message?: string };
        try {
          await saveInvestigation({
            id: resolved.investigationId,
            target: resolved.primaryWallet.toLowerCase(),
            targetName: result.targetEthos?.displayName ?? null,
            clusterResult: serialized,
            ownerProfileId: auth.profileId,
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
        controller.enqueue(encoder.encode(JSON.stringify({ type: "saved", data: saved }) + "\n"));
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "error",
              data: err instanceof Error ? err.message : "Scan failed",
            }) + "\n"
          )
        );
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
