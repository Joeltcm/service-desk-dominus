import { showConfirm } from '../utils/confirm'
import { companyLogoSrc } from '../utils/branding'
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import ItemEditor from '../components/ItemEditor'
import { openPdfWindow, sharePdfFromHtml } from '../utils/pdfViewer'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import ClientAutocomplete from '../components/ClientAutocomplete'
import { useNavigate, useSearchParams, useLocation, useParams } from 'react-router-dom'
import { useFormGuard } from '../context/UnsavedChangesContext'
import {
  getQuotes, createQuote, updateQuote, deleteQuote,
  convertQuoteToOrder, convertQuoteToInvoice, cloneQuote, getQuoteItemSuggestions, getNextQuoteNumber,
  sendQuoteEmail, getContacts, getCompanies, createContact, getQuoteInvoices,
  getInvoices, addInvoiceQuoteLink, removeInvoiceQuoteLink, getClients, createTicketFromQuote,
} from '../services/api'
import {
  Search, Plus, Pencil, Trash2, ArrowLeft, X, Save,
  FileText, User, Hash, MapPin, Mail, Phone, Calendar,
  CheckCircle2, Clock, XCircle, Send, RefreshCw, AlertCircle,
  ShoppingCart, Printer, Download, ChevronDown, PackageCheck, UserPlus, Receipt, Copy, ClipboardList, Share2, Ticket,
} from 'lucide-react'
import { fmtD } from '../utils/fmt'
import toast from 'react-hot-toast'
import { getCompanyCache } from '../context/CompanyContext'

// ── Constants ──────────────────────────────────────────
const STATUSES = ['Borrador', 'Enviada', 'Aprobada', 'Rechazada', 'Vencida', 'En Pedido', 'Facturada']

const STATUS_STYLE = {
  'Borrador':   'bg-gray-100 text-gray-600',
  'Enviada':    'bg-blue-100 text-blue-700',
  'Aprobada':   'bg-green-100 text-green-700',
  'Rechazada':  'bg-red-100 text-red-600',
  'Vencida':    'bg-orange-100 text-orange-700',
  'En Pedido':  'bg-purple-100 text-purple-700',
  'Facturada':  'bg-emerald-100 text-emerald-700',
}

const STATUS_ICON = {
  'Borrador':   <Clock size={11} />,
  'Enviada':    <Send size={11} />,
  'Aprobada':   <CheckCircle2 size={11} />,
  'Rechazada':  <XCircle size={11} />,
  'Vencida':    <AlertCircle size={11} />,
  'En Pedido':  <PackageCheck size={11} />,
  'Facturada':  <Receipt size={11} />,
}

const COMMON_ITEMS = [
  'Servicio técnico', 'Instalación de red', 'Mantenimiento preventivo',
  'Soporte remoto', 'Configuración de equipo', 'Instalación de software',
  'Laptop', 'Monitor', 'Teclado', 'Mouse', 'Impresora', 'Escáner',
  'Tóner', 'Cartucho de tinta', 'Papel bond A4',
  'Disco duro SSD', 'Memoria RAM', 'Fuente de poder', 'UPS',
  'Router', 'Switch', 'Cable UTP', 'Patch cord', 'Patch panel',
  'Cámara IP', 'NVR / DVR', 'Licencia Microsoft 365',
  'Antivirus', 'Backup en la nube',
]

const EMPTY_ITEM = { code: '', description: '', qty: 1, unit_price: '', itbms: true }

const PAYMENT_TERMS = ['Contado', 'Crédito 15 días', 'Crédito 30 días', 'Crédito 45 días', 'Crédito 60 días', 'Crédito 90 días']

const EMPTY_FORM = {
  title: '',
  quote_number: '',
  status: 'Borrador',
  client_name: '',
  client_ruc: '',
  client_address: '',
  client_email: '',
  client_phone: '',
  client_id: null,
  date: '',
  valid_until: '',
  itbms_enabled: false,
  shipping_cost: '',
  payment_terms: '',
  notes: '',
  ticket_id: null,
}

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


