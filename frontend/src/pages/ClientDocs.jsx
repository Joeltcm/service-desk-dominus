import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import { getMyQuotes, getMyInvoices, getMyWarranties, getMyDgiAttachment, getMyInvoiceAttachment } from '../services/api'
import { openPdfWindow } from '../utils/pdfViewer'
import { buildQuoteHTML } from './Quotes'
import { buildInvoiceHTML } from './Facturas'
import { buildWarrantyHTML } from './Warranties'
import { useAuth } from '../context/AuthContext'
import { fmtD } from '../utils/fmt'
import {
  ClipboardList, Receipt, Download, Printer, Search, X,
  ArrowLeft, FileText, User, Hash, MapPin, Mail, Phone, Calendar,
  AlertCircle, ShieldCheck, ArrowRight, Link2, ExternalLink,
} from 'lucide-react'
import toast from 'react-hot-toast'

function fmtMoney(n) { return Number(n || 0).toFixed(2) }

function parseItems(str) {
  if (!str) return []
  try {
    const arr = JSON.parse(str)
    if (Array.isArray(arr)) return arr.filter((it) => it.description?.trim())
  } catch {}
  return []
}

function calcTotals(items, itbms) {
  const subtotal = items.reduce((s, it) => {
    const line = Math.round((parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0) * 100) / 100
    return s + line
  }, 0)
  const itbmsAmt = itbms ? Math.ceil(subtotal * 0.07 * 100) / 100 : 0
  return { subtotal, itbmsAmt, total: subtotal + itbmsAmt }
}

const QUOTE_STYLE = {
  'Borrador':   'bg-gray-100 text-gray-600',
  'Enviada':    'bg-blue-100 text-blue-700',
  'Aprobada':   'bg-green-100 text-green-700',
  'Rechazada':  'bg-red-100 text-red-600',
  'Vencida':    'bg-orange-100 text-orange-700',
  'En Pedido':  'bg-purple-100 text-purple-700',
  'Facturada':  'bg-indigo-100 text-indigo-700',
}
const INVOICE_STYLE = {
  'Borrador': 'bg-gray-100 text-gray-600',
  'Emitida':  'bg-blue-100 text-blue-700',
  'Pagada':   'bg-green-100 text-green-700',
  'Vencida':  'bg-orange-100 text-orange-700',
  'Anulada':  'bg-red-100 text-red-600',
}

function StatusBadge({ status, type }) {
  const style = type === 'quote' ? QUOTE_STYLE : INVOICE_STYLE
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function PaymentBadge({ terms }) {
  if (!terms) return null
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${terms === 'Contado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
      {terms}
    </span>
  )
}

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={12} className="text-gray-500" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-900 break-words">{value}</p>
      </div>
    </div>
  )
}

