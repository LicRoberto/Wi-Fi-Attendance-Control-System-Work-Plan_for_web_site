"use client";

import { signOut } from "next-auth/react";
import { useState, useEffect } from "react";

interface RegistroAsistencia {
  id: number;
  usuario: string;
  email: string;
  fecha_hora: string;
  ip_origen: string;
  metodo: string;
  estado: string;
}

interface RedWifi {
  ssid: string;
  zona: string;
  activa: boolean;
  calibrada?: boolean;
  enlaces_vinculados?: string[];
  tiene_geo?: boolean;
  firma_actual_cliente?: string;
  coincide_actual?: boolean;
}

interface DocenteInfo {
  id: number;
  nombre: string;
  email: string;
  numero_empleado: string | null;
  password_visible?: string | null;
  rol: string;
  foto: string | null;
  hora_llegada: string | null;
  segundos_desde_conexion: number | null;
  en_linea: boolean;
  en_campus: boolean;
  ubicacion: {
    lat: number;
    lon: number;
    precision_metros: number | null;
    distancia_metros: number | null;
  } | null;
}

interface IncidenciaAdmin {
  id: number;
  docente_nombre: string;
  docente_email: string;
  docente_foto: string | null;
  motivo: string;
  fecha_evento: string | null;
  descripcion: string;
  observaciones: string | null;
  urgente: boolean;
  leida: boolean;
  estado: string;
  respuesta_admin: string | null;
  fecha_creacion: string;
  fecha_respuesta: string | null;
}

interface MateriaAsignada {
  id: number;
  usuario_id: number;
  docente_nombre: string;
  docente_email: string;
  materia: string;
  aula: string;
  dia_semana: string;
  horario: string;
}

interface EstadoSistema {
  base_de_datos: string;
  posiblemente_temporal: boolean;
  correo_brevo_configurado?: boolean;
  advertencia: string | null;
  usuarios: number;
  asistencias: number;
}

const ETIQUETAS_MOTIVO: Record<string, string> = {
  justificacion_falta: "Justificante por Inasistencia / Salud",
  permiso_oficial: "Permiso Económico / Oficial",
  falla_tecnica: "Falla Técnica en Aula",
  problema_wifi: "Problema de Conexión Wi-Fi TUP",
  urgencia_inmediata: "URGENCIA INMEDIATA EN CAMPUS",
};

