import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal Supabase stub: a chainable query builder that resolves to a
// scripted response per table, plus the rpc used by the quota.
const responses: Record<string, unknown> = {};
function builder(table: string) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ["select", "eq", "in", "is", "not", "order", "range", "upsert", "update", "insert", "delete"]) b[m] = vi.fn(chain);
  b.single = vi.fn(async () => responses[table] ?? { data: null, error: null });
  b.maybeSingle = vi.fn(async () => responses[table] ?? { data: null, error: null });
  b.then = (res: (v: unknown) => void) => res(responses[table] ?? { data: null, error: null });
  return b;
}
const from = vi.fn(builder);
vi.mock("@/lib/db/supabase", () => ({ getSupabase: () => ({ from, rpc: vi.fn(async () => ({ data: 3, error: null })) }) }));
vi.mock("@/lib/db/investigation-edges", () => ({ replaceEdgesForSource: vi.fn(async () => {}), edgesFromClusterResult: () => [] }));

import { saveInvestigation, DegradedOverwriteError } from "@/lib/db/investigations";
import { replaceEdgesForSource } from "@/lib/db/investigation-edges";
import { consumeDailyScanQuota, DAILY_SCAN_LIMIT } from "@/lib/db/scan-quota";

const base = { id: "scan-p1", target: "0x" + "1".repeat(40), targetName: "t", ownerProfileId: 7, profileId: 1 };

describe("saveInvestigation degraded guard", () => {
  beforeEach(() => { for (const k of Object.keys(responses)) delete responses[k]; vi.mocked(replaceEdgesForSource).mockClear(); });

  it("rejects a degraded result over an existing complete one", async () => {
    responses.investigations = { data: { owner_profile_id: 7, degraded: null }, error: null };
    await expect(saveInvestigation({ ...base, clusterResult: { degraded: { failedNetworks: ["Base"], reasons: ["x"] } } }))
      .rejects.toBeInstanceOf(DegradedOverwriteError);
  });

  it("saves a degraded first scan and does not touch the edge graph", async () => {
    responses.investigations = { data: null, error: null };
    await saveInvestigation({ ...base, clusterResult: { degraded: { failedNetworks: ["Base"], reasons: ["x"] } } });
    expect(replaceEdgesForSource).not.toHaveBeenCalled();
  });

  it("saves a complete result and refreshes edges, even from a non-owner", async () => {
    responses.investigations = { data: { owner_profile_id: 99 }, error: null };
    await saveInvestigation({ ...base, clusterResult: { strongCluster: [] } });
    expect(replaceEdgesForSource).toHaveBeenCalledWith(1, []);
  });
});

describe("consumeDailyScanQuota", () => {
  it("allows while the counter is within the limit", async () => {
    const r = await consumeDailyScanQuota(7);
    expect(r).toEqual({ allowed: true, count: 3, limit: DAILY_SCAN_LIMIT });
  });
});
