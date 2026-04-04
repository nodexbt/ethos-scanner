import { NextRequest, NextResponse } from "next/server";
import { listInvestigations, saveInvestigation } from "@/lib/db/investigations";

// GET /api/investigations — list all
export async function GET() {
  const investigations = await listInvestigations();
  return NextResponse.json(investigations);
}

// POST /api/investigations — save/update
export async function POST(req: NextRequest) {
  const data = await req.json();
  await saveInvestigation(data);
  return NextResponse.json({ ok: true });
}
