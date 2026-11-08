import { describe, it, expect } from "vitest";
import { publicSharePayload } from "@/lib/share-payload";
import type { InvestigationRow } from "@/lib/db/investigations";

const row: InvestigationRow = {
  id: "scan-p61",
  target: "0xabc",
  targetName: "Joost",
  shareId: "secretsecretsecret1234",
  isPublic: true,
  updatedAt: "2026-11-08T00:00:00.000Z",
  twitterEvidence: { "0xabc": { tweets: [{ url: "https://x.com/a/status/1" }] } },
  clusterResult: {
    target: "0xabc",
    strongCluster: [{ address: "0xdef", score: 15 }],
    logs: [{ level: "info", message: "[base] fetched 0x1234… (a wallet nobody shared)" }],
    usage: { alchemyCalls: 400, computeUnits: 235_000 },
    coverageNotes: ["top 200 counterparties"],
  },
};

describe("publicSharePayload", () => {
  it("keeps the result, target and scan time", () => {
    const out = publicSharePayload(row);
    expect(out.target).toBe("0xabc");
    expect(out.targetName).toBe("Joost");
    expect(out.updatedAt).toBe(row.updatedAt);
    const cr = out.clusterResult as Record<string, unknown>;
    expect(cr.strongCluster).toEqual(row.clusterResult && (row.clusterResult as Record<string, unknown>).strongCluster);
    expect(cr.coverageNotes).toEqual(["top 200 counterparties"]);
  });

  it("drops the scan log, Alchemy usage, twitter evidence and ids", () => {
    const out = publicSharePayload(row) as unknown as Record<string, unknown>;
    const cr = out.clusterResult as Record<string, unknown>;
    expect(cr.logs).toEqual([]);
    expect(cr).not.toHaveProperty("usage");
    expect(out).not.toHaveProperty("twitterEvidence");
    expect(out).not.toHaveProperty("id");
    expect(out).not.toHaveProperty("shareId");
    expect(out).not.toHaveProperty("isPublic");
  });

  it("passes a null result through", () => {
    expect(publicSharePayload({ ...row, clusterResult: null }).clusterResult).toBeNull();
  });
});
