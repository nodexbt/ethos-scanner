import type { NextConfig } from "next";
import type { Redirect } from "next/dist/lib/load-custom-routes";

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
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
