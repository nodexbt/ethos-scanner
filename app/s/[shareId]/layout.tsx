import type { Metadata } from "next";

// The share URL embeds the secret share token (/s/<token>). Without a
// referrer policy the browser would put that full URL in the Referer header
// on any outbound click (Ethos profile, explorer, Twitter links in the
// results) or resource load, leaking the token to third-party logs and
// undermining the "unguessable link" protection. no-referrer strips it.
export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
