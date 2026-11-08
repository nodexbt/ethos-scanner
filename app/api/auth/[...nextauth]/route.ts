import NextAuth, { type NextAuthOptions } from "next-auth";
import TwitterProvider from "next-auth/providers/twitter";
import { fetchProfileByX } from "@/lib/ethos";
import { isAdminProfileId } from "@/lib/admin";
import { isAllowed, seedFromEnvIfMissing } from "@/lib/db/allowed-users";
import { meetsOpenAccessBar } from "@/lib/access";

// Run the env→DB seed at most once per process. The seeded rows make the
// transition from ETHOS_PROFILE_ALLOWLIST to the DB-backed allowlist
// invisible to existing users — anyone who could log in before the
// migration can still log in after.
// Resolve the Ethos profile for a Twitter login and verify it is attested
// to the caller's immutable Twitter user ID — not just the handle. Handles
// are recyclable: if an allowlisted user renames or abandons theirs, whoever
// registers the freed handle must not inherit their Ethos identity.
async function fetchAttestedProfile(username: string, twitterId: string) {
  const ethos = await fetchProfileByX(username);
  if (!ethos) return null;
  if (!ethos.userkeys?.includes(`service:x.com:${twitterId}`)) {
    console.error(
      `Ethos profile for @${username} is not attested to Twitter ID ${twitterId}`
    );
    return null;
  }
  return ethos;
}

/** How long the Ethos fields in a session token are trusted before they
    are re-read from the Ethos API. Access depends on score and human
    verification, which change; without this a 30-day session kept whatever
    the user had at sign-in. */
const ETHOS_REFRESH_MS = 60 * 60 * 1000;

function applyEthosToToken(
  token: Record<string, unknown>,
  ethos: NonNullable<Awaited<ReturnType<typeof fetchAttestedProfile>>>
) {
  token.ethosProfileId = ethos.profileId;
  token.ethosDisplayName = ethos.displayName;
  token.ethosAvatarUrl = ethos.avatarUrl;
  token.ethosScore = ethos.score;
  token.ethosHumanVerification = ethos.humanVerificationStatus;
  token.ethosValidatorNftCount = ethos.validatorNftCount;
  token.ethosProfileUrl = ethos.links?.profile;
  token.ethosCheckedAt = Date.now();
}

