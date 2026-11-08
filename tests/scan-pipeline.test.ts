import { describe, it, expect, vi, beforeAll } from "vitest";
import type { AssetTransfer } from "@/lib/alchemy";
import type { EthosProfile } from "@/lib/ethos";

// One scan, end to end, on a hand-built chain. Every external source is
// mocked at the module boundary (Alchemy, the profile_addresses mirror,
// the Ethos API). The fixture is built so each of the three scoring rules
// fixed in this PR has a wallet that only comes out right with the fix:
//
//   T   target, first funded by F
//   F   unknown EOA; first funder of T and C1, so it is also an incoming
//       sender both share -> must score as shared_first_funder once, not
//       also as shared_incoming_sender
//   HOT Binance hot wallet; sent ETH to T and C2 -> not a shared sender
//   C1  shares first funder F with T; also shares deposit address DEP
//   C2  first funded by HOT; only link to T is the hot wallet -> no result
//   C3  first funded by C1, which is in the results -> funded_by_cluster
//   C4  first funded by C2, which is NOT in the results -> no result
//   STG labelled Stargate router that T and C1 both sent to -> not a CEX
//   RTR unlabelled contract T and C1 both sent to -> never verified
//   DEP EOA that T and C1 both sent to and that forwards to HOT -> CEX deposit

// vi.mock factories are hoisted above every import, so the fixture they
// read has to be hoisted with them.
const { T, C1, C2, C3, C4, RTR, DEP, history, firstFunder, profileWallets, profiles, getOutgoingTransfers, batchIsContract, traced, contractChecked } = vi.hoisted(() => {
  const T = "0x1000000000000000000000000000000000000001";
  const F = "0x2000000000000000000000000000000000000002";
  const HOT = "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be"; // "Binance" in known-addresses
  const C1 = "0x4000000000000000000000000000000000000004";
  const C2 = "0x5000000000000000000000000000000000000005";
  const C3 = "0x6000000000000000000000000000000000000006";
  const C4 = "0x7000000000000000000000000000000000000007";
  const STG = "0x296f55f8fb28e498b858d0bcda06d955b2cb3f97"; // "Stargate" in known-addresses
  const RTR = "0x8000000000000000000000000000000000000008";
  const DEP = "0x9000000000000000000000000000000000000009";

  let hashSeq = 0;
  function tx(from: string, to: string, category = "external"): AssetTransfer {
    return { from, to, value: 1, asset: "ETH", category, blockNum: "0x1", hash: `0x${(++hashSeq).toString(16).padStart(8, "0")}` };
  }

  const history: Record<string, AssetTransfer[]> = {
    [T]: [tx(F, T), tx(HOT, T), tx(T, C1), tx(T, C2), tx(T, C3), tx(T, C4), tx(T, STG), tx(T, RTR), tx(T, DEP)],
    [C1]: [tx(F, C1), tx(T, C1), tx(C1, C3), tx(C1, STG), tx(C1, RTR), tx(C1, DEP)],
    [C2]: [tx(HOT, C2), tx(T, C2)],
    [C3]: [tx(C1, C3), tx(T, C3)],
    [C4]: [tx(C2, C4), tx(T, C4)],
  };
  const firstFunder: Record<string, string> = { [T]: F, [C1]: F, [C2]: HOT, [C3]: C1, [C4]: C2 };
  const outgoing: Record<string, string[]> = { [DEP]: [HOT], [F]: [T, C1] };

  // Which addresses each lookup was asked about, for the assertions below.
  const traced: string[] = [];
  const contractChecked: string[] = [];
  const getOutgoingTransfers = vi.fn(async (wallet: string) => {
    traced.push(wallet);
    return (outgoing[wallet] ?? []).map((to) => ({ to, value: 1, txHash: "0x" }));
  });
  const batchIsContract = vi.fn(async (addrs: string[]) => {
    contractChecked.push(...addrs);
    return new Map(addrs.map((a) => [a, a === RTR]));
  });

  // profile_addresses mirror: the wallets of Ethos profiles.
  const profileWallets = [T, C1, C2, C3, C4];
  function profile(id: number, wallet: string): EthosProfile {
    return {
      id, profileId: id, displayName: `p${id}`, username: `p${id}`, avatarUrl: "", description: null, score: 1500,
      status: "ACTIVE", userkeys: [`address:${wallet}`], xpTotal: 0, xpStreakDays: 0, xpRemovedDueToAbuse: false,
      influenceFactor: 0, influenceFactorPercentile: 0, humanVerificationStatus: null, validatorNftCount: 0,
      links: { profile: "", scoreBreakdown: "" },
      stats: { review: { received: { negative: 0, neutral: 0, positive: 0 } }, vouch: { given: { amountWeiTotal: 0, count: 0 }, received: { amountWeiTotal: 0, count: 0 } } },
    };
  }
  const profiles = new Map(profileWallets.map((w, i) => [w, profile(i + 1, w)]));
  return { T, F, HOT, C1, C2, C3, C4, STG, RTR, DEP, history, firstFunder, profileWallets, profiles, getOutgoingTransfers, batchIsContract, traced, contractChecked };
});

