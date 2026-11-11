/**
 * Cross-site request forgery guard for the API.
 *
 * Sessions are cookies, and cookies ride along on requests other sites
 * trigger. NextAuth sets SameSite=Lax, which already stops a cross-site
 * POST from carrying the session in modern browsers; this check is the
 * second lock (OWASP ASVS 4.2.2, "verify the origin of state-changing
 * requests"), so the protection no longer depends on one cookie attribute
 * and holds up when automation adds other credentials.
 *
 * Browsers send `Sec-Fetch-Site` on every request and `Origin` on every
 * POST/PUT/PATCH/DELETE and on cross-origin reads. A request is refused
 * when either says it came from another site. Requests with neither
 * header (same-origin GETs, curl, server-to-server) are allowed through:
 * they carry no ambient browser credentials to abuse.
 */
export function isTrustedOrigin(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site === "cross-site") return false;

  const origin = headers.get("origin");
  if (!origin || origin === "null") return origin === null;

  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.split(",")[0].trim().toLowerCase();
  } catch {
    return false;
  }
}
