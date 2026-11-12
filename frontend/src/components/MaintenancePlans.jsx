import React, { useEffect, useState } from 'react'
import { CalendarClock, Plus, X, Play, Pause, Ban, FilePlus2, Repeat } from 'lucide-react'
import toast from 'react-hot-toast'
import { getMaintPlans, createMaintPlan, updateMaintPlan, createPlanService, getUsers } from '../services/api'
import { showConfirm } from '../utils/confirm'
import { fmtPanama, parseEquipment } from '../utils/maintenance'

const FREQ = [
  { v: 1, l: 'Cada mes' }, { v: 2, l: 'Cada 2 meses' }, { v: 3, l: 'Cada 3 meses' },
  { v: 4, l: 'Cada 4 meses' }, { v: 6, l: 'Cada 6 meses' }, { v: 12, l: 'Cada año' },
]

const freqLabel = (n) => FREQ.find((f) => f.v === n)?.l || `Cada ${n} meses`

// Fecha dd-mm-aaaa desde aaaa-mm-dd.
const dmy = (iso) => (iso ? iso.split('-').reverse().join('-') : '—')

function StateChip({ plan }) {
  const s = plan.state
  if (s === 'overdue') return <span className="text-xs px-2.5 py-1 rounded-full border bg-red-50 text-red-700 border-red-200 font-semibold">Vencido hace {Math.abs(plan.days_to_next)} día(s)</span>
  if (s === 'upcoming') return <span className="text-xs px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200 font-semibold">Próximo en {plan.days_to_next} día(s)</span>
  if (s === 'paused') return <span className="text-xs px-2.5 py-1 rounded-full border bg-gray-100 text-gray-600 border-gray-200 font-semibold">Pausado</span>
  if (s === 'cancelled') return <span className="text-xs px-2.5 py-1 rounded-full border bg-gray-100 text-gray-500 border-gray-200 font-semibold">Cancelado</span>
  return <span className="text-xs px-2.5 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold">Al día</span>
}

