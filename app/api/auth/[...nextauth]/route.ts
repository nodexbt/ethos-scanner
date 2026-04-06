import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import TwitterProvider from "next-auth/providers/twitter";

const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE || "";
const BYPASS_AUTH = process.env.BYPASS_AUTH === "true";

export const authOptions: NextAuthOptions = {
  providers: [
    TwitterProvider({
      clientId: process.env.TWITTER_CLIENT_ID || "",
      clientSecret: process.env.TWITTER_CLIENT_SECRET || "",
      version: "2.0",
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
    async jwt({ token, account, profile }) {
      if (account?.provider === "twitter" && profile) {
        // @ts-expect-error - Twitter v2 profile has data field
        const data = profile.data || profile;
        token.twitterId = data.id;
        token.twitterUsername = data.username;
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
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
