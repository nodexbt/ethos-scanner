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

function extractTwitterUsername(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const p = profile as Record<string, unknown>;

  // Twitter OAuth 2.0 can return username at different paths
  // depending on NextAuth version
  if (typeof p.username === "string") return p.username.toLowerCase();
  if (p.data && typeof p.data === "object") {
    const data = p.data as Record<string, unknown>;
    if (typeof data.username === "string") return data.username.toLowerCase();
  }
  // Fallback: check screen_name (OAuth 1.0a style)
  if (typeof p.screen_name === "string") return p.screen_name.toLowerCase();

  return null;
}

export const authOptions: NextAuthOptions = {
  providers,
  debug: !BYPASS_AUTH, // Enable debug logging for OAuth on production
  callbacks: {
    async signIn({ profile, credentials }) {
      if (BYPASS_AUTH && credentials !== undefined) return true;

      console.log("[auth] signIn profile:", JSON.stringify(profile, null, 2));

      const username = extractTwitterUsername(profile);
      console.log("[auth] extracted username:", username);
      console.log("[auth] allowed users:", [...ALLOWED_USERS]);

      if (!username) {
        console.log("[auth] rejected: no username found in profile");
        return false;
      }
      if (ALLOWED_USERS.size === 0) return true;
      const allowed = ALLOWED_USERS.has(username);
      console.log("[auth] allowed:", allowed);
      return allowed;
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
        token.twitterUsername = extractTwitterUsername(profile);
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