function formatoHora(valor: string | null): string {
  if (!valor) return "";
  const m = valor.match(/(\d{2}):(\d{2})/);
  if (!m) return valor;
  let h = parseInt(m[1], 10);
  const sufijo = h >= 12 ? "p. m." : "a. m.";
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${m[2]} ${sufijo}`;
}

function textoHace(seg: number | null): string {
  if (seg === null) return "sin conexión registrada";
  if (seg < 60) return `hace ${seg} s`;
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
  return `hace ${Math.floor(seg / 86400)} d`;
}

function iniciales(nombre: string): string {
  return nombre.trim().charAt(0).toUpperCase() || "D";
}

interface AdminDashboardProps {
  session: any;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://tup-backend-19dl.onrender.com";

export default function AdminDashboard({ session }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<"bitacora" | "redes" | "docentes" | "materias" | "reportes">("bitacora");
  const [docentes, setDocentes] = useState<DocenteInfo[]>([]);
  const [docenteSelId, setDocenteSelId] = useState<number | null>(null);
  const [mostrarPasswordDocente, setMostrarPasswordDocente] = useState(false);
  const [busquedaDocente, setBusquedaDocente] = useState("");
  const [estadoSistema, setEstadoSistema] = useState<EstadoSistema | null>(null);
  const [registros, setRegistros] = useState<RegistroAsistencia[]>([]);
  const [redesWifi, setRedesWifi] = useState<RedWifi[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("TODOS");
  const [loading, setLoading] = useState(false);

  // Campana e incidencias
  const [incidencias, setIncidencias] = useState<IncidenciaAdmin[]>([]);
  const [modalCampanaAbierto, setModalCampanaAbierto] = useState(false);
  const [campanaImgError, setCampanaImgError] = useState(false);
  const [respuestasTexto, setRespuestasTexto] = useState<Record<number, string>>({});
  const [enviandoRespuestaId, setEnviandoRespuestaId] = useState<number | null>(null);

  // Materias y horarios
  const [materias, setMaterias] = useState<MateriaAsignada[]>([]);
  const [nuevaMateria, setNuevaMateria] = useState({
    usuario_id: "",
    dia_semana: "Lunes",
    horario: "",
    aula: "",
    materia: "",
  });
  const [guardandoMateria, setGuardandoMateria] = useState(false);

  const [showModalDocente, setShowModalDocente] = useState(false);
  const [nuevoDocente, setNuevoDocente] = useState({ nombre: "", email: "", matricula: "", password: "" });

  const [nuevaRed, setNuevaRed] = useState({ ssid: "", password: "", zona: "" });
  const [guardandoRed, setGuardandoRed] = useState(false);
  const [calibrandoSsid, setCalibrandoSsid] = useState<string | null>(null);

  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [passwordAdmin, setPasswordAdmin] = useState("");
  const [errorLoginAdmin, setErrorLoginAdmin] = useState("");
  const [entrandoAdmin, setEntrandoAdmin] = useState(false);

  const cerrarSesionAdmin = () => {
    try { sessionStorage.removeItem("tup_admin_token"); } catch {}
    setAdminToken(null);
  };

  const adminFetch = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${adminToken}` },
    });
    if (res.status === 401) cerrarSesionAdmin();
    return res;
  };

  const manejarLoginAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setEntrandoAdmin(true);
    setErrorLoginAdmin("");
    try {
      const res = await fetch(`${API_URL}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordAdmin }),
      });
      if (res.ok) {
        const data = await res.json();
        try { sessionStorage.setItem("tup_admin_token", data.token); } catch {}
        setAdminToken(data.token);
        setPasswordAdmin("");
      } else if (res.status === 503) {
        setErrorLoginAdmin("El servidor no tiene configurada la contraseña de administrador.");
      } else {
        setErrorLoginAdmin("Contraseña de administrador incorrecta.");
      }
    } catch {
      setErrorLoginAdmin("No fue posible conectar con el servidor.");
    } finally {
      setEntrandoAdmin(false);
    }
  };

  const manejarCerrarSesion = async () => {
    cerrarSesionAdmin();
    await signOut({ redirect: false });
    window.location.href = "/";
  };

  const cargarTablaAdmin = async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/asistencias");
      if (res.ok) setRegistros(await res.json());
    } catch (err) {
      console.error("Error al obtener bitácora general de asistencias", err);
    } finally {
      setLoading(false);
    }
  };

  const cargarRedesWifi = async () => {
    try {
      const res = await adminFetch("/api/admin/redes-wifi");
      if (res.ok) setRedesWifi(await res.json());
    } catch (err) {
      console.error("Error al obtener redes Wi-Fi", err);
    }
  };

  const cargarDocentes = async () => {
    try {
      const res = await adminFetch("/api/admin/docentes");
      if (res.ok) setDocentes(await res.json());
    } catch (err) {
      console.error("Error al obtener docentes", err);
    }
  };

  const cargarIncidencias = async () => {
    try {
      const res = await adminFetch("/api/admin/incidencias");
      if (res.ok) setIncidencias(await res.json());
    } catch (err) {
      console.error("Error al obtener incidencias", err);
    }
  };

  const cargarMaterias = async () => {
    try {
      const res = await adminFetch("/api/admin/materias");
      if (res.ok) setMaterias(await res.json());
    } catch (err) {
      console.error("Error al obtener materias", err);
    }
  };

  const cargarEstadoSistema = async () => {
    try {
      const res = await adminFetch("/api/admin/estado-sistema");
      if (res.ok) setEstadoSistema(await res.json());
    } catch (err) {
      console.error("Error al obtener estado del sistema", err);
    }
  };

  useEffect(() => {
    try {
      const guardado = sessionStorage.getItem("tup_admin_token");
      if (guardado) setAdminToken(guardado);
    } catch {}
  }, []);

  useEffect(() => {
    if (!adminToken) return;
    cargarTablaAdmin();
    cargarRedesWifi();
    cargarDocentes();
    cargarIncidencias();
    cargarMaterias();
    cargarEstadoSistema();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  // Refresco periódico de campana de notificaciones y docentes
  useEffect(() => {
    if (!adminToken) return;
    const t = setInterval(() => {
      cargarIncidencias();
      if (activeTab === "docentes") cargarDocentes();
    }, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, activeTab]);

  const abrirDetalleDocente = (id: number) => {
    setMostrarPasswordDocente(false);
    setDocenteSelId(id);
  };

  const handleResponderIncidencia = async (incidenciaId: number) => {
    const texto = (respuestasTexto[incidenciaId] || "").trim();
    if (!texto) return;

    setEnviandoRespuestaId(incidenciaId);
    try {
      const res = await adminFetch(`/api/admin/incidencias/${incidenciaId}/responder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respuesta: texto, marcar_resuelta: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setRespuestasTexto((prev) => ({ ...prev, [incidenciaId]: "" }));
        await cargarIncidencias();
        alert(data.mensaje || "Respuesta enviada al docente.");
      }
    } catch (err) {
      console.error("Error al responder incidencia", err);
    } finally {
      setEnviandoRespuestaId(null);
    }
  };

  const handleMarcarLeida = async (incidenciaId: number) => {
    try {
      const res = await adminFetch(`/api/admin/incidencias/${incidenciaId}/leida`, {
        method: "POST",
      });
      if (res.ok) await cargarIncidencias();
    } catch (err) {
      console.error("Error al marcar como leída", err);
    }
  };

  const handleAsignarMateria = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevaMateria.usuario_id || !nuevaMateria.materia.trim() || !nuevaMateria.aula.trim() || !nuevaMateria.horario.trim()) {
      return;
    }
    setGuardandoMateria(true);
    try {
      const res = await adminFetch("/api/admin/materias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario_id: Number(nuevaMateria.usuario_id),
          dia_semana: nuevaMateria.dia_semana,
          horario: nuevaMateria.horario,
          aula: nuevaMateria.aula,
          materia: nuevaMateria.materia,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(data.mensaje || "Materia asignada correctamente.");
        setNuevaMateria({ usuario_id: "", dia_semana: "Lunes", horario: "", aula: "", materia: "" });
        await cargarMaterias();
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.detail || "Error al asignar materia.");
      }
    } catch (err) {
      console.error("Error al asignar materia", err);
    } finally {
      setGuardandoMateria(false);
    }
  };

  const handleEliminarMateria = async (id: number) => {
    if (!confirm("¿Eliminar esta materia del horario del docente?")) return;
    try {
      const res = await adminFetch(`/api/admin/materias/${id}`, { method: "DELETE" });
      if (res.ok) await cargarMaterias();
    } catch (err) {
      console.error("Error al eliminar materia", err);
    }
  };

  const handleAgregarRed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevaRed.ssid.trim() || !nuevaRed.zona.trim()) return;

    setGuardandoRed(true);
    try {
      const res = await adminFetch("/api/admin/redes-wifi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nuevaRed),
      });

      if (res.ok) {
        setNuevaRed({ ssid: "", password: "", zona: "" });
        await cargarRedesWifi();
      }
    } catch (err) {
      console.error("Error al guardar red Wi-Fi", err);
    } finally {
      setGuardandoRed(false);
    }
  };

  const handleCalibrarRed = async (ssid: string) => {
    setCalibrandoSsid(ssid);
    try {
      const coords = await new Promise<{ lat: number; lon: number } | null>((resolve) => {
        if (!("geolocation" in navigator)) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 4000 }
        );
      });

      const res = await adminFetch(`/api/admin/redes-wifi/${encodeURIComponent(ssid)}/calibrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: coords?.lat ?? null,
          lon: coords?.lon ?? null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(data.mensaje);
        await cargarRedesWifi();
      }
    } catch (err) {
      console.error("Error al calibrar red Wi-Fi", err);
    } finally {
      setCalibrandoSsid(null);
    }
  };

  const handleResetRed = async (ssid: string) => {
    try {
      const res = await adminFetch(`/api/admin/redes-wifi/${encodeURIComponent(ssid)}/reset`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        alert(data.mensaje);
        await cargarRedesWifi();
      }
    } catch (err) {
      console.error("Error al reiniciar vinculación", err);
    }
  };

  const handleEliminarRed = async (ssid: string) => {
    try {
      const res = await adminFetch(`/api/admin/redes-wifi/${encodeURIComponent(ssid)}`, {
        method: "DELETE",
      });
      if (res.ok) await cargarRedesWifi();
    } catch (err) {
      console.error("Error al eliminar red Wi-Fi", err);
    }
  };

  const handleCrearDocente = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await adminFetch("/api/admin/docentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nuevoDocente),
      });

      if (res.ok) {
        alert("Docente registrado exitosamente");
        setShowModalDocente(false);
        setNuevoDocente({ nombre: "", email: "", matricula: "", password: "" });
        await cargarDocentes();
        await cargarEstadoSistema();
      } else {
        const errData = await res.json().catch(() => null);
        alert(errData?.detail || "Error al registrar docente");
      }
    } catch (err) {
      console.error("Error de red al crear docente", err);
    }
  };

  const handleEliminarDocente = async (e: React.MouseEvent, id: number, nombre: string) => {
    e.stopPropagation();
    if (!confirm(`¿Seguro que deseas eliminar al docente "${nombre}" y todo su historial?`)) return;
    try {
      const res = await adminFetch(`/api/admin/docentes/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (docenteSelId === id) setDocenteSelId(null);
        await cargarDocentes();
        await cargarTablaAdmin();
        await cargarMaterias();
        await cargarEstadoSistema();
      } else {
        const errData = await res.json().catch(() => null);
        alert(errData?.detail || "No se pudo eliminar el docente.");
      }
    } catch (err) {
      console.error("Error al eliminar docente", err);
    }
  };

  const registrosFiltrados = registros.filter((reg) => {
    const coincideTexto =
      reg.usuario.toLowerCase().includes(busqueda.toLowerCase()) ||
      reg.email.toLowerCase().includes(busqueda.toLowerCase());
    const coincideEstado = filtroEstado === "TODOS" || reg.estado === filtroEstado;
    return coincideTexto && coincideEstado;
  });

  const noLeidasCount = incidencias.filter((i) => !i.leida).length;
  const docentesSolo = docentes.filter((d) => d.rol !== "admin");

  if (!adminToken) {
    return (
      <main className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <form
          onSubmit={manejarLoginAdmin}
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 w-full max-w-sm space-y-4"
        >
          <div>
            <h1 className="text-lg font-bold text-slate-900">Acceso de Administrador</h1>
            <p className="text-xs text-slate-500 mt-1">
              Confirma la contraseña de administración para gestionar redes y asistencias.
            </p>
          </div>
          <input
            type="password"
            required
            autoFocus
            placeholder="Contraseña de administrador"
            value={passwordAdmin}
            onChange={(e) => setPasswordAdmin(e.target.value)}
            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
          />
          {errorLoginAdmin && <p className="text-xs font-semibold text-rose-600">{errorLoginAdmin}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={manejarCerrarSesion}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
            >
              Salir
            </button>
            <button
              type="submit"
              disabled={entrandoAdmin}
              className="flex-1 py-2 bg-[#7A1C2E] hover:bg-[#5c1523] text-white text-xs font-bold rounded-lg transition cursor-pointer disabled:opacity-50"
            >
              {entrandoAdmin ? "Verificando..." : "Entrar"}
            </button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-800 pb-12">
      <header className="bg-white border-b border-slate-200 px-6 md:px-8 py-4 flex items-center justify-between shadow-sm sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#7A1C2E] text-white flex items-center justify-center font-bold">
            TUP
          </div>
          <div>
            <h1 className="font-bold text-slate-900 text-lg leading-tight">Tecnológico Universitario Playacar</h1>
            <p className="text-xs text-slate-500">Panel de Administración General</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* CAMPANA DE NOTIFICACIONES / INCIDENCIAS */}
          <button
            type="button"
            onClick={() => {
              cargarIncidencias();
              setModalCampanaAbierto(true);
            }}
            title="Notificaciones e Incidencias de Docentes"
            className="relative p-2 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 transition cursor-pointer"
          >
            {!campanaImgError ? (
              <img
                src="/campana.png"
                alt="Notificaciones"
                onError={() => setCampanaImgError(true)}
                className="w-6 h-6 object-contain"
              />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#7A1C2E"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-6 h-6"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            )}
            {noLeidasCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-600 text-white text-[10px] font-extrabold flex items-center justify-center shadow">
                {noLeidasCount}
              </span>
            )}
          </button>

          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-slate-900">{session?.user?.name || "Administrador"}</p>
            <p className="text-xs text-slate-500">{session?.user?.email || "admin@tecplayacar.edu.mx"}</p>
          </div>
          <button
            onClick={manejarCerrarSesion}
            className="px-4 py-2 text-xs font-semibold text-[#7A1C2E] border border-[#7A1C2E] rounded-lg hover:bg-[#7A1C2E] hover:text-white transition-all cursor-pointer"
          >
            Cerrar Sesión
          </button>
        </div>
      </header>

      <section className="max-w-6xl mx-auto p-6 md:p-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Redes Institucionales</span>
            <p className="text-xl font-bold text-emerald-600 mt-2 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span> {redesWifi.length} Redes Codificadas
            </p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Acciones Rápidas</span>
            <button
              onClick={() => setShowModalDocente(true)}
              className="mt-2 w-full py-2 bg-[#7A1C2E] hover:bg-[#5c1523] text-white text-xs font-semibold rounded-lg transition shadow-sm cursor-pointer"
            >
              + Registrar Nuevo Docente
            </button>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Registros Hoy</span>
            <p className="text-xl font-bold text-slate-900 mt-2">{registros.length} Marcaciones</p>
          </div>
        </div>

        <div className="flex border-b border-slate-200 mb-6 gap-6 overflow-x-auto">
          <button
            onClick={() => setActiveTab("bitacora")}
            className={`pb-3 text-sm font-semibold transition whitespace-nowrap cursor-pointer ${
              activeTab === "bitacora"
                ? "border-b-2 border-[#7A1C2E] text-[#7A1C2E]"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Bitácora de Asistencias
          </button>
          <button
            onClick={() => setActiveTab("redes")}
            className={`pb-3 text-sm font-semibold transition whitespace-nowrap cursor-pointer ${
              activeTab === "redes"
                ? "border-b-2 border-[#7A1C2E] text-[#7A1C2E]"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Redes Wi-Fi TUP
          </button>
          <button
            onClick={() => setActiveTab("docentes")}
            className={`pb-3 text-sm font-semibold transition whitespace-nowrap cursor-pointer ${
              activeTab === "docentes"
                ? "border-b-2 border-[#7A1C2E] text-[#7A1C2E]"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Gestión de Docentes
          </button>
          <button
            onClick={() => setActiveTab("materias")}
            className={`pb-3 text-sm font-semibold transition whitespace-nowrap cursor-pointer ${
              activeTab === "materias"
                ? "border-b-2 border-[#7A1C2E] text-[#7A1C2E]"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Agregar materias
          </button>
          <button
            onClick={() => setActiveTab("reportes")}
            className={`pb-3 text-sm font-semibold transition whitespace-nowrap cursor-pointer ${
              activeTab === "reportes"
                ? "border-b-2 border-[#7A1C2E] text-[#7A1C2E]"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Exportar Reportes
          </button>
        </div>

        {/* PESTAÑA BITÁCORA */}
        {activeTab === "bitacora" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Bitácora de Asistencias Generales</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Registros validados automáticamente mediante Token de Red e ID de Dispositivo.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Buscar docente o correo..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                />
                <select
                  value={filtroEstado}
                  onChange={(e) => setFiltroEstado(e.target.value)}
                  className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                >
                  <option value="TODOS">Todos los estados</option>
                  <option value="PRESENTE">Presente</option>
                  <option value="RETARDO">Retardo</option>
                  <option value="FALTA">Falta</option>
                </select>
                <button
                  onClick={cargarTablaAdmin}
                  disabled={loading}
                  className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  {loading ? "..." : "Actualizar"}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold text-xs uppercase tracking-wider">
                    <th className="py-3 px-4">Usuario</th>
                    <th className="py-3 px-4">Correo Institucional</th>
                    <th className="py-3 px-4">Fecha y Hora</th>
                    <th className="py-3 px-4">ID Dispositivo</th>
                    <th className="py-3 px-4">Aula / Red</th>
                    <th className="py-3 px-4">Estatus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {registrosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-400">
                        {loading ? "Cargando registros..." : "No se encontraron marcaciones."}
                      </td>
                    </tr>
                  ) : (
                    registrosFiltrados.map((reg) => (
                      <tr key={reg.id} className="hover:bg-slate-50 transition">
                        <td className="py-3 px-4 font-semibold text-slate-900">{reg.usuario}</td>
                        <td className="py-3 px-4 text-slate-500">{reg.email}</td>
                        <td className="py-3 px-4">{reg.fecha_hora}</td>
                        <td className="py-3 px-4 text-xs font-mono font-bold text-slate-700">{reg.ip_origen}</td>
                        <td className="py-3 px-4 text-xs font-mono text-slate-500">{reg.metodo}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                              reg.estado === "RETARDO"
                                ? "bg-amber-100 text-amber-800"
                                : reg.estado === "FALTA"
                                ? "bg-rose-100 text-rose-800"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
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
        )}

        {/* PESTAÑA REDES WI-FI */}
        {activeTab === "redes" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-1">Agregar Red Institucional</h3>
              <p className="text-xs text-slate-500 mb-4">
                Al guardar desde el campus, la red se codifica en binario y se vincula automáticamente al enlace Wi-Fi actual.
              </p>

              <form onSubmit={handleAgregarRed} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Nombre de la Red (SSID) *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. TUP-AULAS-2"
                    value={nuevaRed.ssid}
                    onChange={(e) => setNuevaRed({ ...nuevaRed, ssid: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Clave de Acceso Wi-Fi *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. tecplayacar2026"
                    value={nuevaRed.password}
                    onChange={(e) => setNuevaRed({ ...nuevaRed, password: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Zona / Edificio / Aula *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Edificio B - Laboratorios"
                    value={nuevaRed.zona}
                    onChange={(e) => setNuevaRed({ ...nuevaRed, zona: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={guardandoRed}
                  className="w-full py-2.5 bg-[#7A1C2E] hover:bg-[#5c1523] text-white text-xs font-bold rounded-lg transition cursor-pointer disabled:opacity-50"
                >
                  {guardandoRed ? "Codificando Red..." : "+ Codificar y Vincular Red Actual"}
                </button>
              </form>
            </div>

            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Redes Wi-Fi Autorizadas</h3>
                  <p className="text-xs text-slate-500">Conéctate al Wi-Fi del campus y vincula cada enlace oficial con 1 clic.</p>
                </div>
                <button
                  onClick={cargarRedesWifi}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  Actualizar
                </button>
              </div>

              <div className="space-y-3">
                {redesWifi.map((red) => (
                  <div
                    key={red.ssid}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`w-2.5 h-2.5 rounded-full ${red.coincide_actual ? "bg-emerald-500" : "bg-rose-500"}`}></span>
                        <span className="font-bold text-sm text-slate-900">{red.ssid}</span>
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                          red.coincide_actual
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-rose-100 text-rose-800"
                        }`}>
                          {red.coincide_actual ? "CONECTADO A ESTE ENLACE" : "TU RED ACTUAL NO COINCIDE"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">{red.zona}</p>
                      <p className="text-[11px] font-mono text-slate-500 mt-1">
                        Tu subred actual: <strong className="text-slate-800">{red.firma_actual_cliente || "N/A"}</strong> | Vinculadas:{" "}
                        <strong className="text-emerald-700">
                          {red.enlaces_vinculados && red.enlaces_vinculados.length > 0
                            ? red.enlaces_vinculados.join(", ")
                            : "Ninguna"}
                        </strong>
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => handleCalibrarRed(red.ssid)}
                        disabled={calibrandoSsid === red.ssid}
                        className="px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition cursor-pointer disabled:opacity-50"
                      >
                        {calibrandoSsid === red.ssid ? "Vinculando..." : "+ Vincular mi red actual"}
                      </button>

                      {red.calibrada && (
                        <button
                          onClick={() => handleResetRed(red.ssid)}
                          className="px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition cursor-pointer"
                        >
                          Limpiar enlaces
                        </button>
                      )}

                      {red.ssid !== "TUP" && (
                        <button
                          onClick={() => handleEliminarRed(red.ssid)}
                          className="px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg transition cursor-pointer"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PESTAÑA GESTIÓN DE DOCENTES */}
        {activeTab === "docentes" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            {estadoSistema?.posiblemente_temporal && (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                <p className="font-bold mb-1">Los datos podrían perderse al reiniciar el servidor</p>
                <p>
                  El backend usa un archivo SQLite temporal. Configura la variable DATABASE_URL (PostgreSQL) en Render
                  para que docentes, fotos y asistencias se conserven.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Gestión de Docentes</h3>
                <p className="text-xs text-slate-500">
                  {docentes.length} registrados · {docentes.filter((d) => d.en_campus).length} en el campus ahora.
                  Haz clic en un docente para ver su detalle.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={busquedaDocente}
                  onChange={(e) => setBusquedaDocente(e.target.value)}
                  placeholder="Buscar nombre, correo o matrícula"
                  className="px-3 py-2 text-xs border border-slate-200 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                />
                <button
                  onClick={() => setShowModalDocente(true)}
                  className="px-4 py-2 bg-[#7A1C2E] hover:bg-[#5c1523] text-white text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  + Agregar Docente
                </button>
              </div>
            </div>

            {docentes.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-10">Todavía no hay docentes registrados.</p>
            ) : (
              <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {docentes
                  .filter((d) => {
                    const q = busquedaDocente.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      d.nombre.toLowerCase().includes(q) ||
                      d.email.toLowerCase().includes(q) ||
                      (d.numero_empleado || "").toLowerCase().includes(q)
                    );
                  })
                  .map((d) => (
                    <li key={d.id} className="flex items-center justify-between hover:bg-slate-50 transition pr-4">
                      <button
                        type="button"
                        onClick={() => abrirDetalleDocente(d.id)}
                        className="flex-1 flex items-center gap-3 px-4 py-3 text-left min-w-0 cursor-pointer"
                      >
                        <span className="w-10 h-10 rounded-full overflow-hidden bg-slate-200 flex items-center justify-center text-sm font-bold text-slate-600 shrink-0">
                          {d.foto ? (
                            <img src={d.foto} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                          ) : (
                            iniciales(d.nombre)
                          )}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-slate-900 truncate">{d.nombre}</span>
                          <span className="block text-[11px] text-slate-500 truncate">
                            {d.numero_empleado ? `Matrícula ${d.numero_empleado} · ` : ""}
                            {d.email}
                          </span>
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${
                            d.en_campus
                              ? "bg-emerald-100 text-emerald-700"
                              : d.en_linea
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {d.en_campus ? "En el campus" : d.en_linea ? "Fuera de rango" : "Sin conexión"}
                        </span>
                      </button>

                      {d.rol !== "admin" && (
                        <button
                          type="button"
                          onClick={(e) => handleEliminarDocente(e, d.id, d.nombre)}
                          className="ml-2 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg transition shrink-0 cursor-pointer"
                        >
                          Eliminar
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        {/* PESTAÑA AGREGAR MATERIAS */}
        {activeTab === "materias" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-1">Agregar materias</h3>
              <p className="text-xs text-slate-500 mb-4">
                Asigna materia, día, horario y aula a un docente. Se reflejará automáticamente en su calendario escolar.
              </p>

              <form onSubmit={handleAsignarMateria} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Docente *</label>
                  <select
                    required
                    value={nuevaMateria.usuario_id}
                    onChange={(e) => setNuevaMateria({ ...nuevaMateria, usuario_id: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                  >
                    <option value="">Selecciona un docente...</option>
                    {docentesSolo.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.nombre} ({doc.numero_empleado || doc.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Materia *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Ingeniería de Software"
                    value={nuevaMateria.materia}
                    onChange={(e) => setNuevaMateria({ ...nuevaMateria, materia: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Día de la semana *</label>
                    <select
                      value={nuevaMateria.dia_semana}
                      onChange={(e) => setNuevaMateria({ ...nuevaMateria, dia_semana: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                    >
                      <option value="Lunes">Lunes</option>
                      <option value="Martes">Martes</option>
                      <option value="Miércoles">Miércoles</option>
                      <option value="Jueves">Jueves</option>
                      <option value="Viernes">Viernes</option>
                      <option value="Sábado">Sábado</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Horario *</label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. 08:00 - 10:00 AM"
                      value={nuevaMateria.horario}
                      onChange={(e) => setNuevaMateria({ ...nuevaMateria, horario: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Aula *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Aula B-204 / Lab. Cómputo 1"
                    value={nuevaMateria.aula}
                    onChange={(e) => setNuevaMateria({ ...nuevaMateria, aula: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={guardandoMateria}
                  className="w-full py-2.5 bg-[#7A1C2E] hover:bg-[#5c1523] text-white text-xs font-bold rounded-lg transition cursor-pointer disabled:opacity-50"
                >
                  {guardandoMateria ? "Asignando..." : "+ Asignar Materia al Docente"}
                </button>
              </form>
            </div>

            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Materias y Horarios Asignados</h3>
                  <p className="text-xs text-slate-500">Carga académica enviada al portal de cada docente.</p>
                </div>
                <button
                  onClick={cargarMaterias}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  Actualizar
                </button>
              </div>

              {materias.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-10">
                  Aún no hay materias asignadas. Usa el formulario de la izquierda para registrar la primera.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider">
                        <th className="py-2.5 px-3">Docente</th>
                        <th className="py-2.5 px-3">Materia</th>
                        <th className="py-2.5 px-3">Día y Horario</th>
                        <th className="py-2.5 px-3">Aula</th>
                        <th className="py-2.5 px-3 text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {materias.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-semibold text-slate-900">{m.docente_nombre}</td>
                          <td className="py-2.5 px-3 font-medium text-[#7A1C2E]">{m.materia}</td>
                          <td className="py-2.5 px-3 font-mono">{m.dia_semana} · {m.horario}</td>
                          <td className="py-2.5 px-3">{m.aula}</td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleEliminarMateria(m.id)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg cursor-pointer"
                            >
                              Quitar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* PESTAÑA REPORTES */}
        {activeTab === "reportes" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Exportar Reportes Institucionales</h3>
            <p className="text-xs text-slate-500 mb-6">Genera un archivo Excel/CSV con el historial de asistencias.</p>
            <div className="flex gap-4 items-center">
              <input type="date" className="px-3 py-2 text-xs border border-slate-200 rounded-lg" />
              <span className="text-xs text-slate-400">a</span>
              <input type="date" className="px-3 py-2 text-xs border border-slate-200 rounded-lg" />
              <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition cursor-pointer">
                Descargar Reporte (CSV)
              </button>
            </div>
          </div>
        )}
      </section>

      {/* MODAL CAMPANA DE NOTIFICACIONES / INCIDENCIAS */}
      {modalCampanaAbierto && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setModalCampanaAbierto(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl p-6 max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Notificaciones e Incidencias Docentes</h3>
                <p className="text-xs text-slate-500">
                  {noLeidasCount > 0
                    ? `Tienes ${noLeidasCount} notificación(es) pendiente(s) por revisar.`
                    : "Todas las incidencias han sido revisadas."}
                  {estadoSistema?.correo_brevo_configurado
                    ? " · Envío de correo Brevo activo."
                    : ""}
                </p>
              </div>
              <button
                onClick={() => setModalCampanaAbierto(false)}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto py-4 space-y-4 flex-1">
              {incidencias.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No hay incidencias ni notificaciones enviadas por los docentes todavía.
                </div>
              ) : (
                incidencias.map((inc) => (
                  <div
                    key={inc.id}
                    className={`rounded-xl border p-4 space-y-3 ${
                      inc.urgente
                        ? "border-rose-300 bg-rose-50/60"
                        : !inc.leida
                        ? "border-amber-300 bg-amber-50/40"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-700 shrink-0">
                          {inc.docente_foto ? (
                            <img src={inc.docente_foto} alt="" className="w-full h-full object-cover" />
                          ) : (
                            iniciales(inc.docente_nombre)
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-slate-900">{inc.docente_nombre}</span>
                            {inc.urgente && (
                              <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-rose-600 text-white">
                                URGENTE
                              </span>
                            )}
                            <span
                              className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                                inc.estado === "RESUELTA"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {inc.estado}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            {inc.docente_email} · Enviado: {inc.fecha_creacion}
                          </p>
                        </div>
                      </div>

                      {!inc.leida && (
                        <button
                          type="button"
                          onClick={() => handleMarcarLeida(inc.id)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
                        >
                          Marcar leída
                        </button>
                      )}
                    </div>

                    <div className="text-xs space-y-1 bg-white p-3 rounded-lg border border-slate-200/80">
                      <p className="font-bold text-[#7A1C2E]">
                        {ETIQUETAS_MOTIVO[inc.motivo] || inc.motivo}
                        {inc.fecha_evento ? ` · Fecha evento: ${inc.fecha_evento}` : ""}
                      </p>
                      <p className="text-slate-800 whitespace-pre-line">{inc.descripcion}</p>
                      {inc.observaciones && (
                        <p className="text-slate-500 text-[11px] pt-1">
                          <strong>Observaciones:</strong> {inc.observaciones}
                        </p>
                      )}
                    </div>

                    {inc.respuesta_admin && (
                      <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                        <p className="text-[11px] font-bold text-emerald-800 mb-0.5">
                          Respuesta enviada ({inc.fecha_respuesta}):
                        </p>
                        <p className="text-emerald-950 whitespace-pre-line">{inc.respuesta_admin}</p>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <input
                        type="text"
                        placeholder={
                          inc.respuesta_admin
                            ? "Enviar nueva respuesta o actualización..."
                            : "Escribe una respuesta para el docente (llega al portal y por correo)..."
                        }
                        value={respuestasTexto[inc.id] || ""}
                        onChange={(e) =>
                          setRespuestasTexto((prev) => ({ ...prev, [inc.id]: e.target.value }))
                        }
                        className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                      />
                      <button
                        type="button"
                        disabled={enviandoRespuestaId === inc.id || !(respuestasTexto[inc.id] || "").trim()}
                        onClick={() => handleResponderIncidencia(inc.id)}
                        className="px-4 py-2 bg-[#7A1C2E] hover:bg-[#5c1523] text-white text-xs font-bold rounded-lg transition cursor-pointer disabled:opacity-50"
                      >
                        {enviandoRespuestaId === inc.id ? "Enviando..." : "Responder"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* PANEL DE DETALLE DEL DOCENTE */}
      {(() => {
        const d = docentes.find((x) => x.id === docenteSelId);
        if (!d) return null;
        const u = d.ubicacion;
        const delta = 0.0012;
        const mapaSrc = u
          ? `https://www.openstreetmap.org/export/embed.html?bbox=${u.lon - delta},${u.lat - delta},${u.lon + delta},${u.lat + delta}&layer=mapnik&marker=${u.lat},${u.lon}`
          : null;
        return (
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            onClick={() => setDocenteSelId(null)}
          >
            <div
              className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-5 max-h-[92vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-4">
                <div className="w-20 h-20 rounded-full overflow-hidden bg-slate-200 flex items-center justify-center text-2xl font-bold text-slate-600 shrink-0 border border-slate-200">
                  {d.foto ? (
                    <img src={d.foto} alt={d.nombre} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  ) : (
                    iniciales(d.nombre)
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-slate-900 leading-tight">{d.nombre}</h3>
                  <p className="text-xs text-slate-600 mt-1">
                    Matrícula: <span className="font-semibold">{d.numero_empleado || "sin matrícula"}</span>
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">{d.email}</p>
                </div>
                <button
                  onClick={() => setDocenteSelId(null)}
                  className="text-slate-400 hover:text-slate-700 font-bold text-lg cursor-pointer"
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 text-xs text-slate-700">
                {d.hora_llegada ? (
                  <p>
                    Llegó hoy a las <span className="font-bold">{formatoHora(d.hora_llegada)}</span>
                  </p>
                ) : (
                  <p className="text-slate-500">Sin registro de llegada hoy.</p>
                )}
              </div>

              <div className="mt-2">
                <span
                  className={`inline-block text-[11px] font-bold px-2.5 py-1 rounded-full ${
                    d.en_campus
                      ? "bg-emerald-100 text-emerald-700"
                      : d.en_linea
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {d.en_campus
                    ? "Dentro de la red del campus"
                    : d.en_linea
                    ? "Fuera de la red del campus"
                    : "Sin conexión reciente"}
                </span>
                <span className="ml-2 text-[11px] text-slate-400">
                  Última señal: {textoHace(d.segundos_desde_conexion)}
                </span>
              </div>

              <div className="mt-4">
                {mapaSrc && u ? (
                  <>
                    <iframe
                      title={`Ubicación de ${d.nombre}`}
                      src={mapaSrc}
                      className="w-full h-52 rounded-lg border border-slate-200"
                      loading="lazy"
                    />
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span>
                        {u.lat.toFixed(5)}, {u.lon.toFixed(5)}
                        {u.precision_metros != null ? ` · precisión ±${Math.round(u.precision_metros)} m` : ""}
                        {u.distancia_metros != null ? ` · a ${Math.round(u.distancia_metros)} m del campus` : ""}
                      </span>
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${u.lat}&mlon=${u.lon}#map=18/${u.lat}/${u.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#7A1C2E] font-semibold underline"
                      >
                        Abrir mapa grande
                      </a>
                    </div>
                  </>
                ) : (
                  <div className="h-24 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-center text-[11px] text-slate-500 px-4">
                    {d.en_campus
                      ? "Está en la red del campus, pero su dispositivo no ha compartido la ubicación."
                      : "La ubicación solo se muestra mientras el docente está conectado a la red del campus."}
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Credenciales de Acceso
                </p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">No. Docente / Usuario:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {d.numero_empleado || d.email}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Contraseña:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900 select-all">
                      {d.password_visible
                        ? mostrarPasswordDocente
                          ? d.password_visible
                          : "••••••••••••"
                        : "Acceso vía Google / Sin clave local"}
                    </span>
                    {d.password_visible && (
                      <button
                        type="button"
                        onClick={() => setMostrarPasswordDocente((v) => !v)}
                        title={mostrarPasswordDocente ? "Ocultar contraseña" : "Ver contraseña"}
                        aria-label={mostrarPasswordDocente ? "Ocultar contraseña" : "Ver contraseña"}
                        className="p-1 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-200/70 transition cursor-pointer"
                      >
                        {mostrarPasswordDocente ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {d.rol !== "admin" && (
                <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    type="button"
                    onClick={(e) => handleEliminarDocente(e, d.id, d.nombre)}
                    className="px-3.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg transition cursor-pointer"
                  >
                    Eliminar Docente
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* MODAL CREAR DOCENTE */}
      {showModalDocente && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Registrar Nuevo Docente</h3>
            <form onSubmit={handleCrearDocente} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre Completo</label>
                <input
                  type="text"
                  required
                  value={nuevoDocente.nombre}
                  onChange={(e) => setNuevoDocente({ ...nuevoDocente, nombre: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Correo Institucional</label>
                <input
                  type="email"
                  required
                  value={nuevoDocente.email}
                  onChange={(e) => setNuevoDocente({ ...nuevoDocente, email: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Matrícula / ID</label>
                <input
                  type="text"
                  required
                  value={nuevoDocente.matricula}
                  onChange={(e) => setNuevoDocente({ ...nuevoDocente, matricula: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Contraseña Inicial</label>
                <input
                  type="password"
                  required
                  value={nuevoDocente.password}
                  onChange={(e) => setNuevoDocente({ ...nuevoDocente, password: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7A1C2E]"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModalDocente(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-[#7A1C2E] hover:bg-[#5c1523] text-white rounded-lg transition"
                >
                  Guardar Docente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}