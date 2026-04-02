import NextAuth, { type NextAuthOptions } from "next-auth";
import TwitterProvider from "next-auth/providers/twitter";
import CredentialsProvider from "next-auth/providers/credentials";

const BYPASS_AUTH = process.env.BYPASS_AUTH === "true";

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
  if (typeof p.username === "string") return p.username.toLowerCase();
  if (p.data && typeof p.data === "object") {
    const data = p.data as Record<string, unknown>;
    if (typeof data.username === "string") return data.username.toLowerCase();
  }
  if (typeof p.screen_name === "string") return p.screen_name.toLowerCase();
  return null;
}

// Fix for Vercel serverless: ensure cookies work across invocations
const useSecureCookies = !BYPASS_AUTH;
const hostName = process.env.NEXTAUTH_URL
  ? new URL(process.env.NEXTAUTH_URL).hostname
  : "localhost";

export const authOptions: NextAuthOptions = {
  providers,
  debug: !BYPASS_AUTH,
  cookies: {
    sessionToken: {
      name: useSecureCookies ? `__Secure-next-auth.session-token` : `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
        domain: undefined,
      },
    },
    callbackUrl: {
      name: useSecureCookies ? `__Secure-next-auth.callback-url` : `next-auth.callback-url`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
        domain: undefined,
      },
    },
    csrfToken: {
      name: useSecureCookies ? `__Host-next-auth.csrf-token` : `next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    pkceCodeVerifier: {
      name: useSecureCookies ? `__Secure-next-auth.pkce.code_verifier` : `next-auth.pkce.code_verifier`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
        maxAge: 900,
      },
    },
    state: {
      name: useSecureCookies ? `__Secure-next-auth.state` : `next-auth.state`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
        maxAge: 900,
      },
    },
  },
  callbacks: {
    async signIn({ profile, credentials }) {
      if (BYPASS_AUTH && credentials !== undefined) return true;

      console.log("[auth] signIn callback reached");
      console.log("[auth] profile:", JSON.stringify(profile, null, 2));

      const username = extractTwitterUsername(profile);
      console.log("[auth] username:", username, "allowed:", [...ALLOWED_USERS]);

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
