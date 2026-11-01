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
      },
      async authorize(credentials) {
        if (!credentials?.numEmpleado) return null;

        const numEmpUpper = credentials.numEmpleado.trim().toUpperCase();

        try {
          // Consulta al backend FastAPI sin exigir contraseña
          const res = await fetch(
            `http://localhost:8000/api/usuarios/me?num_empleado=${encodeURIComponent(numEmpUpper)}`,
            { method: "GET" }
          );

          if (res.ok) {
            const usuario = await res.json();
            return {
              id: usuario.id.toString(),
              name: usuario.nombre,
              email: usuario.email,
              rol: usuario.rol,
            };
          }

          // Fallback credencial de prueba predeterminada
          if (numEmpUpper === "DOC-2026-01") {
            return {
              id: "1",
              name: "Docente de Prueba",
              email: "docente@tup.edu.mx",
              rol: "DOCENTE",
            };
          }

          return null;
        } catch (err) {
          if (numEmpUpper === "DOC-2026-01") {
            return {
              id: "1",
              name: "Docente de Prueba",
              email: "docente@tup.edu.mx",
              rol: "DOCENTE",
            };
          }
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 10 * 60,
  },
  callbacks: {
    async signIn({ user, account }: any) {
      if (account?.provider === "google" && user?.email) {
        const email = user.email.toLowerCase();
        if (email.endsWith("@tecplayacar.edu.mx") || email.endsWith("@tup.edu.mx")) {
          return true;
        }
        return false;
      }
      return true;
    },
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
        if (user.email === "tup7041@tecplayacar.edu.mx") {
          token.role = "ADMIN";
        } else {
          token.role = (user.rol || user.role || "DOCENTE").toUpperCase();
        }
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