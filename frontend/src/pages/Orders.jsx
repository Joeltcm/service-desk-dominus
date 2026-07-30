import React, { useEffect, useState, useCallback, useRef } from 'react'
import { openPdfWindow, sharePdfFromHtml } from '../utils/pdfViewer'
import { useFlipDropdown } from '../utils/useFlipDropdown'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import { useNavigate, useLocation, useSearchParams, useParams } from 'react-router-dom'
import {
  getOrders, createOrder, updateOrder, deleteOrder, getNextOrderNumber,
  getSuppliers, createSupplier, getTickets, getQuotes,
  uploadOrderAttachment, deleteOrderAttachment, orderAttachmentDownloadUrl, downloadWithAuth,
  createOrderCalendarEvent, deleteOrderCalendarEvent, getCalendarAuthUrl,
  applyOrderInventory, updateExpense,
} from '../services/api'
import { supplierLogoUrl } from '../services/api'
import {
  Search, Plus, Pencil, Trash2, ChevronRight, ChevronDown, ArrowLeft,
  Ticket as TicketIcon, Truck, Calendar, FileText, X,
  CheckCircle2, Clock, Package, XCircle, Upload, Download,
  FileCheck, Paperclip, Receipt, Printer, PackageCheck, Save, ClipboardList,
  ExternalLink, CalendarDays, AlertTriangle, Share2, CreditCard, BadgeAlert,
  Banknote,
} from 'lucide-react'
import { fmtD, fmtTime, toUTC, getFmtTz } from '../utils/fmt'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import toast from 'react-hot-toast'
import { useFormGuard } from '../context/UnsavedChangesContext'
import ItemEditor from '../components/ItemEditor'
import { getCompanyCache, useCompany } from '../context/CompanyContext'

const STATUSES = ['Pendiente', 'En proceso', 'Retiro Programado', 'Recibido', 'Inventariado', 'Cancelado']
const SUPPLIER_CATEGORIES = ['Hardware', 'Software', 'Consumibles', 'Servicios', 'Redes', 'Impresión', 'Otro']

const STATUS_STYLE = {
  'Pendiente':            'bg-yellow-100 text-yellow-700',
  'En proceso':           'bg-blue-100 text-blue-700',
  'Retiro Programado':    'bg-orange-100 text-orange-700',
  'Recibido':             'bg-green-100 text-green-700',
  'Inventariado':         'bg-emerald-100 text-emerald-700',
  'Cancelado':            'bg-red-100 text-red-600',
}

const STATUS_ICON = {
  'Pendiente':            <Clock size={11} />,
  'En proceso':           <Package size={11} />,
  'Retiro Programado':    <CalendarDays size={11} />,
  'Recibido':             <CheckCircle2 size={11} />,
  'Inventariado':         <PackageCheck size={11} />,
  'Cancelado':            <XCircle size={11} />,
}

const DISPATCH_STATUS_STYLE = {
  'Borrador':  'bg-gray-100 text-gray-600',
  'Emitido':   'bg-blue-100 text-blue-700',
  'Entregado': 'bg-green-100 text-green-700',
  'Cancelado': 'bg-red-100 text-red-600',
}

const EMPTY_ITEM = { code: '', description: '', qty: 1, unit_price: '', itbms: true }

function QuickCategoryInput({ value, onChange, categories, onNew }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  const { triggerRef, flipUp } = useFlipDropdown(open)

  const suggestions = categories.filter((c) =>
    !value.trim() || c.toLowerCase().includes(value.toLowerCase())
  )

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="flex gap-2" ref={ref}>
      <div className="relative flex-1" ref={triggerRef}>
        <input
          className="input w-full"
          style={{ fontSize: '16px' }}
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Selecciona o escribe una categoría"
          autoComplete="off"
        />
        {open && suggestions.length > 0 && (
          <ul className={`absolute z-50 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-52 overflow-y-auto ${flipUp ? 'bottom-full mb-1' : 'mt-1'}`}>
            {value.trim() === '' && (
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); onChange(''); setOpen(false) }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50"
                >
                  — Sin categoría —
                </button>
              </li>
            )}
            {suggestions.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); onChange(c); setOpen(false) }}
                  className="w-full text-left px-3 py-2.5 text-sm text-gray-800 hover:bg-blue-50 transition-colors"
                >
                  {c}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={onNew}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors"
        title="Nueva categoría"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}

function fmtMoney(n) {
  return Number(n || 0).toFixed(2)
}

function parseItems(str) {
  if (!str) return [{ ...EMPTY_ITEM }]
  try {
    const arr = JSON.parse(str)
    if (Array.isArray(arr) && arr.length) {
      return arr.map((it) => ({
        code: it.code || '',
        description: it.description || '',
        qty: it.qty ?? 1,
        unit_price: it.unit_price ?? '',
        itbms: it.itbms !== false,
      }))
    }
  } catch {}
  return [{ code: '', description: str, qty: 1, unit_price: '' }]
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


function buildOrderHTML(order, items, origin) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const orderShippingCost = parseFloat(String(order.shipping_cost || '0').replace(/[^\d.]/g, '') || '0') || 0
  const { subtotal, itbmsAmt, total } = calcTotals(items, order.itbms_enabled, orderShippingCost)
  const fmtDate = (iso) => fmtD(iso)
  const co = getCompanyCache()
  const coName    = esc(co.company_name    || 'Service Desk')
  const coAddress = esc(co.company_address || 'Panamá, Punta Pacífica, PH Pacific Wind')
  const coRuc     = esc(co.company_ruc     || '4-754-575 DV 85')

  const suppliers = [order.supplier1, order.supplier2, order.supplier3].filter(Boolean)
  const supplierLine = suppliers.map((s) => esc(s.name)).join(' · ')

  const visibleItems = items.filter((it) => it.description?.trim())
  const hasMixed = order.itbms_enabled && visibleItems.some((it) => it.itbms === false)
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
    <div style="display:flex;align-items:center;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:16px">
      <img src="${origin}/logo.png" alt="Logo" style="width:52px;height:52px;object-fit:contain;border-radius:6px;margin-right:14px">
      <div style="flex:1">
        <div style="font-size:18pt;font-weight:bold;color:#1e3a5f">${coName}</div>
        <div style="font-size:9pt;color:#555;margin-top:2px">${coAddress}</div>
        <div style="font-size:9pt;color:#555">RUC: ${coRuc}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:15pt;font-weight:bold;color:#1e3a5f">ORDEN DE COMPRA</div>
        <div style="font-size:10pt;color:#444;margin-top:4px;font-family:monospace">N° ${esc(order.order_number || String(order.id))}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
      ${supplierLine ? `<div style="padding:5px 8px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px"><div style="font-size:6.5pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px">Proveedor(es)</div><div style="font-size:8.5pt;font-weight:600;color:#111">${supplierLine}</div></div>` : ''}
      <div style="padding:5px 8px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px"><div style="font-size:6.5pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px">Estado</div><div style="font-size:8.5pt;font-weight:600;color:#111">${esc(order.status)}</div></div>
      ${order.expected_date ? `<div style="padding:5px 8px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px"><div style="font-size:6.5pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px">Fecha esperada</div><div style="font-size:8.5pt;font-weight:600;color:#111">${esc(fmtDate(order.expected_date))}</div></div>` : ''}
      ${order.payment_terms ? `<div style="padding:5px 8px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px"><div style="font-size:6.5pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px">Términos de pago</div><div style="font-size:8.5pt;font-weight:600;color:#111">${esc(order.payment_terms)}</div></div>` : ''}
      ${order.ticket ? `<div style="padding:5px 8px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px"><div style="font-size:6.5pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px">Ticket</div><div style="font-size:8.5pt;font-weight:600;color:#111">#${esc(String(order.ticket.id))} ${esc(order.ticket.title)}</div></div>` : ''}
    </div>

    <div style="font-size:13pt;font-weight:bold;color:#1e3a5f;margin-bottom:8px">${esc(order.title)}</div>

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
        ${order.itbms_enabled ? `<div style="display:flex;justify-content:space-between;padding:6px 12px;background:#fffbeb;font-size:9.5pt">
          <span style="color:#b45309">ITBMS 7%</span><span style="font-weight:600;color:#b45309">$${fmtMoney(itbmsAmt)}</span>
        </div>` : ''}
        ${orderShippingCost > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 12px;font-size:9.5pt">
          <span style="color:#555">Costo de entrega</span><span style="font-weight:600">$${fmtMoney(orderShippingCost)}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#1e3a5f;font-size:10.5pt">
          <span style="color:#fff;font-weight:bold">TOTAL</span><span style="color:#fff;font-weight:bold">$${fmtMoney(total)}</span>
        </div>
      </div>
    </div>

    ${order.notes ? `<div style="margin-top:16px;padding:10px 14px;background:#f8f9fb;border:1px solid #ddd;border-radius:6px">
      <div style="font-size:9.5pt;font-weight:bold;color:#444;margin-bottom:4px">NOTAS:</div>
      <div style="font-size:9pt;white-space:pre-wrap">${esc(order.notes)}</div>
    </div>` : ''}

    <div style="margin-top:24px;padding-top:10px;border-top:1px solid #ddd;font-size:7.5pt;color:#888;text-align:center">
      ${coName} • ${coAddress} • RUC: ${coRuc} • N° ${esc(order.order_number || String(order.id))}
    </div>
  </div>`
}

function openOrderWindow(order, bodyHTML, autoprint) {
  const ok = openPdfWindow(`Pedido ${order.order_number || order.id}`, bodyHTML, { autoprint })
  if (!ok) toast.error('El navegador bloqueó la ventana emergente')
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'}`}>
      {STATUS_ICON[status]} {status}
    </span>
  )
}

