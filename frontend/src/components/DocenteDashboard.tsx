"use client";

import { signOut } from "next-auth/react";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";

interface DocenteDashboardProps {
  session: any;
}

interface RegistroAsistenciaDocente {
  id: number;
  usuario?: string;
  fecha_hora: string;
  aula?: string;
  estado: string;
}

interface ClaseDocente {
  id: number;
  materia: string;
  aula: string;
  dia_semana: string;
  horario: string;
}

interface IncidenciaDocente {
  id: number;
  motivo: string;
  fecha_evento: string | null;
  descripcion: string;
  estado: string;
  respuesta_admin: string | null;
  fecha_creacion: string;
  fecha_respuesta: string | null;
}

const DIAS_ESCOLARES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default function DocenteDashboard({ session }: DocenteDashboardProps) {
  const [menuTupAbierto, setMenuTupAbierto] = useState<boolean>(false);
  const [vistaModalActiva, setVistaModalActiva] = useState<
    "historial" | "deteccion" | "incidencias" | "clase_linea" | "foto" | null
  >(null);

  const [deviceId, setDeviceId] = useState<string>("Generando Huella...");
  const [redConectada, setRedConectada] = useState<boolean>(false);
  const [verificandoRed, setVerificandoRed] = useState<boolean>(false);
  const [registrandoAsistencia, setRegistrandoAsistencia] = useState<boolean>(false);
  const [mensajeRegistro, setMensajeRegistro] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const [aulaAsignada, setAulaAsignada] = useState<string>("Sin aula asignada por Administración");
  const [horarioAulaAsignado, setHorarioAulaAsignado] = useState<string>("Pendiente de horario");
  const [ssidDetectado, setSsidDetectado] = useState<string>("Detectando red...");
  const [tokenRed, setTokenRed] = useState<string>("Pendiente");
  const [distanciaCampus, setDistanciaCampus] = useState<number | null>(null);
  const [toleranciaMinutos] = useState<number>(10);

  const [historialAsistencias, setHistorialAsistencias] = useState<RegistroAsistenciaDocente[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState<boolean>(false);
  const [limpiandoHistorial, setLimpiandoHistorial] = useState<boolean>(false);

  // Horario escolar semanal
  const [misClases, setMisClases] = useState<ClaseDocente[]>([]);
  const [cargandoClases, setCargandoClases] = useState<boolean>(false);

  // Incidencias y respuestas del administrador
  const [misIncidencias, setMisIncidencias] = useState<IncidenciaDocente[]>([]);
  const [motivoSolicitud, setMotivoSolicitud] = useState<string>("");
  const [fechaEvento, setFechaEvento] = useState<string>("");
  const [preguntaAbierta, setPreguntaAbierta] = useState<string>("");
  const [detalleAdicional, setDetalleAdicional] = useState<string>("");
  const [reporteEnviado, setReporteEnviado] = useState<boolean>(false);
  const [cargandoReporte, setCargandoReporte] = useState<boolean>(false);

  const [mostrarModalPermisos, setMostrarModalPermisos] = useState<boolean>(false);
  const [reloj12H, setReloj12H] = useState<string>("");
  const [fotoPerfil, setFotoPerfil] = useState<string>("");

  const menuRef = useRef<HTMLDivElement>(null);
  const coordsActualesRef = useRef<{ lat: number; lon: number; precision?: number } | null>(null);
  const [fotoGuardando, setFotoGuardando] = useState(false);
  const [fotoError, setFotoError] = useState("");

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://tup-backend-19dl.onrender.com";
  const emailActivo = session?.user?.email || "docente.tup@tecplayacar.edu.mx";
  const nombreDocente = session?.user?.name || "Docente TUP";

  const authHeaders = (extra: Record<string, string> = {}) => ({
    ...extra,
    Authorization: `Bearer ${session?.backendToken ?? ""}`,
  });

  const manejarCerrarSesion = async () => {
    await signOut({ redirect: false });
    window.location.href = "/";
  };

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

  const obtenerUbicacionBrowser = (): Promise<{ lat: number; lon: number; precision?: number } | null> => {
    return new Promise((resolve) => {
      if (coordsActualesRef.current) return resolve(coordsActualesRef.current);
      if (!("geolocation" in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, precision: pos.coords.accuracy };
          coordsActualesRef.current = coords;
          resolve(coords);
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  };

  const cargarHistorialReal = async (email: string) => {
    setCargandoHistorial(true);
    try {
      const corteLocal = localStorage.getItem(`tup_corte_historial_${email}`) || "";
      const url = corteLocal
        ? `${API_URL}/api/asistencias/historial?email=${encodeURIComponent(email)}&desde=${encodeURIComponent(corteLocal)}`
        : `${API_URL}/api/asistencias/historial?email=${encodeURIComponent(email)}`;

      const res = await fetch(url, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setHistorialAsistencias(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Error al obtener historial de asistencias", err);
    } finally {
      setCargandoHistorial(false);
    }
  };

  const cargarMisClases = async () => {
    setCargandoClases(true);
    try {
      const res = await fetch(`${API_URL}/api/clases/mis-clases`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setMisClases(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Error al cargar horario escolar", err);
    } finally {
      setCargandoClases(false);
    }
  };

  const cargarMisIncidencias = async () => {
    try {
      const res = await fetch(`${API_URL}/api/incidencias/mis-incidencias`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setMisIncidencias(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Error al cargar incidencias", err);
    }
  };

  const manejarRestablecerHistorial = async () => {
    setLimpiandoHistorial(true);
    try {
      const res = await fetch(`${API_URL}/api/asistencias/historial/limpiar-vista`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ email: emailActivo }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.corte_iso) {
          localStorage.setItem(`tup_corte_historial_${emailActivo}`, data.corte_iso);
        }
        setHistorialAsistencias([]);
        alert("Tu vista del historial ha sido restablecida. El Administrador conserva el respaldo completo.");
      }
    } catch (err) {
      console.error("Error al restablecer historial", err);
    } finally {
      setLimpiandoHistorial(false);
    }
  };

  useEffect(() => {
    const claveStorage = `tup_privacidad_${emailActivo}`;
    const aceptadoLocal = localStorage.getItem(claveStorage);

    if (aceptadoLocal === "true") {
      setMostrarModalPermisos(false);
    } else {
      setMostrarModalPermisos(true);
    }

    const currentFingerprint = generarDeviceFingerprint();
    setDeviceId(currentFingerprint);

    const actualizarReloj = () => {
      const ahora = new Date();
      setReloj12H(
        ahora.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })
      );
    };
    actualizarReloj();
    const timerClock = setInterval(actualizarReloj, 1000);

    cargarDatosPerfilReal(emailActivo, currentFingerprint);
    cargarHistorialReal(emailActivo);
    cargarMisClases();
    cargarMisIncidencias();
    evaluarRedWifiReal(emailActivo, currentFingerprint, true, false);

    let watchId: number | null = null;
    if ("geolocation" in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          coordsActualesRef.current = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            precision: pos.coords.accuracy,
          };
          evaluarRedWifiReal(emailActivo, currentFingerprint, false, false);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
      );
    }

    const intervalSensor = setInterval(() => {
      evaluarRedWifiReal(emailActivo, currentFingerprint, false, false);
    }, 15000);

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuTupAbierto(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      clearInterval(timerClock);
      if (watchId !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchId);
      }
      clearInterval(intervalSensor);
      document.removeEventListener("mousedown", handleClickOutside);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailActivo]);

  const cargarDatosPerfilReal = async (email: string, fingerprint: string) => {
    try {
      const res = await fetch(
        `${API_URL}/api/usuarios/me?email=${encodeURIComponent(email)}&nombre=${encodeURIComponent(nombreDocente)}&device_id=${encodeURIComponent(fingerprint)}`,
        { headers: authHeaders() }
      );
      if (res.ok) {
        const data = await res.json();
        setDeviceId(data.mac_address || fingerprint);
        if (data.foto) {
          setFotoPerfil(data.foto);
        } else if (session?.user?.image) {
          setFotoPerfil(session.user.image);
        }
        if (data.token_red) setTokenRed(data.token_red);
        if (data.aula_asignada) setAulaAsignada(data.aula_asignada);
        if (data.horario_asignado) setHorarioAulaAsignado(data.horario_asignado);
      }
    } catch (err) {
      console.error("Error al obtener perfil", err);
    }
  };

  const evaluarRedWifiReal = async (
    email: string,
    fingerprint: string,
    reintento = true,
    mostrarFeedbackManual = false
  ) => {
    if (mostrarFeedbackManual) {
      setRegistrandoAsistencia(true);
      setMensajeRegistro(null);
    } else {
      setVerificandoRed(true);
    }

    try {
      const coords = await obtenerUbicacionBrowser();
      const res = await fetch(`${API_URL}/api/asistencias/auto-marcar`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          email,
          nombre: nombreDocente,
          device_fingerprint: fingerprint,
          lat: coords?.lat ?? null,
          lon: coords?.lon ?? null,
          precision: coords?.precision ?? null,
          forzar_manual: mostrarFeedbackManual,
        }),
      });

      if (res.status === 401) {
        setRedConectada(false);
        setSsidDetectado("Sesión expirada");
        setTokenRed("Sin token");
        if (mostrarFeedbackManual) {
          setMensajeRegistro({
            tipo: "error",
            texto: "Tu sesión expiró. Cierra sesión y vuelve a entrar para registrar asistencia.",
          });
        }
        return;
      }

      if (res.ok) {
        const data = await res.json();
        const activa = Boolean(data.red_activa);
        setRedConectada(activa);
        setSsidDetectado(data.ssid_actual || (activa ? "TUP" : "Fuera de Campus"));
        setTokenRed(data.token_red || "Sin token (Fuera de rango)");
        setDistanciaCampus(typeof data.distancia_metros === "number" ? data.distancia_metros : null);
        if (data.aula_asignada) setAulaAsignada(data.aula_asignada);
        if (data.horario_asignado) setHorarioAulaAsignado(data.horario_asignado);

        if (activa) {
          await cargarHistorialReal(email);
        }

        if (mostrarFeedbackManual) {
          if (activa) {
            setMensajeRegistro({
              tipo: "ok",
              texto: data.mensaje || "Asistencia registrada correctamente.",
            });
          } else {
            setMensajeRegistro({
              tipo: "error",
              texto: data.mensaje || "No se pudo registrar: fuera de red o perímetro del TUP.",
            });
          }
        }
      } else if (reintento) {
        setTimeout(() => evaluarRedWifiReal(email, fingerprint, false, mostrarFeedbackManual), 5000);
      } else {
        setRedConectada(false);
        setSsidDetectado("Sin conexión");
        if (mostrarFeedbackManual) {
          setMensajeRegistro({ tipo: "error", texto: "Error de conexión con el servidor TUP." });
        }
      }
    } catch {
      if (reintento) {
        setTimeout(() => evaluarRedWifiReal(email, fingerprint, false, mostrarFeedbackManual), 5000);
      } else {
        setRedConectada(false);
        setSsidDetectado("Sin conexión");
        if (mostrarFeedbackManual) {
          setMensajeRegistro({ tipo: "error", texto: "No fue posible conectar con el servidor." });
        }
      }
    } finally {
      setVerificandoRed(false);
      setRegistrandoAsistencia(false);
    }
  };

  const formatearFechaHora12H = (fechaIso: string) => {
    if (!fechaIso) return { fecha: "—", hora: "—" };
    const limpia = fechaIso.replace("T", " ").split(".")[0];
    const [fechaPart, horaPart] = limpia.split(" ");
    if (!horaPart) return { fecha: fechaPart || limpia, hora: "—" };

    const [hhStr, mmStr, ssStr] = horaPart.split(":");
    let hh = parseInt(hhStr, 10);
    const sufijo = hh >= 12 ? "PM" : "AM";
    hh = hh % 12;
    if (hh === 0) hh = 12;

    return {
      fecha: fechaPart,
      hora: `${hh}:${mmStr || "00"}:${ssStr || "00"} ${sufijo}`,
    };
  };

  const obtenerTextoAula = (aulaBackend?: string) => {
    if (
      !aulaBackend ||
      aulaBackend.includes("DETECCION") ||
      aulaBackend.includes("TOKEN") ||
      aulaBackend.includes("Campus Principal")
    ) {
      return aulaAsignada !== "Sin aula asignada por Administración"
        ? `${aulaAsignada} (${horarioAulaAsignado})`
        : "Sin aula asignada por Administración";
    }
    return aulaBackend;
  };

  const abrirModalHistorial = () => {
    setVistaModalActiva("historial");
    setMenuTupAbierto(false);
    cargarHistorialReal(emailActivo);
  };

  const aceptarPermisosLegales = async () => {
    localStorage.setItem(`tup_privacidad_${emailActivo}`, "true");
    evaluarRedWifiReal(emailActivo, deviceId, true, false);
    setMostrarModalPermisos(false);
  };

  const manejarEnvioCuestionario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!motivoSolicitud) return;

    setCargandoReporte(true);
    try {
      const res = await fetch(`${API_URL}/api/incidencias/crear`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          email: emailActivo,
          motivo: motivoSolicitud,
          fecha_evento: fechaEvento,
          descripcion: preguntaAbierta,
          observaciones: detalleAdicional,
          urgente: false,
        }),
      });

      if (res.ok) {
        setReporteEnviado(true);
        setMotivoSolicitud("");
        setFechaEvento("");
        setPreguntaAbierta("");
        setDetalleAdicional("");
        await cargarMisIncidencias();
        setTimeout(() => setReporteEnviado(false), 4000);
      }
    } catch (error) {
      console.error("Error al procesar solicitud", error);
    } finally {
      setCargandoReporte(false);
    }
  };

  const activarAlertaEmergencia = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await fetch(`${API_URL}/api/incidencias/crear`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          email: emailActivo,
          motivo: "urgencia_inmediata",
          fecha_evento: new Date().toISOString().split("T")[0],
          descripcion: "Alerta de urgencia activada por el docente desde el portal institucional.",
          observaciones: `Aula: ${aulaAsignada}`,
          urgente: true,
        }),
      });
      await cargarMisIncidencias();
    } catch {}
    alert("URGENCIA REGISTRADA: Se ha notificado inmediatamente a la campana de Administración del Campus TUP.");
  };

  const redimensionarFoto = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const lado = 256;
        const canvas = document.createElement("canvas");
        canvas.width = lado;
        canvas.height = lado;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          return reject(new Error("canvas"));
        }
        const corte = Math.min(img.width, img.height);
        const sx = (img.width - corte) / 2;
        const sy = (img.height - corte) / 2;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, lado, lado);
        ctx.drawImage(img, sx, sy, corte, corte, 0, 0, lado, lado);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("imagen"));
      };
      img.src = url;
    });

  const manejarCambioFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFotoError("");
    if (!file.type.startsWith("image/")) {
      setFotoError("Selecciona un archivo de imagen.");
      return;
    }
    setFotoGuardando(true);
    try {
      const dataUrl = await redimensionarFoto(file);
      const res = await fetch(`${API_URL}/api/usuarios/me/foto`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ foto: dataUrl }),
      });
      if (res.ok) {
        setFotoPerfil(dataUrl);
      } else if (res.status === 401) {
        setFotoError("Tu sesión expiró. Cierra sesión y vuelve a entrar.");
      } else {
        setFotoError("No se pudo guardar la foto. Intenta con otra imagen.");
      }
    } catch {
      setFotoError("No se pudo procesar la imagen.");
    } finally {
      setFotoGuardando(false);
    }
  };

  const quitarFoto = async () => {
    setFotoError("");
    setFotoGuardando(true);
    try {
      const res = await fetch(`${API_URL}/api/usuarios/me/foto`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.ok) setFotoPerfil(session?.user?.image || "");
      else setFotoError("No se pudo quitar la foto.");
    } catch {
      setFotoError("No se pudo conectar con el servidor.");
    } finally {
      setFotoGuardando(false);
    }
  };

  const diaActualSemana = (() => {
    const idx = new Date().getDay();
    const map: Record<number, string> = {
      1: "Lunes",
      2: "Martes",
      3: "Miércoles",
      4: "Jueves",
      5: "Viernes",
      6: "Sábado",
    };
    return map[idx] || "Lunes";
  })();

  const respuestasPendientes = misIncidencias.filter((i) => i.respuesta_admin).length;

  return (
    <main className="relative min-h-screen text-white font-sans bg-gradient-to-br from-neutral-950 via-neutral-900 to-stone-950">
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
                Para automatizar el registro de asistencia mediante la red Wi-Fi y el perímetro geográfico del campus, el docente autoriza la identificación digital única de su dispositivo en el aula.
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
                onClick={manejarCerrarSesion}
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

      <header className="relative z-40 border-b border-white/10 bg-neutral-900/60 backdrop-blur-md px-6 md:px-8 py-3.5 flex items-center justify-between shadow-lg">
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
                  onClick={() => {
                    cargarMisIncidencias();
                    setVistaModalActiva("incidencias");
                    setMenuTupAbierto(false);
                  }}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-white/10 text-white font-medium flex items-center justify-between transition cursor-pointer"
                >
                  <span>Incidencias</span>
                  {respuestasPendientes > 0 && (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {respuestasPendientes} resp.
                    </span>
                  )}
                </button>

                <button
                  onClick={() => { setVistaModalActiva("clase_linea"); setMenuTupAbierto(false); }}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-white/10 text-white font-medium flex items-center transition cursor-pointer"
                >
                  Clase en línea
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
              {reloj12H || "12:00:00 PM"}
            </span>
          </div>

          <div className={`flex items-center gap-2 border px-3.5 py-1.5 rounded-xl text-xs font-bold ${
            redConectada
              ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
              : "border-rose-500/40 bg-rose-950/40 text-rose-300"
          }`}>
            <span className={`w-2 h-2 rounded-full ${redConectada ? "bg-emerald-400 animate-pulse" : "bg-rose-500"}`}></span>
            <span>
              TUP-WIFI:{" "}
              {verificandoRed
                ? "Verificando..."
                : redConectada
                ? `Activa (${ssidDetectado}${distanciaCampus !== null ? ` • ${distanciaCampus}m` : ""})`
                : `Desactivada${distanciaCampus !== null ? ` (${distanciaCampus}m)` : ""}`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-white">{nombreDocente}</p>
            <p className="text-xs text-neutral-400">{emailActivo}</p>
          </div>

          <div className="w-9 h-9 rounded-full overflow-hidden border border-white/20 bg-neutral-800 flex items-center justify-center text-xs font-bold text-white">
            {fotoPerfil ? (
              <img src={fotoPerfil} alt="Perfil" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
            ) : (
              nombreDocente.charAt(0) || "D"
            )}
          </div>

          <button
            onClick={manejarCerrarSesion}
            className="px-3.5 py-1.5 text-xs font-semibold text-rose-400 border border-rose-500/50 rounded-xl hover:bg-rose-600 hover:text-white transition-all cursor-pointer"
          >
            Cerrar Sesión
          </button>
        </div>
      </header>

      {/* VISTA PRINCIPAL */}
      <section className="relative z-10 max-w-7xl mx-auto p-4 md:p-8 space-y-6">
        <div className="p-6 md:p-8 rounded-3xl border border-white/10 bg-neutral-900/60 backdrop-blur-xl shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${redConectada ? "bg-emerald-400 animate-pulse" : "bg-rose-500"}`}></span>
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                {redConectada ? `En Campus (${ssidDetectado})` : `Estado: ${ssidDetectado}`}
              </span>
            </div>
            <h2 className="text-xl md:text-2xl font-extrabold tracking-wide text-white">
              TECPLAYACAR
            </h2>
            <p className="text-xs text-neutral-300">
              Docente: <span className="font-semibold text-white">{nombreDocente}</span> • Dispositivo:{" "}
              <span className="font-mono text-amber-300">{deviceId}</span>
            </p>
            <p className="text-xs text-cyan-300 font-medium">
              Clase / Horario asignado: <span className="font-bold text-white">{aulaAsignada}</span>{" "}
              {horarioAulaAsignado !== "Pendiente de horario" ? `(${horarioAulaAsignado})` : ""}
            </p>
            {mensajeRegistro && (
              <p className={`text-xs font-semibold pt-1 ${mensajeRegistro.tipo === "ok" ? "text-emerald-400" : "text-rose-400"}`}>
                {mensajeRegistro.texto}
              </p>
            )}
          </div>

          <button
            onClick={() => evaluarRedWifiReal(emailActivo, deviceId, false, true)}
            disabled={registrandoAsistencia}
            className="w-full md:w-auto px-7 py-3.5 bg-[#7A1C2E] hover:bg-[#9E2A3F] text-white font-bold text-sm rounded-2xl shadow-xl transition-all cursor-pointer disabled:opacity-50 ring-1 ring-white/15 active:scale-95"
          >
            {registrandoAsistencia ? "Registrando Asistencia..." : "Registrar Asistencia"}
          </button>
        </div>

        {/* CONTENEDOR HORIZONTAL: IZQUIERDA (REGISTRO DE ASISTENCIAS) + DERECHA (CALENDARIO ESCOLAR) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* CUADRO IZQUIERDO: REGISTRO DE ASISTENCIAS DEL DOCENTE */}
          <div className="lg:col-span-6 p-6 rounded-3xl border border-white/10 bg-neutral-900/60 backdrop-blur-xl shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-4 gap-2">
              <div>
                <h3 className="text-base md:text-lg font-extrabold text-white">
                  Registro de Asistencias del Docente
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Marcaciones registradas automáticamente al detectar el campus y red institucional.
                </p>
              </div>
              <button
                onClick={() => cargarHistorialReal(emailActivo)}
                disabled={cargandoHistorial}
                className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-xl transition cursor-pointer disabled:opacity-50 shrink-0"
              >
                {cargandoHistorial ? "..." : "Actualizar"}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-neutral-400 uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-3">Fecha</th>
                    <th className="py-3 px-3">Hora</th>
                    <th className="py-3 px-3">Aula / Materia</th>
                    <th className="py-3 px-3">Estatus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-neutral-200">
                  {historialAsistencias.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-neutral-400">
                        {cargandoHistorial
                          ? "Consultando registros de asistencia..."
                          : "Sin registros visibles. Al ingresar al campus TUP o presionar 'Registrar Asistencia' aparecerá aquí."}
                      </td>
                    </tr>
                  ) : (
                    historialAsistencias.map((reg) => {
                      const { fecha, hora } = formatearFechaHora12H(reg.fecha_hora);
                      return (
                        <tr key={reg.id} className="hover:bg-white/5 transition">
                          <td className="py-3 px-3 font-mono text-neutral-300 whitespace-nowrap">{fecha}</td>
                          <td className="py-3 px-3 font-mono text-amber-300 font-bold whitespace-nowrap">{hora}</td>
                          <td className="py-3 px-3 text-neutral-300">{obtenerTextoAula(reg.aula)}</td>
                          <td className="py-3 px-3">
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              {reg.estado}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* CUADRO DERECHO: CALENDARIO ESCOLAR FORMAL */}
          <div className="lg:col-span-6 p-6 rounded-3xl border border-white/10 bg-neutral-900/60 backdrop-blur-xl shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-4 gap-2">
              <div>
                <h3 className="text-base md:text-lg font-extrabold text-white">
                  Calendario Escolar Semanal
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Materias, horarios y aulas asignadas por Administración Académica.
                </p>
              </div>
              <button
                onClick={cargarMisClases}
                disabled={cargandoClases}
                className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-xl transition cursor-pointer disabled:opacity-50 shrink-0"
              >
                {cargandoClases ? "..." : "Actualizar"}
              </button>
            </div>

            {misClases.length === 0 ? (
              <div className="p-8 rounded-2xl border border-dashed border-white/15 bg-black/30 text-center space-y-1.5">
                <p className="text-sm font-bold text-neutral-200">Sin materias asignadas todavía</p>
                <p className="text-xs text-neutral-400">
                  Cuando Administración cargue tus materias, aulas y horarios aparecerán organizados aquí por día de la semana.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {DIAS_ESCOLARES.map((dia) => {
                  const clasesDia = misClases.filter(
                    (c) => (c.dia_semana || "").toLowerCase() === dia.toLowerCase()
                  );
                  const esHoy = dia.toLowerCase() === diaActualSemana.toLowerCase();
                  return (
                    <div
                      key={dia}
                      className={`rounded-2xl border p-3.5 transition ${
                        esHoy
                          ? "border-[#7A1C2E] bg-[#7A1C2E]/15"
                          : "border-white/10 bg-black/40"
                      }`}
                    >
                      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2.5">
                        <span className="text-xs font-extrabold uppercase tracking-wider text-white">
                          {dia}
                        </span>
                        {esHoy && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#7A1C2E] text-white">
                            HOY
                          </span>
                        )}
                      </div>

                      {clasesDia.length === 0 ? (
                        <p className="text-[11px] text-neutral-500 py-2">Sin clases programadas</p>
                      ) : (
                        <div className="space-y-2">
                          {clasesDia.map((clase) => (
                            <div
                              key={clase.id}
                              className="p-2.5 rounded-xl bg-neutral-900/90 border border-white/10 space-y-1"
                            >
                              <p className="text-xs font-bold text-white leading-snug">{clase.materia}</p>
                              <div className="flex items-center justify-between text-[11px] text-neutral-300">
                                <span className="font-mono text-amber-300">{clase.horario}</span>
                                <span className="px-2 py-0.5 rounded bg-white/10 text-cyan-300 font-semibold">
                                  {clase.aula}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* MODAL CLASE EN LÍNEA */}
      {vistaModalActiva === "clase_linea" && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-3xl border border-white/15 bg-neutral-900/95 p-6 space-y-4 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-base">Clase en Línea — TECPLAYACAR</h3>
              <button onClick={() => setVistaModalActiva(null)} className="text-neutral-400 hover:text-white font-bold text-lg cursor-pointer">✕</button>
            </div>

            <div className="p-6 text-center space-y-2.5 bg-black/50 rounded-2xl border border-white/10">
              <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Módulo en Desarrollo
              </span>
              <p className="font-bold text-white text-sm pt-1">
                Registro de sesiones virtuales en construcción
              </p>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Próximamente podrás validar tus clases a distancia y enlaces institucionales directamente desde este apartado.
              </p>
            </div>

            <div className="pt-2 flex justify-end">
              <button onClick={() => setVistaModalActiva(null)} className="px-4 py-2 bg-[#7A1C2E] text-white text-xs font-bold rounded-xl cursor-pointer">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL INCIDENCIAS + RESPUESTAS DE ADMINISTRACIÓN */}
      {vistaModalActiva === "incidencias" && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-2xl w-full rounded-3xl border border-white/15 bg-neutral-900/95 p-6 md:p-8 space-y-5 text-white shadow-2xl my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 className="text-lg font-extrabold text-white">
                  Solicitudes, Justificaciones e Incidencias
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Cuestionario para notificar faltas, solicitar justificantes o reportar imprevistos en aula.
                </p>
              </div>
              <button
                onClick={() => setVistaModalActiva(null)}
                className="text-neutral-400 hover:text-white font-bold text-lg cursor-pointer"
              >
                ✕
              </button>
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
                  rows={3}
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

              <div className="flex items-center justify-between pt-2">
                {reporteEnviado ? (
                  <span className="text-xs font-bold text-emerald-400">
                    Cuestionario enviado a Administración correctamente.
                  </span>
                ) : (
                  <span className="text-[11px] text-neutral-400">
                    Se notifica en la campana de Administración
                  </span>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setVistaModalActiva(null)}
                    className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl transition cursor-pointer"
                  >
                    Cerrar
                  </button>
                  <button
                    type="submit"
                    disabled={cargandoReporte}
                    className="px-6 py-2.5 bg-[#7A1C2E] hover:bg-[#9E2A3F] text-white font-bold text-xs rounded-xl shadow-lg transition-all cursor-pointer disabled:opacity-50"
                  >
                    {cargandoReporte ? "Enviando..." : "Enviar Cuestionario"}
                  </button>
                </div>
              </div>
            </form>

            {misIncidencias.length > 0 && (
              <div className="pt-4 border-t border-white/10 space-y-2.5">
                <p className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                  Historial de mis solicitudes y respuestas
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {misIncidencias.map((inc) => (
                    <div key={inc.id} className="p-3 rounded-xl bg-black/50 border border-white/10 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">{inc.motivo}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            inc.estado === "RESUELTA"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-amber-500/20 text-amber-300"
                          }`}
                        >
                          {inc.estado}
                        </span>
                      </div>
                      <p className="text-neutral-300">{inc.descripcion}</p>
                      {inc.respuesta_admin && (
                        <div className="p-2.5 rounded-lg bg-emerald-950/50 border border-emerald-500/30 text-emerald-200">
                          <span className="font-bold block text-[11px]">
                            Respuesta de Administración ({inc.fecha_respuesta}):
                          </span>
                          <span>{inc.respuesta_admin}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2">
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
        </div>
      )}

      {/* MODAL HISTORIAL */}
      {vistaModalActiva === "historial" && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-xl w-full rounded-3xl border border-white/15 bg-neutral-900/95 p-6 space-y-4 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="font-bold text-base">Historial de Asistencias Registradas</h3>
                <p className="text-[11px] text-neutral-400">
                  Puedes restablecer tu vista local; Administración conserva el historial completo.
                </p>
              </div>
              <button onClick={() => setVistaModalActiva(null)} className="text-neutral-400 hover:text-white font-bold text-lg cursor-pointer">✕</button>
            </div>

            {cargandoHistorial ? (
              <p className="text-xs text-neutral-400 py-8 text-center">Consultando registros...</p>
            ) : historialAsistencias.length === 0 ? (
              <div className="p-8 text-center space-y-2 bg-black/50 rounded-2xl border border-white/10 my-2">
                <p className="font-bold text-amber-300 text-sm">
                  Sin registros visibles en tu historial
                </p>
                <p className="text-xs text-neutral-400">
                  Las nuevas asistencias registradas en el campus TUP aparecerán aquí automáticamente.
                </p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-white/10 text-xs">
                {historialAsistencias.map((item) => {
                  const { fecha, hora } = formatearFechaHora12H(item.fecha_hora);
                  return (
                    <div key={item.id} className="py-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="font-bold text-white">{item.usuario || nombreDocente}</p>
                        <p className="text-neutral-400 font-mono">{fecha} • {hora}</p>
                        <p className="text-[11px] text-neutral-500">{obtenerTextoAula(item.aula)}</p>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300">
                        {item.estado}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2">
              <button
                onClick={manejarRestablecerHistorial}
                disabled={limpiandoHistorial}
                className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 text-xs font-bold rounded-xl cursor-pointer transition disabled:opacity-50"
              >
                {limpiandoHistorial ? "Restableciendo..." : "Restablecer / Borrar mi historial"}
              </button>

              <button
                onClick={() => setVistaModalActiva(null)}
                className="px-4 py-2 bg-[#7A1C2E] text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DETECCIÓN DE RED */}
      {vistaModalActiva === "deteccion" && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-3xl border border-white/15 bg-neutral-900/95 p-6 space-y-4 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-base">Detección de Red y Perímetro Campus</h3>
              <button onClick={() => setVistaModalActiva(null)} className="text-neutral-400 hover:text-white font-bold text-lg cursor-pointer">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-black/50 border border-white/10 flex justify-between items-center">
                <span className="text-neutral-400">ID Único de Dispositivo:</span>
                <span className="font-mono font-bold text-amber-300 uppercase">{deviceId}</span>
              </div>

              <div className="p-3 rounded-xl bg-black/50 border border-white/10 flex justify-between items-center">
                <span className="text-neutral-400">Red / Zona Detectada:</span>
                <span className="font-mono font-bold text-white">{ssidDetectado}</span>
              </div>

              <div className="p-3 rounded-xl bg-black/50 border border-white/10 flex justify-between items-center">
                <span className="text-neutral-400">Distancia al Campus TUP:</span>
                <span className="font-mono font-bold text-emerald-300">
                  {distanciaCampus !== null ? `${distanciaCampus} metros` : "Validado por IP Campus"}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-black/50 border border-white/10 flex justify-between items-center">
                <span className="text-neutral-400">Token de Red Codificado:</span>
                <span className="font-mono font-bold text-cyan-300">{tokenRed}</span>
              </div>

              <div className="p-3 rounded-xl bg-black/50 border border-white/10 flex justify-between items-center">
                <span className="text-neutral-400">Aula / Materia Asignada:</span>
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
                  {verificandoRed ? "Verificando..." : redConectada ? `En Rango (${ssidDetectado})` : "Fuera de Rango TUP"}
                </span>
              </div>
            </div>

            <div className="pt-2 flex justify-between items-center gap-2">
              <button
                onClick={() => evaluarRedWifiReal(emailActivo, deviceId, false, false)}
                disabled={verificandoRed}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl cursor-pointer transition disabled:opacity-50"
              >
                {verificandoRed ? "Verificando..." : "Re-verificar Ahora"}
              </button>
              <button
                onClick={() => setVistaModalActiva(null)}
                className="px-4 py-2 bg-[#7A1C2E] text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                Cerrar
              </button>
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
                  <img src={fotoPerfil} alt="Vista Previa" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                ) : (
                  nombreDocente.charAt(0) || "D"
                )}
              </div>

              <input
                type="file"
                accept="image/*"
                onChange={manejarCambioFoto}
                id="upload-foto"
                className="hidden"
                disabled={fotoGuardando}
              />
              <label
                htmlFor="upload-foto"
                className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/15 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                {fotoGuardando ? "Guardando..." : "Seleccionar Imagen"}
              </label>
              <button
                type="button"
                onClick={quitarFoto}
                disabled={fotoGuardando}
                className="text-[11px] text-neutral-400 hover:text-white underline cursor-pointer"
              >
                Quitar mi foto
              </button>
              {fotoError && <p className="text-[11px] text-red-400 text-center">{fotoError}</p>}
              <p className="text-[10px] text-neutral-500 text-center">
                La foto se guarda en el servidor y la verá el área de administración.
              </p>
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