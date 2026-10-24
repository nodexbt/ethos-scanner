/**
 * Human-readable text for the ?error= codes the NextAuth signIn callback
 * redirects with (app/api/auth/[...nextauth]/route.ts). Client-safe: no
 * server imports. Unknown codes fall back to a generic message so a new
 * code never renders as a blank error.
 */
import { MIN_SCORE } from "@/lib/access";

const MESSAGES: Record<string, string> = {
  NotEligible: `Access requires an Ethos validator NFT, or a human-verified profile with a score of ${MIN_SCORE} or higher.`,
  // Legacy code, kept so old links still show a sensible message.
  NotAllowlisted: "Your Ethos profile is not on the allowlist.",
  NoEthosProfile: "No Ethos profile found for your X account.",
  NoUsername: "Could not read your X username.",
  NoTwitterId: "Could not read your X account id.",
  OAuthCallback: "X did not complete the sign-in. Please try again.",
  AccessDenied: "Sign-in was denied.",
};

export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? "Sign-in failed. Please try again.";
}
