"use client";

import Link from "next/link";

export default function PrivacidadPage() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-black text-slate-800 dark:text-neutral-100 p-8 flex flex-col items-center justify-center">
      <div className="max-w-2xl w-full bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-2xl p-8 shadow-xl space-y-6">
        <div className="flex items-center gap-4 border-b border-slate-200 dark:border-neutral-800 pb-4">
          <div className="w-12 h-12 rounded-xl bg-[#7A1C2E] text-white flex items-center justify-center font-bold text-xl">
            TUP
          </div>
          <div>
            <h1 className="text-xl font-bold">Aviso de Privacidad y Términos Institucionales</h1>
            <p className="text-xs text-slate-500 dark:text-neutral-400">Tecnológico Universitario Playacar</p>
          </div>
        </div>

        <div className="space-y-4 text-xs leading-relaxed text-slate-600 dark:text-neutral-300">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Monitoreo de Presencia por Red Wi-Fi</h2>
          <p>
            El Sistema de Control de Asistencia del Tecnológico Universitario Playacar (TUP) utiliza la dirección física (MAC Address) y la conexión al SSID autorizado &quot;TUP&quot; para registrar la presencia del docente en el aula de manera automatizada.
          </p>
          <p>
            Los datos recabados son únicamente utilizados para fines estadísticos, control escolar y validación de horarios académicos de conformidad con las políticas del campus.
          </p>
        </div>

        <div className="pt-4 border-t border-slate-200 dark:border-neutral-800 flex justify-between items-center">
          <Link
            href="/"
            className="text-xs font-bold text-[#7A1C2E] dark:text-rose-400 hover:underline"
          >
            ← Volver al Portal de Asistencia
          </Link>
          <a
            href="/aviso-privacidad.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold text-blue-600 dark:text-blue-400 underline"
          >
            Descargar Documentación Oficial (PDF)
          </a>
        </div>
      </div>
    </main>
  );
}