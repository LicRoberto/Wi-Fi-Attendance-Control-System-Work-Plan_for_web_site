"use client";

import { useSession, signOut } from "next-auth/react";
import { useState, useEffect } from "react";

import LoginView from "@/components/LoginView";
import DocenteDashboard from "@/components/DocenteDashboard";
import AdminDashboard from "@/components/AdminDashboard";

const TIEMPO_EXPIRACION_MS = 10 * 60 * 1000; // 10 Minutos

export default function Home() {
  const { data: session, status } = useSession();
  const [rolUsuario, setRolUsuario] = useState<string>("docente");
  const [mensajeSesion, setMensajeSesion] = useState<string | null>(null);

  useEffect(() => {
    // Control de tiempo fuera/cierre de pestaña
    const checkExpiracionSesion = () => {
      const ultimaActividad = localStorage.getItem("tup_last_active");
      const ahora = Date.now();

      if (ultimaActividad && session) {
        const tiempoTranscurrido = ahora - parseInt(ultimaActividad, 10);
        if (tiempoTranscurrido > TIEMPO_EXPIRACION_MS) {
          localStorage.removeItem("tup_last_active");
          setMensajeSesion("Su sesión ha excedido el tiempo límite. Por favor, inicie sesión de nuevo.");
          signOut({ redirect: false });
          return true;
        }
      }
      return false;
    };

    if (session) {
      const expirado = checkExpiracionSesion();
      if (!expirado) {
        localStorage.setItem("tup_last_active", Date.now().toString());

        // Consultar el rol del usuario en la API
        fetch(`http://localhost:8000/api/usuarios/me?email=${encodeURIComponent(session.user?.email || "")}`)
          .then((res) => res.json())
          .then((data) => {
            if (data?.rol) setRolUsuario(data.rol);
          })
          .catch(() => setRolUsuario("docente"));
      }
    }

    // Guardar marca de tiempo al cerrar o cambiar de ventana
    const actualizarUltimaActividad = () => {
      if (session) {
        localStorage.setItem("tup_last_active", Date.now().toString());
      }
    };

    window.addEventListener("beforeunload", actualizarUltimaActividad);
    return () => {
      window.removeEventListener("beforeunload", actualizarUltimaActividad);
    };
  }, [session]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center text-slate-700">
        <p className="text-lg font-medium animate-pulse">Cargando sistema TUP...</p>
      </div>
    );
  }

  if (!session) {
    return <LoginView mensajeError={mensajeSesion} />;
  }

  if (rolUsuario === "admin") {
    return <AdminDashboard session={session} />;
  }

  return <DocenteDashboard session={session} />;
}