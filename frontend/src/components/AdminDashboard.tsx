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
  en_linea?: boolean;
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

interface DocenteItem {
  id: number;
  nombre: string;
  email: string;
  numero_empleado: string;
  mac_address: string;
  en_linea?: boolean;
  en_campus?: boolean;
  ultima_actividad?: string | null;
  total_asistencias?: number;
}

interface AdminDashboardProps {
  session: any;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://tup-backend-19dl.onrender.com";

export default function AdminDashboard({ session }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<"bitacora" | "redes" | "docentes" | "reportes">("bitacora");
  const [registros, setRegistros] = useState<RegistroAsistencia[]>([]);
  const [redesWifi, setRedesWifi] = useState<RedWifi[]>([]);
  const [docentesLista, setDocentesLista] = useState<DocenteItem[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("TODOS");
  const [loading, setLoading] = useState(false);
  const [limpiandoBitacora, setLimpiandoBitacora] = useState(false);

  const [fechaInicioReporte, setFechaInicioReporte] = useState("");
  const [fechaFinReporte, setFechaFinReporte] = useState("");

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
      if (res.ok) {
        const data = await res.json();
        setRegistros(data);
      }
    } catch (err) {
      console.error("Error al obtener bitácora general de asistencias", err);
    } finally {
      setLoading(false);
    }
  };

  const cargarRedesWifi = async () => {
    try {
      const res = await adminFetch("/api/admin/redes-wifi");
      if (res.ok) {
        const data = await res.json();
        setRedesWifi(data);
      }
    } catch (err) {
      console.error("Error al obtener redes Wi-Fi", err);
    }
  };

