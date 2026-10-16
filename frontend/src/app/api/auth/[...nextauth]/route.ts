import NextAuth, { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";

export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
    CredentialsProvider({
      name: "Empleado",
      credentials: {
        numEmpleado: { label: "No. Empleado", type: "text" },
        password: { label: "Contraseña", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.numEmpleado || !credentials?.password) return null;

        try {
          const res = await fetch("http://localhost:8000/api/auth/login-empleado", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              numero_empleado: credentials.numEmpleado,
              password: credentials.password,
            }),
          });

          const data = await res.json();
          if (res.ok && data?.user) {
            return data.user;
          }
          return null;
        } catch (err) {
          return null;
        }
      }
    })
  ],
  session: {
    strategy: "jwt",
    maxAge: 10 * 60,
  },
  callbacks: {
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
        token.role = user.rol || "docente";
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };