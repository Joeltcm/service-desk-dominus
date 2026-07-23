import { showConfirm } from '../utils/confirm'
import { companyLogoSrc } from '../utils/branding'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { buildQuoteHTML } from './Quotes'
import { buildWarrantyHTML } from './Warranties'
import { openPdfWindow, sharePdfFromHtml, generatePdfBase64 } from '../utils/pdfViewer'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import ClientAutocomplete from '../components/ClientAutocomplete'
import { useNavigate, useLocation, useSearchParams, useParams } from 'react-router-dom'
import { useFormGuard } from '../context/UnsavedChangesContext'
import {
  getInvoices, getInvoice, createInvoice, updateInvoice, deleteInvoice,
  cloneInvoice, getNextInvoiceNumber, sendInvoiceEmail, getContacts, getCompanies, getSuppliers, createContact, getQuotes, getQuote, getTickets, getClients,
  createInvoicePayment, deleteInvoicePayment, applyInvoiceInventory, checkInvoiceInventory, validateInvoiceItems,
  getInvoiceExpenses, syncInvoiceExpenses, getInvoiceCogs,
  uploadDgiAttachment, deleteDgiAttachment, getDgiAttachment,
  uploadInvoiceAttachment, deleteInvoiceAttachment, getInvoiceAttachment,
  addInvoiceQuoteLink, removeInvoiceQuoteLink, getWarranties, getWarranty,
} from '../services/api'
import {
  Search, Plus, Pencil, Trash2, ArrowLeft, X, Save,
  FileText, User, Hash, MapPin, Mail, Phone, Calendar,
  CheckCircle2, Clock, XCircle, AlertCircle, ChevronDown,
  Printer, Download, PackageCheck, Receipt, Send, UserPlus,
  CreditCard, Banknote, Building2, DollarSign, TrendingUp, Briefcase, Copy, Smartphone, Paperclip, ClipboardList, Share2, AlertTriangle,
  ShieldCheck, ExternalLink as ExtLink, Tag,
} from 'lucide-react'
import { fmtD } from '../utils/fmt'
import toast from 'react-hot-toast'
import ItemEditor from '../components/ItemEditor'
import { getCompanyCache } from '../context/CompanyContext'

// ── Constants ──────────────────────────────────────────
const STATUSES = ['Borrador', 'Emitida', 'Pagada', 'Vencida', 'Anulada']

const STATUS_STYLE = {
  'Borrador': 'bg-gray-100 text-gray-600',
  'Emitida':  'bg-blue-100 text-blue-700',
  'Pagada':   'bg-green-100 text-green-700',
  'Vencida':  'bg-orange-100 text-orange-700',
  'Anulada':  'bg-red-100 text-red-600',
}

const STATUS_ICON = {
  'Borrador': <Clock size={11} />,
  'Emitida':  <Receipt size={11} />,
  'Pagada':   <CheckCircle2 size={11} />,
  'Vencida':  <AlertCircle size={11} />,
  'Anulada':  <XCircle size={11} />,
}

const PAYMENT_TERMS = ['Contado', 'Crédito 15 días', 'Crédito 30 días', 'Crédito 45 días', 'Crédito 60 días', 'Crédito 90 días']

const EMPTY_FORM = {
  invoice_number: '',
  status: 'Borrador',
  quote_id: null,
  ticket_id: null,
  client_name: '',
  client_ruc: '',
  client_address: '',
  client_email: '',
  client_phone: '',
  client_id: null,
  date: '',
  due_date: '',
  itbms_enabled: false,
  shipping_cost: '',
  payment_terms: '',
  notes: '',
}

const EMPTY_ITEM = { code: '', description: '', qty: 1, unit_price: '', itbms: true }

// ── Helpers ────────────────────────────────────────────
function fmtMoney(n) { return Number(n || 0).toFixed(2) }

function parseItems(str) {
  if (!str) return [{ ...EMPTY_ITEM }]
  try {
    const arr = JSON.parse(str)
    if (Array.isArray(arr) && arr.length) return arr.map((it) => ({ code: it.code || '', description: it.description || '', qty: it.qty ?? 1, unit_price: it.unit_price ?? '', itbms: it.itbms !== false }))
  } catch {}
  return [{ ...EMPTY_ITEM }]
}

function calcTotals(items, itbms, shippingCost = 0) {
  const subtotal = items.reduce((s, it) => {
    const line = Math.round((parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0) * 100) / 100
    return s + line
  }, 0)
  if (!itbms) return { subtotal, itbmsAmt: 0, total: subtotal + shippingCost }
  const taxable = items.reduce((s, it) => {
    if (it.itbms === false) return s
    return s + Math.round((parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0) * 100) / 100
  }, 0)
  const itbmsAmt = Math.ceil(taxable * 0.07 * 100) / 100
  return { subtotal, itbmsAmt, total: subtotal + itbmsAmt + shippingCost }
}


export function buildInvoiceHTML(inv, items, origin) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const invShippingCost = parseFloat(String(inv.shipping_cost || '0').replace(/[^\d.]/g, '') || '0') || 0
  const { subtotal, itbmsAmt, total } = calcTotals(items, inv.itbms_enabled, invShippingCost)
  const payments = inv.payments || []
  const totalPaid = payments.reduce((s, p) => s + parseFloat(String(p.amount || '0').replace(/[^\d.]/g, '') || '0'), 0)
  const remaining = Math.max(0, total - totalPaid)
  const fmtDate = (iso) => fmtD(iso)
  const co = getCompanyCache()
  const coName    = esc(co.company_name    || 'Service Desk')
  const coAddress = esc(co.company_address || 'Panamá, Punta Pacífica, PH Pacific Wind')
  const coRuc     = esc(co.company_ruc     || '4-754-575 DV 85')

  const visibleItems = items.filter((it) => it.description?.trim())
  const hasMixed = inv.itbms_enabled && visibleItems.some((it) => it.itbms === false)
  const rows = visibleItems.map((it, i) => {
    const line = Math.round((parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0) * 100) / 100
    const taxTag = hasMixed
      ? (it.itbms !== false
          ? '<span style="font-size:7pt;color:#b45309;background:#fef9c3;border-radius:3px;padding:1px 4px;margin-left:4px">ITBMS</span>'
          : '<span style="font-size:7pt;color:#6b7280;background:#f3f4f6;border-radius:3px;padding:1px 4px;margin-left:4px">Exento</span>')
      : ''
    return `<tr style="background:${i % 2 === 0 ? '#f8f9fb' : '#fff'}">
      <td style="padding:6px 10px;border:1px solid #d1d5db">${i + 1}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db">${esc(it.description)}${taxTag}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db;text-align:center">${esc(String(it.qty))}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db;text-align:right">$${fmtMoney(it.unit_price)}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db;text-align:right;font-weight:600">$${fmtMoney(line)}</td>
    </tr>`
  }).join('')

  return `<div style="font-family:Arial,sans-serif;font-size:11pt;color:#111;max-width:780px;margin:0 auto;padding:24px">
    <div style="display:flex;align-items:center;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:16px;gap:14px">
      <img src="${companyLogoSrc(origin)}" alt="Logo" style="width:52px;height:52px;object-fit:contain;border-radius:6px">
      <div style="flex:1">
        <div style="font-size:18pt;font-weight:bold;color:#1e3a5f">${coName}</div>
        <div style="font-size:9pt;color:#555;margin-top:2px">${coAddress}</div>
        <div style="font-size:9pt;color:#555">RUC: ${coRuc}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:16pt;font-weight:bold;color:#1e3a5f">FACTURA</div>
        <div style="font-size:10pt;color:#444;margin-top:4px;font-family:monospace">N° ${esc(inv.invoice_number || String(inv.id))}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      <div style="padding:8px 12px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px">
        <div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:3px">Facturar a</div>
        <div style="font-size:10.5pt;font-weight:700;color:#111">${esc(inv.client_name)}</div>
        ${inv.client_ruc ? `<div style="font-size:8.5pt;color:#555;margin-top:2px">RUC: ${esc(inv.client_ruc)}</div>` : ''}
        ${inv.client_address ? `<div style="font-size:8.5pt;color:#555">${esc(inv.client_address)}</div>` : ''}
        ${inv.client_email ? `<div style="font-size:8.5pt;color:#555">${esc(inv.client_email)}</div>` : ''}
        ${inv.client_phone ? `<div style="font-size:8.5pt;color:#555">${esc(inv.client_phone)}</div>` : ''}
      </div>
      <div style="padding:8px 12px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px;display:flex;flex-direction:column;gap:6px">
        <div><div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase">Fecha de emisión</div><div style="font-size:9pt;font-weight:600">${fmtDate(inv.date) || '—'}</div></div>
        ${inv.due_date ? `<div><div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase">Fecha de vencimiento</div><div style="font-size:9pt;font-weight:600">${fmtDate(inv.due_date)}</div></div>` : ''}
        ${inv.payment_terms ? `<div><div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase">Términos de pago</div><div style="font-size:9pt;font-weight:600">${esc(inv.payment_terms)}</div></div>` : ''}
        ${inv.dispatch_id ? `<div><div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase">Despacho</div><div style="font-size:9pt;font-weight:600">#${esc(String(inv.dispatch_id))} ${esc(inv.dispatch?.dispatch_number || '')}</div></div>` : ''}
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:16px">
      <thead>
        <tr style="background:#1e3a5f;color:#fff">
          <th style="padding:7px 10px;text-align:left;font-size:8.5pt;border:1px solid #2d4d7a">#</th>
          <th style="padding:7px 10px;text-align:left;font-size:8.5pt;border:1px solid #2d4d7a">Descripción</th>
          <th style="padding:7px 10px;text-align:center;font-size:8.5pt;border:1px solid #2d4d7a">Cant.</th>
          <th style="padding:7px 10px;text-align:right;font-size:8.5pt;border:1px solid #2d4d7a;white-space:nowrap">Precio unit.</th>
          <th style="padding:7px 10px;text-align:right;font-size:8.5pt;border:1px solid #2d4d7a">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div style="display:flex;justify-content:flex-end">
      <div style="min-width:240px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
        <div style="display:flex;justify-content:space-between;padding:6px 14px;background:#f8f9fb;font-size:9.5pt">
          <span style="color:#555">Subtotal</span><span style="font-weight:600">$${fmtMoney(subtotal)}</span>
        </div>
        ${inv.itbms_enabled ? `<div style="display:flex;justify-content:space-between;padding:6px 14px;background:#fffbeb;font-size:9.5pt">
          <span style="color:#b45309">ITBMS 7%</span><span style="font-weight:600;color:#b45309">$${fmtMoney(itbmsAmt)}</span>
        </div>` : ''}
        ${invShippingCost > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 14px;font-size:9.5pt">
          <span style="color:#555">Costo de entrega</span><span style="font-weight:600">$${fmtMoney(invShippingCost)}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:9px 14px;background:#1e3a5f;font-size:11pt">
          <span style="color:#fff;font-weight:bold">TOTAL A PAGAR</span><span style="color:#fff;font-weight:bold">$${fmtMoney(total)}</span>
        </div>
        ${payments.length > 0 ? `
        <div style="border-top:2px solid #e5e7eb;margin-top:0">
          ${payments.map(p => `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 14px;background:#f0fdf4;font-size:9pt;border-bottom:1px solid #dcfce7">
            <span style="color:#166534">Abono · ${esc(p.method)} · ${fmtDate(p.date)}</span>
            <span style="color:#166534;font-weight:600">-$${fmtMoney(parseFloat(String(p.amount || '0').replace(/[^\d.]/g, '') || '0'))}</span>
          </div>`).join('')}
          <div style="display:flex;justify-content:space-between;padding:8px 14px;background:${remaining <= 0 ? '#dcfce7' : '#fef9c3'};font-size:10.5pt;border-top:1px solid ${remaining <= 0 ? '#86efac' : '#fde047'}">
            <span style="font-weight:bold;color:${remaining <= 0 ? '#15803d' : '#854d0e'}">${remaining <= 0 ? '✓ PAGADA COMPLETAMENTE' : 'SALDO PENDIENTE'}</span>
            <span style="font-weight:bold;color:${remaining <= 0 ? '#15803d' : '#854d0e'}">$${fmtMoney(remaining)}</span>
          </div>
        </div>` : ''}
      </div>
    </div>

    ${inv.notes ? `<div style="margin-top:16px;padding:10px 14px;background:#f8f9fb;border:1px solid #ddd;border-radius:6px">
      <div style="font-size:9.5pt;font-weight:bold;color:#444;margin-bottom:4px">NOTAS:</div>
      <div style="font-size:9pt;white-space:pre-wrap">${esc(inv.notes)}</div>
    </div>` : ''}

    <div style="margin-top:12px;padding:7px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:5px;display:flex;gap:20px;flex-wrap:wrap;align-items:center">
      <div style="font-size:6.5pt;color:#15803d;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;flex-basis:100%;margin-bottom:2px">Información para pago · Diógenes González</div>
      <div>
        <div style="font-size:6.5pt;color:#6b7280;text-transform:uppercase;font-weight:600">Transferencia bancaria</div>
        <div style="font-size:8.5pt;color:#374151;margin-top:1px">Banco General · Cta. de ahorros</div>
        <div style="font-family:monospace;font-size:9.5pt;color:#15803d;font-weight:700;margin-top:1px">04-72-98-543918-2</div>
      </div>
      <div style="border-left:1px solid #bbf7d0;padding-left:20px">
        <div style="font-size:6.5pt;color:#6b7280;text-transform:uppercase;font-weight:600">Yappy</div>
        <div style="font-family:monospace;font-size:11pt;color:#15803d;font-weight:800;margin-top:1px">6262-4077</div>
      </div>
    </div>

    <div style="margin-top:24px;padding-top:10px;border-top:1px solid #ddd;font-size:7.5pt;color:#888;text-align:center">
      ${coName} · ${coAddress} · RUC: ${coRuc} · Factura N° ${esc(inv.invoice_number || String(inv.id))}
    </div>
  </div>`
}

// ── StatusBadge ────────────────────────────────────────
function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'}`}>
      {STATUS_ICON[status]} {status}
    </span>
  )
}

