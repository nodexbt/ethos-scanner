import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in" };

// Rendered per request so ?callbackUrl and ?error are in the HTML rather
// than filled in after hydration.
export const dynamic = "force-dynamic";

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
