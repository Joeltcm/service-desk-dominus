import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createReturn, updateReturn, getAgents } from '../services/api'
import { X, Undo2, Save } from 'lucide-react'
import toast from 'react-hot-toast'

// Devolver mercancía al proveedor. Dos modos:
//  - crear: se pasa `order` (detalle de la orden de recibo) → deriva los equipos.
//  - editar: se pasa `returnDoc` (ReturnOut) → precarga equipos, motivos, técnico y notas.
export default function SupplierReturnForm({ order, returnDoc, onClose, onCreated, onSaved }) {
  const isEdit = !!returnDoc
  const [lines, setLines] = useState(() => isEdit
    ? (returnDoc.items || []).map(it => ({
        item_id: it.item_id, code: it.code, name: it.name, unit_cost: it.unit_cost || '0',
        max: undefined, include: true, qty: it.quantity || '1', reason: it.reason || '',
      }))
    : (order.items || []).map(it => ({
        item_id: it.item_id, code: it.code, name: it.name, unit_cost: it.unit_cost || '0',
        max: parseFloat(it.quantity) || 0, include: false, qty: it.quantity || '1', reason: '',
      })))
  const [notes, setNotes] = useState(returnDoc?.notes || '')
  const [techs, setTechs] = useState([])
  const [reviewedById, setReviewedById] = useState(returnDoc?.reviewed_by_id ? String(returnDoc.reviewed_by_id) : '')
  const [busy, setBusy] = useState(false)

  useEffect(() => { getAgents().then(r => setTechs(r.data || [])).catch(() => {}) }, [])

  const setLine = (idx, field, val) => setLines(ls => ls.map((x, i) => i === idx ? { ...x, [field]: val } : x))

  const submit = async () => {
    const sel = lines.filter(l => l.include)
    if (!sel.length) return toast.error('Selecciona al menos un equipo a devolver')
    if (sel.some(l => !(parseFloat(l.qty) > 0))) return toast.error('La cantidad a devolver debe ser mayor a 0')
    if (sel.some(l => !(l.reason || '').trim())) return toast.error('Indica el motivo de cada equipo devuelto')
    if (!reviewedById) return toast.error('Selecciona el técnico que revisó los equipos')
    const tech = techs.find(t => String(t.id) === String(reviewedById))
    const items = sel.map(l => ({
      item_id: l.item_id, code: l.code, name: l.name,
      quantity: parseFloat(l.qty) || 0, unit_cost: parseFloat(l.unit_cost) || 0,
      reason: l.reason.trim(),
    }))
    setBusy(true)
    try {
      if (isEdit) {
        const r = (await updateReturn(returnDoc.id, {
          notes: notes || null,
          reviewed_by_id: parseInt(reviewedById, 10),
          reviewed_by_name: tech ? tech.name : null,
          items,
        })).data
        toast.success('Devolución actualizada · stock ajustado')
        onSaved ? onSaved(r) : (onCreated && onCreated(r))
      } else {
        const r = (await createReturn({
          receipt_id: order.id,
          supplier_id: order.supplier_id || null,
          notes: notes || null,
          reviewed_by_id: parseInt(reviewedById, 10),
          reviewed_by_name: tech ? tech.name : null,
          items,
        })).data
        toast.success('Devolución registrada · stock descontado')
        onCreated && onCreated(r)
      }
    } catch (err) { toast.error(err.response?.data?.detail || 'No se pudo guardar la devolución') }
    finally { setBusy(false) }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Undo2 size={20} className="text-rose-600" />
            <h2 className="text-lg font-bold text-gray-900">{isEdit ? `Editar ${returnDoc.return_number || 'devolución'}` : 'Devolver a proveedor'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-gray-400"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="text-sm text-gray-500">
            {isEdit ? (
              <>Orden <b className="text-gray-700">{returnDoc.receipt_number || '—'}</b>
                {returnDoc.supplier_name ? <> · Proveedor <b className="text-gray-700">{returnDoc.supplier_name}</b></> : null}</>
            ) : (
              <>Orden <b className="text-gray-700">{order.receipt_number}</b>
                {order.supplier_name ? <> · Proveedor <b className="text-gray-700">{order.supplier_name}</b></> : null}</>
            )}
          </div>
          <p className="text-xs text-gray-500">
            {isEdit
              ? <>Ajusta los equipos, cantidades y motivos. Al guardar, el stock se <b>corrige por la diferencia</b> respecto a la devolución anterior.</>
              : <>Marca los equipos defectuosos, la cantidad a devolver y el <b>motivo</b> de cada uno. Al registrar se descuentan del inventario.</>}
          </p>

          <div className="border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="w-8 px-2 py-2"></th>
                  <th className="text-left px-3 py-2">Equipo</th>
                  <th className="text-right px-2 py-2 w-24">Cant.</th>
                  <th className="text-left px-3 py-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} className={`border-t border-gray-100 ${l.include ? 'bg-rose-50/40' : ''}`}>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" checked={l.include} onChange={e => setLine(idx, 'include', e.target.checked)} className="w-4 h-4" />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-700">{l.code || '—'}</div>
                      <div className="text-xs text-gray-400">{l.name}</div>
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" min="0" max={l.max || undefined} step="any" value={l.qty} disabled={!l.include}
                        onChange={e => setLine(idx, 'qty', e.target.value)}
                        className="input text-right py-1 disabled:bg-gray-50 disabled:text-gray-400" style={{ fontSize: 16 }} />
                      {l.max ? <div className="text-[10px] text-gray-400 text-right mt-0.5">de {l.max}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <input value={l.reason} disabled={!l.include} onChange={e => setLine(idx, 'reason', e.target.value)}
                        placeholder="Ej. pantalla rota / no enciende"
                        className="input py-1 disabled:bg-gray-50" style={{ fontSize: 16 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <label className="label">Técnico que revisó los equipos <span className="text-rose-500">*</span></label>
            <select className="input" value={reviewedById} onChange={e => setReviewedById(e.target.value)} style={{ fontSize: 16 }}>
              <option value="">Selecciona un técnico…</option>
              {techs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Aparecerá en la nota de devolución enviada al proveedor.</p>
          </div>

          <div>
            <label className="label">Notas (opcional)</label>
            <input className="input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Nota general de la devolución" style={{ fontSize: 16 }} />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary" disabled={busy}>Cancelar</button>
          <button onClick={submit} disabled={busy} className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60">
            {isEdit ? <Save size={16} /> : <Undo2 size={16} />} {busy ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Registrar devolución')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
