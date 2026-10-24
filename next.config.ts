import type { NextConfig } from "next";

// Everything is served from ethos.tools: the landing page at /, the tools
// as paths (/scanner, ...). app.ethos.tools was the app's host for a while;
// it now redirects to the same path here so links shared from it keep working.
const HOST = "ethos.tools";
const OLD_APP_HOST = "app.ethos.tools";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // First, so an old-host link takes one hop, not two.
      {
        source: "/:path*",
        has: [{ type: "host", value: OLD_APP_HOST }],
        destination: `https://${HOST}/:path*`,
        permanent: true,
      },
      // Legacy routes from before the scanner moved under /scanner.
      { source: "/network", destination: "/scanner?tab=network", permanent: true },
      {
        source: "/",
        has: [{ type: "query", key: "tab" }],
        destination: "/scanner",
        permanent: true,
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