let seededThisProcess = false;
async function ensureSeeded() {
  if (seededThisProcess) return;
  seededThisProcess = true;
  try {
    await seedFromEnvIfMissing();
  } catch (err) {
    // Don't block sign-in on seed failure — `isAllowed` will fall back
    // to whatever's already in the DB.
    console.error("ensureSeeded failed:", err);
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    TwitterProvider({
      clientId: process.env.TWITTER_CLIENT_ID || "",
      clientSecret: process.env.TWITTER_CLIENT_SECRET || "",
      version: "2.0",
      userinfo: {
        url: "https://api.twitter.com/2/users/me",
        params: { "user.fields": "id,name,username,profile_image_url" },
        async request({ tokens }: { tokens: { access_token?: string } }) {
          const url = new URL("https://api.twitter.com/2/users/me");
          url.searchParams.set("user.fields", "id,name,username,profile_image_url");
          const res = await fetch(url.toString(), {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              "User-Agent": "ethos-scanner",
            },
          });
          if (!res.ok) {
            const body = await res.text();
            throw new Error(`Twitter userinfo ${res.status}: ${body}`);
          }
          return await res.json();
        },
      },
      profile(profile) {
        // Twitter v2 returns { data: { id, name, username, profile_image_url } }
        const data = profile.data || profile;
        return {
          id: data.id,
          name: data.name,
          email: null,
          image: data.profile_image_url?.replace(/_normal\./, "."),
        };
      },
    }),
  ],
  pages: {
    signIn: "/sign-in",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "twitter") return true;
      // @ts-expect-error - Twitter v2 profile has data field
      const data = profile?.data || profile;
      const username = data?.username;
      if (!username) return "/sign-in?error=NoUsername";
      if (!data?.id) return "/sign-in?error=NoTwitterId";

      const ethos = await fetchAttestedProfile(username, data.id);
      if (!ethos) return "/sign-in?error=NoEthosProfile";

      await ensureSeeded();

      // Open bar: validator NFT holder, OR human-verified with a high enough
      // score. The manual allowlist remains an override for anyone else.
      const onAllowlist =
        ethos.profileId !== null && (await isAllowed(ethos.profileId));
      if (!meetsOpenAccessBar(ethos) && !onAllowlist) {
        return "/sign-in?error=NotEligible";
      }
      return true;
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "twitter" && profile) {
        // @ts-expect-error - Twitter v2 profile has data field
        const data = profile.data || profile;
        token.twitterId = data.id;
        token.twitterUsername = data.username;

        // Fetch and attach Ethos profile (attested to the immutable Twitter ID)
        const ethos = await fetchAttestedProfile(data.username, data.id);
        if (ethos) applyEthosToToken(token, ethos);
      } else if (
        token.ethosProfileId !== undefined &&
        typeof token.twitterUsername === "string" &&
        typeof token.twitterId === "string" &&
        Date.now() - (typeof token.ethosCheckedAt === "number" ? token.ethosCheckedAt : 0) > ETHOS_REFRESH_MS
      ) {
        // Refresh the score / verification / validator fields the access
        // rule below reads, at most hourly per session. An Ethos API error
        // keeps the previous values (and retries next request) rather than
        // signing everyone out during an outage; a profile that is no
        // longer attested to this X account is revoked below.
        try {
          const ethos = await fetchAttestedProfile(token.twitterUsername, token.twitterId);
          if (ethos) {
            applyEthosToToken(token, ethos);
          } else {
            // Profile gone or no longer attested: drop the open-bar fields so
            // only the allowlist can keep this session alive.
            token.ethosScore = undefined;
            token.ethosHumanVerification = undefined;
            token.ethosValidatorNftCount = undefined;
            token.ethosCheckedAt = Date.now();
          }
        } catch (err) {
          console.error("Ethos refresh failed, keeping cached eligibility:", err);
        }
      }

      // Re-check allowlist on every token refresh so removals take effect.
      // (requireAuth() also re-checks on every protected request, so this
      // is the second line of defense, not the only one.)
      if (token.ethosProfileId !== undefined) {
        const stillAllowed =
          (typeof token.ethosProfileId === "number" &&
            (await isAllowed(token.ethosProfileId))) ||
          meetsOpenAccessBar({
            score: token.ethosScore as number | undefined,
            humanVerificationStatus: token.ethosHumanVerification as
              | string
              | undefined,
            validatorNftCount: token.ethosValidatorNftCount as
              | number
              | undefined,
          });
        if (!stillAllowed) {
          // Revoke: clear identity fields so session callback won't populate user
          delete token.ethosProfileId;
          delete token.ethosDisplayName;
          delete token.ethosAvatarUrl;
          delete token.ethosScore;
          delete token.ethosHumanVerification;
          delete token.ethosValidatorNftCount;
          delete token.ethosProfileUrl;
          delete token.ethosCheckedAt;
          delete token.twitterId;
          delete token.twitterUsername;
          token.name = undefined;
          token.email = undefined;
          token.picture = undefined;
          token.sub = undefined;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.twitterId) {
        // @ts-expect-error - extending session user
        session.user.twitterId = token.twitterId;
        // @ts-expect-error - extending session user
        session.user.twitterUsername = token.twitterUsername;
      }
      if (token.ethosProfileId !== undefined && session.user) {
        // @ts-expect-error - extending session user with ethos data
        session.user.ethos = {
          profileId: token.ethosProfileId,
          displayName: token.ethosDisplayName,
          avatarUrl: token.ethosAvatarUrl,
          score: token.ethosScore,
          humanVerificationStatus: token.ethosHumanVerification,
          validatorNftCount: token.ethosValidatorNftCount,
          profileUrl: token.ethosProfileUrl,
        };
        // @ts-expect-error - extending session user with admin flag
        session.user.isAdmin = isAdminProfileId(token.ethosProfileId as number);
        // Use Ethos avatar/name as the visible identity
        if (token.ethosDisplayName) session.user.name = token.ethosDisplayName as string;
        if (token.ethosAvatarUrl) session.user.image = token.ethosAvatarUrl as string;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
