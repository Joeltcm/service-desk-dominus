import React, { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  getReceipts, getReceipt, createReceipt, updateReceipt, finalizeReceipt,
  deleteReceipt, getReceiptPdf, sendReceiptEmail, getReceiptNextNumber,
  getInventory, reviewReceiptItems,
} from '../services/api'
import { X, Plus, Trash2, Search, FileText, Mail, CheckCircle2, Package, ArrowLeft, Loader2, ClipboardCheck, Pencil } from 'lucide-react'
import EmailSendDialog from './EmailSendDialog'

const REVIEW_OPTIONS = [
  { value: 'pendiente', label: 'Revisión pendiente' },
  { value: 'revisado', label: 'Revisado' },
]
import toast from 'react-hot-toast'
import { fmtD } from '../utils/fmt'
import SignaturePad from './SignaturePad'

const money = (v) => {
  const n = parseFloat(v)
  return isNaN(n) ? '0.00' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUS_STYLE = {
  Borrador: 'bg-slate-100 text-slate-600',
  Recibida: 'bg-green-100 text-green-700',
  Cancelada: 'bg-red-100 text-red-600',
}

export default function ReceiptOrders({ suppliers = [], onClose, onApplied, initial = null }) {
  const [view, setView] = useState('list')   // 'list' | 'editor'
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  const loadOrders = useCallback(() => {
    setLoading(true)
    getReceipts().then(r => setOrders(r.data)).catch(() => toast.error('Error cargando órdenes')).finally(() => setLoading(false))
  }, [])
  useEffect(() => { loadOrders() }, [loadOrders])

  // ── Editor state ──
  const [editing, setEditing] = useState(null)  // { id?, receipt_number, supplier_id, notes, delivered_by, items:[], status }
  const [itemQuery, setItemQuery] = useState('')
  const [itemResults, setItemResults] = useState([])
  const [signature, setSignature] = useState('')
  const [busy, setBusy] = useState(false)
  const [mailFor, setMailFor] = useState(null)   // { id, defaultEmail }
  const [fullEdit, setFullEdit] = useState(false)   // editar una orden ya Recibida (requiere re-firma)

  const openNew = async () => {
    let number = ''
    try { number = (await getReceiptNextNumber()).data.number } catch {}
    setEditing({ receipt_number: number, supplier_id: '', notes: '', delivered_by: '', items: [], status: 'Borrador' })
    setSignature(''); setFullEdit(false)
    setItemQuery(''); setItemResults([])
    setView('editor')
  }

  const openExisting = async (id, openInEdit = false) => {
    try {
      const r = (await getReceipt(id)).data
      setEditing({
        id: r.id, receipt_number: r.receipt_number, supplier_id: r.supplier_id || '',
        notes: r.notes || '', delivered_by: r.delivered_by || '', status: r.status,
        items: (r.items || []).map(it => ({
          id: it.id, item_id: it.item_id, code: it.code, name: it.name,
          quantity: it.quantity || '1', unit_cost: it.unit_cost || '0',
          review_status: it.review_status || 'pendiente',
        })),
      })
      setSignature('')
      setFullEdit(!!openInEdit && r.status === 'Recibida')   // abre directo en edición si se pidió
      setItemQuery(''); setItemResults([])
      setView('editor')
    } catch { toast.error('No se pudo abrir la orden') }
  }

  // Apertura directa (desde el tab / FAB): 'new' abre orden nueva, 'edit' abre una orden.
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current || !initial) return
    didInit.current = true
    if (initial.mode === 'new') openNew()
    else if (initial.mode === 'edit' && initial.id) openExisting(initial.id, initial.edit)
  }, [initial]) // eslint-disable-line

  // Item search (debounced-ish)
  useEffect(() => {
    if (view !== 'editor' || !itemQuery.trim()) { setItemResults([]); return }
    const t = setTimeout(() => {
      getInventory({ q: itemQuery.trim() }).then(r => setItemResults((r.data || []).slice(0, 8))).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [itemQuery, view])

  const addItem = (inv) => {
    setEditing(e => {
      if (e.items.some(x => x.item_id === inv.id)) { toast('Ese artículo ya está en la orden'); return e }
      return { ...e, items: [...e.items, { item_id: inv.id, code: inv.code, name: inv.name, quantity: '1', unit_cost: inv.cost_price || '0', review_status: 'pendiente' }] }
    })
    setItemQuery(''); setItemResults([])
  }
  const addNewItem = () => {
    setEditing(e => ({ ...e, items: [...e.items, { item_id: null, code: null, name: '', quantity: '1', unit_cost: '0', review_status: 'pendiente', is_new: true }] }))
    setItemQuery(''); setItemResults([])
  }
  const setLine = (idx, field, val) => setEditing(e => ({ ...e, items: e.items.map((x, i) => i === idx ? { ...x, [field]: val } : x) }))
  const removeLine = (idx) => setEditing(e => ({ ...e, items: e.items.filter((_, i) => i !== idx) }))
  const setAllStatus = (val) => setEditing(e => ({ ...e, items: e.items.map(x => ({ ...x, review_status: val })) }))

  const total = (editing?.items || []).reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0), 0)
  const supplier = suppliers.find(s => String(s.id) === String(editing?.supplier_id))
  const reviewMode = editing?.status === 'Recibida'   // orden ya recibida
  const locked = reviewMode && !fullEdit              // recibida sin edición activa: solo estado de revisión

  const payload = () => ({
    supplier_id: editing.supplier_id ? parseInt(editing.supplier_id) : null,
    notes: editing.notes || null,
    delivered_by: editing.delivered_by || null,
    items: editing.items.map(it => ({
      item_id: it.item_id, code: it.code, name: it.name,
      quantity: parseFloat(it.quantity) || 0, unit_cost: parseFloat(it.unit_cost) || 0,
      review_status: it.review_status || 'pendiente',
    })),
  })

  const saveReview = async () => {
    setBusy(true)
    try {
      await reviewReceiptItems(editing.id, editing.items.map(it => ({ id: it.id, review_status: it.review_status || 'pendiente' })))
      toast.success('Revisión guardada')
      loadOrders(); setView('list')
    } catch (err) { toast.error(err.response?.data?.detail || 'No se pudo guardar la revisión') }
    finally { setBusy(false) }
  }

  const ensureSaved = async () => {
    if (editing.id) { await updateReceipt(editing.id, payload()); return editing.id }
    const r = (await createReceipt(payload())).data
    setEditing(e => ({ ...e, id: r.id }))
    return r.id
  }

  const missingNewName = () => editing.items.some(it => !it.item_id && !(it.name || '').trim())

  // Guardar edición de una orden ya Recibida: exige re-firma; el backend ajusta el stock por delta.
  const saveEdit = async () => {
    if (!editing.items.length) return toast.error('Agrega al menos un artículo')
    if (missingNewName()) return toast.error('Escribe el nombre de los artículos nuevos')
    if (!signature) return toast.error('Vuelve a capturar la firma para editar una orden ya recibida')
    setBusy(true)
    try {
      await updateReceipt(editing.id, { ...payload(), delivery_signature: signature })
      toast.success('Orden actualizada · stock ajustado')
      onApplied && onApplied()
      loadOrders(); setView('list')
    } catch (err) { toast.error(err.response?.data?.detail || 'No se pudo actualizar la orden') }
    finally { setBusy(false) }
  }

  const saveDraft = async () => {
    if (!editing.items.length) return toast.error('Agrega al menos un artículo')
    if (missingNewName()) return toast.error('Escribe el nombre de los artículos nuevos')
    setBusy(true)
    try {
      await ensureSaved()
      toast.success('Borrador guardado')
      loadOrders(); setView('list')
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al guardar') }
    finally { setBusy(false) }
  }

  const finalize = async () => {
    if (!editing.items.length) return toast.error('Agrega al menos un artículo')
    if (missingNewName()) return toast.error('Escribe el nombre de los artículos nuevos')
    if (!editing.delivered_by.trim()) return toast.error('Ingresa el nombre de quien entrega')
    if (!signature) return toast.error('Falta la firma de quien entrega')
    setBusy(true)
    try {
      const id = await ensureSaved()
      await finalizeReceipt(id, {
        delivered_by: editing.delivered_by.trim(),
        delivery_signature: signature,
        notes: editing.notes || null,
        items: payload().items,
      })
      toast.success('Orden recibida · stock actualizado')
      onApplied && onApplied()
      loadOrders(); setView('list')
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al finalizar') }
    finally { setBusy(false) }
  }

  const downloadPdf = async (o) => {
    try {
      const blob = (await getReceiptPdf(o.id)).data
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${o.receipt_number || 'orden-recibo'}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch { toast.error('No se pudo generar el PDF') }
  }

  const sendEmail = (o) => setMailFor({ id: o.id, defaultEmail: o.supplier_email || '' })

  const removeOrder = async (o) => {
    if (!window.confirm(`¿Eliminar la orden ${o.receipt_number}?`)) return
    try { await deleteReceipt(o.id); toast.success('Orden eliminada'); loadOrders() }
    catch (err) { toast.error(err.response?.data?.detail || 'No se pudo eliminar') }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            {view === 'editor' && (
              <button onClick={() => setView('list')} className="p-1.5 -ml-1 rounded hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></button>
            )}
            <Package size={20} className="text-gray-700" />
            <h2 className="text-lg font-bold text-gray-900">
              {view === 'list' ? 'Órdenes de Recibo'
                : (reviewMode && fullEdit) ? `Editar ${editing.receipt_number}`
                : reviewMode ? `Revisar ${editing.receipt_number}`
                : (editing?.id ? `Orden ${editing.receipt_number}` : `Nueva orden ${editing?.receipt_number || ''}`)}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-gray-400"><X size={20} /></button>
        </div>

        {/* ── LIST ── */}
        {view === 'list' && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="flex justify-end mb-4">
              <button onClick={openNew} className="btn-primary flex items-center gap-2"><Plus size={15} /> Nueva orden</button>
            </div>
            {loading ? (
              <div className="text-center py-12 text-gray-400"><Loader2 className="animate-spin inline" size={22} /></div>
            ) : orders.length === 0 ? (
              <div className="text-center py-12 text-gray-400"><Package size={34} className="mx-auto mb-2 opacity-40" />Sin órdenes de recibo aún</div>
            ) : (
              <div className="space-y-2">
                {orders.map(o => (
                  <div key={o.id} className="border border-gray-200 rounded-xl p-3 flex flex-wrap items-center gap-3 hover:bg-gray-50">
                    <div className="flex-1 min-w-[180px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-800">{o.receipt_number}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[o.status] || 'bg-gray-100 text-gray-600'}`}>{o.status}</span>
                        {o.pending_review > 0 && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">⚠ {o.pending_review} por revisar</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {o.supplier_name || 'Sin proveedor'} · {o.item_count} art. · {fmtD(o.received_at || o.created_at)}
                        {o.delivered_by ? ` · Entrega: ${o.delivered_by}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {o.status === 'Borrador' && (
                        <button onClick={() => openExisting(o.id)} className="text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100">Validar / Recibir</button>
                      )}
                      {o.status === 'Recibida' && (
                        <>
                          <button onClick={() => openExisting(o.id)} title="Revisar artículos" className="text-xs px-2.5 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 flex items-center gap-1"><ClipboardCheck size={14} /> Revisar</button>
                          <button onClick={() => downloadPdf(o)} title="Descargar PDF" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200"><FileText size={16} /></button>
                          <button onClick={() => sendEmail(o)} title="Enviar por correo" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200"><Mail size={16} /></button>
                        </>
                      )}
                      {o.status === 'Borrador' && (
                        <button onClick={() => removeOrder(o)} title="Eliminar" className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={16} /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── EDITOR ── */}
        {view === 'editor' && editing && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Proveedor */}
            {locked && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-xs text-emerald-700">
                Orden ya recibida. Marca el estado de revisión, o pulsa <b>Editar orden</b> para modificar cantidades/artículos (requerirá volver a firmar).
              </div>
            )}
            {reviewMode && fullEdit && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                Editando una orden ya recibida. Al guardar, el stock se <b>ajustará por la diferencia</b> y deberás <b>volver a firmar</b> (queda registrado por seguridad).
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Proveedor</label>
                <select className="input" value={editing.supplier_id} disabled={locked} onChange={e => setEditing({ ...editing, supplier_id: e.target.value })} style={{ fontSize: 16 }}>
                  <option value="">— Selecciona —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {supplier?.email && <p className="text-[11px] text-gray-400 mt-1">Correo: {supplier.email}</p>}
              </div>
              <div>
                <label className="label">Notas</label>
                <input className="input" value={editing.notes} disabled={locked} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Opcional" style={{ fontSize: 16 }} />
              </div>
            </div>

            {/* Buscar/agregar artículo */}
            {!locked && (
            <div>
              <label className="label">Agregar artículo</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input pl-9" value={itemQuery} onChange={e => setItemQuery(e.target.value)} placeholder="Buscar por código o nombre…" style={{ fontSize: 16 }} />
                  {itemResults.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                      {itemResults.map(inv => (
                        <button key={inv.id} type="button" onClick={() => addItem(inv)} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-50 last:border-0">
                          <span className="font-medium text-gray-700">{inv.code}</span> · {inv.name}
                          <span className="text-gray-400"> — stock {inv.quantity}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button type="button" onClick={addNewItem} title="Agregar un artículo que no está en el inventario"
                  className="whitespace-nowrap text-sm px-3 rounded-lg border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                  <Plus size={14} /> Artículo nuevo
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Un "artículo nuevo" se crea en el inventario al recibir, con código temporal (S/C) hasta que le asignes uno.</p>
            </div>
            )}

            {/* Aplicar estado de revisión a todos */}
            {editing.items.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-gray-500">Marcar todos como:</span>
                {REVIEW_OPTIONS.map(o => (
                  <button key={o.value} type="button" onClick={() => setAllStatus(o.value)}
                    className="px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100">
                    {o.label}
                  </button>
                ))}
              </div>
            )}

            {/* Tabla de items */}
            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">Artículo / Estado</th>
                    <th className="text-right px-2 py-2 w-20">Cant.</th>
                    <th className="text-right px-2 py-2 w-28">Costo unit.</th>
                    <th className="text-right px-3 py-2 w-24">Subtotal</th>
                    {!locked && <th className="w-8"></th>}
                  </tr>
                </thead>
                <tbody>
                  {editing.items.length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-gray-400 py-6 text-sm">Sin artículos. Búscalos arriba para agregarlos.</td></tr>
                  ) : editing.items.map((it, idx) => (
                    <tr key={idx} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        {!it.item_id ? (
                          <>
                            <input value={it.name || ''} onChange={e => setLine(idx, 'name', e.target.value)} placeholder="Nombre del artículo nuevo"
                              className="input py-1 text-sm w-full" style={{ fontSize: 16 }} />
                            <span className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 border border-orange-200">Nuevo · sin código</span>
                          </>
                        ) : (
                          <>
                            <div className="font-medium text-gray-700">{it.code}</div>
                            <div className="text-xs text-gray-400">{it.name}</div>
                          </>
                        )}
                        <select value={it.review_status || 'pendiente'} onChange={e => setLine(idx, 'review_status', e.target.value)}
                          className={`mt-1 text-xs rounded border px-1.5 py-0.5 font-medium ${(it.review_status === 'revisado') ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                          style={{ fontSize: 16 }}>
                          {REVIEW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2">{locked ? <span className="block text-right text-gray-700">{it.quantity}</span> : <input type="number" min="0" step="any" value={it.quantity} onChange={e => setLine(idx, 'quantity', e.target.value)} className="input text-right py-1" style={{ fontSize: 16 }} />}</td>
                      <td className="px-2 py-2">{locked ? <span className="block text-right text-gray-700">${money(it.unit_cost)}</span> : <input type="number" min="0" step="any" value={it.unit_cost} onChange={e => setLine(idx, 'unit_cost', e.target.value)} className="input text-right py-1" style={{ fontSize: 16 }} />}</td>
                      <td className="px-3 py-2 text-right text-gray-700">${money((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0))}</td>
                      {!locked && <td className="px-1"><button onClick={() => removeLine(idx)} className="text-gray-300 hover:text-red-500"><Trash2 size={15} /></button></td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={3} className="px-3 py-2 text-right font-semibold text-gray-600">Total</td>
                    <td className="px-3 py-2 text-right font-bold text-gray-800">${money(total)}</td>
                    {!locked && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Recepción / firma */}
            {!locked && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-semibold text-gray-700 mb-2">{fullEdit ? 'Re-firma de la edición' : 'Recepción'}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Responsable de la entrega (proveedor) <span className="text-red-500">*</span></label>
                  <input className="input" value={editing.delivered_by} onChange={e => setEditing({ ...editing, delivered_by: e.target.value })} placeholder="Nombre de quien entrega" style={{ fontSize: 16 }} />
                  <p className="text-[11px] text-gray-400 mt-2">{fullEdit ? 'La edición queda registrada a tu nombre (usuario actual).' : 'La recepción se registra a tu nombre (usuario actual) al finalizar.'}</p>
                </div>
                <SignaturePad key={fullEdit ? 'edit' : 'new'} label={fullEdit ? 'Vuelve a firmar para guardar los cambios *' : 'Firma de quien entrega *'} onChange={setSignature} />
              </div>
            </div>
            )}
          </div>
        )}

        {/* Footer editor */}
        {view === 'editor' && editing && (
          <div className="px-5 py-4 border-t border-gray-100 flex flex-wrap gap-2 justify-end">
            <button onClick={() => setView('list')} className="btn-secondary" disabled={busy}>Cancelar</button>
            {locked ? (
              <>
                <button onClick={() => setFullEdit(true)} className="btn-secondary flex items-center gap-2" disabled={busy}>
                  <Pencil size={16} /> Editar orden
                </button>
                <button onClick={saveReview} className="btn-primary flex items-center gap-2" disabled={busy}>
                  <ClipboardCheck size={16} /> {busy ? 'Guardando…' : 'Guardar revisión'}
                </button>
              </>
            ) : reviewMode && fullEdit ? (
              <>
                <button onClick={() => { setFullEdit(false); openExisting(editing.id) }} className="btn-secondary" disabled={busy}>Descartar edición</button>
                <button onClick={saveEdit} className="btn-primary flex items-center gap-2" disabled={busy}>
                  <CheckCircle2 size={16} /> {busy ? 'Guardando…' : 'Guardar cambios y firmar'}
                </button>
              </>
            ) : (
              <>
                <button onClick={saveDraft} className="btn-secondary" disabled={busy}>{busy ? '…' : 'Guardar borrador'}</button>
                <button onClick={finalize} className="btn-primary flex items-center gap-2" disabled={busy}>
                  <CheckCircle2 size={16} /> {busy ? 'Procesando…' : 'Finalizar y recibir'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {mailFor && (
        <EmailSendDialog
          title="Enviar orden de recibo por correo"
          subtitle="Se enviará la orden de recibo (PDF) al proveedor."
          defaultEmail={mailFor.defaultEmail}
          onClose={() => setMailFor(null)}
          onSend={(to) => sendReceiptEmail(mailFor.id, to)}
        />
      )}
    </div>,
    document.body
  )
}
