import React, { useEffect, useState, useCallback } from 'react'
import {
  getReceipts, getReceipt, deleteReceipt, getReceiptPdf, sendReceiptEmail, reviewReceiptItems,
  getReturns, getReturnPdf, sendReturnEmail,
} from '../services/api'
import { FileText, Mail, Trash2, ClipboardCheck, Package, Plus, Loader2, Undo2, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { fmtDT } from '../utils/fmt'
import SupplierReturnForm from './SupplierReturnForm'
import EmailSendDialog from './EmailSendDialog'

const money = (v) => {
  const n = parseFloat(v)
  return isNaN(n) ? '0.00' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const STATUS_STYLE = {
  Borrador: 'bg-slate-100 text-slate-600',
  Recibida: 'bg-green-100 text-green-700',
  Cancelada: 'bg-red-100 text-red-600',
}
const REVIEW_OPTIONS = [
  { value: 'pendiente', label: 'Revisión pendiente' },
  { value: 'revisado', label: 'Revisado' },
]
const FILTERS = ['Recibida', 'Borrador', 'Cancelada', 'Todas']

export default function ReceiptOrdersPanel({ suppliers = [], onOpenEditor, onChanged, refreshTick = 0 }) {
  const [filter, setFilter] = useState('Recibida')
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detLoading, setDetLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [returns, setReturns] = useState([])
  const [returnFor, setReturnFor] = useState(null)   // orden desde la que se devuelve
  const [mail, setMail] = useState(null)             // { kind:'receipt'|'return', id, defaultEmail }

  const loadReturns = (rid) => getReturns(rid).then(r => setReturns(r.data || [])).catch(() => setReturns([]))

  const load = useCallback(() => {
    setLoading(true)
    getReceipts().then(r => setOrders(r.data || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load, refreshTick])

  const filtered = orders.filter(o => filter === 'Todas' ? true : o.status === filter)

  const openDetail = async (id) => {
    setSelId(id); setDetLoading(true); setDetail(null); setReturns([])
    try { setDetail((await getReceipt(id)).data); loadReturns(id) } catch { toast.error('No se pudo abrir la orden') } finally { setDetLoading(false) }
  }
  // Auto-selecciona la primera de la lista cuando cambia el filtro / termina de cargar.
  useEffect(() => {
    if (!selId && !loading && filtered.length) openDetail(filtered[0].id)
  }, [loading, filter]) // eslint-disable-line

  const setItemStatus = (idx, val) => setDetail(d => ({ ...d, items: d.items.map((x, i) => i === idx ? { ...x, review_status: val } : x) }))
  const setAll = (val) => setDetail(d => ({ ...d, items: d.items.map(x => ({ ...x, review_status: val })) }))

  const saveReview = async () => {
    setBusy(true)
    try {
      await reviewReceiptItems(detail.id, detail.items.map(it => ({ id: it.id, review_status: it.review_status || 'pendiente' })))
      toast.success('Revisión guardada')
      load(); openDetail(detail.id); onChanged && onChanged()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al guardar') }
    finally { setBusy(false) }
  }

  const dlPdf = async () => {
    try {
      const blob = (await getReceiptPdf(detail.id)).data
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${detail.receipt_number || 'orden-recibo'}.pdf`
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch { toast.error('No se pudo generar el PDF') }
  }
  const email = () => setMail({ kind: 'receipt', id: detail.id, defaultEmail: detail.supplier_email || '' })
  const del = async () => {
    if (!window.confirm(`¿Eliminar la orden ${detail.receipt_number}?`)) return
    try { await deleteReceipt(detail.id); toast.success('Orden eliminada'); setSelId(null); setDetail(null); load(); onChanged && onChanged() }
    catch (e) { toast.error(e.response?.data?.detail || 'No se pudo eliminar') }
  }
  const retPdf = async (rid, num) => {
    try {
      const blob = (await getReturnPdf(rid)).data
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${num || 'devolucion'}.pdf`
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch { toast.error('No se pudo generar el PDF') }
  }
  const retEmail = (rid) => setMail({ kind: 'return', id: rid, defaultEmail: detail?.supplier_email || '' })

  const total = (detail?.items || []).reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0), 0)
  const pendingCount = (detail?.items || []).filter(it => (it.review_status || 'pendiente') === 'pendiente').length

  return (
    <>
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      {/* ── Lista ── */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden flex flex-col">
        <div className="p-3 border-b border-gray-100 flex items-center gap-2">
          <select value={filter} onChange={e => { setFilter(e.target.value); setSelId(null); setDetail(null) }} className="input py-1.5 text-sm flex-1" style={{ fontSize: 16 }}>
            {FILTERS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <button onClick={() => onOpenEditor && onOpenEditor(null)} className="btn-primary text-sm flex items-center gap-1 px-3 whitespace-nowrap"><Plus size={14} /> Nueva</button>
        </div>
        <div className="overflow-y-auto max-h-[62vh]">
          {loading ? (
            <div className="text-center py-10 text-gray-400"><Loader2 className="animate-spin inline" size={20} /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">Sin órdenes</div>
          ) : filtered.map(o => (
            <button key={o.id} onClick={() => openDetail(o.id)} className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors ${selId === o.id ? 'bg-emerald-50' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-gray-800 text-sm">{o.receipt_number}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLE[o.status] || 'bg-gray-100 text-gray-600'}`}>{o.status}</span>
                {o.pending_review > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">⚠ {o.pending_review}</span>}
              </div>
              <div className="text-xs text-gray-400 mt-0.5 truncate">{o.supplier_name || 'Sin proveedor'} · {o.item_count} art.</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Detalle ── */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 min-h-[320px]">
        {!selId ? (
          <div className="text-center py-16 text-gray-400"><Package size={30} className="mx-auto mb-2 opacity-40" />Selecciona una orden para ver el detalle</div>
        ) : (detLoading || !detail) ? (
          <div className="text-center py-16 text-gray-400"><Loader2 className="animate-spin inline" size={22} /></div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold text-gray-900">{detail.receipt_number}</h3>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[detail.status] || 'bg-gray-100 text-gray-600'}`}>{detail.status}</span>
                {pendingCount > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">⚠ {pendingCount} por revisar</span>}
              </div>
              <div className="flex items-center gap-1">
                {detail.status === 'Borrador' && (
                  <>
                    <button onClick={() => onOpenEditor && onOpenEditor(detail.id)} className="text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100">Editar / Recibir</button>
                    <button onClick={del} title="Eliminar" className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={16} /></button>
                  </>
                )}
                {detail.status === 'Recibida' && (
                  <>
                    <button onClick={() => onOpenEditor && onOpenEditor(detail.id, true)} title="Editar la orden (requiere volver a firmar)" className="text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 flex items-center gap-1"><Pencil size={14} /> Editar</button>
                    <button onClick={() => setReturnFor(detail)} title="Devolver mercancía al proveedor" className="text-xs px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 flex items-center gap-1"><Undo2 size={14} /> Devolver</button>
                    <button onClick={dlPdf} title="Descargar PDF" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200"><FileText size={16} /></button>
                    <button onClick={email} title="Enviar por correo" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200"><Mail size={16} /></button>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[11px] uppercase text-gray-400 font-semibold">Proveedor</div>
                <div className="font-medium text-gray-800">{detail.supplier_name || '—'}</div>
                {detail.supplier_email && <div className="text-xs text-gray-500">{detail.supplier_email}</div>}
              </div>
              <div>
                <div className="text-[11px] uppercase text-gray-400 font-semibold">Fechas</div>
                <div className="text-xs text-gray-600">Creada: {fmtDT(detail.created_at)}</div>
                {detail.received_at && <div className="text-xs text-gray-600">Recibida: {fmtDT(detail.received_at)}</div>}
              </div>
              <div>
                <div className="text-[11px] uppercase text-gray-400 font-semibold">Entrega</div>
                <div className="text-gray-800">{detail.delivered_by || '—'}</div>
                {detail.delivery_signature && <img src={detail.delivery_signature} alt="firma" className="mt-1 max-h-14 border border-gray-100 rounded bg-white" />}
              </div>
              <div>
                <div className="text-[11px] uppercase text-gray-400 font-semibold">Recepción</div>
                <div className="text-gray-800">{detail.received_by_name || '—'}</div>
              </div>
            </div>
            {detail.notes && <div className="text-sm text-gray-600"><b>Notas:</b> {detail.notes}</div>}

            {detail.status === 'Recibida' && detail.items.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-gray-500">Marcar todos como:</span>
                {REVIEW_OPTIONS.map(o => <button key={o.value} onClick={() => setAll(o.value)} className="px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100">{o.label}</button>)}
              </div>
            )}

            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <table className="w-full text-sm min-w-[460px]">
                <thead className="bg-gray-50 text-gray-500 text-xs"><tr>
                  <th className="text-left px-3 py-2">Artículo / Estado</th>
                  <th className="text-right px-2 py-2 w-16">Cant.</th>
                  <th className="text-right px-2 py-2 w-24">Costo</th>
                  <th className="text-right px-3 py-2 w-24">Subtotal</th>
                </tr></thead>
                <tbody>
                  {detail.items.map((it, idx) => (
                    <tr key={it.id || idx} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-700">{it.code || '—'}</div>
                        <div className="text-xs text-gray-400">{it.name}</div>
                        {detail.status === 'Recibida' ? (
                          <select value={it.review_status || 'pendiente'} onChange={e => setItemStatus(idx, e.target.value)}
                            className={`mt-1 text-xs rounded border px-1.5 py-0.5 font-medium ${it.review_status === 'revisado' ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`} style={{ fontSize: 16 }}>
                            {REVIEW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <span className={`mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold ${it.review_status === 'revisado' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{it.review_status === 'revisado' ? 'Revisado' : 'Revisión pendiente'}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-700">{it.quantity}</td>
                      <td className="px-2 py-2 text-right text-gray-700">${money(it.unit_cost)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">${money((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={3} className="px-3 py-2 text-right font-semibold text-gray-600">Total</td>
                  <td className="px-3 py-2 text-right font-bold text-gray-800">${money(total)}</td>
                </tr></tfoot>
              </table>
            </div>

            {returns.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-1.5">Devoluciones de esta orden</p>
                <div className="space-y-1.5">
                  {returns.map(rt => (
                    <div key={rt.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2 bg-rose-50/30">
                      <Undo2 size={14} className="text-rose-500 shrink-0" />
                      <span className="font-semibold text-gray-700 text-sm">{rt.return_number}</span>
                      <span className="text-xs text-gray-400 truncate">{rt.item_count} equipo(s) · {fmtDT(rt.created_at)}</span>
                      <div className="ml-auto flex items-center gap-1">
                        <button onClick={() => retPdf(rt.id, rt.return_number)} title="Descargar PDF" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200"><FileText size={15} /></button>
                        <button onClick={() => retEmail(rt.id)} title="Enviar por correo" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200"><Mail size={15} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.status === 'Recibida' && (
              <div className="flex justify-end">
                <button onClick={saveReview} disabled={busy} className="btn-primary flex items-center gap-2"><ClipboardCheck size={16} /> {busy ? 'Guardando…' : 'Guardar revisión'}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {returnFor && (
      <SupplierReturnForm
        order={returnFor}
        onClose={() => setReturnFor(null)}
        onCreated={() => { setReturnFor(null); if (detail) openDetail(detail.id); load(); onChanged && onChanged() }}
      />
    )}

    {mail && (
      <EmailSendDialog
        title={mail.kind === 'return' ? 'Enviar devolución por correo' : 'Enviar orden de recibo por correo'}
        subtitle={mail.kind === 'return'
          ? 'Se enviará la nota de devolución (PDF) al proveedor.'
          : 'Se enviará la orden de recibo (PDF) al proveedor.'}
        defaultEmail={mail.defaultEmail}
        onClose={() => setMail(null)}
        onSend={(to) => mail.kind === 'return' ? sendReturnEmail(mail.id, to) : sendReceiptEmail(mail.id, to)}
      />
    )}
    </>
  )
}
