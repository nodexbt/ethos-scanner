import { NextRequest } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { runClusterScan } from "@/lib/cluster-scanner";
import { resolveScanTarget } from "@/lib/scan-target";
import { getRecentScanAverageMs } from "@/lib/db/investigations";
import { consumeDailyScanQuota } from "@/lib/db/scan-quota";

export const maxDuration = 300; // 5 min timeout for long scans

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  // Rate limit: 10 scans per user per hour
  if (!rateLimit(`scan:${auth.profileId}`, 10, 60 * 60 * 1000)) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  // Accept an address, @handle, or profile URL; resolve server-side to the
  // profile's full attested-wallet set (don't trust a client wallet list).
  // One scan = one rate-limit token + one daily-quota unit regardless of
  // how many wallets the profile has.
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
