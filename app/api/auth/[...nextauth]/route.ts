import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import TwitterProvider from "next-auth/providers/twitter";
import { fetchProfile } from "@/lib/ethos";

const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE || "";
const BYPASS_AUTH = process.env.BYPASS_AUTH === "true";
const MIN_ETHOS_SCORE = 1800;

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
    CredentialsProvider({
      name: "Passphrase",
      credentials: {
        passphrase: { label: "Passphrase", type: "password" },
      },
      async authorize(credentials) {
        if (BYPASS_AUTH) {
          return { id: "dev", name: "Dev User" };
        }
        if (credentials?.passphrase && credentials.passphrase === ADMIN_PASSPHRASE) {
          return { id: "admin", name: "Admin" };
        }
        return null;
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
      if (ethos.score < MIN_ETHOS_SCORE) return "/?error=LowScore";
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
