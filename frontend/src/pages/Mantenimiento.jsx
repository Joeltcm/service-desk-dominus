import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTickets, getAgents, confirmMaintenance, rescheduleMaintenance, createMaintPlan } from '../services/api'
import MaintenancePlans from '../components/MaintenancePlans'
import { useMaintFeatures, featureOn } from '../utils/maintFeatures'
import { MAINT_TYPES, fmtPanama, toPanamaInput, minutesBetween, parseEquipment } from '../utils/maintenance'
import { Wrench, X, Plus, MapPin, Phone, Mail, CalendarClock, CalendarPlus, RefreshCw, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'

const TYPE_CHIP = {
  preventivo: 'bg-teal-50 text-teal-700 border-teal-200',
  correctivo: 'bg-rose-50 text-rose-700 border-rose-200',
}

export default function Mantenimiento() {
  const navigate = useNavigate()
  const [tickets, setTickets] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // { mode: 'confirm' | 'reschedule', ticket }
  const [tab, setTab] = useState('servicios')
  const mf = useMaintFeatures()
  const plansOn = featureOn(mf, 'recurring_plans')

  const load = () => {
    setLoading(true)
    getTickets({ category: 'Mantenimiento', limit: 200 })
      .then((r) => setTickets(r.data || []))
      .catch(() => toast.error('Error cargando mantenimientos'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    getAgents().then((r) => setAgents(r.data || [])).catch(() => {})
  }, [])

  const groups = useMemo(() => {
    const porConfirmar = tickets.filter((t) => !t.closed_at && !t.maint_confirmed_start)
    const programados = tickets.filter((t) => !t.closed_at && t.maint_confirmed_start)
    const cerrados = tickets.filter((t) => t.closed_at)
    return [
      { key: 'pend', label: 'Por confirmar', items: porConfirmar, icon: CalendarPlus, tone: 'text-amber-600' },
      { key: 'prog', label: 'Programados', items: programados, icon: CalendarClock, tone: 'text-teal-600' },
      { key: 'cerr', label: 'Cerrados', items: cerrados, icon: Wrench, tone: 'text-gray-500' },
    ]
  }, [tickets])

  const onSaved = () => { setModal(null); load() }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap md:pr-16 lg:pr-36">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Wrench size={22} className="text-teal-600" /> Mantenimiento</h1>
          <p className="text-sm text-gray-500 mt-0.5">Solicitudes preventivas y correctivas de clientes y flotas.</p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-1.5 text-sm"><RefreshCw size={14} /> Actualizar</button>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {[['servicios', 'Servicios'], ...(plansOn ? [['planes', 'Planes recurrentes']] : [])].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === k ? 'border-teal-600 text-teal-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'planes' && plansOn && <MaintenancePlans onGoTicket={(tid) => navigate(`/tickets/${tid}`)} />}

      {tab === 'servicios' && loading && <div className="card text-center text-gray-400 text-sm py-10">Cargando…</div>}

      {tab === 'servicios' && !loading && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Por confirmar', value: groups[0].items.length, tone: 'border-amber-400 text-amber-700', icon: CalendarPlus },
            { label: 'Programados', value: groups[1].items.length, tone: 'border-teal-500 text-teal-700', icon: CalendarClock },
            { label: 'Cerrados', value: groups[2].items.length, tone: 'border-gray-400 text-gray-600', icon: Wrench },
          ].map((k) => (
            <div key={k.label} className={`card border-t-4 ${k.tone.split(' ')[0]} py-3 px-4`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5"><k.icon size={12} /> {k.label}</p>
              <p className={`text-2xl font-bold leading-tight mt-1 ${k.tone.split(' ')[1]}`}>{k.value}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'servicios' && !loading && groups.map((g) => (
        <section key={g.key} className="space-y-3">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
            <g.icon size={14} className={g.tone} /> {g.label}
            <span className="text-gray-400 font-normal normal-case">({g.items.length})</span>
          </h2>

          {g.items.length === 0 && (
            <div className="card text-sm text-gray-400 text-center py-6">Sin solicitudes en esta sección.</div>
          )}

          {g.items.map((t) => {
            const equipos = parseEquipment(t.maint_equipment)
            const tipo = (t.maint_type || '').toLowerCase()
            const confirmed = !!t.maint_confirmed_start
            return (
              <article key={t.id} className={`card space-y-3 border-l-4 ${tipo === 'correctivo' ? 'border-l-rose-400' : 'border-l-teal-500'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-400">Ticket #{t.id}{t.maint_report_folio ? ` · ${t.maint_report_folio}` : ''}</p>
                    <h3 className="font-semibold text-gray-900 truncate">{t.title}</h3>
                    <p className="text-xs text-gray-500">{t.client?.name}{t.client?.company ? ` · ${t.client.company}` : ''}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${TYPE_CHIP[tipo] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                    {MAINT_TYPES.find((m) => m.value === tipo)?.label || 'Sin tipo'}
                  </span>
                </div>

                {equipos.length > 0 && (
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Flota</p>
                    <ul className="text-sm text-gray-700 space-y-0.5">
                      {equipos.map((e, i) => <li key={i} className="flex justify-between"><span>{e.type}</span><span className="font-semibold">× {e.qty}</span></li>)}
                    </ul>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-gray-400">Fecha propuesta</p>
                    <p className="text-gray-700">{t.maint_requested_date ? t.maint_requested_date.split('-').reverse().join('-') : '—'}</p>
                  </div>
                  <div className={`rounded-lg p-2.5 ${confirmed ? 'bg-teal-50 border border-teal-100' : 'bg-amber-50 border border-amber-100'}`}>
                    <p className={`text-[11px] font-semibold uppercase tracking-wide ${confirmed ? 'text-teal-700' : 'text-amber-700'}`}>{confirmed ? 'Atención confirmada' : 'Atención'}</p>
                    <p className="text-gray-800 font-medium">
                      {confirmed ? `${fmtPanama(t.maint_confirmed_start)} → ${fmtPanama(t.maint_confirmed_end)}` : 'Pendiente de confirmar'}
                    </p>
                  </div>
                  <div className="flex items-start gap-1.5 text-gray-700"><MapPin size={14} className="text-gray-400 mt-0.5 flex-shrink-0" /><span>{t.location || '—'}</span></div>
                  <div className="space-y-0.5 text-gray-700">
                    <p className="font-medium">{t.maint_contact_name || '—'}</p>
                    {t.maint_contact_phone && <p className="flex items-center gap-1.5 text-xs"><Phone size={12} className="text-gray-400" />{t.maint_contact_phone}</p>}
                    {t.maint_contact_email && <p className="flex items-center gap-1.5 text-xs"><Mail size={12} className="text-gray-400" />{t.maint_contact_email}</p>}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                  {!confirmed && !t.closed_at && (
                    <button onClick={() => setModal({ mode: 'confirm', ticket: t })} className="btn-primary text-sm flex items-center gap-1.5">
                      <CalendarPlus size={14} /> Confirmar fecha
                    </button>
                  )}
                  {confirmed && !t.closed_at && (
                    <button onClick={() => setModal({ mode: 'reschedule', ticket: t })} className="btn-secondary text-sm flex items-center gap-1.5">
                      <RefreshCw size={14} /> Reprogramar / extender
                    </button>
                  )}
                  <button onClick={() => navigate(`/tickets/${t.id}`)} className="btn-secondary text-sm flex items-center gap-1.5">
                    <ExternalLink size={14} /> Ver ticket
                  </button>
                </div>
              </article>
            )
          })}
        </section>
      ))}

      {modal?.mode === 'confirm' && (
        <ConfirmModal ticket={modal.ticket} agents={agents} planEnabled={plansOn} onClose={() => setModal(null)} onSaved={onSaved} />
      )}
      {modal?.mode === 'reschedule' && (
        <RescheduleModal ticket={modal.ticket} onClose={() => setModal(null)} onSaved={onSaved} />
      )}
    </div>
  )
}

function ModalShell({ title, subtitle, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-900">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">{children}</div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-100">{footer}</div>
      </div>
    </div>
  )
}

function ConfirmModal({ ticket, agents, planEnabled = true, onClose, onSaved }) {
  const [equipment, setEquipment] = useState(() => {
    const eq = parseEquipment(ticket.maint_equipment)
    return eq.length ? eq.map((e) => ({ type: e.type || '', qty: e.qty || 1 })) : [{ type: '', qty: 1 }]
  })
  const [location, setLocation] = useState(ticket.location || '')
  const [start, setStart] = useState(ticket.maint_requested_date ? `${ticket.maint_requested_date}T09:00` : '')
  const [end, setEnd] = useState('')
  const [assigned, setAssigned] = useState(ticket.assigned_to_id || '')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const canPlan = planEnabled && (ticket.maint_type || '').toLowerCase() === 'preventivo' && !ticket.maint_plan_id
  const [makePlan, setMakePlan] = useState(false)
  const [freq, setFreq] = useState(6)

  const setLine = (i, f, v) => setEquipment((ls) => ls.map((l, idx) => (idx === i ? { ...l, [f]: v } : l)))

  const submit = async () => {
    if (!start) return toast.error('Indica la fecha y hora de inicio')
    if (!assigned) return toast.error('Asigna un técnico para confirmar la visita')
    const mins = end ? minutesBetween(start, end) : 60
    if (end && (mins === null || mins < 15)) return toast.error('La fecha de fin debe ser al menos 15 min posterior al inicio')
    const eq = equipment.filter((e) => e.type.trim()).map((e) => ({ type: e.type.trim(), qty: Number(e.qty) || 1 }))
    setSaving(true)
    try {
      await confirmMaintenance(ticket.id, {
        equipment: JSON.stringify(eq),
        location: location.trim() || null,
        scheduled_at: `${start}:00`,
        confirmed_end: end ? `${end}:00` : null,
        duration_minutes: mins || 60,
        assigned_to_id: Number(assigned),
        notes: notes.trim() || null,
      })
      if (makePlan) {
        try {
          await createMaintPlan({ from_ticket_id: ticket.id, title: ticket.title, frequency_months: Number(freq) })
          toast.success('Mantenimiento confirmado. Plan recurrente creado.')
        } catch (e) {
          toast.error(e?.response?.data?.detail || 'Confirmado, pero no se pudo crear el plan')
        }
      } else {
        toast.success('Mantenimiento confirmado. Se envió el aviso al cliente.')
      }
      onSaved()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error al confirmar')
    } finally { setSaving(false) }
  }

  return (
    <ModalShell title="Confirmar mantenimiento" subtitle={`Ticket #${ticket.id} · ${ticket.title}`} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancelar</button>
        <button onClick={submit} disabled={saving} className="btn-primary">{saving ? 'Confirmando…' : 'Confirmar y avisar'}</button>
      </>}>
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Equipos de la flota</p>
        <div className="space-y-2">
          {equipment.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input className="input flex-1 text-sm" placeholder="Tipo de equipo" value={l.type} onChange={(e) => setLine(i, 'type', e.target.value)} style={{ fontSize: '16px' }} />
              <input type="number" min="1" className="input w-20 text-sm text-right" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} style={{ fontSize: '16px' }} />
              {equipment.length > 1 && <button onClick={() => setEquipment((ls) => ls.filter((_, idx) => idx !== i))} className="text-gray-300 hover:text-red-500 px-1"><X size={16} /></button>}
            </div>
          ))}
        </div>
        <button onClick={() => setEquipment((ls) => [...ls, { type: '', qty: 1 }])} className="text-xs font-medium text-teal-700 flex items-center gap-1 mt-2"><Plus size={12} /> Agregar equipo</button>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Ubicación</p>
        <input className="input w-full" value={location} onChange={(e) => setLocation(e.target.value)} style={{ fontSize: '16px' }} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">Inicio (hora Panamá) *</p>
          <input type="datetime-local" className="input w-full" value={start} onChange={(e) => setStart(e.target.value)} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">Fin / rango (opcional)</p>
          <input type="datetime-local" className="input w-full" value={end} onChange={(e) => setEnd(e.target.value)} style={{ fontSize: '16px' }} />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Técnico asignado <span className="text-red-600">*</span></p>
        <select className={`input w-full ${!assigned ? 'border-amber-300' : ''}`} value={assigned} required onChange={(e) => setAssigned(e.target.value)} style={{ fontSize: '16px' }}>
          <option value="">Selecciona un técnico…</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {canPlan && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 space-y-2">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" className="mt-1 accent-teal-600" checked={makePlan} onChange={(e) => setMakePlan(e.target.checked)} />
            <span className="text-sm text-teal-900"><b>Hacer recurrente</b> · crear un plan preventivo y avisar cuando toque la siguiente fecha.</span>
          </label>
          {makePlan && (
            <select className="input w-full" value={freq} onChange={(e) => setFreq(e.target.value)} style={{ fontSize: '16px' }}>
              <option value={1}>Cada mes</option><option value={3}>Cada 3 meses</option><option value={6}>Cada 6 meses</option><option value={12}>Cada año</option>
            </select>
          )}
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Notas para el técnico</p>
        <textarea className="input w-full h-20 resize-none" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ fontSize: '16px' }} />
      </div>
    </ModalShell>
  )
}

function RescheduleModal({ ticket, onClose, onSaved }) {
  const [start, setStart] = useState(toPanamaInput(ticket.maint_confirmed_start))
  const [end, setEnd] = useState(toPanamaInput(ticket.maint_confirmed_end))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!start) return toast.error('Indica la nueva fecha y hora de inicio')
    const mins = end ? minutesBetween(start, end) : 60
    if (end && (mins === null || mins < 15)) return toast.error('La fecha de fin debe ser al menos 15 min posterior al inicio')
    setSaving(true)
    try {
      await rescheduleMaintenance(ticket.id, {
        scheduled_at: `${start}:00`,
        confirmed_end: end ? `${end}:00` : null,
        duration_minutes: mins || 60,
        reason: reason.trim() || null,
      })
      toast.success('Mantenimiento actualizado en la Agenda. Se envió el aviso al cliente.')
      onSaved()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error al reprogramar')
    } finally { setSaving(false) }
  }

  return (
    <ModalShell title="Reprogramar / extender" subtitle={`Actual: ${fmtPanama(ticket.maint_confirmed_start)} → ${fmtPanama(ticket.maint_confirmed_end)}`} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancelar</button>
        <button onClick={submit} disabled={saving} className="btn-primary">{saving ? 'Guardando…' : 'Guardar cambio'}</button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">Nuevo inicio (hora Panamá) *</p>
          <input type="datetime-local" className="input w-full" value={start} onChange={(e) => setStart(e.target.value)} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">Nuevo fin / rango</p>
          <input type="datetime-local" className="input w-full" value={end} onChange={(e) => setEnd(e.target.value)} style={{ fontSize: '16px' }} />
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Motivo (opcional)</p>
        <input className="input w-full" placeholder="Ej.: El cliente pidió más tiempo para la flota" value={reason} onChange={(e) => setReason(e.target.value)} style={{ fontSize: '16px' }} />
      </div>
    </ModalShell>
  )
}
