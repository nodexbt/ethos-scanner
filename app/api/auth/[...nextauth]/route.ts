import NextAuth, { type NextAuthOptions } from "next-auth";
import TwitterProvider from "next-auth/providers/twitter";
import { fetchProfile } from "@/lib/ethos";
import { isAdminProfileId } from "@/lib/admin";
import { isAllowed, seedFromEnvIfMissing } from "@/lib/db/allowed-users";

// Run the env→DB seed at most once per process. The seeded rows make the
// transition from ETHOS_PROFILE_ALLOWLIST to the DB-backed allowlist
// invisible to existing users — anyone who could log in before the
// migration can still log in after.
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
    signIn: "/",
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
      if (!username) return "/?error=NoUsername";

      const ethos = await fetchProfile(username);
      if (!ethos) return "/?error=NoEthosProfile";

      await ensureSeeded();

      if (ethos.profileId === null || !(await isAllowed(ethos.profileId))) {
        return "/?error=NotAllowlisted";
      }
      return true;
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "twitter" && profile) {
        // @ts-expect-error - Twitter v2 profile has data field
        const data = profile.data || profile;
        token.twitterId = data.id;
        token.twitterUsername = data.username;

        // Fetch and attach Ethos profile
        const ethos = await fetchProfile(data.username);
        if (ethos) {
          token.ethosProfileId = ethos.profileId;
          token.ethosDisplayName = ethos.displayName;
          token.ethosAvatarUrl = ethos.avatarUrl;
          token.ethosScore = ethos.score;
          token.ethosProfileUrl = ethos.links?.profile;
        }
      }

      // Re-check allowlist on every token refresh so removals take effect.
      // (requireAuth() also re-checks on every protected request, so this
      // is the second line of defense, not the only one.)
      if (token.ethosProfileId !== undefined) {
        const stillAllowed =
          typeof token.ethosProfileId === "number" &&
          (await isAllowed(token.ethosProfileId));
        if (!stillAllowed) {
          // Revoke: clear identity fields so session callback won't populate user
          delete token.ethosProfileId;
          delete token.ethosDisplayName;
          delete token.ethosAvatarUrl;
          delete token.ethosScore;
          delete token.ethosProfileUrl;
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
