import NextAuth, { type NextAuthOptions } from "next-auth";
import TwitterProvider from "next-auth/providers/twitter";

// Allowed Twitter usernames (lowercase). Add more as needed.
const ALLOWED_USERS = new Set(
  (process.env.ALLOWED_TWITTER_USERS || "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean)
);

export const authOptions: NextAuthOptions = {
  providers: [
    TwitterProvider({
      clientId: process.env.TWITTER_CLIENT_ID!,
      clientSecret: process.env.TWITTER_CLIENT_SECRET!,
      version: "2.0",
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      // Gate: only allow specific Twitter users
      const username = (profile as { data?: { username?: string } })?.data?.username?.toLowerCase();
      if (!username) return false;
      if (ALLOWED_USERS.size === 0) return true; // no allowlist = allow all
      return ALLOWED_USERS.has(username);
    },
    async session({ session, token }) {
      // Attach Twitter username to session
      if (session.user) {
        (session.user as { twitterUsername?: string }).twitterUsername = token.twitterUsername as string;
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
