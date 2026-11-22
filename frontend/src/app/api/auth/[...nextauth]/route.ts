import NextAuth, { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { createHmac } from "crypto";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ADMIN_EMAIL = "tup7041@tecplayacar.edu.mx";

// Duración del token que el backend acepta como prueba de identidad (segundos).
// El panel docente consulta al backend durante toda la jornada, por eso es de 12 h.
const BACKEND_TOKEN_TTL = 12 * 3600;

/**
 * Firma un token que el backend FastAPI verifica con el mismo secreto
 * (BACKEND_AUTH_SECRET, idéntico en frontend y backend, mínimo 32 caracteres).
 * Solo se ejecuta en el servidor de Next.js: el secreto nunca llega al navegador.
 */
function firmarTokenBackend(email: string): string | null {
  const secreto = process.env.BACKEND_AUTH_SECRET;
  if (!secreto || secreto.length < 32 || !email) return null;
  const payload = Buffer.from(
    JSON.stringify({
      typ: "usr",
      email: email.trim().toLowerCase(),
      exp: Math.floor(Date.now() / 1000) + BACKEND_TOKEN_TTL,
    })
  ).toString("base64url");
  const firma = createHmac("sha256", secreto).update(payload).digest("hex");
  return `${payload}.${firma}`;
}

export const authOptions: AuthOptions = {
  // Sin valor de respaldo: si falta NEXTAUTH_SECRET, NextAuth falla en vez de usar una clave conocida.
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
    CredentialsProvider({
      name: "Empleado",
      credentials: {
        numEmpleado: { label: "No. Empleado", type: "text" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const numEmpleado = credentials?.numEmpleado?.trim();
        const password = credentials?.password;
        if (!numEmpleado || !password) return null;

        try {
          const res = await fetch(`${API_URL}/api/auth/login-empleado`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ numero_empleado: numEmpleado, password }),
          });
          if (!res.ok) return null;

          const data = await res.json();
          const u = data?.user;
          if (!u?.email) return null;
          return { id: String(u.id), name: u.name, email: u.email, rol: u.rol };
        } catch {
          // Sin respaldo: si el backend no responde, no se inicia sesión.
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
    async signIn({ user, account, profile }: any) {
      if (account?.provider === "google") {
        const email = user?.email?.toLowerCase();
        if (!email || profile?.email_verified === false) return false;
        return email.endsWith("@tecplayacar.edu.mx") || email.endsWith("@tup.edu.mx");
      }
      return true;
    },
    async jwt({ token, user, account }: any) {
      if (user) {
        token.id = user.id;
        // ADMIN solo con una cuenta de Google verificada; nunca por número de empleado.
        const esAdmin =
          account?.provider === "google" && user.email?.toLowerCase() === ADMIN_EMAIL;
        token.role = esAdmin ? "ADMIN" : "DOCENTE";
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      // Prueba de identidad para el backend (firmada en el servidor).
      session.backendToken = token.email ? firmarTokenBackend(token.email as string) : null;
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
