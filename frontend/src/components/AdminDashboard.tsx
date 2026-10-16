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

interface AdminDashboardProps {
  session: any;
}

export default function AdminDashboard({ session }: AdminDashboardProps) {
  const [registros, setRegistros] = useState<RegistroAsistencia[]>([]);

  const cargarTablaAdmin = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/admin/asistencias");
      if (res.ok) {
        const data = await res.json();
        setRegistros(data);
      }
    } catch (err) {
      console.error("Error al obtener bitácora general de asistencias");
    }
  };

  useEffect(() => {
    cargarTablaAdmin();
  }, []);

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-800">
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#7A1C2E] text-white flex items-center justify-center font-bold">
            TUP
          </div>
          <div>
            <h1 className="font-bold text-slate-900 text-lg leading-tight">Tecnológico Universitario Playacar</h1>
            <p className="text-xs text-slate-500">Panel de Administración de Asistencias</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-semibold text-slate-900">{session.user?.name}</p>
            <p className="text-xs text-slate-500">{session.user?.email}</p>
          </div>
          <button
            onClick={() => signOut()}
            className="px-4 py-2 text-xs font-semibold text-[#7A1C2E] border border-[#7A1C2E] rounded-lg hover:bg-[#7A1C2E] hover:text-white transition-all cursor-pointer"
          >
            Cerrar Sesión
          </button>
        </div>
      </header>

      <section className="max-w-6xl mx-auto p-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Estado del Sistema</span>
            <p className="text-xl font-bold text-emerald-600 mt-2 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span> Servidor Wi-Fi Activo
            </p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Usuario</span>
            <p className="text-xl font-bold text-slate-900 mt-2">Administrador General</p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Registros Hoy</span>
            <p className="text-xl font-bold text-slate-900 mt-2">{registros.length} Marcaciones</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Bitácora de Asistencias Generales</h2>
              <p className="text-xs text-slate-500 mt-1">
                Registros en tiempo real detectados por la infraestructura Wi-Fi.
              </p>
            </div>
            <button
              onClick={cargarTablaAdmin}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition"
            >
              Actualizar Lista
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold text-xs uppercase tracking-wider">
                  <th className="py-3 px-4">Usuario</th>
                  <th className="py-3 px-4">Correo Institucional</th>
                  <th className="py-3 px-4">Fecha y Hora</th>
                  <th className="py-3 px-4">Origen Wi-Fi</th>
                  <th className="py-3 px-4">Estatus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {registros.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      No hay asistencias registradas aún.
                    </td>
                  </tr>
                ) : (
                  registros.map((reg) => (
                    <tr key={reg.id} className="hover:bg-slate-50 transition">
                      <td className="py-3 px-4 font-semibold text-slate-900">{reg.usuario}</td>
                      <td className="py-3 px-4 text-slate-500">{reg.email}</td>
                      <td className="py-3 px-4">{reg.fecha_hora}</td>
                      <td className="py-3 px-4 text-xs font-mono text-slate-500">{reg.ip_origen}</td>
                      <td className="py-3 px-4">
                        <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded-full">
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
      </section>
    </main>
  );
}