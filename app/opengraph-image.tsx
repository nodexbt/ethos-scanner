import { ImageResponse } from "next/og";

// Next 16 convention: any app/opengraph-image.{png,jpg,tsx} is auto-wired into
// metadata for every route under this segment. Routes that need a different
// preview (e.g. /s/[shareId] showing per-scan stats) can override by dropping
// their own opengraph-image file in their segment folder.

export const alt = "Ethos Scanner — sybil cluster detection on Ethos Network";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(ellipse at top, #1a1a1a 0%, #000000 70%)",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "80px",
        }}
      >
        {/* Shield icon as inline SVG so we don't pull lucide-react into the
            edge runtime that ImageResponse uses. */}
        <svg
          width="120"
          height="120"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        </svg>

        <div
          style={{
            fontSize: 84,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginTop: 32,
            display: "flex",
          }}
        >
          Ethos Scanner
        </div>

        <div
          style={{
            fontSize: 32,
            color: "#a1a1aa",
            marginTop: 16,
            textAlign: "center",
            maxWidth: 900,
            display: "flex",
          }}
        >
          Sybil cluster detection on Ethos Network
        </div>

        <div
          style={{
            fontSize: 22,
            color: "#71717a",
            marginTop: 56,
            display: "flex",
          }}
        >
          On-chain transaction analysis · multi-network · funder graph
        </div>
      </div>
    ),
    size
  );
}
