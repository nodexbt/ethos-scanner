import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE || "";
const BYPASS_AUTH = process.env.BYPASS_AUTH === "true";

export const authOptions: NextAuthOptions = {
  providers: [
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
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
