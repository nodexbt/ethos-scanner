import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The network view became an in-app tab; keep the old route working.
    return [{ source: "/network", destination: "/?tab=network", permanent: true }];
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
