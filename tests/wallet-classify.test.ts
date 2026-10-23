import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/alchemy", () => ({
  CHAINS: [
    { id: "a", name: "A", rpcBase: "", internal: true },
    { id: "b", name: "B", rpcBase: "", internal: false },
  ],
  batchGetCode: vi.fn(),
}));

import { batchGetCode } from "@/lib/alchemy";
import { hasContractCode, classifyContractsOnChain } from "@/lib/wallet-classify";

const EOA = "0x1111111111111111111111111111111111111111";
const DELEGATED = "0x2222222222222222222222222222222222222222";
const CONTRACT = "0x3333333333333333333333333333333333333333";
const designator = "0xef0100" + "ab".repeat(20);

describe("hasContractCode", () => {
  it("treats empty code as an EOA", () => {
    expect(hasContractCode("0x")).toBe(false);
    expect(hasContractCode("0x0")).toBe(false);
  });
  it("treats exactly the 23-byte EIP-7702 designator as an EOA", () => {
    expect(hasContractCode(designator)).toBe(false);
    expect(hasContractCode(designator.toUpperCase().replace("0X", "0x"))).toBe(false);
  });
  it("treats anything else with code as a contract, including a longer 0xef prefix", () => {
    expect(hasContractCode("0x6080604052")).toBe(true);
    expect(hasContractCode("0xef0100" + "ab".repeat(21))).toBe(true);
  });
});

describe("classifyContractsOnChain", () => {
  beforeEach(() => vi.mocked(batchGetCode).mockReset());

  it("is a contract if any chain has contract code; EOA only when every chain answered", async () => {
    vi.mocked(batchGetCode)
      .mockResolvedValueOnce(new Map([[EOA, "0x"], [DELEGATED, designator], [CONTRACT, "0x6080"]]))
      .mockResolvedValueOnce(new Map([[EOA, "0x"], [DELEGATED, "0x"], [CONTRACT, "0x"]]));
    const r = await classifyContractsOnChain([EOA, DELEGATED, CONTRACT]);
    expect(r.get(EOA)).toBe(false);
    expect(r.get(DELEGATED)).toBe(false);
    expect(r.get(CONTRACT)).toBe(true);
  });

  it("leaves an address unknown (absent) when a chain failed to answer and no chain showed code", async () => {
    vi.mocked(batchGetCode)
      .mockResolvedValueOnce(new Map([[EOA, "0x"]]))
      .mockResolvedValueOnce(new Map()); // chain B throttled
    const r = await classifyContractsOnChain([EOA]);
    expect(r.has(EOA)).toBe(false);
  });

  it("still reports a contract when one chain failed but another showed code", async () => {
    vi.mocked(batchGetCode)
      .mockResolvedValueOnce(new Map([[CONTRACT, "0x6080"]]))
      .mockResolvedValueOnce(new Map());
    const r = await classifyContractsOnChain([CONTRACT]);
    expect(r.get(CONTRACT)).toBe(true);
  });
});