vi.mock("@/lib/alchemy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/alchemy")>("@/lib/alchemy");
  return {
    CHAINS: [{ id: "base-mainnet", name: "Base", rpcBase: "", internal: true }],
    NATIVE_CATEGORIES: actual.NATIVE_CATEGORIES,
    parallel: actual.parallel,
    runWithUsage: async <R,>(fn: () => Promise<R>) => ({ result: await fn(), usage: { calls: 0, computeUnits: 0, byMethod: {} } }),
    getAllTransactions: vi.fn(async (wallet: string) => history[wallet] ?? []),
    getFirstFunder: vi.fn(async (wallet: string) => {
      const funder = firstFunder[wallet];
      return funder ? { funder, txHash: "0x", value: 1, asset: "ETH" } : null;
    }),
    getOutgoingTransfers,
    getIncomingTransfers: vi.fn(async () => []),
  };
});
vi.mock("@/lib/wallet-classify", () => ({ batchIsContract }));

vi.mock("@/lib/db/supabase", () => {
  function builder() {
    let wanted: string[] = [];
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.in = (_col: string, vals: string[]) => { wanted = vals; return b; };
    b.then = (res: (v: unknown) => void) =>
      res({ data: profileWallets.filter((w) => wanted.includes(w)).map((address) => ({ address })), error: null });
    return b;
  }
  return { getSupabase: () => ({ from: builder }) };
});

vi.mock("@/lib/ethos", () => ({
  fetchProfilesByAddresses: vi.fn(async (addrs: string[]) =>
    new Map(addrs.filter((a) => profiles.has(a)).map((a) => [a, profiles.get(a)!]))
  ),
  fetchInvitationTree: vi.fn(async () => []),
  fetchActivities: vi.fn(async () => []),
}));

import { runClusterScan, type ClusterScanResult, type ClusterCandidate } from "@/lib/cluster-scanner";

let result: ClusterScanResult;
const find = (addr: string): ClusterCandidate | undefined =>
  [...result.strongCluster, ...result.possibleCluster].find((c) => c.wallets.includes(addr));
const types = (c: ClusterCandidate) => c.signals.filter((s) => s.score > 0).map((s) => s.type).sort();

beforeAll(async () => {
  result = await runClusterScan(T);
});

describe("scan pipeline on a fixture chain", () => {
  it("runs to a complete result", () => {
    expect(result.degraded).toBeUndefined();
    expect(result.targetEthos?.profileId).toBe(1);
  });

  it("scores a shared first funder once, not also as a shared incoming sender", () => {
    const c1 = find(C1)!;
    expect(c1).toBeDefined();
    expect(types(c1)).toEqual(["shared_cex_deposit", "shared_first_funder"]);
    expect(c1.sharedFundingSources).toEqual([]);
    expect(c1.score).toBe(16);
    expect(c1.confidence).toBe("high");
  });

  it("does not make an exchange hot wallet a shared incoming sender", () => {
    expect(find(C2)).toBeUndefined();
  });

  it("gives funded_by_cluster only when the funder is in the results", () => {
    const c3 = find(C3)!;
    expect(c3).toBeDefined();
    expect(types(c3)).toEqual(["funded_by_cluster"]);
    expect(c3.confidence).toBe("high");
    // C4's first funder C2 was a discovery-stage candidate that scored 0.
    expect(find(C4)).toBeUndefined();
  });

  it("does not report a Stargate router or a contract as an exchange deposit", () => {
    // STG is labelled but not an exchange; RTR is a contract and is never traced.
    expect(result.sharedCexDeposits.map((d) => d.depositAddress)).toEqual([DEP]);
    expect(result.sharedCexDeposits[0].exchange).toBe("Binance");
    expect(result.sharedCexDeposits[0].wallets.sort()).toEqual([T, C1].sort());
    expect(contractChecked).toContain(RTR);
    expect(traced).not.toContain(RTR);
  });
});
