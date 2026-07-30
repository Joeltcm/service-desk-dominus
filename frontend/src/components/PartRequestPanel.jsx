import React, { useEffect, useState } from 'react'
import { getInventory, getPartRequests, createPartRequest, approvePartRequest, rejectPartRequest } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { Boxes, Plus, Check, X, Search, Clock } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS = {
  pendiente: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700' },
  aprobado:  { label: 'Aprobado',  cls: 'bg-emerald-100 text-emerald-700' },
  rechazado: { label: 'Rechazado', cls: 'bg-red-100 text-red-700' },
}

export default function PartRequestPanel({ ticketId }) {
  const { user } = useAuth()
  const isApprover = ['admin', 'superadmin', 'supplies'].includes(user?.role)

  const [requests, setRequests] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [parts, setParts] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [qty, setQty] = useState('1')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState(null)

  const load = () => getPartRequests({ ticket_id: ticketId }).then(r => setRequests(r.data)).catch(() => {})
  useEffect(() => { if (ticketId) load() }, [ticketId])

  const openModal = () => {
    setShowModal(true); setSel(null); setQ(''); setQty('1'); setNotes('')
    getInventory({ warehouse: 'partes', active_only: true })
      .then(r => setParts(r.data))
      .catch(() => toast.error('Error cargando la bodega de partes'))
  }

  const submit = async () => {
    if (!sel) return toast.error('Selecciona una parte del inventario')
    setSaving(true)
    try {
      await createPartRequest({ ticket_id: ticketId, item_code: sel.code, quantity: String(qty || '1'), notes: notes || null })
      toast.success('Solicitud enviada — pendiente de aprobación')
      setShowModal(false); load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Error al solicitar la parte') }
    finally { setSaving(false) }
  }

  const decide = async (id, action) => {
    setActing(id)
    try {
      if (action === 'approve') { await approvePartRequest(id); toast.success('Aprobado · descontado del inventario') }
      else { await rejectPartRequest(id); toast.success('Solicitud rechazada') }
      load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Error') }
    finally { setActing(null) }
  }

  const filteredParts = parts.filter(p => {
    const s = q.toLowerCase()
    return !s || p.code.toLowerCase().includes(s) || (p.name || '').toLowerCase().includes(s)
  })
  const stockOf = (p) => parseFloat(p.quantity || '0') || 0

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <Boxes size={13} className="text-teal-600" /> Partes del inventario
        </h3>
        <button onClick={openModal} className="flex items-center gap-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-teal-700 transition-colors">
          <Plus size={13} /> Solicitar parte
        </button>
      </div>

      {requests.length === 0 ? (
        <p className="text-xs text-gray-400">Sin solicitudes de partes para este ticket.</p>
      ) : (
        <div className="space-y-2">
          {requests.map(r => {
            const st = STATUS[r.status] || { label: r.status, cls: 'bg-gray-100 text-gray-600' }
            return (
              <div key={r.id} className="flex items-start gap-3 p-2.5 rounded-lg border border-gray-100 bg-gray-50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold text-blue-700">{r.item_code}</span>
                    <span className="text-sm text-gray-800 font-medium">{r.item_name}</span>
                    <span className="text-xs text-gray-500">× {r.quantity}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Solicitó: {r.requested_by_name || '—'}
                    {r.approved_by_name && ` · ${r.status === 'aprobado' ? 'Aprobó' : 'Decidió'}: ${r.approved_by_name}`}
                  </div>
                  {r.notes && <div className="text-xs text-gray-500 mt-0.5 italic">“{r.notes}”</div>}
                </div>
                {isApprover && r.status === 'pendiente' && (
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => decide(r.id, 'approve')} disabled={acting === r.id}
                      className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50" title="Aprobar y despachar">
                      <Check size={14} />
                    </button>
                    <button onClick={() => decide(r.id, 'reject')} disabled={acting === r.id}
                      className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50" title="Rechazar">
                      <X size={14} />
                    </button>
                  </div>
                )}
                {!isApprover && r.status === 'pendiente' && (
                  <span className="text-xs text-amber-500 flex items-center gap-1 flex-shrink-0"><Clock size={12} /> En espera</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal solicitar parte */}
      {showModal && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Boxes size={16} className="text-teal-600" /> Solicitar parte (bodega de partes)</h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input w-full pl-9" placeholder="Buscar parte por código o nombre..." value={q} onChange={e => setQ(e.target.value)} style={{ fontSize: '16px' }} autoFocus />
              </div>
              <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-56 overflow-y-auto">
                {filteredParts.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-6">No hay partes que coincidan.</p>
                ) : filteredParts.slice(0, 50).map(p => {
                  const stock = stockOf(p)
                  const active = sel?.code === p.code
                  return (
                    <button key={p.id} onClick={() => setSel(p)}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 ${active ? 'bg-teal-50' : 'hover:bg-gray-50'}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-blue-700">{p.code}</span>
                          <span className="text-sm text-gray-800 truncate">{p.name}</span>
                        </div>
                        {p.location && <div className="text-[11px] text-gray-400">📍 {p.location}</div>}
                      </div>
                      <span className={`text-xs flex-shrink-0 font-semibold ${stock <= 0 ? 'text-red-500' : stock <= 5 ? 'text-amber-600' : 'text-gray-500'}`}>
                        Stock: {stock}{stock <= 0 ? ' ⛔' : stock <= 5 ? ' ⚠️' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
              {sel && (
                <div className="flex items-end gap-3">
                  <div>
                    <label className="label">Cantidad</label>
                    <input type="number" min="1" step="1" className="input w-24 text-right" value={qty} onChange={e => setQty(e.target.value)} style={{ fontSize: '16px' }} />
                  </div>
                  <div className="flex-1">
                    <label className="label">Nota (opcional)</label>
                    <input className="input w-full" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Motivo / detalle" style={{ fontSize: '16px' }} />
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
              <button onClick={submit} disabled={saving || !sel} className="btn-primary disabled:opacity-60">
                {saving ? 'Enviando...' : 'Solicitar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