function StatusSelector({ status, onChange, loading, statuses = STATUSES }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium transition-opacity ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'} ${loading ? 'opacity-50' : 'hover:opacity-75'}`}
      >
        {STATUS_ICON[status]} {status} <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-30 py-1 min-w-[180px]">
          {statuses.map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); if (s !== status) onChange(s); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors ${s === status ? 'opacity-40 cursor-default' : ''}`}
            >
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[s] || 'bg-gray-100 text-gray-600'}`}>
                {STATUS_ICON[s]} {s}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
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

// ── InvoiceDetail ──────────────────────────────────────
const METHOD_STYLE = {
  'Efectivo':      'bg-green-100 text-green-700',
  'Tarjeta':       'bg-blue-100 text-blue-700',
  'Transferencia': 'bg-purple-100 text-purple-700',
  'Cheque':        'bg-amber-100 text-amber-700',
  'Yappy':         'bg-cyan-100 text-cyan-700',
}
const METHOD_ICON = {
  'Efectivo':      <Banknote size={11} />,
  'Tarjeta':       <CreditCard size={11} />,
  'Transferencia': <Building2 size={11} />,
  'Cheque':        <FileText size={11} />,
  'Yappy':         <Smartphone size={11} />,
}

function PaymentsSection({ inv, onPaymentAdded }) {
  const invoiceTotal = parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '') || '0')
  const payments = inv.payments || []
  const totalPaid = payments.reduce((s, p) => s + (parseFloat(String(p.amount || '0').replace(/[^\d.]/g, '')) || 0), 0)
  const remaining = Math.max(0, invoiceTotal - totalPaid)
  const paidPct = invoiceTotal > 0 ? Math.min(100, (totalPaid / invoiceTotal) * 100) : 0

  const [form, setForm] = useState({ amount: remaining > 0 ? remaining.toFixed(2) : '', method: 'Efectivo', date: new Date().toISOString().slice(0, 10), notes: '' })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)

  const fmt = (n) => `$${parseFloat(String(n || 0).replace(/[^\d.]/g, '') || '0').toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!form.amount || parseFloat(form.amount) <= 0) { toast.error('Monto inválido'); return }
    setSaving(true)
    try {
      await createInvoicePayment(inv.id, { amount: form.amount, method: form.method, date: form.date, notes: form.notes || null })
      toast.success('Pago registrado')
      setForm(f => ({ ...f, amount: '', notes: '' }))
      onPaymentAdded()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al registrar pago')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (paymentId) => {
    if (!await showConfirm('¿Eliminar este pago?')) return
    setDeleting(paymentId)
    try {
      await deleteInvoicePayment(inv.id, paymentId)
      toast.success('Pago eliminado')
      onPaymentAdded()
    } catch {
      toast.error('Error al eliminar pago')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
        <DollarSign size={14} className="text-gray-400" /> Pagos
      </h3>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-gray-500">
          <span>Pagado: <span className="font-semibold text-green-600">{fmt(totalPaid)}</span></span>
          <span>Pendiente: <span className={`font-semibold ${remaining > 0 ? 'text-red-500' : 'text-green-600'}`}>{fmt(remaining)}</span></span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${paidPct >= 100 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${paidPct}%` }} />
        </div>
        <div className="text-right text-xs text-gray-400">Total factura: <span className="font-medium text-gray-700">{fmt(invoiceTotal)}</span></div>
      </div>

      {/* Payment list */}
      {payments.length > 0 && (
        <div className="space-y-2">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${METHOD_STYLE[p.method] || 'bg-gray-100 text-gray-600'}`}>
                {METHOD_ICON[p.method]} {p.method}
              </span>
              <span className="text-sm font-semibold text-gray-900 flex-shrink-0">{fmt(p.amount)}</span>
              <span className="text-xs text-gray-400 flex-shrink-0">{fmtD(p.date)}</span>
              {p.notes && <span className="text-xs text-gray-500 truncate flex-1">{p.notes}</span>}
              <button
                onClick={() => handleDelete(p.id)}
                disabled={deleting === p.id}
                className="ml-auto p-1 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add payment form */}
      {remaining > 0 && (
        <form onSubmit={handleAdd} className="space-y-3 pt-2 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Registrar pago</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Monto ($)</label>
              <input className="input w-full font-mono" type="number" min="0.01" step="0.01" style={{ fontSize: '16px' }}
                value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
            </div>
            <div>
              <label className="label">Fecha</label>
              <input className="input w-full" type="date" style={{ fontSize: '16px' }}
                value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Método de pago</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {['Efectivo', 'Tarjeta', 'Transferencia', 'Cheque', 'Yappy'].map((m) => (
                <button key={m} type="button"
                  onClick={() => setForm((f) => ({ ...f, method: m }))}
                  className={`flex items-center justify-center gap-1.5 px-2 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors ${form.method === m ? `${METHOD_STYLE[m]} border-current` : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  {METHOD_ICON[m]} <span className="truncate">{m}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Notas (opcional)</label>
            <input className="input w-full" style={{ fontSize: '16px' }} value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Referencia, banco, etc." />
          </div>
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
            <DollarSign size={14} /> {saving ? 'Registrando...' : 'Registrar pago'}
          </button>
        </form>
      )}
      {remaining <= 0 && invoiceTotal > 0 && (
        <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
          <CheckCircle2 size={16} /> Factura completamente pagada
        </div>
      )}
    </div>
  )
}

const EMPTY_EXP = { id: null, concept: '', supplier: '', amount: '', is_payable: false, due_date: '', paid_at: '' }

