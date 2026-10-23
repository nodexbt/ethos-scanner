import { describe, it, expect } from "vitest";
import {
  confidenceFor,
  recalcConfidence,
  mergeSignalsInto,
  scoreCandidate,
  analyzeDirectTransfers,
  findSharedFundingSources,
  FINAL_SCORE_THRESHOLD,
  POSSIBLE_SCORE_THRESHOLD,
  type ClusterCandidate,
} from "@/lib/cluster-scanner";
import { type AssetTransfer } from "@/lib/alchemy";

const T = "0x1111111111111111111111111111111111111111";
const C = "0x2222222222222222222222222222222222222222";
const F = "0x3333333333333333333333333333333333333333";
const SPAM = "0x4444444444444444444444444444444444444444";

function tx(from: string, to: string, category = "external", value = 1): AssetTransfer {
  return { from, to, value, asset: "ETH", category, blockNum: "0x1", hash: `0x${from.slice(2, 6)}${to.slice(2, 6)}${category}` };
}

function candidate(signals: { type: string; score: number }[], confidence: "high" | "medium" | "low" = "low"): ClusterCandidate {
  return {
    address: C, wallets: [C], score: signals.reduce((s, x) => s + x.score, 0), confidence,
    signals: signals.map((s) => ({ ...s, details: "" })), signalTypes: new Set(signals.map((s) => s.type)),
    directCount: 0, incomingCount: 0, outgoingCount: 0, bidirectional: false, repeatTransfer: false,
    sharedFundingSources: [], sharedFirstFunder: false, firstFunders: [], sharedCexDeposits: [],
    invitedByTarget: false, invitedTarget: false, mutualReviews: false, mutualVouches: false, networks: ["Base"],
  };
}

describe("confidenceFor", () => {
  it("is high when first funded by the target or its cluster, whatever the score", () => {
    expect(confidenceFor(10, new Set(["funded_by_target"]), true)).toBe("high");
    expect(confidenceFor(0, new Set(), true)).toBe("high");
  });
  it("needs the threshold AND two signal types for high otherwise", () => {
    expect(confidenceFor(FINAL_SCORE_THRESHOLD, new Set(["a", "b"]), false)).toBe("high");
    expect(confidenceFor(FINAL_SCORE_THRESHOLD + 10, new Set(["a"]), false)).toBe("medium");
  });
  it("is medium from the possible threshold and low below it", () => {
    expect(confidenceFor(POSSIBLE_SCORE_THRESHOLD, new Set(["a"]), false)).toBe("medium");
    expect(confidenceFor(POSSIBLE_SCORE_THRESHOLD - 1, new Set(["a"]), false)).toBe("low");
  });
});

describe("recalcConfidence", () => {
  it("keeps auto-high for a funded-by-target candidate after social signals are added", () => {
    const c = candidate([{ type: "funded_by_target", score: 10 }, { type: "mutual_reviews", score: 0 }], "high");
    recalcConfidence(c);
    expect(c.confidence).toBe("high");
  });
  it("never demotes a candidate that already earned high", () => {
    const c = candidate([{ type: "shared_first_funder", score: 8 }], "high");
    recalcConfidence(c);
    expect(c.confidence).toBe("high");
  });
  it("promotes when a new signal type crosses the threshold", () => {
    const c = candidate([{ type: "shared_first_funder", score: 8 }, { type: "shared_cex_deposit", score: 8 }], "medium");
    recalcConfidence(c);
    expect(c.confidence).toBe("high");
  });
});

describe("mergeSignalsInto", () => {
  it("adds different signal types found on different chains", () => {
    const a = candidate([{ type: "shared_first_funder", score: 8 }]);
    const b = candidate([{ type: "shared_cex_deposit", score: 8 }]);
    mergeSignalsInto(a, b);
    expect(a.score).toBe(16);
    expect([...a.signalTypes].sort()).toEqual(["shared_cex_deposit", "shared_first_funder"]);
    expect(a.confidence).toBe("high");
  });
  it("does not double count the same signal type seen twice", () => {
    const a = candidate([{ type: "shared_incoming_sender", score: 5 }]);
    const b = candidate([{ type: "shared_incoming_sender", score: 5 }]);
    mergeSignalsInto(a, b);
    expect(a.score).toBe(5);
    expect(a.signals).toHaveLength(1);
  });
});

describe("scoreCandidate", () => {
  it("gives funded_by_target 10 points and auto-high", () => {
    const c = scoreCandidate(C, undefined, [], false, true, false, [], "Base");
    expect(c.score).toBe(10);
    expect(c.confidence).toBe("high");
    expect(c.signalTypes.has("funded_by_target")).toBe(true);
  });
  it("direct transfers alone score 0 and are filtered out as low", () => {
    const info = { address: C, count: 3, incomingCount: 2, outgoingCount: 1, timestamps: [], values: [], nativeCount: 3, bidirectional: true, repeatTransfer: true };
    const c = scoreCandidate(C, info, [], false, false, false, [], "Base");
    expect(c.score).toBe(0);
    expect(c.confidence).toBe("low");
    // Context signals are listed for the breakdown but don't count as a
    // signal type for the "two types" rule.
    expect(c.signals.some((s) => s.type === "bidirectional")).toBe(true);
    expect(c.signalTypes.has("bidirectional")).toBe(false);
  });
  it("downgrades a shared exchange first funder to 5 points", () => {
    const binanceHot = "0x28c6c06298d514db089934071355e5743bf21d60"; // labeled in known-addresses
    const c = scoreCandidate(C, undefined, [], true, false, false, [{ chain: "Ethereum", funder: binanceHot, funderLabel: "Binance", txHash: "", value: 1 }], "Ethereum");
    const ff = c.signals.find((s) => s.type === "shared_exchange_funder" || s.type === "shared_first_funder");
    expect(ff?.type).toBe("shared_exchange_funder");
    expect(ff?.score).toBe(5);
  });
});

describe("analyzeDirectTransfers", () => {
  it("counts every category for discovery but tracks native moves separately", () => {
    const txs = [tx(T, C), tx(C, T, "erc721"), tx(T, C, "erc20")];
    const out = analyzeDirectTransfers(new Set([T]), txs, new Map());
    const info = out.get(C)!;
    expect(info.count).toBe(3);
    expect(info.nativeCount).toBe(1);
    expect(info.bidirectional).toBe(true);
  });
  it("never makes another wallet of the same profile a counterparty", () => {
    const T2 = "0x5555555555555555555555555555555555555555";
    const out = analyzeDirectTransfers(new Set([T, T2]), [tx(T, T2)], new Map());
    expect(out.size).toBe(0);
  });
});

describe("findSharedFundingSources", () => {
  it("counts ETH senders shared by target and candidate", () => {
    const targetTxs = [tx(F, T)];
    const candTxs = new Map([[C, [tx(F, C)]]]);
    const out = findSharedFundingSources(new Set([T]), targetTxs, [C], candTxs, new Map());
    expect(out.get(C)).toEqual([F]);
  });
  it("ignores token airdrops so a spammer is not a shared funder", () => {
    const targetTxs = [tx(SPAM, T, "erc1155")];
    const candTxs = new Map([[C, [tx(SPAM, C, "erc1155")]]]);
    const out = findSharedFundingSources(new Set([T]), targetTxs, [C], candTxs, new Map());
    expect(out.size).toBe(0);
  });
});
