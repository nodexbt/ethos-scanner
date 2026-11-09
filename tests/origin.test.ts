import { describe, it, expect } from "vitest";
import { isTrustedOrigin } from "@/lib/origin";

const h = (init: Record<string, string>) => new Headers(init);

describe("isTrustedOrigin", () => {
  it("allows a same-origin browser request", () => {
    expect(isTrustedOrigin(h({ host: "ethos.tools", origin: "https://ethos.tools", "sec-fetch-site": "same-origin" }))).toBe(true);
  });
  it("allows a request with no browser origin headers (curl, server to server)", () => {
    expect(isTrustedOrigin(h({ host: "ethos.tools" }))).toBe(true);
  });
  it("trusts the proxied host on Vercel", () => {
    expect(isTrustedOrigin(h({ host: "internal:3000", "x-forwarded-host": "ethos.tools", origin: "https://ethos.tools" }))).toBe(true);
  });
  it("refuses a cross-site request by Sec-Fetch-Site", () => {
    expect(isTrustedOrigin(h({ host: "ethos.tools", origin: "https://ethos.tools", "sec-fetch-site": "cross-site" }))).toBe(false);
  });
  it("refuses an Origin that is not this host", () => {
    expect(isTrustedOrigin(h({ host: "ethos.tools", origin: "https://evil.example" }))).toBe(false);
    expect(isTrustedOrigin(h({ host: "ethos.tools", origin: "https://ethos.tools.evil.example" }))).toBe(false);
  });
  it("refuses an opaque or malformed Origin", () => {
    expect(isTrustedOrigin(h({ host: "ethos.tools", origin: "null" }))).toBe(false);
    expect(isTrustedOrigin(h({ host: "ethos.tools", origin: "not a url" }))).toBe(false);
  });
});