// ── Linked document pill (clickable) ─────────────────
function LinkedDocPill({ number, status, total, date, type, onClick }) {
  const style = type === 'quote' ? QUOTE_STYLE : INVOICE_STYLE
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between gap-2 p-2.5 rounded-lg border border-gray-100 bg-white hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors text-left group"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-xs text-gray-500 truncate">{number}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${style[status] || 'bg-gray-100 text-gray-600'}`}>{status}</span>
        {total && <span className="text-xs font-semibold text-gray-700">${fmtMoney(total)}</span>}
      </div>
      <ArrowRight size={13} className="text-gray-300 group-hover:text-indigo-400 flex-shrink-0 transition-colors" />
    </button>
  )
}

// ── Quote detail (read-only) ───────────────────────────
function QuoteDetail({ q, onClose, onPrint, onNavToInvoice }) {
  const items = parseItems(q.items)
  const { subtotal, itbmsAmt, total } = calcTotals(items, q.itbms_enabled)
  const linkedInvoices = q.linked_invoices || []

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4 w-full">
      <button onClick={onClose} className="sm:hidden flex items-center gap-2 text-sm text-gray-500 -mb-1">
        <ArrowLeft size={16} /> Volver
      </button>

      {/* Header */}
      <div className="card">
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 font-mono mb-0.5">{q.quote_number || `COT-${q.id}`}</p>
            <h2 className="text-lg font-bold text-gray-900 leading-snug">{q.title}</h2>
            <div className="flex flex-wrap gap-2 mt-2 items-center">
              {q.date && <span className="text-xs text-gray-400 flex items-center gap-1"><Calendar size={11} />{fmtD(q.date)}</span>}
              {q.valid_until && <span className="text-xs text-gray-400 flex items-center gap-1">Válida hasta {fmtD(q.valid_until)}</span>}
              <StatusBadge status={q.status} type="quote" />
              <PaymentBadge terms={q.payment_terms} />
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
            <button onClick={() => onPrint(false)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
              <Download size={13} /> <span className="hidden sm:inline">PDF</span>
            </button>
            <button onClick={() => onPrint(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors">
              <Printer size={13} /> <span className="hidden sm:inline">Imprimir</span>
            </button>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2"><FileText size={14} className="text-gray-400" />Artículos y servicios</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm items-table-mobile">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="pb-2 text-xs font-semibold text-gray-400 text-center w-8">#</th>
                <th className="pb-2 text-xs font-semibold text-gray-400 text-left">Descripción</th>
                <th className="pb-2 text-xs font-semibold text-gray-400 text-center w-16">Cant.</th>
                <th className="pb-2 text-xs font-semibold text-gray-400 text-right w-24">P. Unit.</th>
                <th className="pb-2 text-xs font-semibold text-gray-400 text-right w-24">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const line = (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0)
                return (
                  <tr key={i} className={`border-b border-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                    <td className="py-2 text-center text-xs text-gray-400" data-label="#">{i + 1}</td>
                    <td className="py-2 text-gray-800" data-label="Desc.">{it.description}</td>
                    <td className="py-2 text-center text-gray-700" data-label="Cant.">{it.qty}</td>
                    <td className="py-2 text-right text-gray-700" data-label="P.Unit.">${fmtMoney(it.unit_price)}</td>
                    <td className="py-2 text-right font-semibold text-gray-900" data-label="Total">${fmtMoney(line)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end">
          <div className="min-w-48 space-y-1">
            <div className="flex justify-between text-sm"><span className="text-gray-500">Subtotal</span><span className="font-medium">${fmtMoney(subtotal)}</span></div>
            {q.itbms_enabled && <div className="flex justify-between text-sm"><span className="text-amber-600">ITBMS 7%</span><span className="font-medium text-amber-600">${fmtMoney(itbmsAmt)}</span></div>}
            <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-1 mt-1"><span>TOTAL</span><span>${fmtMoney(total)}</span></div>
          </div>
        </div>
      </div>

      {q.notes && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Notas</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{q.notes}</p>
        </div>
      )}

      {/* Linked invoices */}
      {linkedInvoices.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
            <Link2 size={14} className="text-indigo-400" />
            Facturas vinculadas
          </h3>
          <div className="space-y-2">
            {linkedInvoices.map(inv => (
              <LinkedDocPill
                key={inv.id}
                number={inv.invoice_number || `FAC-${inv.id}`}
                status={inv.status}
                total={inv.total}
                date={inv.date}
                type="invoice"
                onClick={() => onNavToInvoice(inv.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Fila de adjunto individual: descarga via endpoint /my con blob para respetar auth
function InvoiceAttachmentRow({ att, invoiceId }) {
  const [loading, setLoading] = useState(false)

  const handleOpen = async () => {
    setLoading(true)
    try {
      const res = await getMyInvoiceAttachment(invoiceId, att.id)
      const url = URL.createObjectURL(res.data)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      toast.error('No se pudo descargar el archivo')
    } finally {
      setLoading(false)
    }
  }

  const ext = att.original_name.split('.').pop()?.toLowerCase()
  const isPdf = ext === 'pdf'

  return (
    <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-gray-50 border border-gray-100">
      <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
        <FileText size={14} className={isPdf ? 'text-red-500' : 'text-gray-400'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{att.original_name}</p>
        {att.file_size && (
          <p className="text-xs text-gray-400">{(att.file_size / 1024).toFixed(0)} KB</p>
        )}
      </div>
      <button
        onClick={handleOpen}
        disabled={loading}
        className={`flex items-center gap-1.5 px-3 py-2.5 text-sm text-white rounded-lg transition-colors disabled:opacity-60 flex-shrink-0 min-h-[44px] ${isPdf ? 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800' : 'bg-gray-700 hover:bg-gray-800 active:bg-gray-900'}`}
      >
        {loading ? (
          <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
        ) : isPdf ? (
          <ExternalLink size={13} />
        ) : (
          <Download size={14} />
        )}
        <span className="hidden sm:inline">{isPdf ? 'Ver PDF' : 'Descargar'}</span>
      </button>
    </div>
  )
}

// ── Invoice detail (read-only) ─────────────────────────
function InvoiceDetail({ inv, onClose, onPrint, onNavToQuote, warranties = [], onNavToWarranty, quotes = [] }) {
  const items = parseItems(inv.items)
  const { subtotal, itbmsAmt, total } = calcTotals(items, inv.itbms_enabled)
  const linkedWarranties = warranties.filter(w => w.invoice_id === inv.id)

  // Combine direct quote relationship + many-to-many links (deduplicated)
  const allQuotes = (() => {
    const seen = new Set()
    const result = []
    if (inv.quote) { seen.add(inv.quote.id); result.push(inv.quote) }
    for (const q of (inv.linked_quotes || [])) {
      if (!seen.has(q.id)) { seen.add(q.id); result.push(q) }
    }
    return result
  })()
  const [dgiLoading, setDgiLoading] = useState(false)

  const handleDgiOpen = async () => {
    setDgiLoading(true)
    try {
      const res = await getMyDgiAttachment(inv.id)
      const url = URL.createObjectURL(res.data)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) {
      // With responseType:'blob', read status from response or from blob body
      let status = err?.response?.status
      let detail = ''
      try {
        const rawData = err?.response?.data
        if (rawData instanceof Blob) {
          const text = await rawData.text()
          try {
            const json = JSON.parse(text)
            detail = typeof json.detail === 'string' ? json.detail : ''
            if (!status && json.status) status = json.status
          } catch {}
        }
      } catch {}

      if (status === 403) {
        toast.error('No autorizado para ver este documento')
      } else if (status === 404 || detail.toLowerCase().includes('no encontrado') || detail.toLowerCase().includes('no hay')) {
        toast.error('El archivo DGI ya no está disponible en el servidor. Solicita que se suba nuevamente.')
      } else if (!status) {
        toast.error('No se pudo conectar con el servidor. Intenta de nuevo.', { duration: 6000 })
      } else {
        toast.error(`Error ${status} al descargar la factura DGI${detail ? ': ' + detail : ''}`, { duration: 8000 })
      }
    } finally {
      setDgiLoading(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4 w-full">
      <button onClick={onClose} className="sm:hidden flex items-center gap-2 text-sm text-gray-500 -mb-1">
        <ArrowLeft size={16} /> Volver
      </button>

      {/* Header */}
      <div className="card">
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 font-mono mb-0.5">{inv.invoice_number || `FAC-${inv.id}`}</p>
            <h2 className="text-lg font-bold text-gray-900 leading-snug">{inv.client_name || 'Factura'}</h2>
            <div className="flex flex-wrap gap-2 mt-2 items-center">
              {inv.date && <span className="text-xs text-gray-400 flex items-center gap-1"><Calendar size={11} />Emitida: {fmtD(inv.date)}</span>}
              {inv.due_date && <span className="text-xs text-gray-400 flex items-center gap-1"><AlertCircle size={11} />Vence: {fmtD(inv.due_date)}</span>}
              <StatusBadge status={inv.status} type="invoice" />
              <PaymentBadge terms={inv.payment_terms} />
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
            <button onClick={() => onPrint(false)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
              <Download size={13} /> <span className="hidden sm:inline">PDF</span>
            </button>
            <button onClick={() => onPrint(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors">
              <Printer size={13} /> <span className="hidden sm:inline">Imprimir</span>
            </button>
          </div>
        </div>
      </div>

      {/* Client */}
      {(inv.client_name || inv.client_ruc) && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><User size={14} className="text-gray-400" />Facturar a</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InfoRow icon={User} label="Nombre" value={inv.client_name} />
            <InfoRow icon={Hash} label="RUC" value={inv.client_ruc} />
            <InfoRow icon={Mail} label="Email" value={inv.client_email} />
            <InfoRow icon={Phone} label="Teléfono" value={inv.client_phone} />
            <InfoRow icon={MapPin} label="Dirección" value={inv.client_address} />
          </div>
        </div>
      )}

      {/* Items */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2"><FileText size={14} className="text-gray-400" />Detalle</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="pb-2 text-xs font-semibold text-gray-400 text-center w-8">#</th>
                <th className="pb-2 text-xs font-semibold text-gray-400 text-left">Descripción</th>
                <th className="pb-2 text-xs font-semibold text-gray-400 text-center w-16">Cant.</th>
                <th className="pb-2 text-xs font-semibold text-gray-400 text-right w-24">P. Unit.</th>
                <th className="pb-2 text-xs font-semibold text-gray-400 text-right w-24">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const line = (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0)
                return (
                  <tr key={i} className={`border-b border-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                    <td className="py-2 text-center text-xs text-gray-400">{i + 1}</td>
                    <td className="py-2 text-gray-800">{it.description}</td>
                    <td className="py-2 text-center text-gray-700">{it.qty}</td>
                    <td className="py-2 text-right text-gray-700">${fmtMoney(it.unit_price)}</td>
                    <td className="py-2 text-right font-semibold text-gray-900">${fmtMoney(line)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end">
          <div className="min-w-48 space-y-1">
            <div className="flex justify-between text-sm"><span className="text-gray-500">Subtotal</span><span className="font-medium">${fmtMoney(subtotal)}</span></div>
            {inv.itbms_enabled && <div className="flex justify-between text-sm"><span className="text-amber-600">ITBMS 7%</span><span className="font-medium text-amber-600">${fmtMoney(itbmsAmt)}</span></div>}
            <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-1 mt-1"><span>TOTAL A PAGAR</span><span>${fmtMoney(total)}</span></div>
          </div>
        </div>
      </div>

      {inv.notes && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Notas</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{inv.notes}</p>
        </div>
      )}

      {/* DGI attachment */}
      {inv.dgi_filename && (
        <div className="card border-blue-100 bg-blue-50/40">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                <FileText size={15} className="text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-blue-400 font-medium">Factura fiscal DGI</p>
                <p className="text-sm font-semibold text-blue-800 truncate">{inv.dgi_original_name || 'factura_dgi.pdf'}</p>
              </div>
            </div>
            <button
              onClick={handleDgiOpen}
              disabled={dgiLoading}
              className="flex items-center gap-1.5 px-3 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-60 flex-shrink-0 min-h-[44px]"
            >
              {dgiLoading ? (
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <ExternalLink size={13} />
              )}
              <span className="hidden sm:inline">Ver PDF</span>
            </button>
          </div>
        </div>
      )}

      {/* Adjuntos generales de la factura */}
      {inv.attachments?.length > 0 && (
        <div className="card border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
            <FileText size={14} className="text-gray-400" />
            Documentos adjuntos
            <span className="text-xs font-normal text-gray-400">({inv.attachments.length})</span>
          </h3>
          <div className="space-y-2">
            {inv.attachments.map((att) => (
              <InvoiceAttachmentRow key={att.id} att={att} invoiceId={inv.id} />
            ))}
          </div>
        </div>
      )}

      {/* Linked quotes */}
      {allQuotes.length > 0 && (
        <div className="card border-indigo-100 bg-indigo-50/30">
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
            <Link2 size={14} className="text-indigo-400" />
            Cotización{allQuotes.length > 1 ? 'es' : ''} relacionada{allQuotes.length > 1 ? 's' : ''}
          </h3>
          <div className="space-y-2">
            {allQuotes.map(q => (
              <div key={q.id} className="flex items-center gap-2 px-3 py-2.5 bg-white rounded-lg border border-indigo-100">
                <button
                  onClick={() => onNavToQuote(q.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <p className="text-xs font-mono font-semibold text-indigo-600">{q.quote_number || `COT-${q.id}`}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {q.title && <span className="text-sm text-gray-800 truncate">{q.title}</span>}
                    {q.total && <span className="text-sm font-semibold text-gray-900">${parseFloat(q.total || 0).toFixed(2)}</span>}
                    <StatusBadge status={q.status} type="quote" />
                  </div>
                </button>
                <button
                  onClick={() => {
                    const full = quotes.find(qf => qf.id === q.id)
                    if (full) {
                      const items = parseItems(full.items)
                      const html = buildQuoteHTML(full, items, window.location.origin)
                      openPdfWindow(`Cotización ${full.quote_number || full.id}`, html, { autoprint: false })
                    } else {
                      onNavToQuote(q.id)
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors flex-shrink-0 min-h-[44px]"
                >
                  <ExternalLink size={13} />
                  <span className="hidden sm:inline">Ver PDF</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Linked warranties */}
      {linkedWarranties.length > 0 && (
        <div className="card border-emerald-100 bg-emerald-50/30">
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
            <ShieldCheck size={14} className="text-emerald-500" />
            Certificado{linkedWarranties.length > 1 ? 's' : ''} de garantía
          </h3>
          <div className="space-y-2">
            {linkedWarranties.map(w => (
              <div key={w.id} className="flex items-center gap-2 px-3 py-2.5 bg-white rounded-lg border border-emerald-100">
                <button
                  onClick={() => onNavToWarranty(w.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <p className="text-xs font-mono font-semibold text-emerald-600">{w.cert_number}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {w.warranty_period && <span className="text-sm text-gray-800">{w.warranty_period}</span>}
                    {w.warranty_end && <span className="text-xs text-gray-400">· Vence: {fmtD(w.warranty_end)}</span>}
                  </div>
                </button>
                <button
                  onClick={() => {
                    const html = buildWarrantyHTML(w, window.location.origin)
                    openPdfWindow(`Certificado ${w.cert_number}`, html, { autoprint: false, extraCss: 'body{font-family:Arial,sans-serif}' })
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 active:bg-emerald-800 transition-colors flex-shrink-0 min-h-[40px]"
                >
                  <ExternalLink size={13} />
                  <span className="hidden sm:inline">Ver PDF</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Warranty detail (read-only) ────────────────────────
function WarrantyDetail({ w, onClose, onNavToInvoice }) {
  const handlePrint = () => {
    const html = buildWarrantyHTML(w, window.location.origin)
    openPdfWindow(`Certificado ${w.cert_number}`, html, { autoprint: false, extraCss: 'body{font-family:Arial,sans-serif}' })
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4 w-full">
      <button onClick={onClose} className="sm:hidden flex items-center gap-2 text-sm text-gray-500 -mb-1">
        <ArrowLeft size={16} /> Volver
      </button>

      {/* Header card with PDF button */}
      <div className="card border-emerald-100 bg-emerald-50/30">
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck size={18} className="text-emerald-500 flex-shrink-0" />
              <p className="text-xs text-gray-400 font-mono">{w.cert_number}</p>
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-snug">{w.client_name || w.client_company || 'Garantía'}</h2>
            <div className="flex flex-wrap gap-2 mt-2 items-center">
              {w.issue_date && <span className="text-xs text-gray-500 flex items-center gap-1"><Calendar size={10} />Emitida: {fmtD(w.issue_date)}</span>}
              {w.warranty_end && <span className="text-xs text-gray-500 flex items-center gap-1"><AlertCircle size={10} />Vence: {fmtD(w.warranty_end)}</span>}
              {w.warranty_period && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">{w.warranty_period}</span>}
            </div>
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 active:bg-emerald-800 transition-colors flex-shrink-0 min-h-[44px]"
          >
            <ExternalLink size={13} />
            <span className="hidden sm:inline">Ver PDF</span>
          </button>
        </div>
      </div>

      {/* Linked invoice */}
      {w.invoice_id && (
        <button
          onClick={() => onNavToInvoice(w.invoice_id)}
          className="w-full card flex items-center gap-3 bg-blue-50 border-blue-100 hover:bg-blue-100/60 transition-colors text-left"
        >
          <Receipt size={16} className="text-blue-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-blue-400">Factura vinculada</p>
            <p className="text-sm font-semibold text-blue-700">
              {w.invoice?.invoice_number || `FAC-${w.invoice_id}`}
            </p>
          </div>
          <ArrowRight size={14} className="text-blue-300 flex-shrink-0" />
        </button>
      )}

      {w.items?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2"><FileText size={14} className="text-gray-400" />Equipos cubiertos</h3>
          <div className="space-y-3">
            {w.items.map((it, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-3 text-sm space-y-1">
                {it.description && <p className="font-medium text-gray-900">{it.description}</p>}
                <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                  {it.type && <span>Tipo: {it.type}</span>}
                  {it.brand && <span>Marca: {it.brand}</span>}
                  {it.model && <span>Modelo: {it.model}</span>}
                  {it.serial && <span>S/N: {it.serial}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {w.technician && (
        <div className="card">
          <p className="text-xs text-gray-400">Técnico responsable</p>
          <p className="text-sm font-medium text-gray-900 mt-0.5">{w.technician}</p>
        </div>
      )}

      {w.notes && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Notas</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{w.notes}</p>
        </div>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────
export default function ClientDocs() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { ref: urlRef } = useParams()
  const [tab, setTab] = useState('quotes')
  const [quotes, setQuotes] = useState([])
  const [invoices, setInvoices] = useState([])
  const [warranties, setWarranties] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [selectedType, setSelectedType] = useState(null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const detailSwipe = useTouchSwipe({ onSwipeRight: () => {
    setMobileDetailOpen(false)
    navigate(-1)
  }})

  const load = useCallback(() => {
    setLoading(true)
    Promise.allSettled([getMyQuotes(), getMyInvoices(), getMyWarranties()])
      .then(([qr, ir, wr]) => {
        if (qr.status === 'fulfilled') setQuotes(qr.value.data)
        if (ir.status === 'fulfilled') setInvoices(ir.value.data)
        if (wr.status === 'fulfilled') setWarranties(wr.value.data)
      })
      .catch(() => toast.error('Error cargando documentos'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-selecciona el documento indicado en la URL al cargar o cambiar urlRef
  useEffect(() => {
    if (!urlRef || loading) return
    if (urlRef.startsWith('FAC-')) {
      const found = invoices.find((i) => i.invoice_number === urlRef)
      if (found && (selected?.invoice_number !== urlRef || selectedType !== 'invoice')) {
        setSelected(found); setSelectedType('invoice'); setTab('invoices'); setMobileDetailOpen(true)
      }
    } else if (urlRef.startsWith('EST-') || urlRef.startsWith('COT-')) {
      const found = quotes.find((q) => q.quote_number === urlRef)
      if (found && (selected?.quote_number !== urlRef || selectedType !== 'quote')) {
        setSelected(found); setSelectedType('quote'); setTab('quotes'); setMobileDetailOpen(true)
      }
    } else {
      const found = warranties.find((w) => w.cert_number === urlRef)
      if (found && (selected?.cert_number !== urlRef || selectedType !== 'warranty')) {
        setSelected(found); setSelectedType('warranty'); setTab('warranties'); setMobileDetailOpen(true)
      }
    }
  }, [urlRef, invoices, quotes, warranties, loading]) // eslint-disable-line

  // Filters: show all statuses except internal-only drafts
  const HIDDEN_QUOTE_STATUSES = ['Borrador']
  const HIDDEN_INV_STATUSES   = ['Borrador']

  const filteredQuotes = quotes.filter((q) => {
    if (HIDDEN_QUOTE_STATUSES.includes(q.status)) return false
    if (!search) return true
    const s = search.toLowerCase()
    return [q.title, q.quote_number, q.status].some((f) => f?.toLowerCase().includes(s))
  })

  const filteredInvoices = invoices.filter((inv) => {
    if (HIDDEN_INV_STATUSES.includes(inv.status)) return false
    if (!search) return true
    const s = search.toLowerCase()
    return [inv.invoice_number, inv.client_name, inv.status].some((f) => f?.toLowerCase().includes(s))
  })

  const filteredWarranties = warranties.filter((w) => {
    if (!search) return true
    const s = search.toLowerCase()
    return [w.cert_number, w.client_name, w.client_company, w.warranty_period].some((f) => f?.toLowerCase().includes(s))
  })

  // Navigation between linked documents
  const handleNavToInvoice = useCallback((id) => {
    const inv = invoices.find(i => i.id === id)
    if (inv) {
      setSelected(inv); setSelectedType('invoice'); setTab('invoices'); setMobileDetailOpen(true)
      navigate('/mis-documentos/' + (inv.invoice_number || `FAC-${inv.id}`), { replace: true })
    }
  }, [invoices, navigate])

  const handleNavToQuote = useCallback((id) => {
    const q = quotes.find(q => q.id === id)
    if (q) {
      setSelected(q); setSelectedType('quote'); setTab('quotes'); setMobileDetailOpen(true)
      navigate('/mis-documentos/' + (q.quote_number || `COT-${q.id}`), { replace: true })
    }
  }, [quotes, navigate])

  const handleNavToWarranty = useCallback((id) => {
    const w = warranties.find(w => w.id === id)
    if (w) {
      setSelected(w); setSelectedType('warranty'); setTab('warranties'); setMobileDetailOpen(true)
      navigate('/mis-documentos/' + w.cert_number, { replace: true })
    }
  }, [warranties, navigate])

  const handleSelectQuote = (q) => {
    setSelected(q); setSelectedType('quote'); setMobileDetailOpen(true)
    navigate('/mis-documentos/' + (q.quote_number || `COT-${q.id}`))
  }
  const handleSelectInvoice = (inv) => {
    setSelected(inv); setSelectedType('invoice'); setMobileDetailOpen(true)
    navigate('/mis-documentos/' + (inv.invoice_number || `FAC-${inv.id}`))
  }
  const handleSelectWarranty = (w) => {
    setSelected(w); setSelectedType('warranty'); setMobileDetailOpen(true)
    navigate('/mis-documentos/' + w.cert_number)
  }
  const handleClose = () => {
    setMobileDetailOpen(false)
    navigate(-1)
  }

  const handlePrintQuote = (autoprint) => {
    if (!selected) return
    const items = parseItems(selected.items)
    const html = buildQuoteHTML(selected, items, window.location.origin)
    const ok = openPdfWindow(`Cotización ${selected.quote_number || selected.id}`, html, { autoprint })
    if (!ok) toast.error('El navegador bloqueó la ventana emergente')
  }

  const handlePrintInvoice = (autoprint) => {
    if (!selected) return
    const items = parseItems(selected.items)
    const html = buildInvoiceHTML(selected, items, window.location.origin)
    const ok = openPdfWindow(`Factura ${selected.invoice_number || selected.id}`, html, { autoprint })
    if (!ok) toast.error('El navegador bloqueó la ventana emergente')
  }

  const listItems = tab === 'quotes' ? filteredQuotes : tab === 'invoices' ? filteredInvoices : filteredWarranties

  const TAB_CFG = {
    quotes:     { icon: ClipboardList, label: 'Cotizaciones', accent: 'indigo',  count: filteredQuotes.length },
    invoices:   { icon: Receipt,       label: 'Facturas',     accent: 'rose',    count: filteredInvoices.length },
    warranties: { icon: ShieldCheck,   label: 'Garantías',    accent: 'emerald', count: filteredWarranties.length },
  }
  const ACCENT = {
    indigo:  { active: 'bg-indigo-500', text: 'text-indigo-600', light: 'bg-indigo-50', border: 'border-l-indigo-500', badge: 'bg-indigo-100 text-indigo-600' },
    rose:    { active: 'bg-rose-500',   text: 'text-rose-600',   light: 'bg-rose-50',   border: 'border-l-rose-500',   badge: 'bg-rose-100 text-rose-600' },
    emerald: { active: 'bg-emerald-500',text: 'text-emerald-600',light: 'bg-emerald-50',border: 'border-l-emerald-500',badge: 'bg-emerald-100 text-emerald-600' },
  }
  const cur = TAB_CFG[tab]
  const acc = ACCENT[cur.accent]

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── List panel ── */}
      <div className={`${mobileDetailOpen ? 'hidden sm:flex' : 'flex'} w-full sm:w-[320px] flex-shrink-0 border-r border-gray-200 flex-col`}>

        <div className="bg-gradient-to-br from-[#1a3353] to-[#0d1f35] px-4 pt-5 pb-4 space-y-4">
          <div>
            <h1 className="text-base font-bold text-white tracking-tight">Mis Documentos</h1>
            <p className="text-xs text-white/40 mt-0.5">Portal de documentos</p>
          </div>
          <div className="flex gap-1">
            {Object.entries(TAB_CFG).map(([key, cfg]) => {
              const Icon = cfg.icon
              const isActive = tab === key
              return (
                <button
                  key={key}
                  onClick={() => { setTab(key); setSelected(null); setMobileDetailOpen(false); navigate(-1) }}
                  className={`flex-1 flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl text-xs font-medium transition-all ${isActive ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/8'}`}
                >
                  <Icon size={16} className="flex-shrink-0" />
                  <span className="truncate w-full text-center leading-tight">{cfg.label}</span>
                  {cfg.count > 0 && (
                    <span className={`rounded-full px-1.5 py-px text-xs leading-none ${isActive ? 'bg-white/25 text-white' : 'bg-white/10 text-white/50'}`}>
                      {cfg.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-3 bg-white border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-8 pr-8 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a3353]/20 focus:border-[#1a3353]/40 transition"
              style={{ fontSize: '16px' }}
              placeholder={tab === 'quotes' ? 'Buscar cotización...' : tab === 'invoices' ? 'Buscar factura...' : 'Buscar garantía...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={13} />
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2 px-0.5">
            {listItems.length} {tab === 'quotes' ? `cotización${listItems.length !== 1 ? 'es' : ''}` : tab === 'invoices' ? `factura${listItems.length !== 1 ? 's' : ''}` : `garantía${listItems.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 bg-gray-50">
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
          ) : listItems.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm space-y-2">
              <cur.icon size={32} className="mx-auto opacity-20" />
              <p>{search ? 'Sin resultados para tu búsqueda' : tab === 'quotes' ? 'No tienes cotizaciones' : tab === 'invoices' ? 'No tienes facturas' : 'No hay certificados de garantía'}</p>
            </div>
          ) : tab === 'quotes' ? (
            <div className="p-2 space-y-1.5">
              {filteredQuotes.map((q) => {
                const isActive = selected?.id === q.id && selectedType === 'quote'
                const hasLinked = (q.linked_invoices?.length || 0) > 0
                return (
                  <button key={q.id} onClick={() => handleSelectQuote(q)}
                    className={`w-full text-left rounded-xl px-3 py-3 border transition-all ${isActive ? `${acc.light} border-indigo-200 shadow-sm` : 'bg-white border-gray-100 hover:border-indigo-100 hover:shadow-sm'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono text-gray-400">{q.quote_number || `COT-${q.id}`}</span>
                          {hasLinked && <Link2 size={10} className="text-indigo-300 flex-shrink-0" />}
                        </div>
                        <p className={`text-sm font-semibold mt-0.5 truncate ${isActive ? 'text-indigo-900' : 'text-gray-800'}`}>{q.title}</p>
                        {q.total && <p className="text-sm font-bold text-gray-900 mt-1">${fmtMoney(q.total)}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        {q.date && <span className="text-xs text-gray-300">{fmtD(q.date)}</span>}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${QUOTE_STYLE[q.status] || 'bg-gray-100 text-gray-600'}`}>{q.status}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : tab === 'invoices' ? (
            <div className="p-2 space-y-1.5">
              {filteredInvoices.map((inv) => {
                const isActive = selected?.id === inv.id && selectedType === 'invoice'
                const isPaid = inv.status === 'Pagada'
                const hasLinked = (inv.linked_quotes?.length || 0) > 0 || !!inv.quote
                return (
                  <button key={inv.id} onClick={() => handleSelectInvoice(inv)}
                    className={`w-full text-left rounded-xl px-3 py-3 border transition-all ${isActive ? `${acc.light} border-rose-200 shadow-sm` : 'bg-white border-gray-100 hover:border-rose-100 hover:shadow-sm'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono text-gray-400">{inv.invoice_number || `FAC-${inv.id}`}</span>
                          {hasLinked && <Link2 size={10} className="text-indigo-300 flex-shrink-0" />}
                        </div>
                        <p className={`text-sm font-semibold mt-0.5 truncate ${isActive ? 'text-rose-900' : 'text-gray-800'}`}>{inv.client_name || '—'}</p>
                        {inv.total && <p className={`text-sm font-bold mt-1 ${isPaid ? 'text-emerald-600' : 'text-gray-900'}`}>${fmtMoney(inv.total)}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        {inv.date && <span className="text-xs text-gray-300">{fmtD(inv.date)}</span>}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${INVOICE_STYLE[inv.status] || 'bg-gray-100 text-gray-600'}`}>{inv.status}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="p-2 space-y-1.5">
              {filteredWarranties.map((w) => {
                const isActive = selected?.id === w.id && selectedType === 'warranty'
                const hasInvoice = !!w.invoice_id
                return (
                  <button key={w.id} onClick={() => handleSelectWarranty(w)}
                    className={`w-full text-left rounded-xl px-3 py-3 border transition-all ${isActive ? `${acc.light} border-emerald-200 shadow-sm` : 'bg-white border-gray-100 hover:border-emerald-100 hover:shadow-sm'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono text-gray-400">{w.cert_number}</span>
                          {hasInvoice && <Link2 size={10} className="text-indigo-300 flex-shrink-0" />}
                        </div>
                        <p className={`text-sm font-semibold mt-0.5 truncate ${isActive ? 'text-emerald-900' : 'text-gray-800'}`}>{w.client_name || w.client_company || '—'}</p>
                        {w.warranty_period && <span className="inline-block text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full mt-1">{w.warranty_period}</span>}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        {w.issue_date && <span className="text-xs text-gray-300">{fmtD(w.issue_date)}</span>}
                        {w.warranty_end && <span className="text-xs text-orange-500 font-medium">Vence {fmtD(w.warranty_end)}</span>}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail panel ── */}
      <div className={`${mobileDetailOpen ? 'flex' : 'hidden sm:flex'} flex-1 flex-col overflow-y-auto overscroll-contain min-h-0 bg-gray-50`} {...detailSwipe}>
        {selected && selectedType === 'quote' ? (
          <QuoteDetail
            q={selected}
            onClose={handleClose}
            onPrint={handlePrintQuote}
            onNavToInvoice={handleNavToInvoice}
          />
        ) : selected && selectedType === 'invoice' ? (
          <InvoiceDetail
            inv={selected}
            onClose={handleClose}
            onPrint={handlePrintInvoice}
            onNavToQuote={handleNavToQuote}
            warranties={warranties}
            onNavToWarranty={handleNavToWarranty}
            quotes={quotes}
          />
        ) : selected && selectedType === 'warranty' ? (
          <WarrantyDetail
            w={selected}
            onClose={handleClose}
            onNavToInvoice={handleNavToInvoice}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-5 px-8">
            <div className="w-20 h-20 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center">
              <cur.icon size={36} className={`${acc.text} opacity-60`} />
            </div>
            <div className="text-center space-y-1">
              <p className="text-base font-semibold text-gray-700">Selecciona un documento</p>
              <p className="text-sm text-gray-400">Elige una {tab === 'quotes' ? 'cotización' : tab === 'invoices' ? 'factura' : 'garantía'} de la lista para ver todos sus detalles</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
