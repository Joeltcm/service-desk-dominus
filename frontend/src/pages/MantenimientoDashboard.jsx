import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMaintStats } from '../services/api'
import { Wrench, CalendarClock, AlertTriangle, ClipboardList, CheckCircle2, Percent, Ban, RefreshCw, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'

const dmy = (iso) => (iso ? iso.split('-').reverse().join('-') : '—')

function Tile({ icon: Icon, label, value, tone, sub }) {
  return (
    <div className="card flex items-start gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${tone}`}><Icon size={17} /></div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function Section({ title, count, children }) {
  return (
    <section className="card space-y-3">
      <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center justify-between">
        <span>{title}</span><span className="text-gray-400 normal-case font-normal">{count}</span>
      </h2>
      {children}
    </section>
  )
}

export default function MantenimientoDashboard() {
  const navigate = useNavigate()
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    getMaintStats().then((r) => setD(r.data)).catch(() => toast.error('Error cargando el dashboard')).finally(() => setLoading(false))
  }
  useEffect(load, [])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap md:pr-16 lg:pr-36">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Wrench size={22} className="text-teal-600" /> Dashboard de mantenimiento</h1>
          <p className="text-sm text-gray-500 mt-0.5">Lo que viene, lo vencido y cómo cumplimos los servicios.{d ? ` Corte: ${dmy(d.as_of)}.` : ''}</p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-1.5 text-sm"><RefreshCw size={14} /> Actualizar</button>
      </div>

      {loading && !d && <div className="card text-center text-gray-400 text-sm py-10">Cargando…</div>}

      {d && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile icon={CalendarClock} label="Planes activos" value={d.plans.active} tone="bg-teal-50 text-teal-700" sub={`${d.plans.paused} pausados`} />
            <Tile icon={CalendarClock} label="Próximos (30 días)" value={d.upcoming.length} tone="bg-amber-50 text-amber-700" />
            <Tile icon={AlertTriangle} label="Vencidos sin atender" value={d.overdue_unattended} tone="bg-red-50 text-red-700" sub={`${d.overdue.length} vencido(s) en total`} />
            <Tile icon={ClipboardList} label="Pendientes por atender" value={d.pending.count} tone="bg-sky-50 text-sky-700" />
            <Tile icon={CheckCircle2} label="Completados" value={d.completed.total} tone="bg-emerald-50 text-emerald-700" sub={`${d.completed.on_time} a tiempo · ${d.completed.late} tarde`} />
            <Tile icon={Percent} label="Cumplimiento a tiempo" value={d.completed.on_time_pct == null ? '—' : `${d.completed.on_time_pct}%`} tone="bg-violet-50 text-violet-700" />
            <Tile icon={Ban} label="Cancelados" value={d.cancelled.tickets + d.cancelled.plans} tone="bg-gray-100 text-gray-600" sub={`${d.cancelled.plans} planes · ${d.cancelled.tickets} atenciones`} />
            <Tile icon={Wrench} label="Preventivo / correctivo" value={`${d.by_type.preventivo || 0} / ${d.by_type.correctivo || 0}`} tone="bg-indigo-50 text-indigo-700" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Próximos sugeridos" count={d.upcoming.length}>
              {d.upcoming.length === 0 && <p className="text-sm text-gray-400">No hay mantenimientos sugeridos en los próximos {30} días.</p>}
              {d.upcoming.map((u) => (
                <button key={u.id} onClick={() => navigate('/mantenimiento')} className="w-full flex items-center justify-between gap-3 text-left rounded-lg px-2 py-2 hover:bg-gray-50">
                  <div className="min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{u.title}</p><p className="text-xs text-gray-500 truncate">{u.client}</p></div>
                  <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex-shrink-0">{dmy(u.next_suggested_date)}</span>
                </button>
              ))}
            </Section>

            <Section title="Vencidos" count={d.overdue.length}>
              {d.overdue.length === 0 && <p className="text-sm text-gray-400">Ningún plan vencido.</p>}
              {d.overdue.map((o) => (
                <button key={o.id} onClick={() => navigate('/mantenimiento')} className="w-full flex items-center justify-between gap-3 text-left rounded-lg px-2 py-2 hover:bg-gray-50">
                  <div className="min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{o.title}</p><p className="text-xs text-gray-500 truncate">{o.client}</p></div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {o.attended
                      ? <span className="text-[11px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full">En atención</span>
                      : <span className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">Sin atender</span>}
                    <span className="text-xs font-semibold text-red-700">{dmy(o.next_suggested_date)}</span>
                  </div>
                </button>
              ))}
            </Section>

            <Section title="Pendientes por atender" count={d.pending.count}>
              {d.pending.items.length === 0 && <p className="text-sm text-gray-400">No hay solicitudes abiertas.</p>}
              {d.pending.items.map((t) => (
                <button key={t.id} onClick={() => navigate(`/tickets/${t.id}`)} className="w-full flex items-center justify-between gap-3 text-left rounded-lg px-2 py-2 hover:bg-gray-50">
                  <div className="min-w-0"><p className="text-sm font-medium text-gray-800 truncate">#{t.id} · {t.title}</p><p className="text-xs text-gray-500 truncate">{t.client}{t.maint_type ? ` · ${t.maint_type}` : ''}</p></div>
                  <span className="text-xs text-gray-500 flex items-center gap-1 flex-shrink-0">{t.status} <ExternalLink size={11} /></span>
                </button>
              ))}
            </Section>

            <Section title="Por cliente" count={d.by_client.length}>
              {d.by_client.length === 0 && <p className="text-sm text-gray-400">Sin datos aún.</p>}
              {d.by_client.map((c) => {
                const max = Math.max(...d.by_client.map((x) => x.count), 1)
                return (
                  <div key={c.client} className="space-y-1">
                    <div className="flex justify-between text-sm"><span className="text-gray-700 truncate">{c.client}</span><span className="font-semibold text-gray-900">{c.count}</span></div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-teal-500" style={{ width: `${(c.count / max) * 100}%` }} /></div>
                  </div>
                )
              })}
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
