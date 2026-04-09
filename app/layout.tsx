import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, IBM_Plex_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { SessionProvider } from "@/components/session-provider";
import { SmoothScroll } from "@/components/smooth-scroll";
import { Background } from "@/components/background";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// metadataBase is required for resolving relative OG/Twitter image URLs into
// absolute ones. Prefer an explicit NEXT_PUBLIC_SITE_URL when set, otherwise
// fall back to the Vercel-provided production URL, and finally to localhost
// for development. Without this, social crawlers would see localhost URLs.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Ethos Scanner",
  description: "Sybil cluster detection on Ethos Network via on-chain transaction analysis.",
  openGraph: {
    title: "Ethos Scanner",
    description: "Sybil cluster detection on Ethos Network via on-chain transaction analysis.",
    type: "website",
    siteName: "Ethos Scanner",
    // images is auto-populated by app/opengraph-image.tsx — Next 16 picks it
    // up from the file convention, so we don't list it explicitly here.
  },
  twitter: {
    card: "summary_large_image",
    title: "Ethos Scanner",
    description: "Sybil cluster detection on Ethos Network via on-chain transaction analysis.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${ibmPlexMono.variable} antialiased`}
      >
        <SessionProvider>
          <ThemeProvider>
            <Background />
            <SmoothScroll />
            <main className="min-h-screen">{children}</main>
          </ThemeProvider>
        </SessionProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
