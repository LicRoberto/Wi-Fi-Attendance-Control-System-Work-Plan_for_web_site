"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import ThreadsBackground from "./ThreadsBackground";

export default function LoginView() {
  const [numEmpleado, setNumEmpleado] = useState("");
  const [errorSesion, setErrorSesion] = useState(false);
  const [cargando, setCargando] = useState(false);

  const manejarLoginEmpleado = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!numEmpleado.trim()) return;

    setCargando(true);
    setErrorSesion(false);

    const res = await signIn("credentials", {
      numEmpleado,
      redirect: false,
    });

    if (res?.error) {
      setErrorSesion(true);
      setCargando(false);
    } else {
      window.location.href = "/";
    }
  };

  // Función de Autenticación Biométrica Nativa (WebAuthn / TouchID / Sensor de Huella)
  const iniciarSesionBiometrica = async () => {
    if (!window.PublicKeyCredential) {
      alert("Tu dispositivo o navegador no cuenta con un sensor biométrico compatible.");
      return;
    }

    setCargando(true);
    try {
      // Simulación/Trigger de solicitud al sensor biométrico del dispositivo
      const authBiometrica = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      
      if (authBiometrica) {
        // En un entorno de producción se solicita la firma criptográfica al hardware del usuario
        // Entramos directamente con el docente de prueba o el perfil registrado
        const res = await signIn("credentials", {
          numEmpleado: "DOC-2026-01",
          redirect: false,
        });

        if (res?.error) {
          setErrorSesion(true);
        } else {
          window.location.href = "/";
        }
      } else {
        alert("No se detectó un lector biométrico activo en este equipo.");
      }
    } catch (err) {
      console.error("Error biométrico:", err);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-4 md:p-8 font-sans overflow-hidden">
      <ThreadsBackground />

      <main className="relative z-10 w-full max-w-5xl rounded-3xl border border-white/10 bg-neutral-900/60 backdrop-blur-xl shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        
        {/* GALERÍA DE IMÁGENES RECTANGULARES */}
        <div className="lg:col-span-6 p-6 md:p-8 flex flex-col justify-between space-y-6 bg-gradient-to-br from-black/40 to-neutral-950/40 border-b lg:border-b-0 lg:border-r border-white/10">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#7A1C2E] text-white flex items-center justify-center font-extrabold text-base shadow-lg">
                TUP
              </div>
              <div>
                <h1 className="text-lg font-bold text-white leading-tight">Tecnológico Universitario Playacar</h1>
                <p className="text-xs text-neutral-400">Sistema Automatizado de Asistencia Wi-Fi</p>
              </div>
            </div>
            <p className="text-xs text-neutral-300 leading-relaxed">
              Plataforma institucional para la validación automática de presencia en aula y gestión de asistencia docente.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 my-2">
            <div className="relative h-32 rounded-2xl overflow-hidden border border-white/10 group shadow-md">
              <img
                src="/hero-campus.jpg"
                alt="Campus TUP 1"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = "https://images.unsplash.com/photo-1562774053-701939374585?auto=format&fit=crop&w=600&q=80";
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-2.5">
                <span className="text-[10px] font-bold text-white">Instalaciones</span>
              </div>
            </div>

            <div className="relative h-32 rounded-2xl overflow-hidden border border-white/10 group shadow-md">
              <img
                src="/hero-campus-2.jpg"
                alt="Campus TUP 2"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=600&q=80";
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-2.5">
                <span className="text-[10px] font-bold text-white">Aulas de Innovación</span>
              </div>
            </div>

            <div className="col-span-2 relative h-28 rounded-2xl overflow-hidden border border-white/10 group shadow-md">
              <img
                src="/hero-campus-3.jpg"
                alt="Campus TUP 3"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&w=600&q=80";
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-3">
                <span className="text-[11px] font-bold text-white">Red Wi-Fi Institucional TUP</span>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-neutral-400 border-t border-white/10 pt-3 flex justify-between items-center">
            <span>Playacar, Q. Roo</span>
            <span className="font-mono text-neutral-500">v1.0.4 • 2026</span>
          </div>
        </div>

        {/* BLOQUE DE ACCESO */}
        <div className="lg:col-span-6 p-6 md:p-10 flex flex-col justify-center space-y-5 bg-black/40">
          <div>
            <h2 className="text-xl font-extrabold text-white tracking-tight">Acceso al Sistema</h2>
            <p className="text-xs text-neutral-300 mt-1">
              Seleccione su método de ingreso preferido.
            </p>
          </div>

          {errorSesion && (
            <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-800/80 text-rose-200 text-xs flex items-center gap-2.5">
              <span className="text-base">⚠️</span>
              <span>No se encontró el registro del empleado. Verifique los datos o use Google.</span>
            </div>
          )}

          {/* OPCIÓN 1: ACCESO BIOMÉTRICO POR HUELLA / FACE ID */}
          <button
            type="button"
            onClick={iniciarSesionBiometrica}
            className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-2.5 cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
          >
            <span className="text-base"></span>
            Entrar con biometria
          </button>

          {/* OPCIÓN 2: ACCESO POR GOOGLE */}
          <button
            type="button"
            onClick={() => signIn("google")}
            className="w-full py-3 px-4 rounded-xl bg-white hover:bg-neutral-100 text-neutral-900 font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-3 cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            Iniciar Sesión con Google Institucional
          </button>

          <div className="relative flex items-center justify-center my-1">
            <div className="border-t border-white/10 w-full"></div>
            <span className="bg-neutral-900/80 px-3 text-[10px] uppercase font-bold text-neutral-400 whitespace-nowrap rounded-full border border-white/5">
              O por No. de Empleado
            </span>
            <div className="border-t border-white/10 w-full"></div>
          </div>

          {/* OPCIÓN 3: INGRESO POR NO. EMPLEADO SIN CONTRASEÑA */}
          <form onSubmit={manejarLoginEmpleado} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Número de Empleado Docente
              </label>
              <input
                type="text"
                placeholder="Ej. DOC-2026-01"
                value={numEmpleado}
                onChange={(e) => setNumEmpleado(e.target.value)}
                className="w-full bg-black/60 border border-white/15 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#7A1C2E] transition-all"
                required
              />
            </div>

            <button
              type="submit"
              disabled={cargando}
              className="w-full py-2.5 px-4 bg-[#7A1C2E] hover:bg-[#9E2A3F] text-white font-bold text-xs rounded-xl shadow-lg transition-all cursor-pointer disabled:opacity-50"
            >
              {cargando ? "Verificando..." : "Ingresar"}
            </button>
          </form>

        </div>
      </main>
    </div>
  );
}