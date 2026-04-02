import NextAuth, { type NextAuthOptions } from "next-auth";
import TwitterProvider from "next-auth/providers/twitter";
import CredentialsProvider from "next-auth/providers/credentials";

const BYPASS_AUTH = process.env.BYPASS_AUTH === "true";

// Allowed Twitter usernames (lowercase). Add more as needed.
const ALLOWED_USERS = new Set(
  (process.env.ALLOWED_TWITTER_USERS || "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean)
);

const providers: NextAuthOptions["providers"] = [];

if (BYPASS_AUTH) {
  // Local dev: auto-login without Twitter
  providers.push(
    CredentialsProvider({
      name: "Dev Login",
      credentials: {},
      async authorize() {
        return {
          id: "dev",
          name: "Dev User",
          email: "dev@localhost",
          image: null,
        };
      },
    })
  );
} else {
  providers.push(
    TwitterProvider({
      clientId: process.env.TWITTER_CLIENT_ID!,
      clientSecret: process.env.TWITTER_CLIENT_SECRET!,
      version: "2.0",
    })
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  callbacks: {
    async signIn({ profile, credentials }) {
      if (BYPASS_AUTH && credentials !== undefined) return true;

      const username = (profile as { data?: { username?: string } })?.data?.username?.toLowerCase();
      if (!username) return false;
      if (ALLOWED_USERS.size === 0) return true;
      return ALLOWED_USERS.has(username);
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { twitterUsername?: string }).twitterUsername =
          (token.twitterUsername as string) || (BYPASS_AUTH ? "dev" : undefined);
      }
      return session;
    },
    async jwt({ token, profile }) {
      if (profile) {
        const twitterProfile = profile as { data?: { username?: string } };
        token.twitterUsername = twitterProfile?.data?.username || null;
      }
      return token;
    },
  },
  pages: {
    signIn: "/",
    error: "/",
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
