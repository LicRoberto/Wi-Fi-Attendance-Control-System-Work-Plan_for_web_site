"use client";

import { signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import Image from "next/image";

interface RegistroAsistencia {
  id: number;
  fecha_hora: string;
  ip_origen: string;
  metodo: string;
  estado: string;
}

interface DocenteDashboardProps {
  session: any;
}

export default function DocenteDashboard({ session }: DocenteDashboardProps) {
  const [historial, setHistorial] = useState<RegistroAsistencia[]>([]);
  const [macAddress, setMacAddress] = useState<string>("DETECTANDO MAC...");
  const [redConectada, setRedConectada] = useState<boolean>(false);
  const [mostrarModalPermisos, setMostrarModalPermisos] = useState<boolean>(true);

  // Estado para el Modo Oscuro / Claro
  const [modoOscuro, setModoOscuro] = useState<boolean>(false);

  // Estados para Reloj 12H y Porcentajes Dinámicos
  const [reloj12H, setReloj12H] = useState<string>("");
  const [porcentajeEntrada, setPorcentajeEntrada] = useState<number>(0);
  const [porcentajeTolerancia, setPorcentajeTolerancia] = useState<number>(0);
  const [usandoTolerancia, setUsandoTolerancia] = useState<boolean>(false);

  useEffect(() => {
    const aceptado = localStorage.getItem("tup_privacidad_aceptada");
    if (aceptado === "true") {
      setMostrarModalPermisos(false);
    } else {
      setMostrarModalPermisos(true);
    }

    const temaGuardado = localStorage.getItem("tup_tema_oscuro");
    if (temaGuardado === "true") {
      setModoOscuro(true);
    }

    // Actualizador de Reloj y Barras Dinámicas en Tiempo Real
    const timerClock = setInterval(() => {
      const ahora = new Date();
      
      setReloj12H(
        ahora.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })
      );

      const horaActual = ahora.getHours();
      const minutoActual = ahora.getMinutes();
      const segundoActual = ahora.getSeconds();

      const minutosTotalesDia = horaActual * 60 + minutoActual + segundoActual / 60;
      const metaMinutos3PM = 15 * 60; // 3:00 PM = 900 minutos

      if (minutosTotalesDia >= metaMinutos3PM) {
        setPorcentajeEntrada(100);
      } else {
        const inicioJornada = 8 * 60;
        const progreso = Math.max(
          0,
          ((minutosTotalesDia - inicioJornada) / (metaMinutos3PM - inicioJornada)) * 100
        );
        setPorcentajeEntrada(Math.min(99, Math.round(progreso)));
      }

      if (horaActual === 15 && minutoActual >= 0 && minutoActual <= 10) {
        setUsandoTolerancia(true);
        const minutosTolerancia = minutoActual + segundoActual / 60;
        const pctTol = Math.round((minutosTolerancia / 10) * 100);
        setPorcentajeTolerancia(Math.min(100, pctTol));
      } else if (horaActual >= 15 && (horaActual > 15 || minutoActual > 10)) {
        setUsandoTolerancia(false);
        setPorcentajeTolerancia(100);
      } else {
        setUsandoTolerancia(false);
        setPorcentajeTolerancia(0);
      }
    }, 1000);

    if (session?.user?.email) {
      cargarPerfil();
      evaluarRedYAutoMarcar();
      cargarHistorial();

      const interval = setInterval(() => {
        cargarPerfil();
        evaluarRedYAutoMarcar();
        cargarHistorial();
      }, 3000);

      return () => {
        clearInterval(timerClock);
        clearInterval(interval);
      };
    }

    return () => clearInterval(timerClock);
  }, [session]);

  const toggleTemaVisual = () => {
    const nuevoEstado = !modoOscuro;
    setModoOscuro(nuevoEstado);
    localStorage.setItem("tup_tema_oscuro", nuevoEstado ? "true" : "false");
  };

  const cargarPerfil = async () => {
    if (!session?.user?.email) return;
    try {
      const res = await fetch(`http://localhost:8000/api/usuarios/me?email=${encodeURIComponent(session.user.email)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.mac_address) setMacAddress(data.mac_address);
      }
    } catch (err) {
      console.error("Error al obtener perfil de docente");
    }
  };

  const evaluarRedYAutoMarcar = async () => {
    if (!session?.user?.email) return;
    try {
      const res = await fetch("http://localhost:8000/api/asistencias/auto-marcar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          email: session.user.email,
          ssid_actual: "TUP"
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setRedConectada(data.red_activa);
      }
    } catch (err) {
      setRedConectada(false);
    }
  };

  const cargarHistorial = async () => {
    if (!session?.user?.email) return;
    try {
      const res = await fetch(`http://localhost:8000/api/asistencias/historial?email=${encodeURIComponent(session.user.email)}`);
      if (res.ok) {
        const data = await res.json();
        setHistorial(data.slice(0, 10));
      }
    } catch (err) {
      console.error("Error al cargar historial");
    }
  };

  const aceptarPermisosLegales = async () => {
    localStorage.setItem("tup_privacidad_aceptada", "true");
    setMostrarModalPermisos(false);

    if (session?.user?.email) {
      await fetch("http://localhost:8000/api/usuarios/consentimiento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: session.user.email,
          autorizado: true,
        }),
      });
      evaluarRedYAutoMarcar();
    }
  };

  return (
    <main className={`min-h-screen transition-colors duration-300 relative ${
      modoOscuro ? "bg-black text-neutral-100" : "bg-[#F8FAFC] text-slate-800"
    }`}>
      {/* MODAL DE PRIVACIDAD Y DOCUMENTACIÓN LEGAL */}
      {mostrarModalPermisos && (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`max-w-lg w-full rounded-2xl shadow-2xl border p-6 space-y-4 ${
            modoOscuro ? "bg-neutral-900 border-neutral-800 text-neutral-100" : "bg-white border-slate-200 text-slate-800"
          }`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#7A1C2E] text-white flex items-center justify-center font-bold text-lg">
                TUP
              </div>
              <div>
                <h3 className="font-bold text-base">Autorización de Presencia en Red Wi-Fi</h3>
                <p className={`text-xs ${modoOscuro ? "text-neutral-400" : "text-slate-500"}`}>
                  Tecnológico Universitario Playacar
                </p>
              </div>
            </div>

            <div className={`p-4 rounded-xl border text-xs leading-relaxed space-y-3 ${
              modoOscuro ? "bg-neutral-950 border-neutral-800 text-neutral-300" : "bg-slate-50 border-slate-200 text-slate-600"
            }`}>
              <p className="font-semibold">
                Aviso de Privacidad y Permisos de Sesión Institucional:
              </p>
              <p>
                Para automatizar el registro de asistencia mediante la red Wi-Fi del campus, el docente autoriza el monitoreo de presencia por dirección MAC en el aula.
              </p>
              
              <div className="pt-2">
                <a
                  href="/aviso-privacidad.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[#7A1C2E] dark:text-rose-400 font-bold underline hover:opacity-80 transition cursor-pointer"
                >
                  📄 Leer documentación sobre la privacidad del usuario
                </a>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => signOut()}
                className={`px-4 py-2 text-xs font-semibold rounded-xl transition cursor-pointer ${
                  modoOscuro ? "hover:bg-neutral-800 text-neutral-300" : "hover:bg-slate-100 text-slate-600"
                }`}
              >
                Rechazar y Salir
              </button>
              <button
                onClick={aceptarPermisosLegales}
                className="px-5 py-2.5 bg-[#7A1C2E] hover:bg-[#9E2A3F] text-white text-xs font-bold rounded-xl shadow-md transition cursor-pointer"
              >
                Autorizar y Permitir Detección
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header Institucional */}
      <header className={`border-b px-8 py-4 flex items-center justify-between shadow-sm sticky top-0 z-40 transition-colors ${
        modoOscuro ? "bg-neutral-900 border-neutral-800" : "bg-white border-slate-200"
      }`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#7A1C2E] text-white flex items-center justify-center font-bold">
            TUP
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Tecnológico Universitario Playacar</h1>
            <p className={`text-xs ${modoOscuro ? "text-neutral-400" : "text-slate-500"}`}>Portal de Asistencia Docente</p>
          </div>
        </div>

        {/* Reloj Digital Único de 12 Horas Institucional */}
        <div className={`hidden md:flex items-center gap-2 border px-4 py-2 rounded-xl ${
          modoOscuro ? "bg-neutral-950 border-neutral-800 text-neutral-200" : "bg-slate-100 border-slate-200 text-slate-800"
        }`}>
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className={`text-xs font-semibold uppercase ${modoOscuro ? "text-neutral-400" : "text-slate-500"}`}>
            HORA OFICIAL TUP:
          </span>
          <span className="text-sm font-bold font-mono tracking-wider text-[#7A1C2E] dark:text-rose-400">
            {reloj12H || "03:00:00 PM"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold">{session.user?.name}</p>
            <p className={`text-xs ${modoOscuro ? "text-neutral-400" : "text-slate-500"}`}>{session.user?.email}</p>
          </div>

          {/* BOTÓN MODO CLARO / OSCURO CON IMÁGENES .ICO DESDE /public */}
          <button
            onClick={toggleTemaVisual}
            title={modoOscuro ? "Cambiar a Modo Claro" : "Cambiar a Modo Oscuro"}
            className={`p-2 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
              modoOscuro
                ? "bg-neutral-800 border-neutral-700 hover:bg-neutral-700"
                : "bg-slate-100 border-slate-200 hover:bg-slate-200"
            }`}
          >
            {modoOscuro ? (
              <img 
                src="/sol.ico" 
                alt="Sol" 
                className="w-6 h-6 object-contain"
                onError={(e) => {
                  // Fallback si aun no se agrega el archivo en /public
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23F59E0B'><circle cx='12' cy='12' r='5'/></svg>";
                }}
              />
            ) : (
              <img 
                src="/luna.ico" 
                alt="Luna" 
                className="w-6 h-6 object-contain"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23475569'><path d='M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z'/></svg>";
                }}
              />
            )}
          </button>

          <button
            onClick={() => signOut()}
            className="px-4 py-2 text-xs font-semibold text-[#7A1C2E] dark:text-rose-400 border border-[#7A1C2E] dark:border-rose-400 rounded-lg hover:bg-[#7A1C2E] hover:text-white dark:hover:bg-rose-500 dark:hover:text-white transition-all cursor-pointer"
          >
            Cerrar Sesión
          </button>
        </div>
      </header>

      <section className="max-w-6xl mx-auto p-8 space-y-8">
        {/* Tarjetas Informativas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className={`p-6 rounded-xl border shadow-sm ${
            modoOscuro ? "bg-neutral-900 border-neutral-800" : "bg-white border-slate-200"
          }`}>
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Detección de Presencia</span>
            <p className={`text-xl font-bold mt-2 flex items-center gap-2 ${redConectada ? "text-emerald-500" : "text-rose-500"}`}>
              <span className={`w-3 h-3 rounded-full ${redConectada ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`}></span>
              {redConectada ? "Red Wi-Fi TUP Activa" : "Fuera de Red TUP"}
            </p>
            <p className={`text-xs mt-2 ${modoOscuro ? "text-neutral-400" : "text-slate-500"}`}>
              Detección en tiempo real (SSID: TUP)
            </p>
          </div>

          <div className={`p-6 rounded-xl border shadow-sm ${
            modoOscuro ? "bg-neutral-900 border-neutral-800" : "bg-white border-slate-200"
          }`}>
            <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Dirección MAC Registrada</span>
            <p className="text-lg font-bold mt-2 font-mono uppercase">
              {macAddress}
            </p>
            <p className={`text-xs mt-2 ${modoOscuro ? "text-neutral-400" : "text-slate-500"}`}>
              Adaptador de Red del Dispositivo
            </p>
          </div>

          <div className={`p-6 rounded-xl border shadow-sm ${
            modoOscuro ? "bg-neutral-900 border-neutral-800" : "bg-white border-slate-200"
          }`}>
            <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Pases de Lista Activos</span>
            <p className="text-xl font-bold mt-2">{historial.length} / 10 Pases</p>
            <p className={`text-xs mt-2 ${modoOscuro ? "text-neutral-400" : "text-slate-500"}`}>
              Máximo 10 (Archivado en BD)
            </p>
          </div>
        </div>

        {/* GRÁFICA DE BARRAS DINÁMICA */}
        <div className={`p-6 rounded-xl border shadow-sm ${
          modoOscuro ? "bg-neutral-900 border-neutral-800" : "bg-white border-slate-200"
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-lg">Métricas de Asistencia en Tiempo Real</h3>
              <p className={`text-xs ${modoOscuro ? "text-neutral-400" : "text-slate-500"}`}>
                Horario oficial en aula: <span className={`font-bold ${modoOscuro ? "text-neutral-200" : "text-slate-800"}`}>3:00 PM (15:00 hrs)</span> • Ventana de tolerancia: 10 minutos.
              </p>
            </div>
          </div>

          <div className={`relative w-full h-64 my-4 rounded-xl border p-6 flex items-end justify-around ${
            modoOscuro ? "bg-black border-neutral-800" : "bg-slate-50 border-slate-100"
          }`}>
            
            {/* Barra 1: Entrada 3:00 PM */}
            <div className="flex flex-col items-center h-full justify-end w-1/4 group">
              <div className="text-[11px] font-bold text-[#7A1C2E] dark:text-rose-400 mb-2 font-mono transition-all">
                {porcentajeEntrada === 100 ? "100% (¡3:00 PM!)" : `${porcentajeEntrada}% a las 3:00 PM`}
              </div>
              <div 
                className="w-16 bg-gradient-to-t from-[#7A1C2E] to-rose-500 rounded-t-xl shadow-md transition-all duration-700 ease-out"
                style={{ height: `${Math.max(6, porcentajeEntrada)}%` }}
              ></div>
              <span className={`text-xs font-bold mt-3 text-center ${modoOscuro ? "text-neutral-200" : "text-slate-700"}`}>Entrada 3:00 PM</span>
              <span className="text-[10px] text-neutral-400 text-center">Horario oficial en aula</span>
            </div>

            {/* Barra 2: Tolerancia 10 min */}
            <div className="flex flex-col items-center h-full justify-end w-1/4 group">
              <div className="text-[11px] font-bold text-amber-500 mb-2 font-mono transition-all">
                {usandoTolerancia ? `${porcentajeTolerancia}% Tolerancia` : "0% (A tiempo)"}
              </div>
              <div 
                className="w-16 bg-gradient-to-t from-amber-500 to-yellow-400 rounded-t-xl shadow-md transition-all duration-700 ease-out"
                style={{ height: usandoTolerancia ? `${Math.max(6, porcentajeTolerancia)}%` : "6%" }}
              ></div>
              <span className={`text-xs font-bold mt-3 text-center ${modoOscuro ? "text-neutral-200" : "text-slate-700"}`}>Tolerancia 10 min</span>
              <span className="text-[10px] text-neutral-400 text-center">
                {usandoTolerancia ? "En periodo de gracia" : "Curva plana (A tiempo)"}
              </span>
            </div>

            {/* Barra 3: Permanencia en Aula */}
            <div className="flex flex-col items-center h-full justify-end w-1/4 group">
              <div className="text-[11px] font-bold text-teal-500 mb-2 font-mono">
                {redConectada ? "100% Conectado" : "0% Desconectado"}
              </div>
              <div 
                className="w-16 bg-gradient-to-t from-teal-600 to-emerald-400 rounded-t-xl shadow-md transition-all duration-700 ease-out animate-pulse"
                style={{ height: redConectada ? "95%" : "6%" }}
              ></div>
              <span className={`text-xs font-bold mt-3 text-center ${modoOscuro ? "text-neutral-200" : "text-slate-700"}`}>Permanencia en Aula</span>
              <span className="text-[10px] text-neutral-400 text-center">Conexión Wi-Fi continua</span>
            </div>

            {/* Barra 4: Asistencia Continua */}
            <div className="flex flex-col items-center h-full justify-end w-1/4 group">
              <div className="text-[11px] font-bold text-emerald-500 mb-2 font-mono">
                {redConectada ? "Activa" : "Inactiva"}
              </div>
              <div 
                className="w-16 bg-gradient-to-t from-emerald-800 to-emerald-600 rounded-t-xl shadow-md transition-all duration-700 ease-out"
                style={{ height: redConectada ? "90%" : "6%" }}
              ></div>
              <span className={`text-xs font-bold mt-3 text-center ${modoOscuro ? "text-neutral-200" : "text-slate-700"}`}>Asistencia Continua</span>
              <span className="text-[10px] text-neutral-400 text-center">Presencia en aula completa</span>
            </div>
          </div>
        </div>

        {/* Tabla del Historial Real */}
        <div className={`p-6 rounded-xl border shadow-sm ${
          modoOscuro ? "bg-neutral-900 border-neutral-800" : "bg-white border-slate-200"
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-lg mb-1">Mi Historial de Asistencias</h3>
              <p className={`text-xs ${modoOscuro ? "text-neutral-400" : "text-slate-500"}`}>
                Mostrando las últimas 10 asistencias en vivo. Los registros antiguos se transfieren automáticamente al archivo histórico de la base de datos.
              </p>
            </div>
            <span className={`text-xs font-mono border px-3 py-1 rounded-lg ${
              modoOscuro ? "bg-black border-neutral-800 text-neutral-400" : "bg-slate-100 border-slate-200 text-slate-500"
            }`}>
              Límite: 10 Registros
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className={`border-b font-semibold text-xs uppercase tracking-wider ${
                  modoOscuro ? "border-neutral-800 bg-black/50 text-neutral-400" : "border-slate-200 bg-slate-50 text-slate-500"
                }`}>
                  <th className="py-3 px-4">Fecha y Hora</th>
                  <th className="py-3 px-4">Método de Marcación</th>
                  <th className="py-3 px-4">Dirección MAC Detectada</th>
                  <th className="py-3 px-4">Estatus</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${
                modoOscuro ? "divide-neutral-800 text-neutral-200" : "divide-slate-100 text-slate-700"
              }`}>
                {historial.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-neutral-400">
                      Sin pases de lista activos. Conecte su dispositivo al Wi-Fi TUP para registrar presencia.
                    </td>
                  </tr>
                ) : (
                  historial.map((reg) => (
                    <tr key={reg.id} className={`transition ${
                      modoOscuro ? "hover:bg-neutral-800/50" : "hover:bg-slate-50"
                    }`}>
                      <td className="py-3 px-4 font-medium">{reg.fecha_hora}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-1 text-xs font-semibold rounded-md font-mono ${
                          modoOscuro ? "bg-black text-neutral-300" : "bg-slate-100 text-slate-700"
                        }`}>
                          {reg.metodo}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-neutral-400">{reg.ip_origen}</td>
                      <td className="py-3 px-4">
                        <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded-full">
                          {reg.estado}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Zona en Desarrollo */}
        <div className="pt-8 pb-12">
          <div className="relative overflow-hidden rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-6 shadow-sm">
            <div 
              className="absolute top-0 left-0 right-0 h-3"
              style={{
                backgroundImage: "repeating-linear-gradient(45deg, #F59E0B, #F59E0B 15px, #1E293B 15px, #1E293B 30px)"
              }}
            ></div>

            <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-2">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/50 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 flex items-center justify-center font-bold text-xl flex-shrink-0">
                  ⚠️
                </div>
                <div>
                  <h4 className="font-extrabold text-slate-900 dark:text-neutral-100 text-base flex items-center gap-2">
                    Zona en Desarrollo
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 rounded-md">
                      Módulos Futuros
                    </span>
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-neutral-300 mt-1 max-w-xl">
                    Los módulos adicionales de consulta de horarios académicos, justificación de incidencias y solicitud de permisos docentes están actualmente en proceso de implementación.
                  </p>
                </div>
              </div>

              <div className="text-xs font-mono text-amber-900 dark:text-amber-200 bg-amber-100/80 dark:bg-amber-900/40 px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-700 whitespace-nowrap">
                Fase 2 • TUP v1.0.4
              </div>
            </div>

            <div 
              className="absolute bottom-0 left-0 right-0 h-2"
              style={{
                backgroundImage: "repeating-linear-gradient(-45deg, #F59E0B, #F59E0B 15px, #1E293B 15px, #1E293B 30px)"
              }}
            ></div>
          </div>
        </div>
      </section>
    </main>
  );
}