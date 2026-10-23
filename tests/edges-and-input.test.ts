import { describe, it, expect } from "vitest";
import { edgesFromClusterResult } from "@/lib/db/investigation-edges";
import { parseScanInput } from "@/lib/scan-target";
import { formatRelativeTime } from "@/lib/utils";

describe("edgesFromClusterResult", () => {
  it("emits one edge per candidate profile, skipping the source and duplicates", () => {
    const edges = edgesFromClusterResult(1, "scan-p1", {
      strongCluster: [{ score: 15, ethosProfile: { profileId: 2 } }, { score: 9, ethosProfile: { profileId: 1 } }],
      possibleCluster: [{ score: 8, ethosProfile: { profileId: 2 } }, { score: 6, ethosProfile: { profileId: 3 } }, { score: 6 }],
    });
    expect(edges.map((e) => [e.candidateProfileId, e.confidence, e.score])).toEqual([[2, "high", 15], [3, "medium", 6]]);
  });
  it("returns nothing for a missing result", () => {
    expect(edgesFromClusterResult(1, "scan-p1", null)).toEqual([]);
  });
});

describe("parseScanInput", () => {
  it("accepts addresses, handles and profile URLs", () => {
    expect(parseScanInput("0xAbC0000000000000000000000000000000000001")).toBe("0xabc0000000000000000000000000000000000001");
    expect(parseScanInput("@g3rmxyz")).toBe("g3rmxyz");
    expect(parseScanInput("https://x.com/g3rmxyz")).toBe("g3rmxyz");
    expect(parseScanInput("https://app.ethos.network/profile/x/g3rmxyz")).toBe("g3rmxyz");
    expect(parseScanInput("https://app.ethos.network/profile/3708")).toBe("3708");
  });
  it("rejects junk", () => {
    expect(parseScanInput("")).toBeNull();
    expect(parseScanInput("https://example.com/whatever")).toBeNull();
    expect(parseScanInput("not a handle!")).toBeNull();
  });
});

describe("formatRelativeTime", () => {
  it("rounds to the largest sensible unit", () => {
    const now = Date.now();
    expect(formatRelativeTime(now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000)).toBe("5 min ago");
    expect(formatRelativeTime(now - 3 * 3_600_000)).toBe("3 hours ago");
    expect(formatRelativeTime(now - 2 * 86_400_000)).toBe("2 days ago");
    expect(formatRelativeTime(now - 95 * 86_400_000)).toBe("3 months ago");
  });
});
