import React, { useEffect, useState } from 'react'
import { getInventory, getPartRequests, createPartRequest, approvePartRequest, rejectPartRequest, cancelPartRequest, returnPartRequest, deletePartRequest, getSuppliers } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { Boxes, Plus, Check, X, Search, Clock, Ban, Undo2, Truck, CalendarClock, Trash2 } from 'lucide-react'
import { fmtD } from '../utils/fmt'
import toast from 'react-hot-toast'

const STATUS = {
  pendiente: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700' },
  aprobado:  { label: 'Aprobado',  cls: 'bg-emerald-100 text-emerald-700' },
  rechazado: { label: 'Rechazado', cls: 'bg-red-100 text-red-700' },
  cancelado: { label: 'Cancelado', cls: 'bg-gray-100 text-gray-500' },
  devuelto:  { label: 'Devuelto',  cls: 'bg-blue-100 text-blue-700' },
}

export default function PartRequestPanel({ ticketId }) {
  const { user } = useAuth()
  const isApprover = ['admin', 'superadmin', 'supervisor', 'supplies'].includes(user?.role)

  const [requests, setRequests] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [parts, setParts] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [qty, setQty] = useState('1')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState(null)
  const [special, setSpecial] = useState(false)
  const [specialDesc, setSpecialDesc] = useState('')
  const [suppliers, setSuppliers] = useState([])
  const [approveReq, setApproveReq] = useState(null)   // solicitud especial en aprobación
  const [apSupplier, setApSupplier] = useState('')
  const [apEta, setApEta] = useState('')

  const load = () => getPartRequests({ ticket_id: ticketId }).then(r => setRequests(r.data)).catch(() => {})
  useEffect(() => { if (ticketId) load() }, [ticketId])
  useEffect(() => { if (isApprover) getSuppliers().then(r => setSuppliers(r.data)).catch(() => {}) }, [isApprover])

  const openApprove = (r) => { setApproveReq(r); setApSupplier(''); setApEta('') }
  const confirmApprove = async () => {
    setActing(approveReq.id)
    try {
      await approvePartRequest(approveReq.id, { supplier_id: apSupplier ? Number(apSupplier) : null, expected_date: apEta || null })
      toast.success('Aprobada · pendiente por recibir')
      setApproveReq(null); load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Error al aprobar') }
    finally { setActing(null) }
  }

  const openModal = () => {
    setShowModal(true); setSel(null); setQ(''); setQty('1'); setNotes(''); setSpecial(false); setSpecialDesc('')
    getInventory({ warehouse: 'partes', active_only: true })
      .then(r => setParts(r.data))
      .catch(() => toast.error('Error cargando la bodega de partes'))
  }

  const submit = async () => {
    setSaving(true)
    try {
      if (special) {
        if (!specialDesc.trim()) { setSaving(false); return toast.error('Describe la parte especial que necesitas') }
        await createPartRequest({ ticket_id: ticketId, is_special: true, item_name: specialDesc.trim(), quantity: String(qty || '1'), notes: notes || null })
        toast.success('Solicitud de parte especial enviada — pendiente de aprobación')
      } else {
        if (!sel) { setSaving(false); return toast.error('Selecciona una parte del inventario') }
        await createPartRequest({ ticket_id: ticketId, item_code: sel.code, quantity: String(qty || '1'), notes: notes || null })
        toast.success('Solicitud enviada — pendiente de aprobación')
      }
      setShowModal(false); load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Error al solicitar la parte') }
    finally { setSaving(false) }
  }

  const decide = async (id, action) => {
    if (action === 'delete' && !window.confirm('¿Eliminar esta solicitud de parte? Si es especial y no se ha recibido, se quitará también de "pendientes por recibir".')) return
    setActing(id)
    try {
      if (action === 'approve') { await approvePartRequest(id); toast.success('Solicitud aprobada') }
      else if (action === 'cancel') { await cancelPartRequest(id); toast.success('Cancelada') }
      else if (action === 'return') { await returnPartRequest(id); toast.success('Parte devuelta · repuesta al inventario') }
      else if (action === 'delete') { await deletePartRequest(id); toast.success('Solicitud eliminada') }
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
                    {r.item_code && <span className="font-mono text-xs font-semibold text-blue-700">{r.item_code}</span>}
                    <span className="text-sm text-gray-800 font-medium">{r.item_name}</span>
                    <span className="text-xs text-gray-500">× {r.quantity}</span>
                    {r.is_special && <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-purple-100 text-purple-700">Especial</span>}
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Solicitó: {r.requested_by_name || '—'}
                    {r.approved_by_name && ` · ${r.status === 'aprobado' ? 'Aprobó' : 'Decidió'}: ${r.approved_by_name}`}
                  </div>
                  {/* Estado de espera de la parte especial aprobada */}
                  {r.is_special && r.status === 'aprobado' && r.special_state === 'en_espera' && (() => {
                    const overdue = r.pending_eta && new Date(r.pending_eta) < new Date(new Date().toDateString())
                    return (
                      <div className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium mt-1 ${overdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        <CalendarClock size={11} />
                        En espera de proveedor
                        {r.pending_eta ? ` · llega ${fmtD(r.pending_eta + 'T12:00:00')}${overdue ? ' (atrasada)' : ''}` : ' · sin fecha'}
                        {r.supplier_name ? ` · ${r.supplier_name}` : ''}
                      </div>
                    )
                  })()}
                  {r.is_special && r.status === 'aprobado' && r.special_state === 'disponible' && (
                    <div className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium mt-1 bg-emerald-100 text-emerald-700">
                      <Check size={11} /> Recibida · disponible en inventario
                    </div>
                  )}
                  {r.notes && <div className="text-xs text-gray-500 mt-0.5 italic">“{r.notes}”</div>}
                </div>
                <div className="flex gap-1.5 flex-shrink-0 items-center">
                  {r.status === 'pendiente' && (
                    <>
                      {isApprover && (
                        <>
                          <button onClick={() => r.is_special ? openApprove(r) : decide(r.id, 'approve')} disabled={acting === r.id}
                            className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50" title={r.is_special ? 'Aprobar y ordenar (fecha estimada)' : 'Aprobar y despachar'}>
                            <Check size={14} />
                          </button>
                          <button onClick={() => decide(r.id, 'reject')} disabled={acting === r.id}
                            className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50" title="Rechazar">
                            <X size={14} />
                          </button>
                        </>
                      )}
                      {(r.requested_by_id === user?.id || isApprover) && (
                        <button onClick={() => decide(r.id, 'cancel')} disabled={acting === r.id}
                          className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-50" title="Cancelar solicitud">
                          <Ban size={14} />
                        </button>
                      )}
                      {!isApprover && r.requested_by_id !== user?.id && (
                        <span className="text-xs text-amber-500 flex items-center gap-1"><Clock size={12} /> En espera</span>
                      )}
                    </>
                  )}
                  {/* Aprobado: partes normales se devuelven; especiales en espera se cancelan (no se devuelven) */}
                  {r.status === 'aprobado' && isApprover && !r.is_special && (
                    <button onClick={() => decide(r.id, 'return')} disabled={acting === r.id}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-600 text-xs hover:bg-blue-50 disabled:opacity-50" title="Devolver la parte al inventario">
                      <Undo2 size={13} /> Devolver
                    </button>
                  )}
                  {r.status === 'aprobado' && isApprover && r.is_special && r.special_state === 'en_espera' && (
                    <button onClick={() => decide(r.id, 'cancel')} disabled={acting === r.id}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-200 text-amber-700 text-xs hover:bg-amber-50 disabled:opacity-50" title="Cancelar el pedido (aún no llega)">
                      <Ban size={13} /> Cancelar pedido
                    </button>
                  )}
                  {/* Eliminar la solicitud (aprobadores) */}
                  {isApprover && r.status !== 'pendiente' && (
                    <button onClick={() => decide(r.id, 'delete')} disabled={acting === r.id}
                      className="p-1.5 rounded-lg border border-red-200 text-red-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50" title="Eliminar solicitud">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
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
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Boxes size={16} className="text-teal-600" /> Solicitar parte</h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              {/* Selector de modo */}
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                <button onClick={() => setSpecial(false)} className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${!special ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Del inventario</button>
                <button onClick={() => setSpecial(true)} className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${special ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Parte especial (no está en stock)</button>
              </div>

              {special ? (
                <>
                  <div className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    Describe la parte que necesitas. Al aprobarla, quedará <b>pendiente por recibir</b> en el inventario y te avisaremos cuando llegue.
                  </div>
                  <div>
                    <label className="label">Descripción de la parte *</label>
                    <input className="input w-full" value={specialDesc} onChange={e => setSpecialDesc(e.target.value)} placeholder="Ej.: Pantalla LCD 15.6'' para Dell Latitude 3500" style={{ fontSize: '16px' }} autoFocus />
                  </div>
                </>
              ) : (
                <>
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
                </>
              )}

              {(special || sel) && (
                <div className="flex items-end gap-3">
                  <div>
                    <label className="label">Cantidad</label>
                    <input type="number" min="1" step="1" className="input w-24 text-right" value={qty} onChange={e => setQty(e.target.value)} style={{ fontSize: '16px' }} />
                  </div>
                  <div className="flex-1">
                    <label className="label">Nota (opcional)</label>
                    <input className="input w-full" value={notes} onChange={e => setNotes(e.target.value)} placeholder={special ? 'Proveedor sugerido, link, urgencia…' : 'Motivo / detalle'} style={{ fontSize: '16px' }} />
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
              <button onClick={submit} disabled={saving || (special ? !specialDesc.trim() : !sel)} className="btn-primary disabled:opacity-60">
                {saving ? 'Enviando...' : 'Solicitar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal aprobar parte especial (proveedor + ETA) */}
      {approveReq && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setApproveReq(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Truck size={16} className="text-teal-600" /> Aprobar y ordenar parte</h3>
              <button onClick={() => setApproveReq(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                <b>{approveReq.item_name}</b> (x{approveReq.quantity}). Quedará <b>pendiente por recibir</b> hasta que llegue del proveedor.
              </p>
              <div>
                <label className="label">Proveedor (opcional)</label>
                <select className="input w-full" value={apSupplier} onChange={e => setApSupplier(e.target.value)} style={{ fontSize: '16px' }}>
                  <option value="">— Sin definir —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Fecha estimada de llegada (opcional)</label>
                <input type="date" className="input w-full" value={apEta} onChange={e => setApEta(e.target.value)} style={{ fontSize: '16px' }} />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
              <button onClick={() => setApproveReq(null)} className="btn-secondary">Cancelar</button>
              <button onClick={confirmApprove} disabled={acting === approveReq.id} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-60 text-sm">
                <Check size={15} /> {acting === approveReq.id ? 'Aprobando…' : 'Aprobar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
