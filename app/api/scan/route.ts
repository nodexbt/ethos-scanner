import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { runClusterScan } from "@/lib/cluster-scanner";

export const maxDuration = 300; // 5 min timeout for long scans

export async function POST(req: NextRequest) {
  if (process.env.BYPASS_AUTH !== "true") {
    const session = await getServerSession(authOptions);
    if (!session) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const { target } = await req.json();
  if (!target || !/^0x[a-fA-F0-9]{40}$/.test(target)) {
    return new Response(JSON.stringify({ error: "Invalid address" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Stream logs + final result as newline-delimited JSON
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await runClusterScan(
          target,
          (logEntry) => {
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "log", data: logEntry }) + "\n")
            );
          },
          (progress) => {
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "progress", data: progress }) + "\n")
            );
          }
        );

        // Serialize the result (convert Sets to arrays)
        const serialized = {
          ...result,
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
