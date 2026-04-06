import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listInvestigations, saveInvestigation } from "@/lib/db/investigations";

// Cap on the serialized cluster result size (2 MB). Larger payloads are rejected
// to prevent DB bloat / DoS via arbitrary writes.
const MAX_CLUSTER_RESULT_BYTES = 2 * 1024 * 1024;

// GET /api/investigations — list all
export async function GET() {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const investigations = await listInvestigations();
  return NextResponse.json(investigations);
}

// POST /api/investigations — save/update
export async function POST(req: NextRequest) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const data = body as Record<string, unknown>;

  // ID must be of the form `scan-0x<40 hex>` to prevent arbitrary key writes.
  if (typeof data.id !== "string" || !/^scan-0x[a-f0-9]{40}$/i.test(data.id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // target must match the ID's address
  if (typeof data.target !== "string" || !/^0x[a-f0-9]{40}$/i.test(data.target)) {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }
  if (data.id.toLowerCase() !== `scan-${data.target.toLowerCase()}`) {
    return NextResponse.json({ error: "id/target mismatch" }, { status: 400 });
  }

  if (data.targetName !== null && typeof data.targetName !== "string") {
    return NextResponse.json({ error: "Invalid targetName" }, { status: 400 });
  }
  if (typeof data.targetName === "string" && data.targetName.length > 200) {
    return NextResponse.json({ error: "targetName too long" }, { status: 400 });
  }

  // clusterResult must be an object and under the size cap
  if (!data.clusterResult || typeof data.clusterResult !== "object") {
    return NextResponse.json({ error: "Invalid clusterResult" }, { status: 400 });
  }
  const serializedSize = JSON.stringify(data.clusterResult).length;
  if (serializedSize > MAX_CLUSTER_RESULT_BYTES) {
    return NextResponse.json({ error: "clusterResult too large" }, { status: 413 });
  }

  if (data.aiAnalysis !== null && data.aiAnalysis !== undefined && typeof data.aiAnalysis !== "string") {
    return NextResponse.json({ error: "Invalid aiAnalysis" }, { status: 400 });
  }

  await saveInvestigation({
    id: data.id,
    target: data.target.toLowerCase(),
    targetName: (data.targetName as string | null) ?? null,
    clusterResult: data.clusterResult,
    aiAnalysis: (data.aiAnalysis as string | null) ?? null,
  });
  return NextResponse.json({ ok: true });
}