export function buildQuoteHTML(q, items, origin) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const qShippingCost = parseFloat(String(q.shipping_cost || '0').replace(/[^\d.]/g, '') || '0') || 0
  const { subtotal, itbmsAmt, total } = calcTotals(items, q.itbms_enabled, qShippingCost)
  const fmtDate = (iso) => fmtD(iso)
  const co = getCompanyCache()
  const coName    = esc(co.company_name    || 'Service Desk')
  const coAddress = esc(co.company_address || 'Panamá, Punta Pacífica, PH Pacific Wind')
  const coRuc     = esc(co.company_ruc     || '4-754-575 DV 85')

  const visibleItems = items.filter((it) => it.description?.trim())
  const hasMixed = q.itbms_enabled && visibleItems.some((it) => it.itbms === false)
  const rows = visibleItems.map((it, i) => {
    const line = (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0)
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
        <div style="font-size:15pt;font-weight:bold;color:#1e3a5f">COTIZACIÓN</div>
        <div style="font-size:10pt;color:#444;margin-top:4px;font-family:monospace">N° ${esc(q.quote_number || String(q.id))}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      <div style="padding:8px 12px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px">
        <div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:3px">Cliente</div>
        <div style="font-size:10pt;font-weight:600;color:#111">${esc(q.client_name)}</div>
        ${q.client_ruc ? `<div style="font-size:8.5pt;color:#555">RUC: ${esc(q.client_ruc)}</div>` : ''}
        ${q.client_address ? `<div style="font-size:8.5pt;color:#555">${esc(q.client_address)}</div>` : ''}
        ${q.client_email ? `<div style="font-size:8.5pt;color:#555">${esc(q.client_email)}</div>` : ''}
      </div>
      <div style="padding:8px 12px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <div><div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase">Fecha</div><div style="font-size:9pt;font-weight:600">${fmtDate(q.date)}</div></div>
          ${q.valid_until ? `<div><div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase">Válida hasta</div><div style="font-size:9pt;font-weight:600">${fmtDate(q.valid_until)}</div></div>` : ''}
        </div>
        ${q.payment_terms ? `<div style="margin-top:4px"><div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase">Términos de pago</div><div style="font-size:9pt;font-weight:600">${esc(q.payment_terms)}</div></div>` : ''}
      </div>
    </div>

    <div style="font-size:13pt;font-weight:bold;color:#1e3a5f;margin-bottom:8px">${esc(q.title)}</div>

    <table style="width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:16px">
      <thead>
        <tr style="background:#1e3a5f;color:#fff">
          <th style="padding:7px 10px;text-align:left;font-size:8.5pt;border:1px solid #2d4d7a">#</th>
          <th style="padding:7px 10px;text-align:left;font-size:8.5pt;border:1px solid #2d4d7a">Descripción</th>
          <th style="padding:7px 10px;text-align:center;font-size:8.5pt;border:1px solid #2d4d7a">Cant.</th>
          <th style="padding:7px 10px;text-align:right;font-size:8.5pt;border:1px solid #2d4d7a;white-space:nowrap">Precio unit.</th>
          <th style="padding:7px 10px;text-align:right;font-size:8.5pt;border:1px solid #2d4d7a">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div style="display:flex;justify-content:flex-end">
      <div style="min-width:220px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
        <div style="display:flex;justify-content:space-between;padding:6px 12px;background:#f8f9fb;font-size:9.5pt">
          <span style="color:#555">Subtotal</span><span style="font-weight:600">$${fmtMoney(subtotal)}</span>
        </div>
        ${q.itbms_enabled ? `<div style="display:flex;justify-content:space-between;padding:6px 12px;background:#fffbeb;font-size:9.5pt">
          <span style="color:#b45309">ITBMS 7%</span><span style="font-weight:600;color:#b45309">$${fmtMoney(itbmsAmt)}</span>
        </div>` : ''}
        ${qShippingCost > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 12px;font-size:9.5pt">
          <span style="color:#555">Costo de entrega</span><span style="font-weight:600">$${fmtMoney(qShippingCost)}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#1e3a5f;font-size:10.5pt">
          <span style="color:#fff;font-weight:bold">TOTAL</span><span style="color:#fff;font-weight:bold">$${fmtMoney(total)}</span>
        </div>
      </div>
    </div>

    ${q.notes ? `<div style="margin-top:16px;padding:10px 14px;background:#f8f9fb;border:1px solid #ddd;border-radius:6px">
      <div style="font-size:9.5pt;font-weight:bold;color:#444;margin-bottom:4px">NOTAS:</div>
      <div style="font-size:9pt;white-space:pre-wrap">${esc(q.notes)}</div>
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
      Esta cotización es válida por los días indicados desde la fecha de emisión · ${coName} · RUC: ${coRuc}
    </div>
  </div>`
}

// ── Sub-components ─────────────────────────────────────
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
        <div className="absolute top-full left-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-30 py-1 min-w-[190px]">
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


// ── QuoteDetail (read-only) ────────────────────────────
function QuoteDetail({ q, onEdit, onDelete, onStatusChange, onConvert, onConvertToInvoice, onCreateTicket, onUnlinkTicket, onClone, onPrint, onSendEmail, onShare, converting, convertingInvoice, creatingTicket, unlinkingTicket }) {
  const navigate = useNavigate()
  const [changingStatus, setChangingStatus] = useState(false)
  const [linkedInvoices, setLinkedInvoices] = useState([])
  const [invSearch, setInvSearch] = useState('')
  const [invResults, setInvResults] = useState([])
  const [invDropOpen, setInvDropOpen] = useState(false)
  const [invLinkLoading, setInvLinkLoading] = useState(false)
  const items = parseItems(q.items)
  const shippingCost = parseFloat(q.shipping_cost || '0') || 0
  const { subtotal, itbmsAmt, total } = calcTotals(items, q.itbms_enabled, shippingCost)
  const canConvert = !['Cancelada', 'Rechazada', 'Facturada'].includes(q.status)

  useEffect(() => {
    getQuoteInvoices(q.id).then((r) => setLinkedInvoices(r.data)).catch(() => {})
  }, [q.id])

  useEffect(() => {
    if (!invSearch.trim()) { setInvResults([]); return }
    const t = setTimeout(() => {
      getInvoices({ search: invSearch, limit: 8 }).then((r) => setInvResults(r.data)).catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [invSearch])

  const handleAddInvLink = async (inv) => {
    if (linkedInvoices.some((li) => li.id === inv.id)) { setInvDropOpen(false); setInvSearch(''); return }
    setInvLinkLoading(true)
    try {
      await addInvoiceQuoteLink(inv.id, q.id)
      const r = await getQuoteInvoices(q.id)
      setLinkedInvoices(r.data)
      toast.success('Factura vinculada')
    } catch { toast.error('Error al vincular') }
    finally { setInvLinkLoading(false); setInvSearch(''); setInvDropOpen(false) }
  }

  const handleRemoveInvLink = async (invoiceId) => {
    setInvLinkLoading(true)
    try {
      await removeInvoiceQuoteLink(invoiceId, q.id)
      const r = await getQuoteInvoices(q.id)
      setLinkedInvoices(r.data)
      toast.success('Vínculo eliminado')
    } catch { toast.error('Error al desvincular') }
    finally { setInvLinkLoading(false) }
  }

  const handleStatus = async (val) => {
    setChangingStatus(true)
    await onStatusChange(val)
    setChangingStatus(false)
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4 w-full">
      {/* Header */}
      <div className="card">
        {/* Número prominente + info — ancho completo */}
        <div>
          <p className="text-lg font-bold font-mono text-gray-700 mb-0.5 tracking-wide">{q.quote_number || `COT-${q.id}`}</p>
          <h2 className="text-xl font-bold text-gray-900 leading-snug">{q.title}</h2>
          <div className="flex flex-wrap gap-2 mt-2 items-center">
            {q.date && <span className="text-xs text-gray-400 flex items-center gap-1"><Calendar size={11} />{fmtD(q.date)}</span>}
            {q.valid_until && <span className="text-xs text-gray-400 flex items-center gap-1"><Clock size={11} />Válida hasta {fmtD(q.valid_until)}</span>}
            <StatusSelector status={q.status} onChange={handleStatus} loading={changingStatus} />
            {q.payment_terms && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${q.payment_terms === 'Contado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {q.payment_terms}
              </span>
            )}
          </div>
        </div>
        {/* Acciones — fila propia debajo de la info */}
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
          <button onClick={onSendEmail} title="Enviar por correo" className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors">
            <Mail size={13} /> <span className="hidden sm:inline">Enviar</span>
          </button>
          <button onClick={() => onPrint(true)} title={q.status === 'Facturada' ? 'Imprimir cotización (no la factura)' : 'Imprimir'} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-900 active:bg-black transition-colors">
            <Printer size={13} /> <span className="hidden sm:inline">Imprimir{q.status === 'Facturada' ? ' cot.' : ''}</span>
          </button>
          <button onClick={() => onPrint(false)} title={q.status === 'Facturada' ? 'PDF cotización (no la factura)' : 'Guardar PDF'} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 active:bg-green-800 transition-colors">
            <Download size={13} /> <span className="hidden sm:inline">PDF{q.status === 'Facturada' ? ' cot.' : ''}</span>
          </button>
          <button onClick={onShare} title="Compartir PDF" className="flex items-center gap-1.5 px-3 py-2 text-sm bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 active:bg-cyan-800 transition-colors">
            <Share2 size={13} /> <span className="hidden sm:inline">Compartir</span>
          </button>
          <button onClick={onEdit} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Pencil size={13} /> <span className="hidden sm:inline">Editar</span>
          </button>
          <button onClick={onClone} title="Clonar cotización" className="flex items-center gap-1.5 px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-200 transition-colors">
            <Copy size={13} />
          </button>
          <button onClick={onDelete} className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>

        {/* Convert actions */}
        {canConvert && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
            <button
              onClick={onConvert}
              disabled={converting || convertingInvoice}
              className="btn-primary flex items-center gap-2 text-sm py-2 px-4"
            >
              <ShoppingCart size={14} />
              {converting ? 'Convirtiendo...' : 'Convertir en Pedido'}
            </button>
            <button
              onClick={onConvertToInvoice}
              disabled={converting || convertingInvoice}
              className="flex items-center gap-2 text-sm py-2 px-4 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              <Receipt size={14} />
              {convertingInvoice ? 'Creando factura...' : 'Convertir en Factura'}
            </button>
            {!q.ticket_id && (
              <button
                onClick={onCreateTicket}
                disabled={converting || convertingInvoice || creatingTicket || !q.client_id}
                title={!q.client_id ? 'Vincula primero un cliente del portal (arriba en "Datos del cliente") para poder crear el ticket' : ''}
                className="flex items-center gap-2 text-sm py-2 px-4 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Ticket size={14} />
                {creatingTicket ? 'Creando ticket...' : 'Crear ticket'}
              </button>
            )}
          </div>
        )}
        {q.ticket_id && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
            <Ticket size={14} className="text-violet-500" />
            <span className="text-sm text-gray-600">Ticket vinculado —</span>
            <button onClick={() => navigate(`/tickets/${q.ticket_id}`)} className="text-sm text-violet-600 hover:underline font-medium">
              Ver Ticket #{q.ticket_id} →
            </button>
            <button
              onClick={onUnlinkTicket}
              disabled={unlinkingTicket}
              title="Desvincular ticket (el ticket no se elimina, solo se quita el vínculo con esta cotización)"
              className="ml-1 text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 disabled:opacity-50"
            >
              <X size={13} />
            </button>
          </div>
        )}
        {q.status === 'En Pedido' && q.order_id && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
            <PackageCheck size={14} className="text-purple-500" />
            <span className="text-sm text-gray-600">Convertida a pedido —</span>
            <button onClick={() => navigate('/orders', { state: { selectOrderId: q.order_id } })} className="text-sm text-purple-600 hover:underline font-medium">
              Ver Pedido →
            </button>
          </div>
        )}
        {q.status === 'Facturada' && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
            <Receipt size={14} className="text-emerald-500" />
            <span className="text-sm text-gray-600">Convertida en factura directa</span>
          </div>
        )}
      </div>

      {/* Client */}
      {(q.client_name || q.client_ruc) && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><User size={14} className="text-gray-400" />Cliente</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InfoRow icon={User} label="Nombre" value={q.client_name} />
            <InfoRow icon={Hash} label="RUC" value={q.client_ruc} />
            <InfoRow icon={Mail} label="Email" value={q.client_email} />
            <InfoRow icon={Phone} label="Teléfono" value={q.client_phone} />
            <InfoRow icon={MapPin} label="Dirección" value={q.client_address} />
          </div>
        </div>
      )}

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

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="min-w-48 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-medium text-gray-900">${fmtMoney(subtotal)}</span>
            </div>
            {q.itbms_enabled && (
              <div className="flex justify-between text-sm">
                <span className="text-amber-600">ITBMS 7%</span>
                <span className="font-medium text-amber-600">${fmtMoney(itbmsAmt)}</span>
              </div>
            )}
            {shippingCost > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Costo de entrega</span>
                <span className="font-medium text-gray-700">${fmtMoney(shippingCost)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-1 mt-1">
              <span className="text-gray-900">TOTAL</span>
              <span className="text-gray-900">${fmtMoney(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {q.notes && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Notas</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{q.notes}</p>
        </div>
      )}

      {/* Facturas vinculadas */}
      <div className="card space-y-2">
        <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
          <Receipt size={14} className="text-rose-400" />
          Facturas vinculadas
        </h3>
        {linkedInvoices.map((inv) => (
          <div key={inv.id} className="flex items-center gap-2">
            <button
              onClick={() => navigate('/facturas', { state: { selectInvoiceId: inv.id } })}
              className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <Receipt size={12} className="text-rose-400 flex-shrink-0" />
              <span className="text-sm font-mono text-rose-700 font-medium">{inv.invoice_number || `FAC-${inv.id}`}</span>
              {inv.client_name && <span className="text-xs text-gray-500 truncate">{inv.client_name}</span>}
              {inv.total && <span className="text-xs font-semibold text-gray-700 ml-auto">${inv.total}</span>}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                inv.status === 'Pagada' ? 'bg-green-100 text-green-700' :
                inv.status === 'Emitida' ? 'bg-blue-100 text-blue-700' :
                inv.status === 'Vencida' ? 'bg-orange-100 text-orange-700' :
                'bg-gray-100 text-gray-600'
              }`}>{inv.status}</span>
            </button>
            <button
              onClick={() => navigate('/facturas', { state: { selectInvoiceId: inv.id } })}
              title="Ver e imprimir PDF de la factura"
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg border border-rose-200 transition-colors flex-shrink-0"
            >
              <Download size={11} /> <span className="hidden sm:inline">PDF factura</span>
            </button>
            <button onClick={() => handleRemoveInvLink(inv.id)} disabled={invLinkLoading} className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0">
              <X size={13} />
            </button>
          </div>
        ))}
        <div className="relative">
          <input
            value={invSearch}
            onChange={(e) => { setInvSearch(e.target.value); setInvDropOpen(true) }}
            onFocus={() => setInvDropOpen(true)}
            onBlur={() => setTimeout(() => setInvDropOpen(false), 150)}
            placeholder="Vincular factura..."
            className="text-xs border border-dashed border-gray-300 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-rose-400 placeholder-gray-400"
            disabled={invLinkLoading}
          />
          {invDropOpen && invResults.length > 0 && (
            <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
              {invResults.map((inv) => (
                <button
                  key={inv.id}
                  onMouseDown={() => handleAddInvLink(inv)}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-rose-50 transition-colors"
                >
                  <Receipt size={12} className="text-rose-400 flex-shrink-0" />
                  <span className="text-xs font-mono text-rose-700">{inv.invoice_number || `FAC-${inv.id}`}</span>
                  {inv.client_name && <span className="text-xs text-gray-500 truncate">{inv.client_name}</span>}
                  {linkedInvoices.some((li) => li.id === inv.id) && <span className="ml-auto text-xs text-green-600">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

// ── Main component ─────────────────────────────────────
export default function Quotes() {
  const navigate = useNavigate()
  const location = useLocation()
  const { ref: urlRef } = useParams()

  // List state
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const detailSwipe = useTouchSwipe({ onSwipeRight: () => { setMobileDetailOpen(false); navigate(-1) } })

  // Edit state
  const [editing, setEditing] = useState(false)    // true = edit/create mode
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [items, setItems] = useState([{ ...EMPTY_ITEM }])
  const [saving, setSaving] = useState(false)
  const [converting, setConverting] = useState(false)
  const [convertingInvoice, setConvertingInvoice] = useState(false)
  const [creatingTicket, setCreatingTicket] = useState(false)
  const [unlinkingTicket, setUnlinkingTicket] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  useFormGuard(isDirty)

  // Email modal
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailMsg, setEmailMsg] = useState('')
  const [emailSending, setEmailSending] = useState(false)

  // Autocomplete data
  const [contacts, setContacts] = useState([])
  const [companies, setCompanies] = useState([])
  const [portalClients, setPortalClients] = useState([])
  const [itemSuggestions, setItemSuggestions] = useState([])
  const [clientQuery, setClientQuery] = useState('')

  const allSuggestions = useMemo(() => {
    const extra = quotes.flatMap((q) => {
      try { return JSON.parse(q.items || '[]').map((it) => it.description || '') } catch { return [] }
    }).filter(Boolean)
    return Array.from(new Set([...COMMON_ITEMS, ...itemSuggestions, ...extra]))
  }, [itemSuggestions, quotes])


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
    getQuotes(params)
      .then((r) => setQuotes(r.data))
      .catch(() => toast.error('Error cargando cotizaciones'))
      .finally(() => setLoading(false))
  }, [debouncedSearch, statusFilter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    Promise.allSettled([getContacts(), getCompanies(), getQuoteItemSuggestions(), getClients()])
      .then(([cr, comr, sr, clr]) => {
        if (cr.status === 'fulfilled') setContacts(cr.value.data)
        if (comr.status === 'fulfilled') setCompanies(comr.value.data)
        if (sr.status === 'fulfilled') setItemSuggestions(sr.value.data)
        if (clr.status === 'fulfilled') setPortalClients(clr.value.data)
      })
  }, [])

  // Auto-select quote from navigation state (from Facturas)
  useEffect(() => {
    const id = location.state?.selectQuoteId
    if (!id) return
    getQuotes({}).then((r) => {
      setQuotes(r.data)
      const found = r.data.find((q) => q.id === id)
      if (found) { setSelected(found); setMobileDetailOpen(true) }
    })
  }, [location.state?.selectQuoteId])

  // Auto-select from URL param (e.g. /quotes/COT-0007)
  useEffect(() => {
    if (!urlRef) { if (selected) { setSelected(null); setMobileDetailOpen(false) } return }
    if (quotes.length === 0) return
    if (selected?.quote_number === urlRef || String(selected?.id) === urlRef) return
    const found = quotes.find((q) => q.quote_number === urlRef || String(q.id) === urlRef)
    if (found) { setSelected(found); setEditing(false); setMobileDetailOpen(true) }
  }, [urlRef, quotes])

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
    const num = await getNextQuoteNumber().then((r) => r.data.number).catch(() => 'COT-0001')
    setForm({ ...EMPTY_FORM, quote_number: num, date: new Date().toISOString().split('T')[0], ticket_id: ticketId })
    setItems([{ ...EMPTY_ITEM }])
    setClientQuery('')
    setEditing(true)
    setSelected(null)
    setMobileDetailOpen(true)
  }

  const openEdit = (q) => {
    setIsNew(false)
    setForm({
      title: q.title || '',
      quote_number: q.quote_number || '',
      status: q.status || 'Borrador',
      client_name: q.client_name || '',
      client_ruc: q.client_ruc || '',
      client_address: q.client_address || '',
      client_email: q.client_email || '',
      client_phone: q.client_phone || '',
      client_id: q.client_id || null,
      date: q.date || '',
      valid_until: q.valid_until || '',
      itbms_enabled: q.itbms_enabled || false,
      shipping_cost: q.shipping_cost || '',
      payment_terms: q.payment_terms || '',
      notes: q.notes || '',
    })
    setClientQuery(q.client_name || '')
    setItems(parseItems(q.items))
    setEditing(true)
  }

  const cancelEdit = async () => {
    if (isDirty && !await showConfirm('¿Salir sin guardar los cambios?')) return
    setIsDirty(false)
    setEditing(false)
    if (isNew) { setSelected(null); setMobileDetailOpen(false); navigate('/quotes', { replace: true }) }
  }

  const handleFormChange = (field, value) => { setIsDirty(true); setForm((f) => ({ ...f, [field]: value })) }

  const handleSelectClient = (c) => {
    const name = c.name || ''
    setClientQuery(name)
    setIsDirty(true)
    let autoClientId = null
    if (c._type === 'company') {
      const match = portalClients.find(
        (u) => (u.company || '').toLowerCase() === (c.name || '').toLowerCase()
      )
      if (match) autoClientId = match.id
    }
    setForm((f) => ({
      ...f,
      client_name: name,
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
      valid_until: form.valid_until || null,
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return toast.error('El título es requerido')
    if (!isNew && !selected) return toast.error('No hay cotización seleccionada')
    setSaving(true)
    try {
      const payload = buildPayload()
      if (isNew) {
        const r = await createQuote(payload)
        setQuotes((prev) => [r.data, ...prev])
        setSelected(r.data)
        toast.success('Cotización creada')
      } else {
        const r = await updateQuote(selected.id, payload)
        setSelected(r.data)
        setQuotes((prev) => prev.map((q) => q.id === r.data.id ? r.data : q))
        toast.success('Cotización actualizada')
      }
      setIsDirty(false)
      setEditing(false)
      setIsNew(false)
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail
        : typeof detail === 'object' && detail !== null ? JSON.stringify(detail)
        : err?.message || 'Error guardando cotización'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    if (!await showConfirm(`¿Eliminar la cotización "${selected.title}"?`)) return
    try {
      await deleteQuote(selected.id)
      setQuotes((prev) => prev.filter((q) => q.id !== selected.id))
      setSelected(null)
      setMobileDetailOpen(false)
      navigate('/quotes', { replace: true })
      toast.success('Cotización eliminada')
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const handleStatusChange = async (newStatus) => {
    if (!selected) return
    try {
      const r = await updateQuote(selected.id, { status: newStatus })
      setSelected(r.data)
      setQuotes((prev) => prev.map((q) => q.id === r.data.id ? r.data : q))
    } catch {
      toast.error('Error actualizando estado')
    }
  }

  const handleConvert = async () => {
    if (!selected) return
    if (!await showConfirm('¿Convertir esta cotización en un Pedido? La cotización quedará marcada como "En Pedido".')) return
    setConverting(true)
    try {
      const r = await convertQuoteToOrder(selected.id)
      toast.success('Pedido creado exitosamente')
      const qr = await getQuotes({})
      setQuotes(qr.data)
      const updated = qr.data.find((q) => q.id === selected.id)
      if (updated) setSelected(updated)
      navigate('/orders', { state: { selectOrderId: r.data.id } })
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al convertir')
    } finally {
      setConverting(false)
    }
  }

  const handleConvertToInvoice = async () => {
    if (!selected) return
    if (!await showConfirm('¿Convertir esta cotización directamente en una Factura? La cotización quedará marcada como "Facturada".')) return
    setConvertingInvoice(true)
    try {
      const r = await convertQuoteToInvoice(selected.id)
      toast.success(`Factura ${r.data.invoice_number} creada exitosamente`)
      const qr = await getQuotes({})
      setQuotes(qr.data)
      const updated = qr.data.find((q) => q.id === selected.id)
      if (updated) setSelected(updated)
      navigate('/facturas', { state: { selectInvoiceId: r.data.id } })
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al crear factura')
    } finally {
      setConvertingInvoice(false)
    }
  }

  const handleCreateTicket = async () => {
    if (!selected) return
    if (!await showConfirm('¿Crear un ticket vinculado a esta cotización?')) return
    setCreatingTicket(true)
    try {
      const r = await createTicketFromQuote(selected.id)
      toast.success(`Ticket #${r.data.id} creado y vinculado`)
      const qr = await getQuotes({})
      setQuotes(qr.data)
      const updated = qr.data.find((q) => q.id === selected.id)
      if (updated) setSelected(updated)
      navigate(`/tickets/${r.data.id}`)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al crear el ticket')
    } finally {
      setCreatingTicket(false)
    }
  }

  const handleUnlinkTicket = async () => {
    if (!selected) return
    if (!await showConfirm('¿Desvincular el ticket de esta cotización? El ticket no se elimina, solo se quita el vínculo.')) return
    setUnlinkingTicket(true)
    try {
      await updateQuote(selected.id, { ticket_id: null })
      toast.success('Ticket desvinculado')
      const qr = await getQuotes({})
      setQuotes(qr.data)
      const updated = qr.data.find((q) => q.id === selected.id)
      if (updated) setSelected(updated)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al desvincular el ticket')
    } finally {
      setUnlinkingTicket(false)
    }
  }

  const handleClone = async () => {
    if (!selected) return
    try {
      const r = await cloneQuote(selected.id)
      toast.success(`Cotización clonada como ${r.data.quote_number}`)
      const qr = await getQuotes({})
      setQuotes(qr.data)
      setSelected(r.data)
    } catch {
      toast.error('Error al clonar la cotización')
    }
  }

  const handlePrint = (autoprint = true) => {
    if (!selected) return
    const its = parseItems(selected.items)
    const html = buildQuoteHTML(selected, its, window.location.origin)
    const ok = openPdfWindow(`Cotización ${selected.quote_number || selected.id}`, html, { autoprint })
    if (!ok) toast.error('El navegador bloqueó la ventana emergente')
  }

  const handleShare = async () => {
    if (!selected) return
    const its = parseItems(selected.items)
    const html = buildQuoteHTML(selected, its, window.location.origin)
    const filename = `Cotizacion-${selected.quote_number || selected.id}.pdf`
    await sharePdfFromHtml(`Cotización ${selected.quote_number || selected.id}`, html, filename)
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
      await sendQuoteEmail(selected.id, { to: emailTo.trim(), message: emailMsg.trim() || undefined })
      toast.success('Cotización enviada por correo')
      setEmailOpen(false)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al enviar el correo')
    } finally {
      setEmailSending(false)
    }
  }

  const { subtotal: fSubtotal, itbmsAmt: fItbms, total: fTotal } = calcTotals(items, form.itbms_enabled)

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* List panel */}
      <div className={`${mobileDetailOpen ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 flex-shrink-0 border-r border-gray-200 flex-col bg-white`}>
        {/* Header */}
        <div className="p-4 border-b border-gray-200 space-y-2.5">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">Cotizaciones</h1>
            <button onClick={() => openNew()} className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3">
              <Plus size={14} /> Nueva
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-8 text-sm"
              placeholder="Buscar cotización..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{fontSize:'16px'}}
            />
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
          <p className="text-xs text-gray-400">{quotes.length} cotización{quotes.length !== 1 ? 'es' : ''}</p>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {loading ? (
            <div className="text-center py-16 px-4">
              <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <ClipboardList size={20} className="text-indigo-200" />
              </div>
              <p className="text-sm text-gray-300">Cargando...</p>
            </div>
          ) : quotes.length === 0 ? (
            <div className="text-center py-16 px-4 space-y-3">
              <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mx-auto">
                <ClipboardList size={20} className="text-indigo-200" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-400">{search ? 'Sin resultados' : 'No hay cotizaciones aún'}</p>
                {!search && <p className="text-xs text-gray-300 mt-1">Usa "Nueva" para crear tu primera cotización</p>}
              </div>
            </div>
          ) : quotes.map((q) => (
            <button
              key={q.id}
              onClick={() => { setSelected(q); setEditing(false); setMobileDetailOpen(true); navigate(`/quotes/${q.quote_number || q.id}`) }}
              className={`w-full flex items-start gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left ${selected?.id === q.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="mb-0.5">
                  <span className="text-xs font-mono text-gray-400">{q.quote_number || `COT-${q.id}`}</span>
                </div>
                <p className="text-sm font-medium text-gray-900 truncate">{q.title}</p>
                {q.client_name && <p className="text-xs text-gray-400 truncate">{q.client_name}</p>}
                {q.total && <p className="text-xs font-semibold text-gray-700 mt-0.5">${fmtMoney(q.total)}</p>}
              </div>
              <div className="flex-shrink-0 flex flex-col items-end gap-1">
                {q.date && <span className="text-xs text-gray-300">{fmtD(q.date)}</span>}
                <StatusBadge status={q.status} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* New contact modal */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><UserPlus size={16} className="text-blue-600" />Nuevo contacto</h3>
              <button onClick={() => setShowContactModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <form onSubmit={handleCreateContact} className="p-5 space-y-3">
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
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Mail size={16} className="text-blue-600" />Enviar cotización por correo</h3>
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
                  placeholder="Estimado cliente, adjunto encontrará nuestra cotización..."
                  style={{fontSize:'16px'}}
                />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setEmailOpen(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={emailSending} className="btn-primary flex items-center gap-2">
                  <Send size={14} />{emailSending ? 'Enviando...' : 'Enviar cotización'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail / Edit panel */}
      <div className={`${mobileDetailOpen ? 'flex' : 'hidden sm:flex'} flex-1 flex-col overflow-y-auto overscroll-contain min-h-0 bg-gray-50`} {...(editing ? {} : detailSwipe)}>
        {editing ? (
          /* ── Edit / Create form ── */
          <form onSubmit={handleSave} className="p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-5">
            {/* Mobile back */}
            <button type="button" onClick={cancelEdit} className="sm:hidden flex items-center gap-2 text-sm text-gray-500 -mb-2">
              <ArrowLeft size={16} /> Volver
            </button>

            <div className="card space-y-4">
              <h2 className="font-bold text-gray-900">{isNew ? 'Nueva cotización' : 'Editar cotización'}</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="label">Título *</label>
                  <input className="input" value={form.title} onChange={(e) => handleFormChange('title', e.target.value)} placeholder="Ej. Cotización equipos de red" required style={{fontSize:'16px'}} />
                </div>
                <div>
                  <label className="label">N° Cotización</label>
                  <input className="input font-mono" value={form.quote_number} onChange={(e) => handleFormChange('quote_number', e.target.value)} placeholder="COT-0001" style={{fontSize:'16px'}} />
                </div>
                <div>
                  <label className="label">Fecha de emisión</label>
                  <input type="date" className="input" value={form.date} onChange={(e) => handleFormChange('date', e.target.value)} style={{fontSize:'16px'}} />
                </div>
                <div>
                  <label className="label">Válida hasta</label>
                  <input type="date" className="input" value={form.valid_until} onChange={(e) => handleFormChange('valid_until', e.target.value)} style={{fontSize:'16px'}} />
                </div>
                <div>
                  <label className="label">Estado</label>
                  <select className="input" value={form.status} onChange={(e) => handleFormChange('status', e.target.value)} style={{fontSize:'16px'}}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Términos de pago</label>
                  <select className="input" value={form.payment_terms} onChange={(e) => handleFormChange('payment_terms', e.target.value)} style={{fontSize:'16px'}}>
                    <option value="">— Sin especificar —</option>
                    {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Client section */}
            <div className="card space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><User size={14} className="text-gray-400" />Datos del cliente</h3>
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
                <p className="text-xs text-gray-400 mt-1">Vincula esta cotización a la cuenta del cliente para que la vea en su portal, sin depender de que el nombre coincida exactamente.</p>
              </div>

              {/* Client name with autocomplete */}
              <ClientAutocomplete
                field="name"
                label="Nombre / Empresa"
                value={clientQuery}
                onChange={(v) => { setClientQuery(v); handleFormChange('client_name', v) }}
                onSelect={handleSelectClient}
                contacts={contacts}
                companies={companies}
                placeholder="Buscar en contactos o escribir nombre..."
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ClientAutocomplete field="ruc" label="RUC" value={form.client_ruc} onChange={(v) => handleFormChange('client_ruc', v)} onSelect={handleSelectClient} contacts={contacts} companies={companies} placeholder="RUC del cliente" />
                <ClientAutocomplete field="phone" label="Teléfono" value={form.client_phone} onChange={(v) => handleFormChange('client_phone', v)} onSelect={handleSelectClient} contacts={contacts} companies={companies} placeholder="+507 0000-0000" />
                <ClientAutocomplete field="email" label="Email" type="email" value={form.client_email} onChange={(v) => handleFormChange('client_email', v)} onSelect={handleSelectClient} contacts={contacts} companies={companies} placeholder="correo@cliente.com" />
                <ClientAutocomplete field="address" label="Dirección" value={form.client_address} onChange={(v) => handleFormChange('client_address', v)} onSelect={handleSelectClient} contacts={contacts} companies={companies} placeholder="Dirección física" />
              </div>
            </div>

            {/* Items section */}
            <div className="card">
              <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2"><FileText size={14} className="text-gray-400" />Artículos y servicios</h3>
              <ItemEditor
                items={items}
                onChange={handleItemChange}
                onRemove={removeItem}
                onAdd={addItem}
                itbms={form.itbms_enabled}
                onItbmsChange={v => { setIsDirty(true); setForm(f => ({ ...f, itbms_enabled: v })) }}
                descSuggestions={allSuggestions}
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

            {/* Notes */}
            <div className="card">
              <label className="label">Notas</label>
              <textarea className="input resize-none" rows={3} value={form.notes} onChange={(e) => handleFormChange('notes', e.target.value)} placeholder="Condiciones, términos, observaciones..." style={{fontSize:'16px'}} />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pb-4">
              <button type="button" onClick={cancelEdit} className="btn-secondary">Cancelar</button>
              <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
                <Save size={14} />
                {saving ? 'Guardando...' : isNew ? 'Crear cotización' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        ) : selected ? (
          <>
            <button onClick={() => { setMobileDetailOpen(false); navigate(-1) }} className="sm:hidden flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 p-4 pb-0">
              <ArrowLeft size={16} /> Volver a la lista
            </button>
            <QuoteDetail
              q={selected}
              onEdit={() => openEdit(selected)}
              onDelete={handleDelete}
              onStatusChange={handleStatusChange}
              onConvert={handleConvert}
              onConvertToInvoice={handleConvertToInvoice}
              onCreateTicket={handleCreateTicket}
              onUnlinkTicket={handleUnlinkTicket}
              onClone={handleClone}
              onPrint={(autoprint) => handlePrint(autoprint)}
              onSendEmail={openEmailModal}
              onShare={handleShare}
              converting={converting}
              convertingInvoice={convertingInvoice}
              creatingTicket={creatingTicket}
              unlinkingTicket={unlinkingTicket}
            />
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <FileText size={48} className="mb-3 opacity-30" />
            <p className="text-sm">Selecciona una cotización o crea una nueva</p>
          </div>
        )}
      </div>
    </div>
  )
}