function ProfitSection({ inv }) {
  const [rows, setRows]             = useState([])
  const [orderExpenses, setOrderExpenses] = useState([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [dirty, setDirty]           = useState(false)
  const [cogs, setCogs]             = useState({ total: 0, lines: [] })
  const [contacts, setContacts]     = useState([])
  const [companies, setCompanies]   = useState([])
  const [suppliers, setSuppliers]   = useState([])

  const invoiceTotal = parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '') || '0')

  useEffect(() => {
    Promise.allSettled([getContacts(), getCompanies(), getSuppliers()]).then(([c, co, s]) => {
      if (c.status === 'fulfilled') setContacts(c.value.data)
      if (co.status === 'fulfilled') setCompanies(co.value.data)
      if (s.status === 'fulfilled') setSuppliers(s.value.data)
    })
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getInvoiceExpenses(inv.id),
      getInvoiceCogs(inv.id),
    ]).then(([expR, cogsR]) => {
      const all = expR.data
      const manual = all.filter(e => e.type !== 'pedido')
      const orders = all.filter(e => e.type === 'pedido')
      setOrderExpenses(orders)
      setRows(manual.length > 0
        ? manual.map(e => ({ id: e.id, concept: e.concept, supplier: e.supplier || '', amount: e.amount, is_payable: e.is_payable, due_date: e.due_date || '', paid_at: e.paid_at || '' }))
        : [{ ...EMPTY_EXP }]
      )
      setCogs(cogsR.data || { total: 0, lines: [] })
    }).catch(() => {
      setRows([{ ...EMPTY_EXP }])
      setOrderExpenses([])
      setCogs({ total: 0, lines: [] })
    }).finally(() => setLoading(false))
    setDirty(false)
  }, [inv.id])

  const update = (idx, field, val) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))
    setDirty(true)
  }

  const addRow = () => { if (rows.length < 5) { setRows(prev => [...prev, { ...EMPTY_EXP }]); setDirty(true) } }
  const removeRow = (idx) => { setRows(prev => prev.length === 1 ? [{ ...EMPTY_EXP }] : prev.filter((_, i) => i !== idx)); setDirty(true) }

  const handleSave = async () => {
    const incomplete = rows.filter(r => (r.concept.trim() || r.supplier.trim()) && !(r.concept.trim() && parseFloat(r.amount) > 0))
    if (incomplete.length > 0) {
      toast.error('Cada servicio requiere una descripción y un monto mayor a 0')
      return
    }
    const valid = rows.filter(r => r.concept.trim() && parseFloat(r.amount) > 0)
    setSaving(true)
    try {
      const r = await syncInvoiceExpenses(inv.id, valid.map(e => ({
        id: e.id || undefined,
        concept: e.concept.trim(),
        amount: String(parseFloat(e.amount) || 0),
        supplier: e.supplier.trim() || null,
        is_payable: e.is_payable,
        due_date: e.due_date || null,
        paid_at: e.paid_at || null,
      })))
      setRows(r.data.length > 0
        ? r.data.map(e => ({ id: e.id, concept: e.concept, supplier: e.supplier || '', amount: e.amount, is_payable: e.is_payable, due_date: e.due_date || '', paid_at: e.paid_at || '' }))
        : [{ ...EMPTY_EXP }]
      )
      setDirty(false)
      toast.success('Costos guardados y registrados en gastos')
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al guardar costos')
    } finally {
      setSaving(false)
    }
  }

  const manualCosts = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const orderCosts  = orderExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const totalCosts  = manualCosts + orderCosts + (cogs.total || 0)
  const profit      = invoiceTotal - totalCosts
  const margin      = invoiceTotal > 0 ? (profit / invoiceTotal) * 100 : 0
  const costsWidth  = invoiceTotal > 0 ? Math.min(100, (totalCosts / invoiceTotal) * 100) : 0
  const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
        <TrendingUp size={14} className="text-indigo-500" /> Rentabilidad
      </h3>

      {/* Barra visual */}
      {invoiceTotal > 0 && (
        <div className="space-y-2">
          <div className="h-3 bg-green-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${costsWidth >= 100 ? 'bg-red-500' : 'bg-orange-400'}`} style={{ width: `${costsWidth}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-green-50 border border-green-100 rounded-lg p-2">
              <p className="text-xs text-green-600 font-medium">Ingresos</p>
              <p className="text-sm font-bold text-green-700">{fmt(invoiceTotal)}</p>
            </div>
            <div className="bg-orange-50 border border-orange-100 rounded-lg p-2">
              <p className="text-xs text-orange-600 font-medium">Costos totales</p>
              <p className="text-sm font-bold text-orange-700">{fmt(totalCosts)}</p>
            </div>
            <div className={`rounded-lg p-2 border ${profit >= 0 ? 'bg-indigo-50 border-indigo-100' : 'bg-red-50 border-red-100'}`}>
              <p className={`text-xs font-medium ${profit >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>Utilidad {invoiceTotal > 0 ? `${margin.toFixed(0)}%` : ''}</p>
              <p className={`text-sm font-bold ${profit >= 0 ? 'text-indigo-700' : 'text-red-700'}`}>{fmt(profit)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Pedidos vinculados */}
      {orderExpenses.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            Pedidos vinculados <span className="text-gray-300 font-normal normal-case tracking-normal">(automático desde pedidos)</span>
          </p>
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            {orderExpenses.map((e, i) => (
              <div key={e.id} className={`flex items-center gap-3 px-3 py-2 text-xs ${i % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
                <span className="text-gray-700 flex-1 truncate">{e.concept}</span>
                {e.supplier && <span className="text-gray-400 min-w-0 truncate max-w-[120px]">{e.supplier}</span>}
                <span className="font-semibold text-orange-700 flex-shrink-0 w-20 text-right">{fmt(parseFloat(e.amount) || 0)}</span>
              </div>
            ))}
            <div className="flex justify-between px-3 py-2 bg-orange-50 border-t border-orange-100">
              <span className="text-xs font-semibold text-orange-700">Subtotal pedidos</span>
              <span className="text-xs font-bold text-orange-700">{fmt(orderCosts)}</span>
            </div>
          </div>
        </div>
      )}

      {/* COGS automático desde inventario */}
      {cogs.lines?.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            Costo de mercancía <span className="text-gray-300 font-normal normal-case tracking-normal">(automático desde inventario)</span>
          </p>
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            {cogs.lines.map((l, i) => (
              <div key={i} className={`flex items-center gap-3 px-3 py-2 text-xs ${i % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
                <span className="font-mono text-gray-400 flex-shrink-0 w-20 truncate">{l.code}</span>
                <span className="text-gray-700 flex-1 truncate">{l.name}</span>
                <span className="text-gray-500 flex-shrink-0">{l.qty} × {fmt(l.cost_price)}</span>
                <span className="font-semibold text-orange-700 flex-shrink-0 w-20 text-right">{fmt(l.line_cost)}</span>
              </div>
            ))}
            <div className="flex justify-between px-3 py-2 bg-orange-50 border-t border-orange-100">
              <span className="text-xs font-semibold text-orange-700">Subtotal mercancía</span>
              <span className="text-xs font-bold text-orange-700">{fmt(cogs.total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Gastos manuales de servicio */}
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Servicios profesionales / subcontratos</p>
      {loading ? (
        <p className="text-xs text-gray-400 text-center py-2">Cargando...</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div key={idx} className={`border rounded-lg p-3 space-y-2 ${(row.concept.trim() || row.supplier.trim()) && !(row.concept.trim() && parseFloat(row.amount) > 0) ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
              <div className="flex gap-2">
                <input
                  className={`input flex-1 text-sm ${row.supplier.trim() && !row.concept.trim() ? 'border-red-400 focus:border-red-500' : ''}`}
                  style={{ fontSize: '16px' }}
                  placeholder="Concepto (subcontrato, mano de obra...)"
                  value={row.concept}
                  onChange={e => update(idx, 'concept', e.target.value)}
                />
                <input
                  className={`input w-24 text-sm font-mono ${row.concept.trim() && !(parseFloat(row.amount) > 0) ? 'border-red-400 focus:border-red-500' : ''}`}
                  style={{ fontSize: '16px' }}
                  placeholder="0.00"
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.amount}
                  onChange={e => update(idx, 'amount', e.target.value)}
                />
                <button onClick={() => removeRow(idx)} className="p-2 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
                  <X size={14} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-40">
                  <ClientAutocomplete
                    field="name"
                    value={row.supplier}
                    onChange={v => update(idx, 'supplier', v)}
                    onSelect={c => update(idx, 'supplier', c.name || '')}
                    contacts={contacts}
                    companies={companies}
                    suppliers={suppliers}
                    placeholder="Proveedor / beneficiario"
                  />
                </div>
                <label
                  className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer flex-shrink-0 select-none"
                  title="Marca si este costo aún no está pagado y quieres hacer seguimiento del pago pendiente"
                >
                  <input
                    type="checkbox"
                    checked={row.is_payable}
                    onChange={e => update(idx, 'is_payable', e.target.checked)}
                    className="w-4 h-4 rounded accent-indigo-600"
                  />
                  Cuenta por pagar
                </label>
                {row.is_payable && (
                  <label className="flex flex-col gap-0.5 flex-shrink-0">
                    <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Vencimiento</span>
                    <input
                      className="input w-36 text-sm"
                      style={{ fontSize: '16px' }}
                      type="date"
                      value={row.due_date}
                      onChange={e => update(idx, 'due_date', e.target.value)}
                    />
                  </label>
                )}
                <label className="flex flex-col gap-0.5 flex-shrink-0">
                  <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Fecha de pago</span>
                  <input
                    className="input w-36 text-sm"
                    style={{ fontSize: '16px' }}
                    type="date"
                    value={row.paid_at}
                    onChange={e => update(idx, 'paid_at', e.target.value)}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {manualCosts > 0 && (
        <div className="flex justify-between px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-lg">
          <span className="text-xs font-semibold text-indigo-700">Subtotal servicios / subcontratos</span>
          <span className="text-xs font-bold text-indigo-700">{fmt(manualCosts)}</span>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {rows.length < 5 && (
          <button onClick={addRow} className="flex items-center gap-1.5 text-xs px-3 py-2 border border-dashed border-gray-300 text-gray-500 rounded-lg hover:border-indigo-400 hover:text-indigo-600 transition-colors">
            <Plus size={12} /> Agregar costo
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="flex items-center gap-1.5 text-xs px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors ml-auto"
        >
          <Save size={12} /> {saving ? 'Guardando...' : 'Guardar costos'}
        </button>
      </div>
      <p className="text-xs text-gray-400 flex items-center gap-1">
        <Briefcase size={11} /> Los costos guardados se registran automáticamente en la lista de gastos.
      </p>
    </div>
  )
}


function ViewPdfBtn({ onClick, loading, title = 'Ver PDF' }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      title={title}
    >
      {loading
        ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
        : <ExtLink size={11} />}
      <span className="hidden sm:inline">Ver PDF</span>
    </button>
  )
}

function AttachmentRow({ att, isPdf, invoiceId, onDelete }) {
  const [loading, setLoading] = useState(false)

  const handleOpen = async () => {
    setLoading(true)
    try {
      const res = await getInvoiceAttachment(invoiceId, att.id)
      const url = URL.createObjectURL(res.data)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      toast.error('No se pudo abrir el archivo')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-gray-50 border border-gray-100 group">
      <div className="w-7 h-7 rounded-md bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
        <FileText size={13} className={isPdf ? 'text-red-400' : 'text-blue-400'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700 truncate" title={att.original_name}>{att.original_name}</p>
        {att.file_size && <p className="text-xs text-gray-400">{(att.file_size / 1024).toFixed(0)} KB</p>}
      </div>
      {isPdf
        ? <ViewPdfBtn onClick={handleOpen} loading={loading} />
        : <button onClick={handleOpen} disabled={loading}
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors">
            {loading ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Download size={11} />}
            <span className="hidden sm:inline">Descargar</span>
          </button>
      }
      <button onClick={() => onDelete(att.id)}
        className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors sm:opacity-0 sm:group-hover:opacity-100" title="Eliminar">
        <X size={14} />
      </button>
    </div>
  )
}

function InvoiceDetail({ inv, onEdit, onDelete, onClone, onStatusChange, onPrint, onSendEmail, onShare, onPaymentAdded, onInventoryApplied }) {
  const navigate = useNavigate()
  const [changingStatus, setChangingStatus] = useState(false)
  const [applyingInv, setApplyingInv] = useState(false)
  const [dgiFilename, setDgiFilename] = useState(inv.dgi_filename || null)
  const [dgiName, setDgiName] = useState(inv.dgi_original_name || null)
  const [dgiLoading, setDgiLoading] = useState(false)
  const dgiInputRef = useRef(null)
  const [attachments, setAttachments] = useState(inv.attachments || [])
  const [attUploading, setAttUploading] = useState(false)
  const attInputRef = useRef(null)
  const [linkedQuotes, setLinkedQuotes] = useState(inv.linked_quotes || [])
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState([])
  const [warranties, setWarranties] = useState([])

  useEffect(() => {
    getWarranties({ invoice_id: inv.id }).then(r => setWarranties(r.data)).catch(() => {})
  }, [inv.id])
  const [linkDropOpen, setLinkDropOpen] = useState(false)
  const [linkLoading, setLinkLoading] = useState(false)
  const [quotePdfLoading, setQuotePdfLoading] = useState(null)
  const [warrantyPdfLoading, setWarrantyPdfLoading] = useState(null)
  const items = parseItems(inv.items)
  const shippingCost = parseFloat(inv.shipping_cost || '0') || 0
  const { subtotal, itbmsAmt, total } = calcTotals(items, inv.itbms_enabled, shippingCost)

  const totalPaid = (inv.payments || []).reduce((s, p) => s + parseFloat(String(p.amount || '0').replace(/[^\d.]/g, '') || '0'), 0)
  const hasPayments = totalPaid > 0
  // Once an invoice has payments, prevent reverting to Borrador/Emitida; only Pagada and Anulada are valid
  const allowedStatuses = hasPayments && inv.status === 'Pagada'
    ? STATUSES.filter(s => s === 'Pagada' || s === 'Anulada')
    : STATUSES

  const handleApplyInventory = async (force = false) => {
    const msg = force
      ? '¿Re-aplicar descuento de inventario? Esto volverá a descontar los artículos. Solo úsalo si el descuento anterior no se realizó correctamente.'
      : '¿Descontar los artículos de esta factura del inventario?'
    if (!await showConfirm(msg)) return
    setApplyingInv(true)
    try {
      await applyInvoiceInventory(inv.id)
      toast.success('Inventario actualizado desde la factura')
      onInventoryApplied?.()
    } catch {
      toast.error('Error al aplicar inventario')
    } finally {
      setApplyingInv(false)
    }
  }

  const handleStatus = async (val) => {
    setChangingStatus(true)
    await onStatusChange(val)
    setChangingStatus(false)
  }

  const handleDgiUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') { toast.error('Solo se permite PDF'); return }
    setDgiLoading(true)
    try {
      const r = await uploadDgiAttachment(inv.id, file)
      setDgiFilename(file.name)
      setDgiName(r.data.original_name || file.name)
      toast.success('Factura DGI adjuntada')
    } catch {
      toast.error('Error al subir el archivo')
    } finally {
      setDgiLoading(false)
      e.target.value = ''
    }
  }

  const handleDgiDelete = async () => {
    if (!await showConfirm('¿Eliminar la factura DGI adjunta?')) return
    setDgiLoading(true)
    try {
      await deleteDgiAttachment(inv.id)
      setDgiFilename(null)
      setDgiName(null)
      toast.success('Adjunto eliminado')
    } catch {
      toast.error('Error al eliminar')
    } finally {
      setDgiLoading(false)
    }
  }

  const handleDgiOpen = async () => {
    setDgiLoading(true)
    try {
      const res = await getDgiAttachment(inv.id)
      const url = URL.createObjectURL(res.data)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      toast.error('No se pudo abrir el archivo')
    } finally {
      setDgiLoading(false)
    }
  }

  const handleAttUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (attachments.length >= 5) { toast.error('Máximo 5 adjuntos por factura'); e.target.value = ''; return }
    if (file.size > 20 * 1024 * 1024) { toast.error('El archivo excede 20 MB'); e.target.value = ''; return }
    setAttUploading(true)
    try {
      const r = await uploadInvoiceAttachment(inv.id, file)
      setAttachments((prev) => [...prev, r.data])
      toast.success('Adjunto agregado')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al subir el archivo')
    } finally {
      setAttUploading(false)
      e.target.value = ''
    }
  }

  const handleAttDelete = async (attId) => {
    if (!await showConfirm('¿Eliminar este adjunto?')) return
    try {
      await deleteInvoiceAttachment(inv.id, attId)
      setAttachments((prev) => prev.filter((a) => a.id !== attId))
      toast.success('Adjunto eliminado')
    } catch {
      toast.error('Error al eliminar')
    }
  }

  useEffect(() => {
    if (!linkSearch.trim()) { setLinkResults([]); return }
    const t = setTimeout(() => {
      getQuotes({ search: linkSearch, limit: 8 }).then((r) => setLinkResults(r.data)).catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [linkSearch])

  const handleAddLink = async (q) => {
    if (linkedQuotes.some((lq) => lq.id === q.id)) { setLinkDropOpen(false); setLinkSearch(''); return }
    setLinkLoading(true)
    try {
      const r = await addInvoiceQuoteLink(inv.id, q.id)
      setLinkedQuotes(r.data.linked_quotes || [])
      toast.success('Cotización vinculada')
    } catch { toast.error('Error al vincular') }
    finally { setLinkLoading(false); setLinkSearch(''); setLinkDropOpen(false) }
  }

  const handleRemoveLink = async (quoteId) => {
    setLinkLoading(true)
    try {
      const r = await removeInvoiceQuoteLink(inv.id, quoteId)
      setLinkedQuotes(r.data.linked_quotes || [])
      toast.success('Vínculo eliminado')
    } catch { toast.error('Error al desvincular') }
    finally { setLinkLoading(false) }
  }

  const handleWarrantyPdf = async (w) => {
    setWarrantyPdfLoading(w.id)
    try {
      const r = await getWarranty(w.id)
      const html = buildWarrantyHTML(r.data, window.location.origin)
      const ok = openPdfWindow(`Certificado ${r.data.cert_number || w.cert_number}`, html, { autoprint: false })
      if (!ok) toast.error('El navegador bloqueó la ventana emergente')
    } catch {
      toast.error('No se pudo cargar el certificado')
    } finally {
      setWarrantyPdfLoading(null)
    }
  }

  const handleQuotePdf = async (q) => {
    setQuotePdfLoading(q.id)
    try {
      const r = await getQuote(q.id)
      const qData = r.data
      const items = qData.items ? (() => { try { const a = JSON.parse(qData.items); return Array.isArray(a) ? a : [] } catch { return [] } })() : []
      const html = buildQuoteHTML(qData, items, window.location.origin)
      const ok = openPdfWindow(`Cotización ${qData.quote_number || qData.id}`, html, { autoprint: false })
      if (!ok) toast.error('El navegador bloqueó la ventana emergente')
    } catch {
      toast.error('No se pudo cargar la cotización')
    } finally {
      setQuotePdfLoading(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4 w-full">
      {!dgiFilename && inv.status !== 'Borrador' && inv.status !== 'Anulada' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-orange-50 border border-orange-200 rounded-xl text-sm">
          <Paperclip size={16} className="text-orange-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-orange-800">Factura fiscal DGI pendiente</span>
            <span className="text-orange-600 ml-1.5">— Adjunta el PDF de la DGI para completar el expediente.</span>
          </div>
          <button
            onClick={() => dgiInputRef.current?.click()}
            disabled={dgiLoading}
            className="flex-shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <Paperclip size={12} /> Adjuntar
          </button>
        </div>
      )}

      {/* Header */}
      <div className="card">
        {/* Número prominente + info — ancho completo */}
        <div>
          <p className="text-lg font-bold font-mono text-gray-700 mb-0.5 tracking-wide">{inv.invoice_number || `FAC-${inv.id}`}</p>
          <h2 className="text-xl font-bold text-gray-900 leading-snug">{inv.client_name || 'Factura'}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {inv.date && <span className="text-xs text-gray-400 flex items-center gap-1"><Calendar size={11} />Emitida: {fmtD(inv.date)}</span>}
            {inv.due_date && <span className="text-xs text-gray-400 flex items-center gap-1"><AlertCircle size={11} />Vence: {fmtD(inv.due_date)}</span>}
            <StatusSelector status={inv.status} onChange={handleStatus} loading={changingStatus} statuses={allowedStatuses} />
            {inv.payment_terms && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${inv.payment_terms === 'Contado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {inv.payment_terms}
              </span>
            )}
          </div>
          {hasPayments && (() => {
            const invTotal = parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '') || '0')
            const remaining = Math.max(0, invTotal - totalPaid)
            const pct = invTotal > 0 ? Math.min(100, (totalPaid / invTotal) * 100) : 0
            const fmt = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            return (
              <div className="w-full mt-2 space-y-1">
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-green-600 font-medium flex items-center gap-1">
                    <CheckCircle2 size={10} /> {fmt(totalPaid)} abonado
                  </span>
                  {remaining > 0
                    ? <span className="text-red-500 font-medium">{fmt(remaining)} pendiente</span>
                    : <span className="text-green-600 font-medium">Pagada completamente</span>
                  }
                </div>
              </div>
            )
          })()}
        </div>
        {/* Acciones — fila propia debajo de la info */}
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
          <button onClick={onSendEmail} title="Enviar por correo" className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors">
            <Mail size={13} /> <span className="hidden sm:inline">Enviar</span>
          </button>
          <button onClick={() => onPrint(true)} title="Imprimir" className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-900 active:bg-black transition-colors">
            <Printer size={13} /> <span className="hidden sm:inline">Imprimir</span>
          </button>
          <button onClick={() => onPrint(false)} title="Guardar PDF" className="flex items-center gap-1.5 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 active:bg-green-800 transition-colors">
            <Download size={13} /> <span className="hidden sm:inline">PDF</span>
          </button>
          <button onClick={onShare} title="Compartir PDF" className="flex items-center gap-1.5 px-3 py-2 text-sm bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 active:bg-cyan-800 transition-colors">
            <Share2 size={13} /> <span className="hidden sm:inline">Compartir</span>
          </button>
          {['Emitida', 'Pagada'].includes(inv.status) && !inv.inventory_applied && (
            <button onClick={() => handleApplyInventory(false)} disabled={applyingInv} title="Descontar del inventario" className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors">
              <PackageCheck size={13} /> <span className="hidden sm:inline">{applyingInv ? 'Aplicando...' : 'Al inventario'}</span>
            </button>
          )}
          {['Emitida', 'Pagada'].includes(inv.status) && inv.inventory_applied && (
            <button onClick={() => handleApplyInventory(true)} disabled={applyingInv} title="Re-aplicar descuento de inventario" className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-60 transition-colors">
              <PackageCheck size={13} /> <span className="hidden sm:inline">{applyingInv ? 'Aplicando...' : 'Re-inventario'}</span>
            </button>
          )}
          <button onClick={onEdit} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Pencil size={13} /> <span className="hidden sm:inline">Editar</span>
          </button>
          <button onClick={onClone} title="Clonar factura" className="flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] px-3 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-200 transition-colors">
            <Copy size={14} />
          </button>
          <button onClick={onDelete} title="Eliminar factura" className="flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] px-3 text-sm text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>

        {/* Cotizaciones vinculadas */}
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <ClipboardList size={14} className="text-blue-500 flex-shrink-0" />
            <span className="text-gray-500 flex-shrink-0 font-medium">Cotizaciones vinculadas</span>
          </div>
          {linkedQuotes.map((q) => (
            <div key={q.id} className="flex items-center gap-2 pl-5">
              <button
                onClick={() => navigate('/quotes', { state: { selectQuoteId: q.id } })}
                className="text-sm text-blue-700 font-medium hover:underline flex-1 text-left truncate"
              >
                {q.quote_number || `COT-${q.id}`}{q.client_name ? ` · ${q.client_name}` : ''}
              </button>
              <ViewPdfBtn onClick={() => handleQuotePdf(q)} loading={quotePdfLoading === q.id} />
              <button onClick={() => handleRemoveLink(q.id)} disabled={linkLoading} className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors">
                <X size={13} />
              </button>
            </div>
          ))}
          <div className="pl-5 relative">
            <div className="flex items-center gap-2">
              <input
                value={linkSearch}
                onChange={(e) => { setLinkSearch(e.target.value); setLinkDropOpen(true) }}
                onFocus={() => setLinkDropOpen(true)}
                onBlur={() => setTimeout(() => setLinkDropOpen(false), 150)}
                placeholder="Vincular cotización..."
                className="text-xs border border-dashed border-gray-300 rounded-lg px-2 py-1.5 flex-1 focus:outline-none focus:border-blue-400 placeholder-gray-400"
                disabled={linkLoading}
              />
            </div>
            {linkDropOpen && linkResults.length > 0 && (
              <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                {linkResults.map((q) => (
                  <button
                    key={q.id}
                    onMouseDown={() => handleAddLink(q)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-blue-50 transition-colors"
                  >
                    <ClipboardList size={12} className="text-blue-400 flex-shrink-0" />
                    <span className="text-xs font-mono text-blue-700">{q.quote_number || `COT-${q.id}`}</span>
                    {q.client_name && <span className="text-xs text-gray-500 truncate">{q.client_name}</span>}
                    {linkedQuotes.some((lq) => lq.id === q.id) && <span className="ml-auto text-xs text-green-600">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Certificados de garantía */}
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck size={14} className="text-emerald-500 flex-shrink-0" />
              <span className="text-gray-500 font-medium">Certificados de garantía</span>
              {warranties.length > 0 && (
                <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">{warranties.length}</span>
              )}
            </div>
            <button
              onClick={() => navigate('/warranties', { state: { preselectedInvoiceId: inv.id, preselectedInvoiceNumber: inv.invoice_number } })}
              className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 font-medium"
            >
              <Plus size={11} /> Crear certificado
            </button>
          </div>
          {warranties.length === 0 ? (
            <p className="text-xs text-gray-300 pl-5">Sin certificados vinculados</p>
          ) : warranties.map(w => (
            <div key={w.id} className="flex items-center gap-2 pl-5">
              <button
                onClick={() => navigate('/warranties')}
                className="flex items-center gap-2 flex-1 text-left hover:underline truncate"
              >
                <span className="text-sm text-emerald-700 font-medium flex-shrink-0">{w.cert_number}</span>
                {w.warranty_period && <span className="text-xs text-gray-400 truncate">· {w.warranty_period}</span>}
                {w.warranty_end && <span className="text-xs text-gray-400 flex-shrink-0">· Vence {w.warranty_end}</span>}
              </button>
              <ViewPdfBtn onClick={() => handleWarrantyPdf(w)} loading={warrantyPdfLoading === w.id} />
            </div>
          ))}
        </div>

        {/* Despacho link */}
        {inv.dispatch_id && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-sm">
            <PackageCheck size={14} className="text-indigo-500" />
            <span className="text-gray-500">Originada del despacho</span>
            <button
              onClick={() => navigate('/pedidos', { state: { selectDispatchId: inv.dispatch_id } })}
              className="text-indigo-600 hover:underline font-medium"
            >
              {inv.dispatch?.dispatch_number || `#${inv.dispatch_id}`} →
            </button>
          </div>
        )}

        {/* Ticket link */}
        {inv.ticket_id && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-sm">
            <Tag size={14} className="text-violet-500" />
            <span className="text-gray-500">Ticket vinculado</span>
            <button
              onClick={() => navigate(`/tickets/${inv.ticket_id}`)}
              className="text-violet-600 hover:underline font-medium truncate"
            >
              #{inv.ticket_id}{inv.ticket?.title ? ` · ${inv.ticket.title}` : ''} →
            </button>
          </div>
        )}

        {/* Archivos adjuntos: DGI + adjuntos generales */}
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Archivos adjuntos</span>
            {attachments.length < 5 && (
              <button
                onClick={() => attInputRef.current?.click()}
                disabled={attUploading}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                <Plus size={11} /> {attUploading ? 'Subiendo...' : 'Agregar archivo'}
              </button>
            )}
          </div>

          {/* Fila DGI */}
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-gray-50 border border-gray-100 group">
            <div className="w-7 h-7 rounded-md bg-red-50 border border-red-100 flex items-center justify-center flex-shrink-0">
              <FileText size={13} className="text-red-500" />
            </div>
            <span className="text-xs font-medium text-gray-400 flex-shrink-0">DGI</span>
            {dgiFilename ? (
              <>
                <span className="flex-1 min-w-0 text-sm text-gray-700 font-medium truncate" title={dgiName}>{dgiName}</span>
                <ViewPdfBtn onClick={handleDgiOpen} loading={dgiLoading} />
                <button onClick={() => dgiInputRef.current?.click()} disabled={dgiLoading}
                  className="flex-shrink-0 text-gray-300 hover:text-gray-500 transition-colors disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100" title="Reemplazar">
                  <Paperclip size={13} />
                </button>
                <button onClick={handleDgiDelete} disabled={dgiLoading}
                  className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100" title="Eliminar">
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-gray-400 italic">Sin adjunto</span>
                <button onClick={() => dgiInputRef.current?.click()} disabled={dgiLoading}
                  className="flex-shrink-0 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50">
                  <Paperclip size={12} /> {dgiLoading ? 'Subiendo...' : 'Adjuntar PDF'}
                </button>
              </>
            )}
          </div>

          {/* Adjuntos generales */}
          {attachments.map((att) => {
            const ext = att.original_name.split('.').pop()?.toLowerCase()
            const isPdf = ext === 'pdf'
            return (
              <AttachmentRow
                key={att.id}
                att={att}
                isPdf={isPdf}
                invoiceId={inv.id}
                onDelete={handleAttDelete}
              />
            )
          })}

          {attachments.length === 0 && !dgiFilename && (
            <p className="text-xs text-gray-400 italic px-1">Sin archivos adjuntos</p>
          )}
          <p className="text-xs text-gray-300 px-1">{attachments.length}/5 adjuntos generales</p>
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
          <table className="w-full text-sm items-table-mobile">
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
              {items.filter((it) => it.description?.trim()).map((it, i) => {
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
            {inv.itbms_enabled && <div className="flex justify-between text-sm"><span className="text-amber-600">ITBMS 7%</span><span className="font-medium text-amber-600">${fmtMoney(itbmsAmt)}</span></div>}
            {shippingCost > 0 && <div className="flex justify-between text-sm"><span className="text-gray-600">Costo de entrega</span><span className="font-medium text-gray-700">${fmtMoney(shippingCost)}</span></div>}
            <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-1"><span>TOTAL</span><span>${fmtMoney(total)}</span></div>
          </div>
        </div>
      </div>

      {inv.notes && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Notas</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{inv.notes}</p>
        </div>
      )}

      <ProfitSection inv={inv} />

      <PaymentsSection inv={inv} onPaymentAdded={onPaymentAdded} />

      <input ref={dgiInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleDgiUpload} />
      <input ref={attInputRef} type="file" className="hidden" onChange={handleAttUpload} />
    </div>
  )
}

// ── Main ───────────────────────────────────────────────
export default function Facturas() {
  const navigate = useNavigate()
  const location = useLocation()
  const { ref: urlRef } = useParams()

  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const detailSwipe = useTouchSwipe({ onSwipeRight: () => { setMobileDetailOpen(false); navigate(-1) }, edgeOnly: 28 })
  const [editing, setEditing] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [items, setItems] = useState([{ ...EMPTY_ITEM }])
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  useFormGuard(isDirty)

  // Email modal
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailMsg, setEmailMsg] = useState('')
  const [emailSending, setEmailSending] = useState(false)

  // Client autocomplete
  const [contacts, setContacts] = useState([])
  const [companies, setCompanies] = useState([])
  const [portalClients, setPortalClients] = useState([])
  const [clientQuery, setClientQuery] = useState('')
  const [quoteQuery, setQuoteQuery] = useState('')
  const [quoteResults, setQuoteResults] = useState([])
  const [quoteDropOpen, setQuoteDropOpen] = useState(false)
  const [ticketQuery, setTicketQuery] = useState('')
  const [ticketResults, setTicketResults] = useState([])
  const [ticketDropOpen, setTicketDropOpen] = useState(false)

  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 320)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    setLoading(true)
    const params = {}
    if (debouncedSearch) params.search = debouncedSearch
    if (statusFilter) params.status = statusFilter
    getInvoices(params)
      .then((r) => setInvoices(r.data))
      .catch(() => toast.error('Error cargando facturas'))
      .finally(() => setLoading(false))
  }, [debouncedSearch, statusFilter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    Promise.allSettled([getContacts(), getCompanies(), getClients()])
      .then(([cr, comr, clr]) => {
        if (cr.status === 'fulfilled') setContacts(cr.value.data)
        if (comr.status === 'fulfilled') setCompanies(comr.value.data)
        if (clr.status === 'fulfilled') setPortalClients(clr.value.data)
      })
  }, [])

  useEffect(() => {
    if (!quoteQuery.trim()) { setQuoteResults([]); return }
    const t = setTimeout(() => {
      getQuotes({ search: quoteQuery, limit: 10 }).then((r) => setQuoteResults(r.data)).catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [quoteQuery])

  useEffect(() => {
    if (!ticketQuery.trim()) { setTicketResults([]); return }
    const t = setTimeout(() => {
      getTickets({ search: ticketQuery, limit: 10 }).then((r) => setTicketResults(r.data)).catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [ticketQuery])

  // Auto-select invoice from navigation state (from Despacho / Quotes)
  useEffect(() => {
    const id = location.state?.selectInvoiceId
    if (!id) return
    const existing = invoices.find((inv) => inv.id === id)
    if (existing) { setSelected(existing); setMobileDetailOpen(true); return }
    getInvoice(id).then((r) => {
      setSelected(r.data)
      setMobileDetailOpen(true)
    }).catch(() => toast.error('No se encontró la factura seleccionada'))
  }, [location.state?.selectInvoiceId])

  // Auto-select from URL param (e.g. /facturas/FAC-0002)
  useEffect(() => {
    if (!urlRef) { if (selected) { setSelected(null); setMobileDetailOpen(false) } return }
    if (invoices.length === 0) return
    if (selected?.invoice_number === urlRef || String(selected?.id) === urlRef) return
    const found = invoices.find((inv) => inv.invoice_number === urlRef || String(inv.id) === urlRef)
    if (found) { setSelected(found); setEditing(false); setMobileDetailOpen(true) }
  }, [urlRef, invoices])

  // ── Handlers ──────────────────────────────────────────

  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      const ticketId = searchParams.get('ticket_id') ? parseInt(searchParams.get('ticket_id')) : null
      setSearchParams({}, { replace: true })
      openNew(ticketId)
    }
  }, []) // eslint-disable-line

  const openNew = async (ticketId = null) => {
    setIsNew(true)
    const num = await getNextInvoiceNumber().then((r) => r.data.number).catch(() => 'FAC-0001')
    setForm({ ...EMPTY_FORM, invoice_number: num, date: new Date().toISOString().split('T')[0], ticket_id: ticketId })
    setItems([{ ...EMPTY_ITEM }])
    setClientQuery('')
    setEditing(true)
    setSelected(null)
    setMobileDetailOpen(true)
  }

  const openEdit = (inv) => {
    setIsNew(false)
    setForm({
      invoice_number: inv.invoice_number || '',
      status: inv.status || 'Borrador',
      client_name: inv.client_name || '',
      client_ruc: inv.client_ruc || '',
      client_address: inv.client_address || '',
      client_email: inv.client_email || '',
      client_phone: inv.client_phone || '',
      client_id: inv.client_id || null,
      date: inv.date || '',
      due_date: inv.due_date || '',
      itbms_enabled: inv.itbms_enabled || false,
      shipping_cost: inv.shipping_cost || '',
      payment_terms: inv.payment_terms || '',
      notes: inv.notes || '',
      quote_id: inv.quote_id || null,
      ticket_id: inv.ticket_id || null,
    })
    setQuoteQuery(inv.quote ? (inv.quote.quote_number || `COT-${inv.quote_id}`) : '')
    setTicketQuery(inv.ticket_id ? (inv.ticket?.title ? `#${inv.ticket_id} · ${inv.ticket.title}` : `#${inv.ticket_id}`) : '')
    setClientQuery(inv.client_name || '')
    setItems(parseItems(inv.items))
    setEditing(true)
  }

  const cancelEdit = async () => {
    if (isDirty && !await showConfirm('¿Salir sin guardar los cambios?')) return
    setIsDirty(false)
    setEditing(false)
    if (isNew) { setSelected(null); setMobileDetailOpen(false); navigate('/facturas', { replace: true }) }
  }

  const handleSelectClient = (c) => {
    setClientQuery(c.name || '')
    setIsDirty(true)
    // If a Company entity is selected, try to auto-link a portal client with the same company name
    let autoClientId = null
    if (c._type === 'company') {
      const match = portalClients.find(
        (u) => (u.company || '').toLowerCase() === (c.name || '').toLowerCase()
      )
      if (match) autoClientId = match.id
    }
    setForm((f) => ({
      ...f,
      client_name: c.name || f.client_name,
      client_ruc: c.ruc || f.client_ruc,
      client_address: c.address || f.client_address,
      client_email: c.email || f.client_email,
      client_phone: c.phone || f.client_phone,
      ...(autoClientId !== null ? { client_id: autoClientId } : {}),
    }))
  }

  const handleSelectPortalClient = (idStr) => {
    const cid = idStr ? Number(idStr) : null
    setIsDirty(true)
    if (!cid) { setForm((f) => ({ ...f, client_id: null })); return }
    const u = portalClients.find((c) => c.id === cid)
    if (u) setClientQuery(u.name)
    setForm((f) => ({
      ...f,
      client_id: cid,
      client_name: u?.name || f.client_name,
      client_email: u?.email || f.client_email,
      client_phone: u?.phone || f.client_phone,
      client_address: u?.address || f.client_address,
    }))
  }

  // New contact modal
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ name: '', company: '', ruc: '', email: '', phone: '', address: '' })
  const [savingContact, setSavingContact] = useState(false)
  const [companyDrop, setCompanyDrop] = useState([])

  const handleCreateContact = async (e) => {
    e.preventDefault()
    if (!contactForm.name.trim()) return
    setSavingContact(true)
    try {
      const res = await createContact({
        name: contactForm.name, company: contactForm.company || null,
        ruc: contactForm.ruc || null, email: contactForm.email || null,
        phone: contactForm.phone || null, address: contactForm.address || null,
      })
      const c = res.data
      setContacts((prev) => [c, ...prev])
      setClientQuery(c.name)
      setIsDirty(true)
      setForm((f) => ({
        ...f,
        client_name: c.name,
        client_ruc: c.ruc || f.client_ruc,
        client_address: c.address || f.client_address,
        client_email: c.email || f.client_email,
        client_phone: c.phone || f.client_phone,
      }))
      setShowContactModal(false)
      setContactForm({ name: '', company: '', ruc: '', email: '', phone: '', address: '' })
      toast.success(`Contacto "${c.name}" creado`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error creando contacto')
    } finally {
      setSavingContact(false)
    }
  }

  const handleItemChange = (idx, field, value) => {
    setIsDirty(true)
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }
  const addItem = () => { setIsDirty(true); setItems((prev) => [...prev, { ...EMPTY_ITEM }]) }
  const removeItem = (idx) => { setIsDirty(true); setItems((prev) => prev.filter((_, i) => i !== idx)) }

  const buildPayload = () => {
    const shippingCost = parseFloat(form.shipping_cost || '0') || 0
    const { subtotal, itbmsAmt, total } = calcTotals(items, form.itbms_enabled, shippingCost)
    return {
      ...form,
      items: JSON.stringify(items.filter((it) => it.description?.trim())),
      shipping_cost: shippingCost > 0 ? fmtMoney(shippingCost) : null,
      subtotal: fmtMoney(subtotal),
      itbms_amount: fmtMoney(itbmsAmt),
      total: fmtMoney(total),
      date: form.date || null,
      due_date: form.due_date || null,
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.client_name.trim()) return toast.error('El nombre del cliente es requerido')

    // Validate coded items exist in inventory before saving
    const itemsWithCode = items.filter(it => (it.code || '').trim())
    if (itemsWithCode.length > 0) {
      try {
        const check = await validateInvoiceItems(items)
        if (!check.data.ok) {
          const list = check.data.missing.map(m => `• ${m.code}${m.description ? ' — ' + m.description : ''}`).join('\n')
          toast.error(`Los siguientes artículos no existen en inventario y deben ser registrados antes de guardar:\n\n${list}`, { duration: 8000 })
          return
        }
      } catch { /* no bloquear si el endpoint falla */ }
    }

    // Warn before inventory deduction when saving as Emitida/Pagada for first time
    const willDeduct = !selected?.inventory_applied && ['Emitida', 'Pagada'].includes(form.status) && itemsWithCode.length > 0
    if (willDeduct) {
      const list = itemsWithCode.map(it => `• ${it.code}${it.description ? ' — ' + it.description : ''}`).join('\n')
      const confirmed = await showConfirm(
        `Al guardar con estado "${form.status}", se descontarán automáticamente del inventario:\n\n${list}\n\n¿Continuar?`
      )
      if (!confirmed) return
    }

    setSaving(true)
    try {
      const payload = buildPayload()
      if (isNew) {
        const r = await createInvoice(payload)
        setInvoices((prev) => [r.data, ...prev])
        setSelected(r.data)
        toast.success('Factura creada')
      } else {
        const r = await updateInvoice(selected.id, payload)
        setSelected(r.data)
        setInvoices((prev) => prev.map((inv) => inv.id === r.data.id ? r.data : inv))
        toast.success('Factura actualizada')
      }
      setIsDirty(false)
      setEditing(false)
      setIsNew(false)
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail
        : typeof detail === 'object' && detail !== null ? JSON.stringify(detail)
        : err?.message || 'Error guardando factura'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleClone = async () => {
    if (!selected) return
    try {
      const r = await cloneInvoice(selected.id)
      toast.success(`Factura clonada como ${r.data.invoice_number}`)
      const ir = await getInvoices({})
      setInvoices(ir.data)
      setSelected(r.data)
    } catch {
      toast.error('Error al clonar la factura')
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    if (!await showConfirm(`¿Eliminar la factura ${selected.invoice_number || `#${selected.id}`}?`)) return
    try {
      await deleteInvoice(selected.id)
      setInvoices((prev) => prev.filter((inv) => inv.id !== selected.id))
      setSelected(null)
      setMobileDetailOpen(false)
      navigate('/facturas', { replace: true })
      toast.success('Factura eliminada')
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const handleStatusChange = async (newStatus) => {
    if (!selected) return
    if (newStatus === 'Emitida' && selected.status === 'Borrador' && !selected.inventory_applied) {
      try {
        const check = await checkInvoiceInventory(selected.id)
        if (!check.data.ok && check.data.warnings.length > 0) {
          const lines = check.data.warnings.map(w =>
            `• ${w.code} – ${w.name}: solicitado ${w.requested}, disponible ${w.available}`
          ).join('\n')
          const proceed = await showConfirm(
            `⚠️ Stock insuficiente para algunos artículos:\n\n${lines}\n\n¿Desea emitir la factura de todas formas?`
          )
          if (!proceed) return
        }
      } catch { /* si falla el check, continuar */ }
    }
    try {
      const r = await updateInvoice(selected.id, { status: newStatus })
      setSelected(r.data)
      setInvoices((prev) => prev.map((inv) => inv.id === r.data.id ? r.data : inv))
    } catch {
      toast.error('Error actualizando estado')
    }
  }

  const handlePaymentAdded = async () => {
    if (!selected) return
    try {
      const r = await getInvoice(selected.id)
      setSelected(r.data)
      setInvoices((prev) => prev.map((inv) => inv.id === r.data.id ? r.data : inv))
    } catch { /* silent */ }
  }

  const handlePrint = (autoprint = true) => {
    if (!selected) return
    const its = parseItems(selected.items)
    const html = buildInvoiceHTML(selected, its, window.location.origin)
    const ok = openPdfWindow(`Factura ${selected.invoice_number || selected.id}`, html, { autoprint })
    if (!ok) toast.error('El navegador bloqueó la ventana emergente')
  }

  const handleShare = async () => {
    if (!selected) return
    const its = parseItems(selected.items)
    const html = buildInvoiceHTML(selected, its, window.location.origin)
    const filename = `Factura-${selected.invoice_number || selected.id}.pdf`
    await sharePdfFromHtml(`Factura ${selected.invoice_number || selected.id}`, html, filename)
  }

  const openEmailModal = () => {
    setEmailTo(selected?.client_email || '')
    setEmailMsg('')
    setEmailOpen(true)
  }

  const handleSendEmail = async (e) => {
    e.preventDefault()
    if (!emailTo.trim()) return toast.error('Ingresa el correo del destinatario')
    setEmailSending(true)
    try {
      await sendInvoiceEmail(selected.id, { to: emailTo.trim(), message: emailMsg.trim() || undefined })
      toast.success('Factura enviada por correo')
      setEmailOpen(false)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al enviar el correo')
    } finally {
      setEmailSending(false)
    }
  }

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* New contact modal */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 flex-shrink-0">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><UserPlus size={16} className="text-blue-600" />Nuevo contacto</h3>
              <button onClick={() => setShowContactModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <form onSubmit={handleCreateContact} className="p-5 space-y-3 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="label">Nombre *</label>
                  <input className="input" value={contactForm.name} onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nombre completo" required autoFocus style={{fontSize:'16px'}} />
                </div>
                <div className="relative">
                  <label className="label">Empresa</label>
                  <input className="input" value={contactForm.company}
                    onChange={(e) => {
                      const v = e.target.value
                      setContactForm((f) => ({ ...f, company: v }))
                      setCompanyDrop(v.trim() ? companies.filter((c) => c.name.toLowerCase().includes(v.toLowerCase())) : [])
                    }}
                    onBlur={() => setTimeout(() => setCompanyDrop([]), 150)}
                    placeholder="Nombre de la empresa" style={{fontSize:'16px'}} autoComplete="off" />
                  {companyDrop.length > 0 && (
                    <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {companyDrop.map((c) => (
                        <li key={c.id} onMouseDown={() => {
                          setContactForm((f) => ({ ...f, company: c.name, ruc: c.ruc || f.ruc, address: c.address || f.address, phone: c.phone || f.phone, email: c.email || f.email }))
                          setCompanyDrop([])
                        }} className="px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm">
                          <span className="font-medium">{c.name}</span>
                          {c.ruc && <span className="text-gray-400 ml-2 text-xs">RUC: {c.ruc}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <label className="label">RUC</label>
                  <input className="input" value={contactForm.ruc} onChange={(e) => setContactForm((f) => ({ ...f, ruc: e.target.value }))} placeholder="Ej: 8-123-456 DV 12" style={{fontSize:'16px'}} />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input className="input" type="email" value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} placeholder="correo@cliente.com" style={{fontSize:'16px'}} />
                </div>
                <div>
                  <label className="label">Teléfono</label>
                  <input className="input" value={contactForm.phone} onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+507 0000-0000" style={{fontSize:'16px'}} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Dirección</label>
                  <input className="input" value={contactForm.address} onChange={(e) => setContactForm((f) => ({ ...f, address: e.target.value }))} placeholder="Dirección física" style={{fontSize:'16px'}} />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setShowContactModal(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={savingContact || !contactForm.name.trim()} className="btn-primary flex items-center gap-2">
                  <UserPlus size={14} />{savingContact ? 'Guardando...' : 'Crear contacto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Email modal */}
      {emailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Mail size={16} className="text-blue-600" />Enviar factura por correo</h3>
              <button onClick={() => setEmailOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <form onSubmit={handleSendEmail} className="p-4 space-y-4">
              {!selected?.client_email && (
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <AlertCircle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">Este cliente no tiene correo registrado. Ingresa la dirección manualmente.</p>
                </div>
              )}
              <div>
                <label className="label">Destinatario *</label>
                <input
                  type="email"
                  className="input"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="correo@cliente.com"
                  required
                  autoFocus={!selected?.client_email}
                  style={{fontSize:'16px'}}
                />
              </div>
              <div>
                <label className="label">Mensaje opcional</label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  value={emailMsg}
                  onChange={(e) => setEmailMsg(e.target.value)}
                  placeholder="Estimado cliente, adjunto encontrará su factura..."
                  style={{fontSize:'16px'}}
                />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setEmailOpen(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={emailSending} className="btn-primary flex items-center gap-2">
                  <Send size={14} />{emailSending ? 'Enviando...' : 'Enviar factura'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* List */}
      <div className={`${mobileDetailOpen ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 flex-shrink-0 border-r border-gray-200 flex-col bg-white`}>
        <div className="p-4 border-b border-gray-200 space-y-2.5">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">Facturas</h1>
            <button onClick={() => openNew()} className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3">
              <Plus size={14} /> Nueva
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-8 text-sm" placeholder="Buscar factura, cliente, RUC..." value={search} onChange={(e) => setSearch(e.target.value)} style={{fontSize:'16px'}} />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={13} /></button>}
          </div>
          <select
            className="input text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{fontSize:'16px'}}
          >
            <option value="">Todos los estados</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <p className="text-xs text-gray-400">{invoices.length} factura{invoices.length !== 1 ? 's' : ''}</p>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {loading ? (
            <div className="text-center py-16 px-4">
              <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <Receipt size={20} className="text-rose-200" />
              </div>
              <p className="text-sm text-gray-300">Cargando...</p>
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-16 px-4 space-y-3">
              <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mx-auto">
                <Receipt size={20} className="text-rose-200" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-400">{search ? 'Sin resultados' : 'No hay facturas aún'}</p>
                {!search && <p className="text-xs text-gray-300 mt-1">Usa "Nueva" para crear tu primera factura</p>}
              </div>
            </div>
          ) : invoices.map((inv) => {
            const invTotal = parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '') || '0')
            const paidAmt = (inv.payments || []).reduce((s, p) => s + parseFloat(String(p.amount || '0').replace(/[^\d.]/g, '') || '0'), 0)
            const isPartial = inv.status === 'Emitida' && paidAmt > 0 && paidAmt < invTotal
            return (
              <button
                key={inv.id}
                onClick={() => { setSelected(inv); setEditing(false); setMobileDetailOpen(true); navigate(`/facturas/${inv.invoice_number || inv.id}`) }}
                className={`w-full flex items-start gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left ${selected?.id === inv.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="mb-0.5">
                    <span className="text-xs font-mono text-gray-400">{inv.invoice_number || `FAC-${inv.id}`}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900 truncate">{inv.client_name || '—'}</p>
                  {inv.client_ruc && <p className="text-xs text-gray-400 truncate">RUC: {inv.client_ruc}</p>}
                  {inv.total && (
                    <div className="mt-0.5">
                      <p className="text-xs font-semibold text-gray-700">${fmtMoney(inv.total)}</p>
                      {isPartial && (
                        <p className="text-xs text-green-600 font-medium">${fmtMoney(paidAmt)} abonado</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 flex flex-col items-end gap-1">
                  {inv.date && <span className="text-xs text-gray-300">{fmtD(inv.date)}</span>}
                  <StatusBadge status={inv.status} />
                  {isPartial && (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                      <AlertCircle size={10} /> Parcial
                    </span>
                  )}
                  {!inv.dgi_filename && inv.status !== 'Borrador' && inv.status !== 'Anulada' && (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-600">
                      <Paperclip size={10} /> Sin DGI
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Detail / Edit */}
      <div className={`${mobileDetailOpen ? 'flex' : 'hidden sm:flex'} flex-1 flex-col overflow-y-auto overscroll-contain min-h-0 bg-gray-50`} {...(editing ? {} : detailSwipe)}>
        {editing ? (
          <form onSubmit={handleSave} className="p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-5">
            <button type="button" onClick={cancelEdit} className="sm:hidden flex items-center gap-2 text-sm text-gray-500 -mb-2">
              <ArrowLeft size={16} /> Volver
            </button>

            {/* Header */}
            <div className="card space-y-4">
              <h2 className="font-bold text-gray-900">{isNew ? 'Nueva factura' : 'Editar factura'}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">N° Factura</label>
                  <input className="input font-mono" value={form.invoice_number} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, invoice_number: e.target.value })) }} placeholder="FAC-0001" style={{fontSize:'16px'}} />
                </div>
                <div>
                  <label className="label">Fecha de emisión</label>
                  <input type="date" className="input" value={form.date} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, date: e.target.value })) }} style={{fontSize:'16px'}} />
                </div>
                <div>
                  <label className="label">Fecha de vencimiento</label>
                  <input type="date" className="input" value={form.due_date} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, due_date: e.target.value })) }} style={{fontSize:'16px'}} />
                </div>
                <div>
                  <label className="label">Estado</label>
                  <select className="input" value={form.status} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, status: e.target.value })) }} style={{fontSize:'16px'}}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Términos de pago</label>
                  <select className="input" value={form.payment_terms} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, payment_terms: e.target.value })) }} style={{fontSize:'16px'}}>
                    <option value="">— Sin especificar —</option>
                    {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="relative">
                  <label className="label">Cotización vinculada</label>
                  <input
                    className="input"
                    value={quoteQuery}
                    onChange={(e) => { setQuoteQuery(e.target.value); setQuoteDropOpen(true); if (!e.target.value) { setForm((f) => ({ ...f, quote_id: null })); setIsDirty(true) } }}
                    onFocus={() => { if (quoteQuery) setQuoteDropOpen(true) }}
                    onBlur={() => setTimeout(() => setQuoteDropOpen(false), 150)}
                    placeholder="Buscar cotización..."
                    style={{fontSize:'16px'}}
                    autoComplete="off"
                  />
                  {form.quote_id && (
                    <button type="button" onClick={() => { setQuoteQuery(''); setForm((f) => ({ ...f, quote_id: null })); setIsDirty(true) }}
                      className="absolute right-2 top-7 text-gray-400 hover:text-gray-600">×</button>
                  )}
                  {quoteDropOpen && quoteResults.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {quoteResults.map((q) => (
                        <button key={q.id} type="button"
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm flex items-center gap-2"
                          onClick={() => {
                            setForm((f) => ({ ...f, quote_id: q.id }))
                            setQuoteQuery(q.quote_number || `COT-${q.id}`)
                            setQuoteDropOpen(false)
                            setIsDirty(true)
                          }}>
                          <span className="font-mono text-blue-700 text-xs">{q.quote_number || `COT-${q.id}`}</span>
                          {q.client_name && <span className="text-gray-500 truncate">{q.client_name}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <label className="label">Ticket vinculado</label>
                  <input
                    className="input"
                    value={ticketQuery}
                    onChange={(e) => { setTicketQuery(e.target.value); setTicketDropOpen(true); if (!e.target.value) { setForm((f) => ({ ...f, ticket_id: null })); setIsDirty(true) } }}
                    onFocus={() => { if (ticketQuery) setTicketDropOpen(true) }}
                    onBlur={() => setTimeout(() => setTicketDropOpen(false), 150)}
                    placeholder="Buscar ticket..."
                    style={{fontSize:'16px'}}
                    autoComplete="off"
                  />
                  {form.ticket_id && (
                    <button type="button" onClick={() => { setTicketQuery(''); setForm((f) => ({ ...f, ticket_id: null })); setIsDirty(true) }}
                      className="absolute right-2 top-7 text-gray-400 hover:text-gray-600">×</button>
                  )}
                  {ticketDropOpen && ticketResults.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {ticketResults.map((t) => (
                        <button key={t.id} type="button"
                          className="w-full text-left px-3 py-2 hover:bg-violet-50 text-sm flex items-center gap-2"
                          onClick={() => {
                            setForm((f) => ({ ...f, ticket_id: t.id }))
                            setTicketQuery(`#${t.id} · ${t.title}`)
                            setTicketDropOpen(false)
                            setIsDirty(true)
                          }}>
                          <Tag size={11} className="text-violet-500 flex-shrink-0" />
                          <span className="font-mono text-violet-700 text-xs flex-shrink-0">#{t.id}</span>
                          <span className="text-gray-700 truncate">{t.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Client */}
            <div className="card space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><User size={14} className="text-gray-400" />Facturar a</h3>
                <button type="button" onClick={() => { setContactForm({ name: clientQuery, company: '', ruc: '', email: '', phone: '', address: '' }); setShowContactModal(true) }}
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium">
                  <UserPlus size={13} /> Nuevo contacto
                </button>
              </div>

              {/* Vínculo opcional a la cuenta de portal del cliente */}
              <div>
                <label className="label">Cliente del portal (opcional)</label>
                <select className="input" style={{fontSize:'16px'}} value={form.client_id || ''} onChange={(e) => handleSelectPortalClient(e.target.value)}>
                  <option value="">— Sin vincular a una cuenta de cliente —</option>
                  {portalClients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">Vincula esta factura a la cuenta del cliente para que la vea en su portal, sin depender de que el nombre coincida exactamente.</p>
              </div>

              <ClientAutocomplete
                field="name"
                label="Nombre / Empresa *"
                value={clientQuery}
                onChange={(v) => { setIsDirty(true); setClientQuery(v); setForm((f) => ({ ...f, client_name: v })) }}
                onSelect={handleSelectClient}
                contacts={contacts}
                companies={companies}
                placeholder="Buscar en contactos o escribir nombre..."
                required
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ClientAutocomplete field="ruc" label="RUC" value={form.client_ruc} onChange={(v) => { setIsDirty(true); setForm((f) => ({ ...f, client_ruc: v })) }} onSelect={handleSelectClient} contacts={contacts} companies={companies} placeholder="RUC" />
                <ClientAutocomplete field="phone" label="Teléfono" value={form.client_phone} onChange={(v) => { setIsDirty(true); setForm((f) => ({ ...f, client_phone: v })) }} onSelect={handleSelectClient} contacts={contacts} companies={companies} placeholder="+507 0000-0000" />
                <ClientAutocomplete field="email" label="Email" type="email" value={form.client_email} onChange={(v) => { setIsDirty(true); setForm((f) => ({ ...f, client_email: v })) }} onSelect={handleSelectClient} contacts={contacts} companies={companies} placeholder="correo@cliente.com" />
                <ClientAutocomplete field="address" label="Dirección" value={form.client_address} onChange={(v) => { setIsDirty(true); setForm((f) => ({ ...f, client_address: v })) }} onSelect={handleSelectClient} contacts={contacts} companies={companies} placeholder="Dirección" />
              </div>
            </div>

            {/* Items */}
            <div className="card">
              <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2"><FileText size={14} className="text-gray-400" />Detalle de servicios / productos</h3>
              <ItemEditor
                items={items}
                onChange={handleItemChange}
                onRemove={removeItem}
                onAdd={addItem}
                itbms={form.itbms_enabled}
                onItbmsChange={v => { setIsDirty(true); setForm(f => ({ ...f, itbms_enabled: v })) }}
              />
              <div className="mt-3 flex justify-end">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <label className="whitespace-nowrap">Costo de entrega $</label>
                  <input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    className="input w-28 text-right text-sm"
                    placeholder="0.00"
                    value={form.shipping_cost}
                    onChange={e => { setIsDirty(true); setForm(f => ({ ...f, shipping_cost: e.target.value })) }}
                    style={{fontSize:'16px'}}
                  />
                </div>
              </div>
            </div>

            <div className="card">
              <label className="label">Notas</label>
              <textarea className="input resize-none" rows={3} value={form.notes} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, notes: e.target.value })) }} placeholder="Condiciones de pago, observaciones..." style={{fontSize:'16px'}} />
            </div>

            <div className="flex items-center justify-between pb-4">
              <button type="button" onClick={cancelEdit} className="btn-secondary">Cancelar</button>
              <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
                <Save size={14} />
                {saving ? 'Guardando...' : isNew ? 'Crear factura' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        ) : selected ? (
          <>
            <button onClick={() => { setMobileDetailOpen(false); navigate(-1) }} className="sm:hidden flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 p-4 pb-0">
              <ArrowLeft size={16} /> Volver
            </button>
            <InvoiceDetail
              key={selected.id}
              inv={selected}
              onEdit={() => openEdit(selected)}
              onDelete={handleDelete}
              onClone={handleClone}
              onStatusChange={handleStatusChange}
              onPrint={(autoprint) => handlePrint(autoprint)}
              onSendEmail={openEmailModal}
              onShare={handleShare}
              onPaymentAdded={handlePaymentAdded}
              onInventoryApplied={async () => {
                const r = await getInvoice(selected.id)
                setSelected(r.data)
                setInvoices(prev => prev.map(inv => inv.id === r.data.id ? r.data : inv))
              }}
            />
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <Receipt size={48} className="mb-3 opacity-30" />
            <p className="text-sm">Selecciona una factura o crea una nueva</p>
            <p className="text-xs mt-1">También puedes crear facturas desde el módulo de Despacho</p>
          </div>
        )}
      </div>
    </div>
  )
}
