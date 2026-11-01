"use client";

import { signOut } from "next-auth/react";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import ParticlesBackground from "./ParticlesBackground";
import CircularCarousel from "./CircularCarousel";

interface DocenteDashboardProps {
  session: any;
}

export default function DocenteDashboard({ session }: DocenteDashboardProps) {
  const [menuTupAbierto, setMenuTupAbierto] = useState<boolean>(false);
  const [vistaModalActiva, setVistaModalActiva] = useState<"historial" | "deteccion" | "foto" | null>(null);

  // Huella Digital del Dispositivo en lugar de MAC hardcodeada
  const [deviceId, setDeviceId] = useState<string>("Generando Huella...");
  const [redConectada, setRedConectada] = useState<boolean>(false);
  const [aulaAsignada, setAulaAsignada] = useState<string>("Pendiente de asignación por Administración");
  const [toleranciaMinutos, setToleranciaMinutos] = useState<number>(10);
  const [cargandoHistorial, setCargandoHistorial] = useState<boolean>(false);

  const [mostrarModalPermisos, setMostrarModalPermisos] = useState<boolean>(false);
  const [reloj12H, setReloj12H] = useState<string>("");
  const [fotoPerfil, setFotoPerfil] = useState<string>("");

  const [motivoSolicitud, setMotivoSolicitud] = useState<string>("");
  const [fechaEvento, setFechaEvento] = useState<string>("");
  const [preguntaAbierta, setPreguntaAbierta] = useState<string>("");
  const [detalleAdicional, setDetalleAdicional] = useState<string>("");
  const [reporteEnviado, setReporteEnviado] = useState<boolean>(false);
  const [cargandoReporte, setCargandoReporte] = useState<boolean>(false);

  const menuRef = useRef<HTMLDivElement>(null);

  // Generador de Huella Digital Web Única por Dispositivo
  const generarDeviceFingerprint = (): string => {
    let devId = localStorage.getItem("tup_device_fingerprint");
    if (!devId) {
      const navInfo = `${navigator.userAgent}-${navigator.language}-${screen.width}x${screen.height}-${new Date().getTimezoneOffset()}`;
      let hash = 0;
      for (let i = 0; i < navInfo.length; i++) {
        const char = navInfo.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
      }
      const hashHex = Math.abs(hash).toString(16).toUpperCase().padStart(8, "0");
      devId = `TUP-DEV-${hashHex.slice(0, 4)}-${hashHex.slice(4, 8)}`;
      localStorage.setItem("tup_device_fingerprint", devId);
    }
    return devId;
  };

  useEffect(() => {
    const usuarioEmail = session?.user?.email;
    const claveStorage = `tup_privacidad_${usuarioEmail}`;
    const aceptadoLocal = localStorage.getItem(claveStorage);

    if (aceptadoLocal === "true") {
      setMostrarModalPermisos(false);
    } else {
      setMostrarModalPermisos(true);
    }

    const currentFingerprint = generarDeviceFingerprint();
    setDeviceId(currentFingerprint);

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
    }, 1000);

    if (usuarioEmail) {
      cargarDatosPerfilReal(usuarioEmail, currentFingerprint);
      evaluarRedWifiReal(usuarioEmail, currentFingerprint);
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuTupAbierto(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      clearInterval(timerClock);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [session]);

  const cargarDatosPerfilReal = async (email: string, fingerprint: string) => {
    try {
      const res = await fetch(`http://localhost:8000/api/usuarios/me?email=${encodeURIComponent(email)}&device_id=${encodeURIComponent(fingerprint)}`);
      if (res.ok) {
        const data = await res.json();
        setDeviceId(data.mac_address || fingerprint);
      }
    } catch (err) {
      console.error("Error al obtener perfil", err);
    }
  };

  const evaluarRedWifiReal = async (email: string, fingerprint: string) => {
    try {
      const res = await fetch("http://localhost:8000/api/asistencias/auto-marcar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, device_fingerprint: fingerprint }),
      });
      if (res.ok) {
        const data = await res.json();
        setRedConectada(Boolean(data.red_activa));
      } else {
        setRedConectada(false);
      }
    } catch (err) {
      setRedConectada(false);
    }
  };

  const abrirModalHistorial = () => {
    setVistaModalActiva("historial");
    setMenuTupAbierto(false);
    setCargandoHistorial(true);
    setTimeout(() => {
      setCargandoHistorial(false);
    }, 400);
  };

  const aceptarPermisosLegales = async () => {
    const usuarioEmail = session?.user?.email;
    if (usuarioEmail) {
      localStorage.setItem(`tup_privacidad_${usuarioEmail}`, "true");
    }
    setMostrarModalPermisos(false);
  };

  const manejarEnvioCuestionario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!motivoSolicitud) return;

    setCargandoReporte(true);
    try {
      await fetch("http://localhost:8000/api/incidencias/crear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: session?.user?.email,
          motivo: motivoSolicitud,
          fecha_evento: fechaEvento,
          descripcion: preguntaAbierta,
          observaciones: detalleAdicional,
        }),
      });

      setReporteEnviado(true);
      setMotivoSolicitud("");
      setFechaEvento("");
      setPreguntaAbierta("");
      setDetalleAdicional("");
      setTimeout(() => setReporteEnviado(false), 4000);
    } catch (error) {
      console.error("Error al procesar solicitud", error);
    } finally {
      setCargandoReporte(false);
    }
  };

  const activarAlertaEmergencia = (e: React.MouseEvent) => {
    e.preventDefault();
    alert("URGENCIA REGISTRADA: Se ha notificado inmediatamente al área de Control Escolar y Administración del Campus TUP.");
  };

  const manejarCambioFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFotoPerfil(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <main className="relative min-h-screen text-white font-sans overflow-hidden">
      <ParticlesBackground />

      {mostrarModalPermisos && (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-lg w-full rounded-2xl shadow-2xl border border-white/10 bg-neutral-900/90 text-white p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#7A1C2E] text-white flex items-center justify-center font-bold text-lg shadow-lg">
                TUP
              </div>
              <div>
                <h3 className="font-bold text-base">Autorización de Presencia en Red Wi-Fi</h3>
                <p className="text-xs text-neutral-400">Tecnológico Universitario Playacar</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-white/10 bg-black/50 text-xs leading-relaxed space-y-3 text-neutral-300">
              <p className="font-semibold text-white">
                Aviso de Privacidad y Permisos de Sesión Institucional:
              </p>
              <p>
                Para automatizar el registro de asistencia mediante la red Wi-Fi del campus, el docente autoriza la identificación digital única de su dispositivo en el aula.
              </p>
              
              <div className="pt-2">
                <Link
                  href="/privacidad"
                  target="_blank"
                  className="inline-flex items-center gap-1.5 text-blue-400 font-bold underline hover:opacity-80 transition cursor-pointer"
                >
                  Leer aviso de privacidad aquí
                </Link>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => signOut()}
                className="px-4 py-2 text-xs font-semibold rounded-xl text-neutral-300 hover:bg-neutral-800 transition cursor-pointer"
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

      <header className="relative z-40 border-b border-white/10 bg-neutral-900/40 backdrop-blur-md px-6 md:px-8 py-3.5 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-4">
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuTupAbierto(!menuTupAbierto)}
              title="Menú Opciones TUP"
              className="w-10 h-10 rounded-full bg-[#7A1C2E] hover:bg-[#9E2A3F] text-white flex items-center justify-center font-bold shadow-lg transition-all cursor-pointer ring-2 ring-white/20 hover:scale-105 active:scale-95"
            >
              TUP
            </button>

            {menuTupAbierto && (
              <div className="absolute left-0 mt-3 w-64 rounded-2xl bg-neutral-900/95 border border-white/15 shadow-2xl backdrop-blur-xl p-2 z-50 text-xs space-y-1">
                <div className="px-3 py-2 border-b border-white/10 text-neutral-400 font-bold uppercase tracking-wider text-[10px]">
                  Opciones del Docente
                </div>

                <button
                  onClick={abrirModalHistorial}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-white/10 text-white font-medium flex items-center transition cursor-pointer"
                >
                  Historial de asistencias
                </button>

                <button
                  onClick={() => { setVistaModalActiva("deteccion"); setMenuTupAbierto(false); }}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-white/10 text-white font-medium flex items-center transition cursor-pointer"
                >
                  Detección de red
                </button>

                <button
                  onClick={() => { setVistaModalActiva("foto"); setMenuTupAbierto(false); }}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-white/10 text-white font-medium flex items-center transition cursor-pointer"
                >
                  Cambiar foto de perfil
                </button>
              </div>
            )}
          </div>

          <div>
            <h1 className="font-bold text-base md:text-lg leading-tight text-white">Tecnológico Universitario Playacar</h1>
            <p className="text-xs text-neutral-400">Portal de Asistencia Docente</p>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <div className="flex items-center gap-2 border border-white/10 px-3.5 py-1.5 rounded-xl bg-black/50 text-neutral-200">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-xs font-bold font-mono tracking-wider text-rose-400">
              {reloj12H || "03:00:00 PM"}
            </span>
          </div>

          <div className={`flex items-center gap-2 border px-3.5 py-1.5 rounded-xl text-xs font-bold ${
            redConectada
              ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
              : "border-rose-500/40 bg-rose-950/40 text-rose-300"
          }`}>
            <span className={`w-2 h-2 rounded-full ${redConectada ? "bg-emerald-400 animate-pulse" : "bg-rose-500"}`}></span>
            <span>TUP-WIFI: {redConectada ? "Activa" : "Desactivada"}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-white">{session?.user?.name}</p>
            <p className="text-xs text-neutral-400">{session?.user?.email}</p>
          </div>

          <div className="w-9 h-9 rounded-full overflow-hidden border border-white/20 bg-neutral-800 flex items-center justify-center text-xs font-bold text-white">
            {fotoPerfil ? (
              <img src={fotoPerfil} alt="Perfil" className="w-full h-full object-cover" />
            ) : (
              session?.user?.name?.charAt(0) || "D"
            )}
          </div>

          <button
            onClick={() => signOut()}
            className="px-3.5 py-1.5 text-xs font-semibold text-rose-400 border border-rose-500/50 rounded-xl hover:bg-rose-600 hover:text-white transition-all cursor-pointer"
          >
            Cerrar Sesión
          </button>
        </div>
      </header>

      <section className="relative z-10 max-w-4xl mx-auto p-4 md:p-8 space-y-6">
        <div className="p-6 md:p-8 rounded-3xl border border-white/10 bg-neutral-900/50 backdrop-blur-xl shadow-2xl space-y-6">
          <div className="border-b border-white/10 pb-4">
            <h3 className="text-lg md:text-xl font-extrabold text-white">
              Solicitudes, Justificaciones e Incidencias
            </h3>
            <p className="text-xs text-neutral-300 mt-1">
              Cuestionario para notificar faltas, solicitar justificantes o reportar imprevistos en aula.
            </p>
          </div>

          <form onSubmit={manejarEnvioCuestionario} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-neutral-200">
                  1. ¿Qué deseas reportar o solicitar? *
                </label>
                <select
                  value={motivoSolicitud}
                  onChange={(e) => setMotivoSolicitud(e.target.value)}
                  className="w-full rounded-xl px-3.5 py-2.5 text-xs bg-black/60 border border-white/15 text-white focus:outline-none focus:border-[#7A1C2E] transition-all"
                  required
                >
                  <option value="" className="bg-neutral-900 text-white">Seleccione una opción...</option>
                  <option value="justificacion_falta" className="bg-neutral-900 text-white">Solicitar Justificante por Inasistencia / Salud</option>
                  <option value="permiso_oficial" className="bg-neutral-900 text-white">Solicitud de Permiso Económico / Oficial</option>
                  <option value="falla_tecnica" className="bg-neutral-900 text-white">Falla Técnica de Equipo / Proyector / Clima</option>
                  <option value="problema_wifi" className="bg-neutral-900 text-white">Problema de Conexión a Red Wi-Fi TUP</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5 text-neutral-200">
                  2. Fecha correspondiente del evento / falta
                </label>
                <input
                  type="date"
                  value={fechaEvento}
                  onChange={(e) => setFechaEvento(e.target.value)}
                  className="w-full rounded-xl px-3.5 py-2.5 text-xs bg-black/60 border border-white/15 text-white focus:outline-none focus:border-[#7A1C2E] transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5 text-neutral-200">
                3. ¿Qué está sucediendo? (Pregunta Abierta) *
              </label>
              <textarea
                rows={4}
                placeholder="Describe a detalle lo que sucede en el aula o el motivo de tu solicitud..."
                value={preguntaAbierta}
                onChange={(e) => setPreguntaAbierta(e.target.value)}
                className="w-full rounded-xl px-3.5 py-2.5 text-xs bg-black/60 border border-white/15 text-white placeholder-neutral-500 focus:outline-none focus:border-[#7A1C2E] transition-all"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5 text-neutral-200">
                4. Observaciones o comentarios adicionales (Opcional)
              </label>
              <input
                type="text"
                placeholder="Ej. Adjunto número de folio médico o número de equipo..."
                value={detalleAdicional}
                onChange={(e) => setDetalleAdicional(e.target.value)}
                className="w-full rounded-xl px-3.5 py-2.5 text-xs bg-black/60 border border-white/15 text-white placeholder-neutral-500 focus:outline-none focus:border-[#7A1C2E] transition-all"
              />
            </div>

            <div className="flex items-center justify-between pt-3">
              {reporteEnviado ? (
                <span className="text-xs font-bold text-emerald-400">
                  Cuestionario enviado a Administración correctamente.
                </span>
              ) : (
                <span className="text-[11px] text-neutral-400">
                  Folio generado automáticamente
                </span>
              )}
              
              <button
                type="submit"
                disabled={cargandoReporte}
                className="px-6 py-2.5 bg-[#7A1C2E] hover:bg-[#9E2A3F] text-white font-bold text-xs rounded-xl shadow-lg transition-all cursor-pointer disabled:opacity-50"
              >
                {cargandoReporte ? "Enviando..." : "Enviar Cuestionario"}
              </button>
            </div>
          </form>

          <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-neutral-300">
              En caso de urgencia oprimir{" "}
              <a
                href="#emergencia"
                onClick={activarAlertaEmergencia}
                className="text-blue-400 font-bold underline hover:text-blue-300 transition cursor-pointer"
              >
                AQUÍ
              </a>.
            </p>
          </div>
        </div>

        <CircularCarousel />
      </section>

      {/* MODAL HISTORIAL */}
      {vistaModalActiva === "historial" && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-xl w-full rounded-3xl border border-white/15 bg-neutral-900/95 p-6 space-y-4 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-base">Historial de Asistencias Registradas</h3>
              <button onClick={() => setVistaModalActiva(null)} className="text-neutral-400 hover:text-white font-bold text-lg cursor-pointer">✕</button>
            </div>

            {cargandoHistorial ? (
              <p className="text-xs text-neutral-400 py-8 text-center">Consultando registros...</p>
            ) : (
              <div className="p-8 text-center space-y-2 bg-black/50 rounded-2xl border border-white/10 my-2">
                <p className="font-bold text-amber-300 text-sm md:text-base leading-relaxed">
                  Hazta que el admin asigne labor, te asignaremos tus asistencias
                </p>
                <p className="text-xs text-neutral-400">
                  El registro en tiempo real por red Wi-Fi se habilitará automáticamente al vincular tu horario de grupo en el panel de administración.
                </p>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button onClick={() => setVistaModalActiva(null)} className="px-4 py-2 bg-[#7A1C2E] text-white text-xs font-bold rounded-xl cursor-pointer">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DETECCIÓN DE RED */}
      {vistaModalActiva === "deteccion" && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-3xl border border-white/15 bg-neutral-900/95 p-6 space-y-4 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-base">Detección de Red y Estado de Dispositivo</h3>
              <button onClick={() => setVistaModalActiva(null)} className="text-neutral-400 hover:text-white font-bold text-lg cursor-pointer">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-black/50 border border-white/10 flex justify-between items-center">
                <span className="text-neutral-400">ID Único de Dispositivo:</span>
                <span className="font-mono font-bold text-amber-300 uppercase">{deviceId}</span>
              </div>

              <div className="p-3 rounded-xl bg-black/50 border border-white/10 flex justify-between items-center">
                <span className="text-neutral-400">Aula Asignada:</span>
                <span className="font-bold text-neutral-300">{aulaAsignada}</span>
              </div>

              <div className="p-3 rounded-xl bg-black/50 border border-white/10 flex justify-between items-center">
                <span className="text-neutral-400">Margen de Tolerancia:</span>
                <span className="font-bold text-emerald-400">{toleranciaMinutos} Minutos</span>
              </div>

              <div className="p-3 rounded-xl bg-black/50 border border-white/10 flex justify-between items-center">
                <span className="text-neutral-400">Estado de Conexión:</span>
                <span className={`font-bold flex items-center gap-1.5 ${redConectada ? "text-emerald-400" : "text-rose-400"}`}>
                  <span className={`w-2 h-2 rounded-full ${redConectada ? "bg-emerald-400 animate-pulse" : "bg-rose-500"}`}></span>
                  {redConectada ? "Conectado a Red TUP" : "Fuera de Red TUP"}
                </span>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button onClick={() => setVistaModalActiva(null)} className="px-4 py-2 bg-[#7A1C2E] text-white text-xs font-bold rounded-xl cursor-pointer">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL FOTO DE PERFIL */}
      {vistaModalActiva === "foto" && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-sm w-full rounded-3xl border border-white/15 bg-neutral-900/95 p-6 space-y-4 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-base">Cambiar Foto de Perfil</h3>
              <button onClick={() => setVistaModalActiva(null)} className="text-neutral-400 hover:text-white font-bold text-lg cursor-pointer">✕</button>
            </div>

            <div className="flex flex-col items-center gap-4 py-2">
              <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-[#7A1C2E] bg-neutral-800 flex items-center justify-center text-2xl font-bold">
                {fotoPerfil ? (
                  <img src={fotoPerfil} alt="Vista Previa" className="w-full h-full object-cover" />
                ) : (
                  session?.user?.name?.charAt(0) || "D"
                )}
              </div>

              <input
                type="file"
                accept="image/*"
                onChange={manejarCambioFoto}
                id="upload-foto"
                className="hidden"
              />
              <label
                htmlFor="upload-foto"
                className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/15 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Seleccionar Imagen
              </label>
            </div>

            <div className="pt-2 flex justify-end">
              <button onClick={() => setVistaModalActiva(null)} className="px-4 py-2 bg-[#7A1C2E] text-white text-xs font-bold rounded-xl cursor-pointer">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}