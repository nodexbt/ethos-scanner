import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchProfilesByAddresses } from "@/lib/ethos";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const profile = (addr: string, id: number) => ({ profileId: id, userkeys: [`address:${addr}`], displayName: `p${id}` });

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("fetchProfilesByAddresses", () => {
  it("retries the bulk call on 429 instead of falling back to one call per address", async () => {
    fetchMock.mockResolvedValueOnce(res(429, {})).mockResolvedValueOnce(res(200, [profile(A, 1), profile(B, 2)]));
    const onError = vi.fn();
    const p = fetchProfilesByAddresses([A, B], onError);
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out.get(A)?.profileId).toBe(1);
    expect(out.get(B)?.profileId).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith("/users/by/address"))).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a batch that keeps failing so the scan is marked degraded", async () => {
    fetchMock.mockResolvedValue(res(503, {}));
    const onError = vi.fn();
    const p = fetchProfilesByAddresses([A, B], onError);
    await vi.runAllTimersAsync();
    expect((await p).size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/503/);
  });

  it("treats a 200 with an unexpected body as a failure, not as no profiles", async () => {
    fetchMock.mockResolvedValue(res(200, { message: "maintenance" }));
    const onError = vi.fn();
    const out = await fetchProfilesByAddresses([A], onError);
    expect(out.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/unexpected body/));
  });

  it("does not retry a 4xx that is not a rate limit", async () => {
    fetchMock.mockResolvedValue(res(400, {}));
    const onError = vi.fn();
    await fetchProfilesByAddresses([A], onError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
