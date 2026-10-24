import type { NextConfig } from "next";

// One deployment serves two hosts: ethos.tools (landing page only) and
// app.ethos.tools (everything that needs a session, plus the public profile
// and share pages). Local development serves both from one origin.
const LANDING_HOST = "ethos.tools";
const APP_HOST = "app.ethos.tools";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Legacy routes from before the scanner moved under /scanner.
      { source: "/network", destination: "/scanner?tab=network", permanent: true },
      {
        source: "/",
        has: [{ type: "query", key: "tab" }],
        destination: "/scanner",
        permanent: true,
      },
      // The app host has no landing page; its root is the scanner.
      {
        source: "/",
        has: [{ type: "host", value: APP_HOST }],
        destination: "/scanner",
        permanent: false,
      },
      // The landing host serves nothing but the landing page. Its own
      // assets (/_next/*, favicon, social images) must stay on this host:
      // redirects run before the filesystem, so without the exclusion the
      // page's CSS would be fetched from the app host.
      {
        source: "/:path((?!_next/|favicon\\.ico|opengraph-image|twitter-image).+)",
        has: [{ type: "host", value: LANDING_HOST }],
        destination: `https://${APP_HOST}/:path`,
        permanent: false,
      },
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
