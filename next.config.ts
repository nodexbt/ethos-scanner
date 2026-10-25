import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Old in-page tab addresses (/?tab=… and /scanner?tab=…) now have pages.
    const legacyTabs = ["/", "/scanner"].flatMap((source) => [
      {
        source,
        has: [{ type: "query" as const, key: "tab", value: "network" }],
        destination: "/network",
        permanent: true,
      },
      {
        source,
        has: [{ type: "query" as const, key: "tab", value: "(?<scope>yours|verified)" }],
        destination: "/scans?scope=:scope",
        permanent: true,
      },
      {
        source,
        // Next anchors this as ^…$; the group keeps the alternation anchored.
        has: [{ type: "query" as const, key: "tab", value: "(scans|all)" }],
        destination: "/scans",
        permanent: true,
      },
    ]);
    return [
      ...legacyTabs,
      // Any other old tab value (e.g. /?tab=scanner) lands on the scanner,
      // as the old single page did.
      {
        source: "/",
        has: [{ type: "query" as const, key: "tab" }],
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