export default function MaintenancePlans({ onGoTicket }) {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  const load = () => {
    setLoading(true)
    getMaintPlans().then((r) => setPlans(r.data || [])).catch(() => toast.error('Error cargando planes')).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const setStatus = async (p, status) => {
    try {
      await updateMaintPlan(p.id, { status })
      toast.success(status === 'paused' ? 'Plan pausado' : status === 'active' ? 'Plan reanudado' : 'Plan cancelado')
      load()
    } catch (e) { toast.error(e?.response?.data?.detail || 'No se pudo actualizar el plan') }
  }

  const cancel = async (p) => {
    if (!await showConfirm(`¿Cancelar el plan "${p.title}"? No se generarán más avisos.`)) return
    setStatus(p, 'cancelled')
  }

  const makeService = async (p) => {
    try {
      const r = await createPlanService(p.id)
      toast.success('Atención creada. Confírmala desde la pestaña Servicios.')
      load()
      onGoTicket?.(r.data.ticket_id)
    } catch (e) { toast.error(e?.response?.data?.detail || 'No se pudo crear la atención') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500">Planes recurrentes por flota. El sistema avisa cuando se acerca o vence la fecha; tú decides cuándo agendar.</p>
        <button onClick={() => setShowNew(true)} className="btn-primary text-sm flex items-center gap-1.5"><Plus size={14} /> Nuevo plan</button>
      </div>

      {loading && <div className="card text-center text-gray-400 text-sm py-8">Cargando…</div>}
      {!loading && plans.length === 0 && <div className="card text-center text-gray-400 text-sm py-8">Aún no hay planes. Crea uno o conviértelo desde una atención preventiva confirmada.</div>}

      {!loading && plans.map((p) => {
        const eq = parseEquipment(p.equipment)
        const cancelled = p.status === 'cancelled'
        return (
          <article key={p.id} className={`card space-y-3 ${cancelled ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-xs text-gray-400 flex items-center gap-1"><Repeat size={11} /> {freqLabel(p.frequency_months)}</p>
                <h3 className="font-semibold text-gray-900">{p.title}</h3>
                <p className="text-xs text-gray-500">{p.client?.name}{p.client?.company ? ` · ${p.client.company}` : ''}</p>
              </div>
              <StateChip plan={p} />
            </div>

            {eq.length > 0 && (
              <p className="text-sm text-gray-700">{eq.map((e) => `${e.type} × ${e.qty}`).join(' · ')}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div><p className="text-xs text-gray-400">Próxima fecha sugerida</p><p className="text-gray-700 font-medium">{dmy(p.next_suggested_date)}</p></div>
              <div><p className="text-xs text-gray-400">Última atención</p><p className="text-gray-700">{p.last_service_date ? dmy(p.last_service_date) : 'Ninguna aún'}</p></div>
              <div><p className="text-xs text-gray-400">Atenciones abiertas</p><p className="text-gray-700">{p.open_services}</p></div>
            </div>

            {!cancelled && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                <button onClick={() => makeService(p)} className="btn-primary text-sm flex items-center gap-1.5"><FilePlus2 size={14} /> Crear atención</button>
                {p.status === 'active'
                  ? <button onClick={() => setStatus(p, 'paused')} className="btn-secondary text-sm flex items-center gap-1.5"><Pause size={14} /> Pausar</button>
                  : <button onClick={() => setStatus(p, 'active')} className="btn-secondary text-sm flex items-center gap-1.5"><Play size={14} /> Reanudar</button>}
                <button onClick={() => cancel(p)} className="btn-secondary text-sm flex items-center gap-1.5 text-red-600"><Ban size={14} /> Cancelar plan</button>
              </div>
            )}
          </article>
        )
      })}

      {showNew && <NewPlanModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load() }} />}
    </div>
  )
}

function NewPlanModal({ onClose, onSaved }) {
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [title, setTitle] = useState('')
  const [freq, setFreq] = useState(6)
  const [first, setFirst] = useState('')
  const [equipment, setEquipment] = useState([{ type: '', qty: 1 }])
  const [location, setLocation] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getUsers().then((r) => setClients((r.data || []).filter((u) => u.role === 'client' && u.is_active !== false))).catch(() => {})
  }, [])

  const setLine = (i, f, v) => setEquipment((ls) => ls.map((l, idx) => (idx === i ? { ...l, [f]: v } : l)))

  const submit = async () => {
    if (!clientId) return toast.error('Elige el cliente')
    if (!title.trim()) return toast.error('Escribe un nombre para el plan')
    const eq = equipment.filter((e) => e.type.trim()).map((e) => ({ type: e.type.trim(), qty: Number(e.qty) || 1 }))
    setSaving(true)
    try {
      await createMaintPlan({
        client_id: Number(clientId),
        title: title.trim(),
        frequency_months: Number(freq),
        first_service_date: first || null,
        equipment: JSON.stringify(eq),
        location: location.trim() || null,
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
      })
      toast.success('Plan creado')
      onSaved()
    } catch (e) { toast.error(e?.response?.data?.detail || 'Error al crear el plan') }
    finally { setSaving(false) }
  }

  const lbl = 'block text-xs font-medium text-gray-600 mb-1'
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div><h2 className="font-bold text-gray-900 flex items-center gap-2"><CalendarClock size={16} className="text-teal-600" /> Nuevo plan de mantenimiento</h2></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className={lbl}>Cliente *</label>
            <select className="input w-full" value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ fontSize: '16px' }}>
              <option value="">Selecciona…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Nombre del plan *</label>
            <input className="input w-full" placeholder="Ej.: Preventivo impresoras sucursal norte" value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontSize: '16px' }} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Frecuencia</label>
              <select className="input w-full" value={freq} onChange={(e) => setFreq(e.target.value)} style={{ fontSize: '16px' }}>
                {FREQ.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Primera fecha sugerida</label>
              <input type="date" className="input w-full" value={first} onChange={(e) => setFirst(e.target.value)} style={{ fontSize: '16px' }} />
            </div>
          </div>
          <div>
            <label className={lbl}>Equipos de la flota</label>
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
            <label className={lbl}>Ubicación</label>
            <input className="input w-full" value={location} onChange={(e) => setLocation(e.target.value)} style={{ fontSize: '16px' }} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className={lbl}>Contacto</label><input className="input w-full" value={contactName} onChange={(e) => setContactName(e.target.value)} style={{ fontSize: '16px' }} /></div>
            <div><label className={lbl}>Correo</label><input type="email" className="input w-full" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} style={{ fontSize: '16px' }} /></div>
            <div><label className={lbl}>Teléfono</label><input className="input w-full" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} style={{ fontSize: '16px' }} /></div>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={submit} disabled={saving} className="btn-primary">{saving ? 'Guardando…' : 'Crear plan'}</button>
        </div>
      </div>
    </div>
  )
}