  const cargarDocentes = async () => {
    try {
      const res = await adminFetch("/api/admin/docentes");
      if (res.ok) {
        const data = await res.json();
        setDocentesLista(data);
      }
    } catch (err) {
      console.error("Error al obtener lista de docentes", err);
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

    const interval = setInterval(() => {
      cargarDocentes();
      cargarTablaAdmin();
    }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  const descargarCsvDesdeRegistros = (lista: RegistroAsistencia[], nombreArchivo: string) => {
    const escaparCsv = (valor: string | number | undefined) => {
      const texto = String(valor ?? "").replace(/"/g, '""');
      return `"${texto}"`;
    };

    const encabezados = [
      "ID",
      "Docente",
      "Correo Institucional",
      "Fecha y Hora",
      "ID Dispositivo",
      "Red / Zona",
      "Estatus",
    ];

    const filas = lista.map((r) =>
      [
        escaparCsv(r.id),
        escaparCsv(r.usuario),
        escaparCsv(r.email),
        escaparCsv(r.fecha_hora),
        escaparCsv(r.ip_origen),
        escaparCsv(r.metodo),
        escaparCsv(r.estado),
      ].join(",")
    );

    const contenidoCsv = "\uFEFF" + [encabezados.join(","), ...filas].join("\n");
    const blob = new Blob([contenidoCsv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombreArchivo;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
  };

  const handleDescargarYBorrarBitacora = async () => {
    if (registros.length === 0) {
      alert("La bitácora ya está vacía, no hay registros para respaldar o borrar.");
      return;
    }

    const confirmar = confirm(
      `Se descargará un respaldo CSV con los ${registros.length} registros actuales en tu carpeta de Descargas y después se restablecerá la bitácora.\n\n¿Deseas continuar?`
    );
    if (!confirmar) return;

    setLimpiandoBitacora(true);
    try {
      const fechaHoy = new Date().toISOString().slice(0, 10);
      descargarCsvDesdeRegistros(registros, `respaldo_bitacora_tup_${fechaHoy}.csv`);

      const res = await adminFetch("/api/admin/asistencias", { method: "DELETE" });
      if (res.ok) {
        setRegistros([]);
        await cargarDocentes();
        alert("Respaldo guardado en Descargas y bitácora restablecida correctamente.");
      } else {
        alert("Se descargó el respaldo, pero hubo un error al limpiar la base de datos.");
      }
    } catch (err) {
      console.error("Error al respaldar y limpiar bitácora", err);
    } finally {
      setLimpiandoBitacora(false);
    }
  };

  const handleDescargarReporteFiltrado = () => {
    const filtradosPorFecha = registros.filter((r) => {
      const fechaSolo = r.fecha_hora.slice(0, 10);
      if (fechaInicioReporte && fechaSolo < fechaInicioReporte) return false;
      if (fechaFinReporte && fechaSolo > fechaFinReporte) return false;
      return true;
    });

    const sufijo =
      fechaInicioReporte || fechaFinReporte
        ? `${fechaInicioReporte || "inicio"}_a_${fechaFinReporte || "hoy"}`
        : new Date().toISOString().slice(0, 10);

    descargarCsvDesdeRegistros(filtradosPorFecha, `reporte_asistencias_tup_${sufijo}.csv`);
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
      if (res.ok) {
        await cargarRedesWifi();
      }
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
        setActiveTab("docentes");
      } else {
        const errData = await res.json().catch(() => null);
        alert(errData?.detail || "Error al registrar docente");
      }
    } catch (err) {
      console.error("Error de red al crear docente", err);
    }
  };

  const handleEliminarDocente = async (id: number, nombre: string) => {
    if (!confirm(`¿Seguro que deseas eliminar al docente "${nombre}" y todo su historial de asistencias?`)) return;
    try {
      const res = await adminFetch(`/api/admin/docentes/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await cargarDocentes();
        await cargarTablaAdmin();
      } else {
        const errData = await res.json().catch(() => null);
        alert(errData?.detail || "No se pudo eliminar el docente");
      }
    } catch (err) {
      console.error("Error al eliminar docente", err);
    }
  };

  const docentesEnLineaCount = docentesLista.filter((d) => d.en_linea).length;

  const registrosFiltrados = registros.filter((reg) => {
    const coincideTexto =
      reg.usuario.toLowerCase().includes(busqueda.toLowerCase()) ||
      reg.email.toLowerCase().includes(busqueda.toLowerCase());
    const coincideEstado = filtroEstado === "TODOS" || reg.estado === filtroEstado;
    return coincideTexto && coincideEstado;
  });

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
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
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
          <div className="text-right">
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

      <section className="max-w-6xl mx-auto p-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Redes Institucionales</span>
            <p className="text-xl font-bold text-emerald-600 mt-2 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span> {redesWifi.length} Redes Codificadas
            </p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Docentes en Línea</span>
            <p className="text-xl font-bold text-emerald-600 mt-2 flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${docentesEnLineaCount > 0 ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`}></span>
              {docentesEnLineaCount} de {docentesLista.length} Activos
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
            Gestión de Docentes ({docentesLista.length})
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

        {activeTab === "bitacora" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Bitácora de Asistencias Generales</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Registros validados automáticamente mediante Token de Red e ID de Dispositivo.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
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
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  {loading ? "..." : "Actualizar"}
                </button>
                <button
                  onClick={handleDescargarYBorrarBitacora}
                  disabled={limpiandoBitacora || registros.length === 0}
                  className="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold rounded-lg transition cursor-pointer disabled:opacity-50"
                >
                  {limpiandoBitacora ? "Respaldando..." : "Descargar y Borrar Historial"}
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
                    <th className="py-3 px-4">Red / Método</th>
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
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span
                              title={reg.en_linea ? "En línea ahora" : "Desconectado"}
                              className={`w-2 h-2 rounded-full ${reg.en_linea ? "bg-emerald-500" : "bg-slate-300"}`}
                            ></span>
                            <span>{reg.usuario}</span>
                          </div>
                        </td>
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

        {activeTab === "docentes" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Catálogo de Docentes y Estado en Línea</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Visualiza todos los profesores registrados, quién tiene sesión abierta en tiempo real y elimina cuentas.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={cargarDocentes}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  Actualizar
                </button>
                <button
                  onClick={() => setShowModalDocente(true)}
                  className="px-4 py-2 bg-[#7A1C2E] hover:bg-[#5c1523] text-white text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  + Agregar Docente
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold text-xs uppercase tracking-wider">
                    <th className="py-3 px-4">Estado</th>
                    <th className="py-3 px-4">Nombre</th>
                    <th className="py-3 px-4">Correo Institucional</th>
                    <th className="py-3 px-4">No. Empleado</th>
                    <th className="py-3 px-4">Dispositivo</th>
                    <th className="py-3 px-4 text-center">Marcaciones</th>
                    <th className="py-3 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {docentesLista.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-400">
                        No hay docentes registrados todavía.
                      </td>
                    </tr>
                  ) : (
                    docentesLista.map((doc) => (
                      <tr key={doc.id} className="hover:bg-slate-50 transition">
                        <td className="py-3 px-4">
                          {doc.en_linea ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full bg-emerald-100 text-emerald-800">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                              {doc.en_campus ? "EN LÍNEA (CAMPUS)" : "EN LÍNEA"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-slate-100 text-slate-500">
                              <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                              Desconectado
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">{doc.nombre}</td>
                        <td className="py-3 px-4 text-slate-500">{doc.email}</td>
                        <td className="py-3 px-4 font-mono text-xs font-bold text-slate-700">{doc.numero_empleado}</td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-500">{doc.mac_address}</td>
                        <td className="py-3 px-4 text-center font-bold text-slate-700">{doc.total_asistencias ?? 0}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleEliminarDocente(doc.id, doc.nombre)}
                            className="px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg transition cursor-pointer"
                          >
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "reportes" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Exportar Reportes Institucionales</h3>
              <p className="text-xs text-slate-500">
                Descarga un archivo CSV compatible con Excel con todas las asistencias registradas (opcionalmente filtrado por rango de fechas).
              </p>
            </div>

            <div className="flex flex-wrap gap-4 items-center">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Desde</label>
                <input
                  type="date"
                  value={fechaInicioReporte}
                  onChange={(e) => setFechaInicioReporte(e.target.value)}
                  className="px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Hasta</label>
                <input
                  type="date"
                  value={fechaFinReporte}
                  onChange={(e) => setFechaFinReporte(e.target.value)}
                  className="px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div className="pt-4">
                <button
                  onClick={handleDescargarReporteFiltrado}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  Descargar Reporte (CSV)
                </button>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-600 mb-2">
                Docentes registrados incluidos en el sistema ({docentesLista.length}):
              </p>
              <div className="flex flex-wrap gap-2">
                {docentesLista.map((d) => (
                  <span
                    key={d.id}
                    className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-xs font-medium"
                  >
                    {d.nombre} ({d.numero_empleado})
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

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
                <label className="block text-xs font-semibold text-slate-600 mb-1">Contraseña Inicial (mín. 8 caracteres)</label>
                <input
                  type="password"
                  required
                  minLength={8}
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