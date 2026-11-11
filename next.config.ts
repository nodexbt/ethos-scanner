import type { NextConfig } from "next";
import type { Redirect } from "next/dist/lib/load-custom-routes";

/**
 * Content-Security-Policy for every response.
 *
 * What it buys: no plugins (`object-src`), no injected <base> rewrites,
 * forms post only to this host, the page cannot be framed, and scripts,
 * fetches and workers come only from this origin plus Vercel's analytics.
 * A script that does get injected cannot load code from or exfiltrate to
 * an attacker's host.
 *
 * What it does not buy yet: `script-src` keeps 'unsafe-inline'. Next.js
 * renders its React Server Components payload as inline <script> tags and
 * only nonces them when the page is rendered per request. The landing
 * page and the app shell (/scanner, /scans, /network) are prerendered at
 * build time, so a nonce would either break them or force every page to
 * render dynamically. Hashes don't help: the payload differs per page.
 * The upgrade path is a proxy.ts that sets a per-request nonce and
 * `'strict-dynamic'`, accepting dynamic rendering for those pages.
 *
 * `img-src https:` because Ethos avatars are hosted on many CDNs.
 * `'unsafe-eval'` is dev-only (Next's hot reloading needs it).
 */
function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV !== "production";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://va.vercel-scripts.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://va.vercel-scripts.com https://vitals.vercel-insights.com",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

const nextConfig: NextConfig = {
  async redirects() {
    // Old in-page tab addresses (/?tab=… and /scanner?tab=…) now have pages.
    // Temporary (307), so browsers don't cache them for good the way the
    // first /network redirect was. The query string is passed through, so
    // an old cached /network → /scanner?tab=network ends at
    // /network?tab=network rather than looping.
    const legacyTabs: Redirect[] = ["/", "/scanner"].flatMap((source): Redirect[] => [
      {
        source,
        has: [{ type: "query", key: "tab", value: "network" }],
        destination: "/network",
        permanent: false,
      },
      {
        source,
        has: [{ type: "query", key: "tab", value: "(?<scope>yours|verified)" }],
        destination: "/scans?scope=:scope",
        permanent: false,
      },
      {
        source,
        // Next anchors this as ^…$; the group keeps the alternation anchored.
        has: [{ type: "query", key: "tab", value: "(scans|all)" }],
        destination: "/scans",
        permanent: false,
      },
    ]);
    return [
      ...legacyTabs,
      // Any other old tab value (e.g. /?tab=scanner) lands on the scanner,
      // as the old single page did.
      {
        source: "/",
        has: [{ type: "query", key: "tab" }],
        destination: "/scanner",
        permanent: true,
      },
      // Follow Check needs the X search provider; until it is funded the
      // address leads to the scanner instead of a "disabled" notice.
      ...(process.env.NEXT_PUBLIC_TWITTER_SEARCH_ENABLED === "true"
        ? []
        : [{ source: "/follows", destination: "/scanner", permanent: false }]),
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
