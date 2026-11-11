import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({ profileId: 61, twitterUsername: "nodexbt", isAdmin: false })),
  isAuthError: () => false,
}));
const { resolveScanTarget } = vi.hoisted(() => ({ resolveScanTarget: vi.fn(async () => null) }));
vi.mock("@/lib/scan-target", () => ({ resolveScanTarget }));
vi.mock("@/lib/db/investigations", () => ({ getRecentScanAverageMs: vi.fn(async () => 90_000) }));
vi.mock("@/lib/db/scan-quota", () => ({ consumeDailyScanQuota: vi.fn() }));
vi.mock("@/lib/db/scan-jobs", () => ({ createScanJob: vi.fn(), getActiveScanJob: vi.fn(), ScanJobsUnavailable: class extends Error {} }));
vi.mock("@/lib/scan-runner", () => ({ executeScan: vi.fn(), runScanJob: vi.fn() }));
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: vi.fn() };
});

import { POST } from "@/app/api/scan/route";

const post = (body: string) =>
  POST(new NextRequest("http://localhost/api/scan", { method: "POST", body, headers: { "Content-Type": "application/json" } }));

describe("POST /api/scan input handling", () => {
  it("answers malformed JSON with 400, not 500", async () => {
    const r = await post("{not json");
    expect(r.status).toBe(400);
    expect(resolveScanTarget).not.toHaveBeenCalled();
  });
  it("rejects a non-string target", async () => {
    expect((await post(JSON.stringify({ target: 123 }))).status).toBe(400);
    expect((await post(JSON.stringify({}))).status).toBe(400);
    expect(resolveScanTarget).not.toHaveBeenCalled();
  });
  it("rejects an oversized target before resolving it", async () => {
    expect((await post(JSON.stringify({ target: "x".repeat(201) }))).status).toBe(400);
    expect(resolveScanTarget).not.toHaveBeenCalled();
  });
  it("resolves a plausible target and reports when nothing matches", async () => {
    const r = await post(JSON.stringify({ target: "@someone" }));
    expect(resolveScanTarget).toHaveBeenCalledWith("@someone");
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/No Ethos profile/);
  });
});