function StatusSelector({ status, onChange, loading }) {
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
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium transition-opacity ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'} ${loading ? 'opacity-50' : 'hover:opacity-75'}`}
      >
        {STATUS_ICON[status]} {status} <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-30 py-1 min-w-[190px]">
          {STATUSES.map(s => (
            <button
              key={s}
              onMouseDown={(e) => { e.preventDefault(); if (s !== status) { onChange(s) } setOpen(false) }}
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

function SupplierChip({ supplier }) {
  if (!supplier) return null
  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
      {supplier.logo_path
        ? <img src={supplierLogoUrl(supplier.id)} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" alt={supplier.name} />
        : <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
            <Truck size={14} className="text-violet-600" />
          </div>
      }
      <div className="min-w-0">
        <p className="font-semibold text-sm text-gray-900">{supplier.name}</p>
        {supplier.category && <p className="text-xs text-gray-400">{supplier.category}</p>}
      </div>
    </div>
  )
}

function fileIcon(contentType = '') {
  if (contentType.startsWith('image/')) return '🖼️'
  if (contentType === 'application/pdf') return '📄'
  if (contentType.includes('word')) return '📝'
  if (contentType.includes('excel') || contentType.includes('spreadsheet')) return '📊'
  return '📎'
}

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function AttachmentSection({ orderId, docType, label, icon, attachments, onUploaded, onDeleted }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const mine = attachments.filter((a) => a.doc_type === docType)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      await uploadOrderAttachment(orderId, file, docType)
      onUploaded()
      toast.success('Archivo adjuntado')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al subir archivo')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (att) => {
    if (!confirm(`¿Eliminar "${att.original_name}"?`)) return
    try {
      await deleteOrderAttachment(orderId, att.id)
      onDeleted()
    } catch {
      toast.error('Error eliminando archivo')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        {label && (
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            {icon} {label}
          </h4>
        )}
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50 ml-auto"
        >
          <Upload size={12} /> {uploading ? 'Subiendo...' : 'Adjuntar'}
        </button>
      </div>
      <input ref={inputRef} type="file" className="hidden" onChange={handleUpload} />

      {mine.length === 0 ? (
        <p className="text-xs text-gray-300 italic">Sin archivos adjuntos</p>
      ) : (
        <div className="space-y-1.5">
          {mine.map((att) => (
            <div key={att.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
              <span className="text-base leading-none">{fileIcon(att.content_type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{att.original_name}</p>
                <p className="text-xs text-gray-400">{fmtSize(att.file_size)}</p>
              </div>
              <button onClick={() => downloadWithAuth(orderAttachmentDownloadUrl(orderId, att.id), att.original_name)}
                className="p-1 text-gray-400 hover:text-blue-600" title="Descargar">
                <Download size={13} />
              </button>
              <button onClick={() => handleDelete(att)} className="p-1 text-gray-300 hover:text-red-500">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TicketSearch({ tickets, value, onChange }) {
  const [input, setInput] = useState(value ? String(value) : '')
  const found = input ? tickets.find((t) => t.id === parseInt(input)) : null

  const handleChange = (e) => {
    const val = e.target.value.replace(/\D/g, '')
    setInput(val)
    const match = val ? tickets.find((t) => t.id === parseInt(val)) : null
    onChange(match ? match.id : null)
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-mono">#</span>
          <input
            className="input w-full pl-7"
            type="text" inputMode="numeric"
            value={input} onChange={handleChange}
            placeholder="Número de ticket"
            style={{fontSize:'16px'}}
          />
        </div>
        {input && (
          <button type="button" onClick={() => { setInput(''); onChange(null) }} className="text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
      </div>
      {input && (
        <p className={`mt-1.5 text-xs px-1 ${found ? 'text-green-700' : 'text-red-500'}`}>
          {found ? `✓ ${found.title}` : 'Ticket no encontrado'}
        </p>
      )}
    </div>
  )
}

function QuoteSearch({ quotes, value, onChange }) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef()
  const selected = value ? quotes.find((q) => q.id === value) : null

  useEffect(() => {
    if (selected) setInput(selected.quote_number ? `${selected.quote_number} — ${selected.title}` : selected.title)
    else setInput('')
  }, [value, selected])

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const suggestions = input.trim()
    ? quotes.filter((q) =>
        q.title?.toLowerCase().includes(input.toLowerCase()) ||
        q.quote_number?.toLowerCase().includes(input.toLowerCase()) ||
        q.client_name?.toLowerCase().includes(input.toLowerCase())
      ).slice(0, 8)
    : quotes.slice(0, 8)

  const handleSelect = (q) => { onChange(q.id); setOpen(false) }
  const handleClear = () => { onChange(null); setInput(''); setOpen(false) }

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            className="input w-full pr-8"
            style={{ fontSize: '16px' }}
            value={input}
            onChange={(e) => { setInput(e.target.value); onChange(null); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder="Buscar por número o título..."
            autoComplete="off"
          />
          {value && (
            <button type="button" onClick={handleClear} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      {selected && (
        <p className="mt-1.5 text-xs text-green-700 px-1 flex items-center gap-1">
          ✓ {selected.quote_number && <span className="font-mono">{selected.quote_number}</span>}
          {selected.client_name && <span className="text-green-600">· {selected.client_name}</span>}
          <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700`}>{selected.status}</span>
        </p>
      )}
      {open && suggestions.length > 0 && !selected && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {suggestions.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); handleSelect(q) }}
                className="w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {q.quote_number && <span className="text-xs font-mono text-gray-400 flex-shrink-0">{q.quote_number}</span>}
                  <span className="text-sm font-medium text-gray-900 flex-1 truncate">{q.title}</span>
                  {q.total && <span className="text-xs font-semibold text-gray-700 flex-shrink-0">${q.total}</span>}
                </div>
                {q.client_name && <p className="text-xs text-gray-400 mt-0.5 truncate">{q.client_name}</p>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const EMPTY_FORM = {
  title: '', order_number: '', status: 'Pendiente', ticket_id: null, quote_id: null, notes: '',
  supplier1_id: '', supplier2_id: '', supplier3_id: '', expected_date: '',
  items: [{ ...EMPTY_ITEM }],
  itbms_enabled: false,
  shipping_cost: '',
}

export default function Orders() {
  const navigate = useNavigate()
  const location = useLocation()
  const { ref: urlRef } = useParams()
  const [orders, setOrders] = useState([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [tickets, setTickets] = useState([])
  const [quotes, setQuotes] = useState([])
  const [pendingSelectId, setPendingSelectId] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 320)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    getOrders({ search: debouncedSearch || undefined, status: filterStatus || undefined })
      .then((r) => setOrders(r.data))
      .catch(() => toast.error('Error cargando pedidos'))
  }, [debouncedSearch, filterStatus])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    getSuppliers().then((r) => setSuppliers(r.data)).catch(() => {})
    getTickets().then((r) => setTickets(r.data)).catch(() => {})
    getQuotes().then((r) => setQuotes(r.data)).catch(() => {})
  }, [])

  // Handle navigation from Despacho page ("Ver pedido")
  useEffect(() => {
    const id = location.state?.selectOrderId
    if (!id) return
    window.history.replaceState({}, '')
    setPendingSelectId(id)
  }, [location.state])

  useEffect(() => {
    if (!pendingSelectId || orders.length === 0) return
    const found = orders.find((o) => o.id === pendingSelectId)
    if (found) {
      setSelected(found)
      setShowForm(false)
      setMobileDetailOpen(true)
      setPendingSelectId(null)
    }
  }, [orders, pendingSelectId])

  // Auto-select from URL param (e.g. /orders/PED-0001)
  useEffect(() => {
    if (!urlRef) { if (selected) { setSelected(null); setMobileDetailOpen(false) } return }
    if (orders.length === 0) return
    if (selected?.order_number === urlRef || String(selected?.id) === urlRef) return
    const found = orders.find((o) => o.order_number === urlRef || String(o.id) === urlRef)
    if (found) { setSelected(found); setShowForm(false); setMobileDetailOpen(true) }
  }, [urlRef, orders])

  const refreshSelected = useCallback((id) => {
    getOrders().then((r) => {
      const fresh = r.data.find((o) => o.id === id)
      if (fresh) setSelected(fresh)
      setOrders(r.data)
    }).catch(() => {})
  }, [])

  const handleSelect = (o) => { setSelected(o); setShowForm(false); setMobileDetailOpen(true); navigate(`/orders/${o.order_number || o.id}`) }

  const handleNew = async () => {
    setSelected(null)
    const num = await getNextOrderNumber().then((r) => r.data.number).catch(() => 'PED-0001')
    setForm({ ...EMPTY_FORM, order_number: num })
    setShowForm(true)
    setMobileDetailOpen(true)
  }

  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setSearchParams({}, { replace: true })
      handleNew()
    }
  }, []) // eslint-disable-line

  const handleEdit = () => {
    setForm({
      title: selected.title || '',
      order_number: selected.order_number || '',
      status: selected.status || 'Pendiente',
      ticket_id: selected.ticket_id ?? null,
      quote_id: selected.quote_id ?? null,
      notes: selected.notes || '',
      supplier1_id: selected.supplier1_id ?? '',
      supplier2_id: selected.supplier2_id ?? '',
      supplier3_id: selected.supplier3_id ?? '',
      expected_date: selected.expected_date || '',
      items: parseItems(selected.purchase_items),
      itbms_enabled: selected.itbms_enabled ?? false,
      shipping_cost: selected.shipping_cost || '',
    })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return toast.error('El título es requerido')
    const validItems = form.items.filter((it) => it.description?.trim())
    const shippingCost = parseFloat(form.shipping_cost || '0') || 0
    const { subtotal, itbmsAmt, total } = calcTotals(validItems, form.itbms_enabled, shippingCost)
    const payload = {
      title: form.title,
      order_number: form.order_number || null,
      status: form.status,
      ticket_id: form.ticket_id ? Number(form.ticket_id) : null,
      quote_id: form.quote_id ? Number(form.quote_id) : null,
      supplier1_id: form.supplier1_id ? Number(form.supplier1_id) : null,
      supplier2_id: form.supplier2_id ? Number(form.supplier2_id) : null,
      supplier3_id: form.supplier3_id ? Number(form.supplier3_id) : null,
      expected_date: form.expected_date || null,
      notes: form.notes || null,
      purchase_items: validItems.length ? JSON.stringify(validItems) : null,
      purchase_total: total > 0 ? `$${fmtMoney(total)}` : null,
      itbms_enabled: form.itbms_enabled,
      shipping_cost: shippingCost > 0 ? fmtMoney(shippingCost) : null,
    }
    setSaving(true)
    try {
      if (selected && showForm) {
        const res = await updateOrder(selected.id, payload)
        setSelected(res.data)
        toast.success('Pedido actualizado')
      } else {
        const res = await createOrder(payload)
        setSelected(res.data)
        toast.success('Pedido guardado en la lista')
      }
      setShowForm(false)
      load()
    } catch {
      toast.error('Error guardando pedido')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (o) => {
    if (!confirm(`¿Eliminar el pedido "${o.title}"?`)) return
    try {
      await deleteOrder(o.id)
      toast.success('Pedido eliminado')
      if (selected?.id === o.id) { setSelected(null); setMobileDetailOpen(false); navigate('/orders', { replace: true }) }
      load()
    } catch {
      toast.error('Error eliminando pedido')
    }
  }

  const handleBack = () => { setMobileDetailOpen(false); setShowForm(false); navigate(-1) }
  const detailSwipe = useTouchSwipe({ onSwipeRight: handleBack })

  const handlePrint = (order, autoprint = true) => {
    const items = parseItems(order.purchase_items)
    const origin = window.location.origin
    openOrderWindow(order, buildOrderHTML(order, items, origin), autoprint)
  }

  const handleShare = async (order) => {
    const items = parseItems(order.purchase_items)
    const origin = window.location.origin
    const filename = `Pedido-${order.order_number || order.id}.pdf`
    await sharePdfFromHtml(`Pedido ${order.order_number || order.id}`, buildOrderHTML(order, items, origin), filename)
  }

  const handleConvertToDispatch = (order) => {
    navigate('/pedidos', { state: { fromOrder: order } })
  }

  const handleSupplierCreated = (newSupplier) => {
    setSuppliers((prev) => [newSupplier, ...prev])
  }

  const handleStatusChange = async (order, newStatus) => {
    try {
      const res = await updateOrder(order.id, {
        title: order.title,
        order_number: order.order_number || null,
        status: newStatus,
        ticket_id: order.ticket_id ?? null,
        quote_id: order.quote_id ?? null,
        supplier1_id: order.supplier1_id ?? null,
        supplier2_id: order.supplier2_id ?? null,
        supplier3_id: order.supplier3_id ?? null,
        expected_date: order.expected_date || null,
        notes: order.notes || null,
        purchase_items: order.purchase_items || null,
        purchase_total: order.purchase_total || null,
        itbms_enabled: order.itbms_enabled ?? false,
      })
      setSelected(res.data)
      load()
      toast.success(`Estado: ${newStatus}`)
    } catch {
      toast.error('Error al cambiar estado')
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left panel */}
      <div className={`${mobileDetailOpen ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-gray-200 bg-white flex-shrink-0`}>
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">Pedidos</h1>
            <button onClick={handleNew} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
              <Plus size={15} /> Nuevo
            </button>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <FileCheck size={12} className="text-blue-400" />
            <p className="text-xs text-blue-500 font-medium">{orders.length} guardado{orders.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        <div className="px-4 py-3 space-y-2 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-8 w-full text-sm" placeholder="Buscar por título, número, notas..." value={search} onChange={(e) => setSearch(e.target.value)} style={{fontSize:'16px'}} />
          </div>
          <select className="input w-full text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{fontSize:'16px'}}>
            <option value="">Todos los estados</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {orders.length > 0 && (
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-1.5">
            <FileCheck size={11} className="text-green-400" />
            <span className="text-xs text-gray-400 font-medium">Registros guardados</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 divide-y divide-gray-50">
          {orders.length === 0
            ? (
              <div className="text-center py-16 px-4 space-y-3">
                <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
                  <FileCheck size={20} className="text-blue-200" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-400">Sin pedidos guardados</p>
                  <p className="text-xs text-gray-300 mt-1">Usa el botón "Nuevo" para crear tu primer pedido</p>
                </div>
              </div>
            )
            : orders.map((o) => {
              const needsInventory = o.status === 'Recibido'
              return (
              <button key={o.id} onClick={() => handleSelect(o)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors border-l-4 ${
                  needsInventory
                    ? selected?.id === o.id
                      ? 'bg-amber-100 border-amber-500'
                      : 'bg-amber-50 border-amber-400 hover:bg-amber-100'
                    : selected?.id === o.id
                      ? 'bg-blue-50 border-transparent'
                      : 'hover:bg-gray-50 border-transparent'
                }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${needsInventory ? 'bg-amber-400 text-white' : STATUS_STYLE[o.status] || 'bg-gray-100 text-gray-500'}`}>
                  {needsInventory ? <AlertTriangle size={16} /> : (STATUS_ICON[o.status] || <Package size={14} />)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-sm truncate ${selected?.id === o.id ? 'text-blue-700' : 'text-gray-900'}`}>{o.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <StatusBadge status={o.status} />
                    {needsInventory && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500 text-white font-semibold">
                        <AlertTriangle size={10} /> Pendiente de inventariar
                      </span>
                    )}
                    {o.purchase_total && <span className="text-xs text-gray-500 font-medium">{o.purchase_total}</span>}
                    {o.expense?.is_payable && !o.expense?.paid_at && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
                        <BadgeAlert size={10} /> Pago pendiente
                      </span>
                    )}
                    {o.order_number && <span className="text-xs font-mono text-gray-400">{o.order_number}</span>}
                    {o.ticket && <span className="text-xs text-gray-400">#{o.ticket.id}</span>}
                    {o.attachments?.length > 0 && (
                      <span className="text-xs text-gray-400 flex items-center gap-0.5">
                        <Paperclip size={10} /> {o.attachments.length}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight size={14} className={needsInventory ? 'text-amber-400 flex-shrink-0' : 'text-gray-300 flex-shrink-0'} />
              </button>
              )
            })
          }
        </div>
      </div>

      {/* Right panel */}
      <div className={`${mobileDetailOpen ? 'flex' : 'hidden'} md:flex flex-1 flex-col bg-gray-50 overflow-y-auto overscroll-contain min-h-0`} {...detailSwipe}>
        {showForm ? (
          <OrderForm
            form={form} setForm={setForm}
            suppliers={suppliers} tickets={tickets} quotes={quotes}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); if (!selected) setMobileDetailOpen(false) }}
            saving={saving} isEdit={!!selected} onBack={handleBack}
            onSupplierCreated={handleSupplierCreated}
          />
        ) : selected ? (
          <OrderDetail
            order={selected}
            onEdit={handleEdit}
            onDelete={() => handleDelete(selected)}
            onBack={handleBack}
            onAttachmentChange={() => refreshSelected(selected.id)}
            onPrint={(autoprint) => handlePrint(selected, autoprint)}
            onShare={() => handleShare(selected)}
            onConvertToDispatch={() => handleConvertToDispatch(selected)}
            onViewDispatch={(d) => navigate('/pedidos', { state: { selectDispatchId: d.id } })}
            onStatusChange={(newStatus) => handleStatusChange(selected, newStatus)}
            onCalendarChange={() => refreshSelected(selected.id)}
            onInventoryApplied={() => refreshSelected(selected.id)}
            onExpenseUpdated={() => refreshSelected(selected.id)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center">
              <FileCheck size={24} className="text-blue-200" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-400">Selecciona un pedido guardado</p>
              <p className="text-xs text-gray-300 mt-1">o usa "Nuevo" para crear uno</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Detail view ─────────────────────────────────────────
function OrderDetail({ order, onEdit, onDelete, onBack, onAttachmentChange, onPrint, onShare, onConvertToDispatch, onViewDispatch, onStatusChange, onCalendarChange, onInventoryApplied, onExpenseUpdated }) {
  const { vertical } = useCompany()
  const nounPlCap = vertical === 'it_support' ? 'Pedidos' : 'Despachos'
  const supplierList = [order.supplier1, order.supplier2, order.supplier3].filter(Boolean)
  const items = parseItems(order.purchase_items)
  const hasItems = items.some((it) => it.description?.trim())
  const shippingCost = parseFloat(order.shipping_cost || '0') || 0
  const { subtotal, itbmsAmt, total } = calcTotals(items, order.itbms_enabled, shippingCost)
  const [changingStatus, setChangingStatus] = useState(false)
  const [applyingInv, setApplyingInv] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [dueDate, setDueDate] = useState(order.expense?.due_date || '')
  const [payMethod, setPayMethod] = useState('Efectivo')
  const [payNote, setPayNote] = useState('')
  const [editingPayment, setEditingPayment] = useState(false)
  const [editPaidAt, setEditPaidAt] = useState('')
  const [editPayMethod, setEditPayMethod] = useState('')
  const [editPayNote, setEditPayNote] = useState('')

  const exp = order.expense

  const PAY_METHODS = ['Efectivo', 'Tarjeta', 'Transferencia', 'Cheque', 'Yappy']

  const handleStartEditPayment = () => {
    setEditPaidAt(exp.paid_at || '')
    setEditPayMethod(exp.payment_method || 'Efectivo')
    setEditPayNote(exp.notes || '')
    setEditingPayment(true)
  }

  const handleSaveEditPayment = async () => {
    if (!exp) return
    setSavingPayment(true)
    try {
      await updateExpense(exp.id, {
        paid_at: editPaidAt || exp.paid_at,
        payment_method: editPayMethod,
        notes: editPayNote.trim() || null,
      })
      toast.success('Pago actualizado')
      setEditingPayment(false)
      onExpenseUpdated?.()
    } catch { toast.error('Error actualizando pago') }
    finally { setSavingPayment(false) }
  }

  const handleMarkPaid = async () => {
    if (!exp) return
    setSavingPayment(true)
    try {
      await updateExpense(exp.id, {
        paid_at: new Date().toISOString().slice(0, 10),
        payment_method: payMethod,
        notes: payNote.trim() || exp.notes || null,
      })
      toast.success('Gasto marcado como pagado')
      onExpenseUpdated?.()
    } catch { toast.error('Error actualizando pago') }
    finally { setSavingPayment(false) }
  }

  const handleMarkUnpaid = async () => {
    if (!exp) return
    setSavingPayment(true)
    try {
      await updateExpense(exp.id, { paid_at: null, payment_method: null })
      toast.success('Pago revertido a pendiente')
      onExpenseUpdated?.()
    } catch { toast.error('Error actualizando pago') }
    finally { setSavingPayment(false) }
  }

  const handleSaveDueDate = async () => {
    if (!exp) return
    setSavingPayment(true)
    try {
      await updateExpense(exp.id, { due_date: dueDate || null })
      toast.success('Fecha de vencimiento guardada')
      onExpenseUpdated?.()
    } catch { toast.error('Error guardando fecha') }
    finally { setSavingPayment(false) }
  }

  const handleApplyInventory = async () => {
    if (!window.confirm('¿Aplicar los artículos de este pedido al inventario? El pedido pasará a estado "Inventariado".')) return
    setApplyingInv(true)
    try {
      await applyOrderInventory(order.id)
      toast.success('Inventario actualizado — pedido marcado como Inventariado')
      onInventoryApplied?.()
    } catch {
      toast.error('Error al aplicar inventario')
    } finally {
      setApplyingInv(false)
    }
  }

  const [showCalendarModal, setShowCalendarModal] = useState(false)
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [calForm, setCalForm] = useState({
    date: '', hour: '8', minute: '00', ampm: 'AM',
    duration_minutes: 60, location: '', notes: '',
    endMode: 'duration', endHour: '9', endMinute: '00', endAmpm: 'AM',
  })
  const [retiroForm, setRetiroForm] = useState({ date: '', time: '08:00' })
  const [savingRetiro, setSavingRetiro] = useState(false)
  const [editingRetiro, setEditingRetiro] = useState(false)

  useEffect(() => {
    if (order.scheduled_at) {
      const utcDate = toUTC(order.scheduled_at)
      const local = toZonedTime(utcDate, 'America/Panama')
      const h24 = local.getHours()
      const h12 = h24 % 12 || 12
      const dateStr = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
      setCalForm((f) => ({
        ...f,
        date: dateStr,
        hour: String(h12),
        minute: String(local.getMinutes()).padStart(2, '0'),
        ampm: h24 >= 12 ? 'PM' : 'AM',
        duration_minutes: order.duration_minutes || 60,
      }))
      setRetiroForm({
        date: dateStr,
        time: `${String(h24).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`,
      })
    }
  }, [order.id, order.scheduled_at])

  const handleSaveRetiro = async () => {
    if (!retiroForm.date) { toast.error('Selecciona una fecha'); return }
    setSavingRetiro(true)
    try {
      const iso = fromZonedTime(`${retiroForm.date}T${retiroForm.time}:00`, 'America/Panama').toISOString()
      await createOrderCalendarEvent({
        order_id: order.id,
        scheduled_at: iso,
        duration_minutes: 60,
      })
      toast.success('Retiro agendado en Google Calendar')
      setEditingRetiro(false)
      onCalendarChange?.()
    } catch (err) {
      const detail = typeof err.response?.data?.detail === 'string' ? err.response.data.detail : ''
      if (detail.includes('Google Calendar no está configurado')) {
        toast.error('Configura primero Google Calendar en el .env')
      } else if (err.response?.status === 401 || detail.includes('token') || detail.includes('auth') || detail.includes('credential') || detail.includes('autenticación')) {
        toast.error('Sesión de Google expirada. Reconecta tu cuenta en Perfil.')
      } else if (err.response?.status === 400) {
        try {
          const authRes = await getCalendarAuthUrl()
          window.open(authRes.data.auth_url, '_blank')
          toast('Autoriza Google Calendar en la ventana que se abrió', { icon: '🔑' })
        } catch {
          toast.error('Debes conectar Google Calendar primero')
        }
      } else {
        toast.error(detail || `Error ${err.response?.status || ''} al crear evento`)
      }
    } finally { setSavingRetiro(false) }
  }

  const getCalScheduledAtISO = (form = calForm) => {
    if (!form.date) return ''
    let h = parseInt(form.hour)
    if (form.ampm === 'PM' && h !== 12) h += 12
    if (form.ampm === 'AM' && h === 12) h = 0
    return fromZonedTime(`${form.date}T${String(h).padStart(2, '0')}:${form.minute}:00`, 'America/Panama').toISOString()
  }

  const getCalEffectiveDuration = (form = calForm) => {
    if (form.endMode === 'duration') return form.duration_minutes
    const startISO = getCalScheduledAtISO(form)
    if (!startISO || !form.date) return form.duration_minutes
    let eh = parseInt(form.endHour)
    if (form.endAmpm === 'PM' && eh !== 12) eh += 12
    if (form.endAmpm === 'AM' && eh === 12) eh = 0
    const endISO = fromZonedTime(`${form.date}T${String(eh).padStart(2, '0')}:${form.endMinute}:00`, 'America/Panama').toISOString()
    const diff = Math.round((new Date(endISO) - new Date(startISO)) / 60000)
    return diff > 0 ? diff : form.duration_minutes
  }

  const handleCalendarEvent = async () => {
    if (creatingEvent) return
    setCreatingEvent(true)
    try {
      await createOrderCalendarEvent({
        order_id: order.id,
        scheduled_at: getCalScheduledAtISO(),
        duration_minutes: getCalEffectiveDuration(),
        location: calForm.location,
        notes: calForm.notes,
      })
      toast.success('Evento creado en Google Calendar')
      setShowCalendarModal(false)
      onCalendarChange?.()
    } catch (err) {
      const detail = typeof err.response?.data?.detail === 'string' ? err.response.data.detail : ''
      if (detail.includes('Google Calendar no está configurado')) {
        toast.error('Configura primero Google Calendar en el .env')
      } else if (err.response?.status === 401 || detail.includes('token') || detail.includes('auth') || detail.includes('credential') || detail.includes('autenticación')) {
        toast.error('Sesión de Google expirada. Reconecta tu cuenta en Perfil.')
      } else if (err.response?.status === 400) {
        try {
          const authRes = await getCalendarAuthUrl()
          window.open(authRes.data.auth_url, '_blank')
          toast('Autoriza Google Calendar en la ventana que se abrió', { icon: '🔑' })
        } catch {
          toast.error('Debes conectar Google Calendar primero')
        }
      } else {
        toast.error(detail || `Error ${err.response?.status || ''} al crear evento`)
      }
    } finally {
      setCreatingEvent(false)
    }
  }

  const handleDeleteCalendarEvent = async () => {
    if (!window.confirm('¿Eliminar el evento de Google Calendar para este pedido?')) return
    try {
      await deleteOrderCalendarEvent(order.id)
      toast.success('Evento eliminado')
      onCalendarChange?.()
    } catch {
      toast.error('Error al eliminar evento')
    }
  }

  const handleStatusChange = async (newStatus) => {
    setChangingStatus(true)
    await onStatusChange(newStatus)
    setChangingStatus(false)
  }

  return (
    <>
    <div className="p-4 sm:p-6 max-w-2xl space-y-4">
      <button onClick={onBack} className="md:hidden flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft size={16} /> Volver
      </button>

      {/* Header */}
      <div className="space-y-2">
        <div>
          {order.order_number && (
            <span className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded inline-block mb-1">{order.order_number}</span>
          )}
          <h2 className="text-base font-semibold text-gray-900 leading-snug">{order.title}</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusSelector status={order.status} onChange={handleStatusChange} loading={changingStatus} />
          <div className="flex gap-2 flex-wrap ml-auto">
            <button onClick={() => onPrint(true)} title="Imprimir" className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-900 active:bg-black transition-colors">
              <Printer size={13} /> <span className="hidden sm:inline">Imprimir</span>
            </button>
            <button onClick={() => onPrint(false)} title="Guardar PDF" className="flex items-center gap-1.5 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 active:bg-green-800 transition-colors">
              <Download size={13} /> <span className="hidden sm:inline">PDF</span>
            </button>
            <button onClick={onShare} title="Compartir PDF" className="flex items-center gap-1.5 px-3 py-2 text-sm bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors">
              <Share2 size={13} /> <span className="hidden sm:inline">Compartir</span>
            </button>
            {(order.status === 'Recibido' || (order.status === 'Inventariado' && order.inventory_applied)) && (
              <button onClick={handleApplyInventory} disabled={applyingInv} title="Aplicar al inventario" className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors">
                <Package size={13} /> <span className="hidden sm:inline">{applyingInv ? 'Aplicando...' : 'Inventariar'}</span>
              </button>
            )}

            <button onClick={() => setShowCalendarModal(true)} title="Agendar" className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors ${order.calendar_event_id ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-purple-600 hover:bg-purple-700 text-white'}`}>
              <CalendarDays size={13} /> <span className="hidden sm:inline">{order.calendar_event_id ? 'Reagendar' : 'Agendar'}</span>
            </button>
            <button onClick={onEdit} className="btn-secondary flex items-center gap-1.5 text-sm">
              <Pencil size={13} /> <span className="hidden sm:inline">Editar</span>
            </button>
            <button onClick={onDelete} className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Alert: received/inventariado but inventory not applied yet */}
      {['Recibido', 'Inventariado'].includes(order.status) && !order.inventory_applied && (
        <div className="mx-4 sm:mx-6 mt-3 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <Package size={16} className="text-amber-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">Artículos pendientes de ingresar al inventario</p>
            <p className="text-xs text-amber-600 mt-0.5">El pedido fue marcado como recibido pero los artículos aún no han sido ingresados.</p>
          </div>
          <button onClick={handleApplyInventory} disabled={applyingInv} className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-60 transition-colors">
            <Package size={12} /> {applyingInv ? 'Aplicando...' : 'Inventariar ahora'}
          </button>
        </div>
      )}

      {/* Proveedores */}
      {supplierList.length > 0 && (
        <div className="card">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Truck size={13} /> Proveedores
          </h3>
          <div className="space-y-2">
            {supplierList.map((s) => <SupplierChip key={s.id} supplier={s} />)}
          </div>
        </div>
      )}

      {/* Cotización vinculada */}
      {order.quote && (
        <div className="card">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <ClipboardList size={13} /> Cotización relacionada
          </h3>
          <div className="flex items-center gap-3 p-3 bg-violet-50 rounded-xl">
            {order.quote.quote_number && (
              <span className="text-xs font-mono text-violet-400 flex-shrink-0">{order.quote.quote_number}</span>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-violet-900 truncate">{order.quote.title}</p>
              {order.quote.client_name && <p className="text-xs text-violet-500 mt-0.5 truncate">{order.quote.client_name}</p>}
            </div>
            {order.quote.total && <span className="text-sm font-bold text-violet-700 flex-shrink-0">${order.quote.total}</span>}
            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-200 text-violet-700 font-medium flex-shrink-0">{order.quote.status}</span>
          </div>
        </div>
      )}

      {/* Ticket */}
      {order.ticket && (
        <div className="card">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <TicketIcon size={13} /> Ticket relacionado
          </h3>
          <a href={`/tickets/${order.ticket.id}`}
            className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors">
            <span className="text-xs font-mono text-blue-400 flex-shrink-0">#{order.ticket.id}</span>
            <span className="font-medium text-sm text-blue-800 flex-1 min-w-0 truncate">{order.ticket.title}</span>
          </a>
        </div>
      )}

      {/* Despachos vinculados */}
      {order.dispatches?.length > 0 && (
        <div className="card">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <PackageCheck size={13} /> {nounPlCap} generados
          </h3>
          <div className="space-y-2">
            {order.dispatches.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${DISPATCH_STATUS_STYLE[d.status] || 'bg-gray-100 text-gray-600'}`}>
                  {d.status}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{d.title}</p>
                  {(d.dispatch_number || d.date) && (
                    <p className="text-xs text-gray-400">
                      {d.dispatch_number && <span className="font-mono">{d.dispatch_number}</span>}
                      {d.dispatch_number && d.date && ' · '}
                      {d.date && fmtD(d.date + 'T12:00:00')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => onViewDispatch(d)}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors flex-shrink-0"
                >
                  Ver <ChevronRight size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Artículos */}
      <div className="card space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <Receipt size={13} /> Artículos de la compra
        </h3>
        {!hasItems ? (
          <p className="text-sm text-gray-400 italic">Sin artículos registrados.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm items-table-mobile">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Descripción</th>
                    <th className="text-center py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide w-16">Cant.</th>
                    <th className="text-right py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide w-24">Precio</th>
                    <th className="text-right py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide w-24">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.filter((it) => it.description?.trim()).map((it, i) => {
                    const line = (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0)
                    return (
                      <tr key={i}>
                        <td className="py-2 text-gray-800" data-label="Desc.">{it.description}</td>
                        <td className="py-2 text-center text-gray-600" data-label="Cant.">{it.qty}</td>
                        <td className="py-2 text-right text-gray-600" data-label="Precio">${fmtMoney(it.unit_price)}</td>
                        <td className="py-2 text-right font-medium text-gray-800" data-label="Subtotal">${fmtMoney(line)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-200 pt-2 space-y-1 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span><span>${fmtMoney(subtotal)}</span>
              </div>
              {order.itbms_enabled && (
                <div className="flex justify-between text-amber-600">
                  <span>ITBMS 7%</span><span>${fmtMoney(itbmsAmt)}</span>
                </div>
              )}
              {shippingCost > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Costo de entrega</span><span>${fmtMoney(shippingCost)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1">
                <span>Total</span><span className="text-blue-700">${fmtMoney(total)}</span>
              </div>
            </div>
          </>
        )}
        <div className="border-t border-gray-100 pt-3">
          <AttachmentSection
            orderId={order.id} docType="compra" label="" icon={null}
            attachments={order.attachments || []}
            onUploaded={onAttachmentChange} onDeleted={onAttachmentChange}
          />
        </div>
      </div>

      {/* Pago al proveedor */}
      {exp && (
        <div className={`card space-y-3 ${exp.is_payable && !exp.paid_at ? 'border border-red-200 bg-red-50/40' : ''}`}>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <CreditCard size={13} className={exp.is_payable && !exp.paid_at ? 'text-red-500' : 'text-emerald-500'} />
            Pago al proveedor
          </h3>

          {exp.paid_at ? (
            <div className="space-y-1.5">
              {editingPayment ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Fecha de pago</label>
                    <input type="date" value={editPaidAt} onChange={(e) => setEditPaidAt(e.target.value)}
                      className="input text-xs py-1" style={{ fontSize: '14px', maxWidth: 160 }} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5">Método de pago</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {PAY_METHODS.map(m => (
                        <button key={m} type="button" onClick={() => setEditPayMethod(m)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${editPayMethod === m ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input type="text" className="input text-xs py-1.5" style={{ fontSize: '14px' }}
                    placeholder="Nota de la transacción (opcional)"
                    value={editPayNote} onChange={(e) => setEditPayNote(e.target.value)} />
                  <div className="flex gap-2 items-center">
                    <button onClick={handleSaveEditPayment} disabled={savingPayment}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors">
                      <Save size={13} /> {savingPayment ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                    <button onClick={() => setEditingPayment(false)} disabled={savingPayment}
                      className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 text-sm text-emerald-700 flex-wrap">
                      <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />
                      <span>Pagado el <strong>{new Date(exp.paid_at + 'T12:00:00').toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></span>
                      <span className="text-gray-500 font-medium">{exp.amount}</span>
                      {exp.payment_method && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                          <Banknote size={10} /> {exp.payment_method}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={handleStartEditPayment} className="text-xs text-blue-500 hover:text-blue-700 transition-colors">
                        Editar
                      </button>
                      <button onClick={handleMarkUnpaid} disabled={savingPayment} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                        Revertir a pendiente
                      </button>
                    </div>
                  </div>
                  {exp.notes && (
                    <p className="text-xs text-gray-400 pl-5">{exp.notes}</p>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm text-red-700">
                <AlertTriangle size={15} className="text-red-500 flex-shrink-0" />
                <span className="font-medium">Pago pendiente</span>
                <span className="text-gray-600">{exp.amount}</span>
              </div>
              {/* Fecha de vencimiento */}
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500 whitespace-nowrap">Vence:</label>
                <input
                  type="date"
                  className="input text-xs py-1"
                  style={{ fontSize: '14px', maxWidth: 160 }}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  onBlur={handleSaveDueDate}
                />
              </div>
              {/* Método de pago */}
              <div>
                <p className="text-xs text-gray-500 mb-1.5">Método de pago</p>
                <div className="flex gap-1.5 flex-wrap">
                  {PAY_METHODS.map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPayMethod(m)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        payMethod === m
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              {/* Nota opcional */}
              <input
                type="text"
                className="input text-xs py-1.5"
                style={{ fontSize: '14px' }}
                placeholder="Nota de la transacción (opcional)"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
              />
              <button
                onClick={handleMarkPaid}
                disabled={savingPayment}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors self-start"
              >
                <CheckCircle2 size={13} />
                {savingPayment ? 'Guardando...' : 'Marcar como pagado'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Facturas del proveedor */}
      <div className="card">
        <AttachmentSection
          orderId={order.id} docType="proveedor"
          label="Facturas del proveedor" icon={<FileText size={13} />}
          attachments={order.attachments || []}
          onUploaded={onAttachmentChange} onDeleted={onAttachmentChange}
        />
      </div>

      {/* Meta */}
      {(order.expected_date || order.payment_terms || order.notes) && (
        <div className="card space-y-2">
          {order.expected_date && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Calendar size={12} /> Entrega esperada:
              <span className="font-medium">{fmtD(order.expected_date + 'T12:00:00')}</span>
            </div>
          )}
          {order.payment_terms && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>Términos de pago:</span>
              <span className={`px-2 py-0.5 rounded-full font-medium ${order.payment_terms === 'Contado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {order.payment_terms}
              </span>
            </div>
          )}
          {order.notes && (
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{order.notes}</p>
          )}
        </div>
      )}

      {/* Scheduled */}
      {order.scheduled_at && (
        <div className="card space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <CalendarDays size={13} className="text-purple-500" /> Agendado
          </h3>
          {editingRetiro ? (
            <div className="space-y-3">
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Fecha</label>
                  <input type="date" value={retiroForm.date}
                    onChange={(e) => setRetiroForm(f => ({ ...f, date: e.target.value }))}
                    className="input text-xs py-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Hora</label>
                  <input type="time" value={retiroForm.time}
                    onChange={(e) => setRetiroForm(f => ({ ...f, time: e.target.value }))}
                    className="input text-xs py-1" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveRetiro} disabled={savingRetiro}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-60 transition-colors">
                  <Save size={12} /> {savingRetiro ? 'Guardando…' : 'Guardar'}
                </button>
                <button onClick={() => setEditingRetiro(false)}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-sm font-medium text-gray-800">{fmtD(toUTC(order.scheduled_at).toISOString())} · {fmtTime(order.scheduled_at)}</p>
                <p className="text-xs text-gray-500">{order.duration_minutes || 60} min</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {order.status === 'Retiro Programado' && (
                  <button onClick={() => setEditingRetiro(true)}
                    className="text-xs text-orange-600 hover:text-orange-800 px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors border border-orange-200">
                    Editar fecha
                  </button>
                )}
                {order.calendar_event_link && (
                  <a href={order.calendar_event_link} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1.5 rounded-lg hover:bg-blue-50 transition-colors border border-blue-200">
                    <ExternalLink size={11} /> Ver en Calendar
                  </a>
                )}
                <button onClick={handleDeleteCalendarEvent}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors border border-red-200">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Programar retiro (sin Google Calendar) */}
      {order.status === 'Retiro Programado' && !order.scheduled_at && (
        <div className="card space-y-3 border border-orange-200 bg-orange-50/30">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <CalendarDays size={13} className="text-orange-500" /> Programar fecha de retiro
          </h3>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Fecha</label>
              <input type="date" value={retiroForm.date}
                onChange={(e) => setRetiroForm(f => ({ ...f, date: e.target.value }))}
                className="input text-xs py-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Hora</label>
              <input type="time" value={retiroForm.time}
                onChange={(e) => setRetiroForm(f => ({ ...f, time: e.target.value }))}
                className="input text-xs py-1" />
            </div>
          </div>
          <button onClick={handleSaveRetiro} disabled={savingRetiro}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-60 transition-colors">
            <Save size={13} /> {savingRetiro ? 'Guardando…' : 'Guardar fecha de retiro'}
          </button>
        </div>
      )}
    </div>

    {/* Calendar Modal */}
    {showCalendarModal && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
            <h3 className="font-semibold text-gray-900">Agendar en Google Calendar</h3>
            <button onClick={() => setShowCalendarModal(false)}><X size={18} className="text-gray-400" /></button>
          </div>
          <div className="overflow-y-auto flex-1 p-5 space-y-4">
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <p className="text-xs font-semibold text-purple-700 mb-1">Evento en Google Calendar:</p>
              <p className="text-xs text-purple-600 font-mono break-all">
                Pedido #{order.id} - {order.title}{order.supplier1 ? ` - ${order.supplier1.name}` : ''}
              </p>
            </div>

            <div>
              <label className="label">Fecha *</label>
              <input type="date" className="input" value={calForm.date}
                onChange={(e) => setCalForm((f) => ({ ...f, date: e.target.value }))} />
            </div>

            <div>
              <label className="label">Hora *</label>
              <div className="flex gap-2">
                <select className="input flex-1" value={calForm.hour}
                  onChange={(e) => setCalForm((f) => ({ ...f, hour: e.target.value }))}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                  ))}
                </select>
                <select className="input flex-1" value={calForm.minute}
                  onChange={(e) => setCalForm((f) => ({ ...f, minute: e.target.value }))}>
                  {['00','05','10','15','20','25','30','35','40','45','50','55'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select className="input w-24" value={calForm.ampm}
                  onChange={(e) => setCalForm((f) => ({ ...f, ampm: e.target.value }))}>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>

            {/* After-hours warning */}
            {(() => {
              let h = parseInt(calForm.hour, 10)
              if (calForm.ampm === 'PM' && h !== 12) h += 12
              if (calForm.ampm === 'AM' && h === 12) h = 0
              return h >= 18 ? (
                <p className="flex items-center gap-1 text-xs text-amber-600">
                  <AlertTriangle size={12} /> Fuera de horario laboral
                </p>
              ) : null
            })()}

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Duración</label>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                  <button type="button" onClick={() => setCalForm((f) => ({ ...f, endMode: 'duration' }))}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${calForm.endMode === 'duration' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                    Duración
                  </button>
                  <button type="button" onClick={() => setCalForm((f) => ({ ...f, endMode: 'endtime' }))}
                    className={`px-3 py-1 text-xs font-medium transition-colors border-l border-gray-200 ${calForm.endMode === 'endtime' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                    Hora de fin
                  </button>
                </div>
              </div>
              {calForm.endMode === 'duration' ? (
                <div className="flex gap-2 flex-wrap">
                  {[30, 60, 90, 120, 180, 240].map((m) => (
                    <button key={m} type="button" onClick={() => setCalForm((f) => ({ ...f, duration_minutes: m }))}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${parseInt(calForm.duration_minutes) === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                      {m < 60 ? `${m} min` : `${m / 60}h${m % 60 ? ` ${m % 60}m` : ''}`}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <select className="input flex-1" value={calForm.endHour}
                      onChange={(e) => setCalForm((f) => ({ ...f, endHour: e.target.value }))}>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                        <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                      ))}
                    </select>
                    <select className="input flex-1" value={calForm.endMinute}
                      onChange={(e) => setCalForm((f) => ({ ...f, endMinute: e.target.value }))}>
                      {['00','05','10','15','20','25','30','35','40','45','50','55'].map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <select className="input w-24" value={calForm.endAmpm}
                      onChange={(e) => setCalForm((f) => ({ ...f, endAmpm: e.target.value }))}>
                      <option value="AM">AM</option>
                      <option value="PM">PM</option>
                    </select>
                  </div>
                  {calForm.date && (() => {
                    const mins = getCalEffectiveDuration()
                    return mins > 0
                      ? <p className="text-xs text-gray-400 mt-1.5">Duración: {mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`}</p>
                      : <p className="text-xs text-red-400 mt-1.5">La hora de fin debe ser posterior</p>
                  })()}
                </>
              )}
            </div>

            <div>
              <label className="label">Ubicación</label>
              <input className="input" placeholder="Ej: Almacén principal"
                value={calForm.location}
                onChange={(e) => setCalForm((f) => ({ ...f, location: e.target.value }))} />
            </div>
            <div>
              <label className="label">Notas</label>
              <textarea className="input h-16 resize-none" value={calForm.notes}
                onChange={(e) => setCalForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <p className="text-xs text-gray-400">Requiere Google Calendar conectado.</p>
          </div>
          <div className="flex justify-end gap-3 p-5 border-t flex-shrink-0">
            <button onClick={() => setShowCalendarModal(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleCalendarEvent} disabled={!calForm.date || creatingEvent}
              className="btn-primary flex items-center gap-2 disabled:opacity-60">
              <Calendar size={14} />
              {creatingEvent ? 'Creando...' : (order.calendar_event_id ? 'Reagendar' : 'Crear evento')}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

// ── Form ────────────────────────────────────────────────
function OrderForm({ form, setForm, suppliers, tickets, quotes, onSave, onCancel, saving, isEdit, onBack, onSupplierCreated }) {
  const [isDirty, setIsDirty] = useState(false)
  useFormGuard(isDirty)
  const set = (field) => (e) => { setIsDirty(true); setForm((f) => ({ ...f, [field]: e.target.value })) }

  // Item editor helpers
  const setItem = (i, field, val) => { setIsDirty(true); setForm((f) => ({ ...f, items: f.items.map((it, idx) => idx === i ? { ...it, [field]: val } : it) })) }
  const addItem = () => { setIsDirty(true); setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] })) }
  const removeItem = (i) => { setIsDirty(true); setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) })) }

  const formShippingCost = parseFloat(form.shipping_cost || '0') || 0
  const { subtotal, itbmsAmt, total } = calcTotals(form.items, form.itbms_enabled, formShippingCost)

  // Supplier slot dedup
  const usedIds = [form.supplier1_id, form.supplier2_id, form.supplier3_id].filter(Boolean).map(Number)
  const availableFor = (slot) =>
    suppliers.filter((s) => {
      const id = Number(s.id)
      const slotVal = Number(form[slot])
      return id === slotVal || !usedIds.includes(id) || slotVal === id
    })

  // Quick-add supplier modal
  const [quickSlot, setQuickSlot] = useState(null)
  const [quickForm, setQuickForm] = useState({ name: '', category: '', phone: '', email: '' })
  const [creatingSup, setCreatingSup] = useState(false)
  const [quickCategoryOptions, setQuickCategoryOptions] = useState([...SUPPLIER_CATEGORIES])
  const [showQuickCatModal, setShowQuickCatModal] = useState(false)
  const [newQuickCatName, setNewQuickCatName] = useState('')

  const handleAddQuickCategory = () => {
    const name = newQuickCatName.trim()
    if (!name) return
    if (!quickCategoryOptions.includes(name)) setQuickCategoryOptions((prev) => [...prev, name])
    setQuickForm((f) => ({ ...f, category: name }))
    setShowQuickCatModal(false)
    setNewQuickCatName('')
  }

  const openQuickSupplier = (slot) => {
    setQuickForm({ name: '', category: '', phone: '', email: '' })
    setQuickSlot(slot)
  }

  const handleCreateQuickSupplier = async () => {
    if (!quickForm.name.trim()) return
    setCreatingSup(true)
    try {
      const res = await createSupplier({
        name: quickForm.name,
        category: quickForm.category || null,
        phone: quickForm.phone || null,
        email: quickForm.email || null,
      })
      const newSup = res.data
      onSupplierCreated(newSup)
      setForm((f) => ({ ...f, [quickSlot]: newSup.id }))
      setQuickSlot(null)
      toast.success(`Proveedor "${newSup.name}" creado`)
    } catch {
      toast.error('Error creando proveedor')
    } finally {
      setCreatingSup(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      <button onClick={onBack} className="md:hidden flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={16} /> Volver
      </button>
      <h2 className="text-lg font-bold text-gray-900 mb-5">{isEdit ? 'Editar pedido' : 'Nuevo pedido'}</h2>

      <form id="order-form" onSubmit={onSave} className="space-y-4 sticky-footer-form">
        {/* Info básica */}
        <div className="card space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Título del pedido *</label>
              <input className="input w-full" value={form.title} onChange={set('title')} placeholder="Ej: Compra de laptops para oficina" required style={{fontSize:'16px'}} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">N° de pedido</label>
              <input className="input w-full font-mono" value={form.order_number} onChange={set('order_number')} placeholder="PED-0001" style={{fontSize:'16px'}} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Estado</label>
              <select className="input w-full" value={form.status} onChange={set('status')} style={{fontSize:'16px'}}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fecha esperada de entrega</label>
              <input className="input w-full" type="date" value={form.expected_date} onChange={set('expected_date')} style={{fontSize:'16px'}} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notas generales</label>
            <textarea className="input w-full h-16 resize-none" value={form.notes} onChange={set('notes')} placeholder="Observaciones del pedido..." style={{fontSize:'16px'}} />
          </div>
        </div>

        {/* Proveedores */}
        <div className="card space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <Truck size={13} /> Proveedores (hasta 3)
          </h3>
          {['supplier1_id', 'supplier2_id', 'supplier3_id'].map((slot, i) => (
            <div key={slot} className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-4 text-center flex-shrink-0">{i + 1}</span>
              <select className="input flex-1 text-sm" value={form[slot]} onChange={set(slot)} style={{fontSize:'16px'}}>
                <option value="">— Sin proveedor —</option>
                {availableFor(slot).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.category ? ` (${s.category})` : ''}</option>
                ))}
              </select>
              {form[slot] && (
                <button type="button" onClick={() => { setIsDirty(true); setForm((f) => ({ ...f, [slot]: '' })) }} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                  <X size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => openQuickSupplier(slot)}
                title="Nuevo proveedor"
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-dashed border-blue-300 text-blue-500 hover:bg-blue-50 active:bg-blue-100 transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Cotización */}
        <div className="card space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <ClipboardList size={13} /> Cotización relacionada (opcional)
          </h3>
          <QuoteSearch quotes={quotes} value={form.quote_id} onChange={(id) => { setIsDirty(true); setForm((f) => ({ ...f, quote_id: id })) }} />
        </div>

        {/* Ticket */}
        <div className="card space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <TicketIcon size={13} /> Ticket relacionado (opcional)
          </h3>
          <TicketSearch tickets={tickets} value={form.ticket_id} onChange={(id) => { setIsDirty(true); setForm((f) => ({ ...f, ticket_id: id })) }} />
        </div>

        {/* Artículos */}
        <div className="card">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-3">
            <Receipt size={13} /> Artículos
          </h3>
          <ItemEditor
            items={form.items}
            onChange={setItem}
            onRemove={removeItem}
            onAdd={addItem}
            itbms={form.itbms_enabled}
            onItbmsChange={v => { setIsDirty(true); setForm(f => ({ ...f, itbms_enabled: v })) }}
          />
          <div className="mt-3 flex justify-end">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <label className="whitespace-nowrap">Costo de entrega $</label>
              <input
                type="number" min="0" step="0.01"
                className="input w-28 text-right text-sm"
                placeholder="0.00"
                value={form.shipping_cost}
                onChange={e => { setIsDirty(true); setForm(f => ({ ...f, shipping_cost: e.target.value })) }}
                style={{fontSize:'16px'}}
              />
            </div>
          </div>

          {/* Atribución por proveedor — visible solo cuando hay ≥1 proveedor y ≥1 ítem */}
          {(() => {
            const orderSuppliers = suppliers.filter(s =>
              [form.supplier1_id, form.supplier2_id, form.supplier3_id]
                .filter(Boolean).map(Number).includes(Number(s.id))
            )
            const filledItems = form.items.filter(it => it.description || it.code)
            if (!orderSuppliers.length || !filledItems.length) return null
            return (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-3">
                  <Truck size={13} /> Atribución por proveedor
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400 border-b border-gray-100">
                        <th className="text-left pb-1.5 font-medium w-6">#</th>
                        <th className="text-left pb-1.5 font-medium">Descripción</th>
                        <th className="text-right pb-1.5 font-medium pr-2">Monto</th>
                        <th className="text-left pb-1.5 font-medium">Proveedor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.items.map((it, idx) => {
                        if (!it.description && !it.code) return null
                        const lineAmt = (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0)
                        return (
                          <tr key={idx} className="border-b border-gray-50 last:border-0">
                            <td className="py-1 pr-2 text-xs text-gray-400">{idx + 1}</td>
                            <td className="py-1 pr-2 text-sm text-gray-700 truncate max-w-[200px]">{it.description || it.code}</td>
                            <td className="py-1 pr-2 text-right text-sm text-gray-600 whitespace-nowrap">${lineAmt.toFixed(2)}</td>
                            <td className="py-1">
                              <select
                                className="input text-xs py-1"
                                style={{ fontSize: '16px', minWidth: '130px' }}
                                value={it.supplier_id || ''}
                                onChange={e => { setIsDirty(true); setItem(idx, 'supplier_id', e.target.value ? Number(e.target.value) : null) }}
                              >
                                <option value="">Sin asignar</option>
                                {orderSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </select>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Subtotales por proveedor */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {orderSuppliers.map(s => {
                    const tot = form.items
                      .filter(it => Number(it.supplier_id) === Number(s.id))
                      .reduce((sum, it) => sum + (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0), 0)
                    return (
                      <div key={s.id} className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 text-sm">
                        <span className="text-gray-600 font-medium truncate max-w-[120px]">{s.name}</span>
                        <span className="font-bold text-amber-700">${tot.toFixed(2)}</span>
                      </div>
                    )
                  })}
                  {form.items.some(it => !it.supplier_id && (it.description || it.code)) && (
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-400">
                      Sin asignar: ${form.items
                        .filter(it => !it.supplier_id && (it.description || it.code))
                        .reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0), 0).toFixed(2)}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
        </div>

      </form>

      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 sm:px-6 py-3 flex items-center gap-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] z-10 -mx-4 sm:-mx-6">
        <span className={`text-xs flex items-center gap-1.5 ${isDirty ? 'text-amber-600' : 'text-gray-300'}`}>
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${isDirty ? 'bg-amber-500 animate-pulse' : 'bg-gray-300'}`} />
          {isDirty ? 'Sin guardar' : 'Sin cambios'}
        </span>
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm py-1.5 px-3">Cancelar</button>
          <button type="submit" form="order-form" disabled={saving} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
            <Save size={13} />
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear pedido'}
          </button>
        </div>
      </div>

      {/* Quick-add supplier modal */}
      {quickSlot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Truck size={16} /> Nuevo proveedor
              </h3>
              <button type="button" onClick={() => setQuickSlot(null)}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                <input
                  className="input w-full"
                  value={quickForm.name}
                  onChange={(e) => setQuickForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nombre del proveedor"
                  autoFocus
                  style={{fontSize:'16px'}}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Categoría</label>
                <QuickCategoryInput
                  value={quickForm.category}
                  onChange={(val) => setQuickForm((f) => ({ ...f, category: val }))}
                  categories={quickCategoryOptions}
                  onNew={() => { setNewQuickCatName(quickForm.category.trim()); setShowQuickCatModal(true) }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
                  <input className="input w-full" value={quickForm.phone} onChange={(e) => setQuickForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+507 000-0000" style={{fontSize:'16px'}} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input className="input w-full" type="email" value={quickForm.email} onChange={(e) => setQuickForm((f) => ({ ...f, email: e.target.value }))} placeholder="email@empresa.com" style={{fontSize:'16px'}} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t">
              <button type="button" onClick={() => setQuickSlot(null)} className="btn-secondary">Cancelar</button>
              <button
                type="button"
                onClick={handleCreateQuickSupplier}
                disabled={!quickForm.name.trim() || creatingSup}
                className="btn-primary"
              >
                {creatingSup ? 'Creando...' : 'Crear proveedor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showQuickCatModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <FileText size={16} /> Nueva categoría
              </h3>
              <button type="button" onClick={() => setShowQuickCatModal(false)}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <div className="p-5">
              <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
              <input
                className="input w-full"
                style={{ fontSize: '16px' }}
                value={newQuickCatName}
                onChange={(e) => setNewQuickCatName(e.target.value)}
                placeholder="Ej: Logística, Seguros..."
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddQuickCategory()}
              />
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button type="button" onClick={() => setShowQuickCatModal(false)} className="btn-secondary">
                Cancelar
              </button>
              <button type="button" onClick={handleAddQuickCategory} disabled={!newQuickCatName.trim()} className="btn-primary">
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
