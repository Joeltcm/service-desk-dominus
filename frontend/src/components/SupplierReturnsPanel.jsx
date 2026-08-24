import React, { useEffect, useState, useCallback } from 'react'
import { getReturns, getReturn, getReturnPdf, sendReturnEmail } from '../services/api'
import { FileText, Mail, Undo2, Loader2, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { fmtDT } from '../utils/fmt'
import EmailSendDialog from './EmailSendDialog'
import SupplierReturnForm from './SupplierReturnForm'

const money = (v) => {
  const n = parseFloat(v)
  return isNaN(n) ? '0.00' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function SupplierReturnsPanel({ refreshTick = 0 }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detLoading, setDetLoading] = useState(false)
  const [mailFor, setMailFor] = useState(null)   // { id, defaultEmail }
  const [editing, setEditing] = useState(null)   // returnDoc en edición

  const load = useCallback(() => {
    setLoading(true)
    getReturns().then(r => setRows(r.data || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load, refreshTick])

  const openDetail = async (id) => {
    setSelId(id); setDetLoading(true); setDetail(null)
    try { setDetail((await getReturn(id)).data) } catch { toast.error('No se pudo abrir la devolución') } finally { setDetLoading(false) }
  }
  useEffect(() => { if (!selId && !loading && rows.length) openDetail(rows[0].id) }, [loading]) // eslint-disable-line

  const dlPdf = async (id, num) => {
    try {
      const blob = (await getReturnPdf(id)).data
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${num || 'devolucion'}.pdf`
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch { toast.error('No se pudo generar el PDF') }
  }
  const email = (id, supEmail) => setMailFor({ id, defaultEmail: supEmail || '' })

  const total = (detail?.items || []).reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0), 0)

  return (
    <>
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
      {/* ── Registro (lista) ── */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden flex flex-col">
        <div className="px-3 py-2.5 border-b border-gray-100 text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Undo2 size={15} className="text-rose-600" /> Registro de devoluciones
        </div>
        <div className="overflow-y-auto max-h-[62vh]">
          {loading ? (
            <div className="text-center py-10 text-gray-400"><Loader2 className="animate-spin inline" size={20} /></div>
          ) : rows.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">Sin devoluciones registradas</div>
          ) : rows.map(r => (
            <button key={r.id} onClick={() => openDetail(r.id)} className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors ${selId === r.id ? 'bg-rose-50' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-gray-800 text-sm">{r.return_number}</span>
                {r.receipt_number && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">Orden {r.receipt_number}</span>}
              </div>
              <div className="text-xs text-gray-400 mt-0.5 truncate">{r.supplier_name || 'Sin proveedor'} · {r.item_count} equipo(s) · {fmtDT(r.created_at)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Detalle / vista previa ── */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 min-h-[320px]">
        {!selId ? (
          <div className="text-center py-16 text-gray-400"><Undo2 size={30} className="mx-auto mb-2 opacity-40" />Selecciona una devolución</div>
        ) : (detLoading || !detail) ? (
          <div className="text-center py-16 text-gray-400"><Loader2 className="animate-spin inline" size={22} /></div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold text-gray-900">{detail.return_number}</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-rose-100 text-rose-700">Devolución</span>
                {detail.receipt_number && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">Orden {detail.receipt_number}</span>}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditing(detail)} title="Editar devolución" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200"><Pencil size={16} /></button>
                <button onClick={() => dlPdf(detail.id, detail.return_number)} title="Descargar PDF" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200"><FileText size={16} /></button>
                <button onClick={() => email(detail.id, detail.supplier_email)} title="Enviar por correo" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200"><Mail size={16} /></button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[11px] uppercase text-gray-400 font-semibold">Proveedor</div>
                <div className="font-medium text-gray-800">{detail.supplier_name || '—'}</div>
                {detail.supplier_email && <div className="text-xs text-gray-500">{detail.supplier_email}</div>}
              </div>
              <div>
                <div className="text-[11px] uppercase text-gray-400 font-semibold">Revisado por</div>
                <div className="font-medium text-gray-800">{detail.reviewed_by_name || '—'}</div>
                <div className="text-[11px] uppercase text-gray-400 font-semibold mt-2">Fecha / registró</div>
                <div className="text-xs text-gray-600">{fmtDT(detail.created_at)}</div>
                {detail.created_by_name && <div className="text-xs text-gray-600">{detail.created_by_name}</div>}
              </div>
            </div>
            {detail.notes && <div className="text-sm text-gray-600"><b>Notas:</b> {detail.notes}</div>}

            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="bg-gray-50 text-gray-500 text-xs"><tr>
                  <th className="text-left px-3 py-2">Equipo</th>
                  <th className="text-left px-3 py-2">Motivo</th>
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
                      </td>
                      <td className="px-3 py-2 text-gray-700">{it.reason || '—'}</td>
                      <td className="px-2 py-2 text-right text-gray-700">{it.quantity}</td>
                      <td className="px-2 py-2 text-right text-gray-700">${money(it.unit_cost)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">${money((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={4} className="px-3 py-2 text-right font-semibold text-gray-600">Total</td>
                  <td className="px-3 py-2 text-right font-bold text-gray-800">${money(total)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>

    {mailFor && (
      <EmailSendDialog
        title="Enviar devolución por correo"
        subtitle="Se enviará la nota de devolución (PDF) al proveedor."
        defaultEmail={mailFor.defaultEmail}
        onClose={() => setMailFor(null)}
        onSend={(to) => sendReturnEmail(mailFor.id, to)}
      />
    )}

    {editing && (
      <SupplierReturnForm
        returnDoc={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { const id = editing.id; setEditing(null); load(); openDetail(id) }}
      />
    )}
    </>
  )
}
