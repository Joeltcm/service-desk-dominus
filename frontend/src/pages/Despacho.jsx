import React, { useEffect, useState, useCallback, useRef } from 'react'
import { openPdfWindow, sharePdfFromHtml } from '../utils/pdfViewer'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import {
  getDispatches, createDispatch, updateDispatch, deleteDispatch, cancelDispatch, getNextDispatchNumber,
  getOrders, getQuotes, getContacts, getCompanies, getAgents,
  uploadDispatchAttachment, deleteDispatchAttachment, dispatchAttachmentDownloadUrl,
  downloadWithAuth,
  createDispatchCalendarEvent, deleteDispatchCalendarEvent, getCalendarAuthUrl,
  createInvoiceFromDispatch,
  getDispatchTimeline, addDispatchTimeline, updateDispatchTimeline, deleteDispatchTimeline, getDispatchTasks, addDispatchTask, updateDispatchTask, deleteDispatchTask,
  getDispatchParts, addDispatchPart, deleteDispatchPart, searchInventory,
} from '../services/api'
import {
  Search, Plus, Pencil, Trash2, ChevronRight, ChevronDown, ArrowLeft,
  PackageCheck, FileText, X, CheckCircle2, Clock, Send,
  XCircle, Printer, Receipt, Download, Upload, FileCheck, Save,
  Ticket as TicketIcon, Building2, FilePlus2, Calendar, ExternalLink, CalendarDays, Share2,
  Tag, ShieldCheck, AlertTriangle,
  User, MessageSquare, CheckSquare, Square, History as HistoryIcon, ListChecks, Wrench,
} from 'lucide-react'
import { fmtD, fmtTime, toUTC, getFmtTz } from '../utils/fmt'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import toast from 'react-hot-toast'
import { useFormGuard } from '../context/UnsavedChangesContext'
import ItemEditor, { EMPTY_ITEM, parseItems, calcTotals } from '../components/ItemEditor'
import { getCompanyCache, useCompany } from '../context/CompanyContext'
import { useAuth } from '../context/AuthContext'
import { useModuleAccess } from '../context/RoleFeaturesContext'
import { useModules } from '../context/ModulesContext'

const STATUSES = ['Borrador', 'Emitido', 'Despacho Programado', 'Entregado', 'Cancelado']

const STATUS_STYLE = {
  'Borrador':            'bg-gray-100 text-gray-600',
  'Emitido':             'bg-blue-100 text-blue-700',
  'Despacho Programado': 'bg-cyan-100 text-cyan-700',
  'Entregado':           'bg-green-100 text-green-700',
  'Cancelado':           'bg-red-100 text-red-600',
}

const STATUS_ICON = {
  'Borrador':            <Clock size={11} />,
  'Emitido':             <Send size={11} />,
  'Despacho Programado': <CalendarDays size={11} />,
  'Entregado':           <CheckCircle2 size={11} />,
  'Cancelado':           <XCircle size={11} />,
}

function fmtMoney(n) { return Number(n || 0).toFixed(2) }

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'}`}>
      {STATUS_ICON[status]} {status}
    </span>
  )
}

// ── Print ─────────────────────────────────────────────
function buildDispatchHTML(d, items, origin) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const { subtotal, itbmsAmt, total } = calcTotals(items, d.itbms_enabled)
  const fmtDate = (iso) => fmtD(iso)
  const co = getCompanyCache()
  const itMode = co.vertical === 'it_support'
  const docTitle = itMode ? 'PEDIDO' : 'DESPACHO DE MERCANCÍA'
  const coName    = esc(co.company_name    || 'Service Desk')
  const coAddress = esc(co.company_address || 'Panamá, Punta Pacífica, PH Pacific Wind')
  const coRuc     = esc(co.company_ruc     || '4-754-575 DV 85')

  const rows = items.filter((it) => it.description?.trim()).map((it, i) => {
    const line = (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0)
    return `<tr style="background:${i % 2 === 0 ? '#f8f9fb' : '#fff'}">
      <td style="padding:6px 10px;border:1px solid #d1d5db">${i + 1}</td>
      <td style="padding:6px 10px;border:1px solid #d1d5db">${esc(it.description)}</td>
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
        <div style="font-size:15pt;font-weight:bold;color:#1e3a5f">${docTitle}</div>
        <div style="font-size:10pt;color:#444;margin-top:4px;font-family:monospace">N° ${esc(d.dispatch_number || String(d.id))}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
      ${d.client_name ? `<div style="padding:5px 8px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px"><div style="font-size:6.5pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px">Cliente</div><div style="font-size:8.5pt;font-weight:600;color:#111">${esc(d.client_name)}</div></div>` : ''}
      ${d.client_ruc ? `<div style="padding:5px 8px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px"><div style="font-size:6.5pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px">RUC</div><div style="font-size:8.5pt;font-weight:600;color:#111">${esc(d.client_ruc)}</div></div>` : ''}
      ${d.client_address ? `<div style="padding:5px 8px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px"><div style="font-size:6.5pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px">Dirección</div><div style="font-size:8.5pt;font-weight:600;color:#111">${esc(d.client_address)}</div></div>` : ''}
      <div style="padding:5px 8px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px"><div style="font-size:6.5pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px">Fecha</div><div style="font-size:8.5pt;font-weight:600;color:#111">${esc(fmtDate(d.date || ''))}</div></div>
      <div style="padding:5px 8px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px"><div style="font-size:6.5pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px">Estado</div><div style="font-size:8.5pt;font-weight:600;color:#111">${esc(d.status)}</div></div>
    </div>

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
        ${d.itbms_enabled ? `<div style="display:flex;justify-content:space-between;padding:6px 12px;background:#fffbeb;font-size:9.5pt">
          <span style="color:#b45309">ITBMS 7%</span><span style="font-weight:600;color:#b45309">$${fmtMoney(itbmsAmt)}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#1e3a5f;font-size:10.5pt">
          <span style="color:#fff;font-weight:bold">TOTAL</span><span style="color:#fff;font-weight:bold">$${fmtMoney(total)}</span>
        </div>
      </div>
    </div>

    ${d.notes ? `<div style="margin-top:16px;padding:10px 14px;background:#f8f9fb;border:1px solid #ddd;border-radius:6px">
      <div style="font-size:9.5pt;font-weight:bold;color:#444;margin-bottom:4px">OBSERVACIONES:</div>
      <div style="font-size:9pt;white-space:pre-wrap">${esc(d.notes)}</div>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:32px;page-break-inside:avoid">
      <div style="text-align:center"><div style="border-bottom:1.5px solid #333;margin-bottom:6px;height:40px"></div><div style="font-size:9pt;font-weight:bold;color:#333">Firma del Responsable</div><div style="font-size:8.5pt;color:#666">${coName}</div></div>
      <div style="text-align:center"><div style="border-bottom:1.5px solid #333;margin-bottom:6px;height:40px"></div><div style="font-size:9pt;font-weight:bold;color:#333">Firma del Receptor</div>${d.client_name ? `<div style="font-size:8.5pt;color:#666">${esc(d.client_name)}</div>` : ''}</div>
    </div>

    <div style="margin-top:24px;padding-top:10px;border-top:1px solid #ddd;font-size:7.5pt;color:#888;text-align:center">
      ${coName} • ${coAddress} • RUC: ${coRuc} • N° ${esc(d.dispatch_number || String(d.id))}
    </div>
  </div>`
}

function openDispatchWindow(d, bodyHTML, autoprint) {
  const _noun = getCompanyCache().vertical === 'it_support' ? 'Pedido' : 'Despacho'
  const ok = openPdfWindow(`${_noun} ${d.dispatch_number || d.id}`, bodyHTML, { autoprint })
  if (!ok) toast.error('El navegador bloqueó la ventana emergente')
}

// ── Dispatch Attachment Section ────────────────────────
function DispatchAttachmentSection({ dispatchId, docType, label, icon, attachments, onUploaded, onDeleted }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const mine = attachments.filter((a) => a.doc_type === docType)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      await uploadDispatchAttachment(dispatchId, file, docType)
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
      await deleteDispatchAttachment(dispatchId, att.id)
      onDeleted()
    } catch {
      toast.error('Error eliminando archivo')
    }
  }

  const fileIcon = (ct = '') => {
    if (ct.startsWith('image/')) return '🖼️'
    if (ct === 'application/pdf') return '📄'
    if (ct.includes('word')) return '📝'
    if (ct.includes('excel') || ct.includes('spreadsheet')) return '📊'
    return '📎'
  }
  const fmtSize = (b) => {
    if (!b) return ''
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
    return `${(b / 1024 / 1024).toFixed(1)} MB`
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
              <button onClick={() => downloadWithAuth(dispatchAttachmentDownloadUrl(dispatchId, att.id), att.original_name)}
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

// ── Main page ─────────────────────────────────────────
const EMPTY_FORM = {
  title: '', dispatch_number: '', order_id: '', quote_id: '', assigned_to_id: '',
  client_name: '', client_ruc: '', client_address: '',
  date: new Date().toISOString().slice(0, 10),
  delivery_date: '',
  status: 'Borrador', notes: '',
  items: [{ ...EMPTY_ITEM }],
  itbms_enabled: false,
}

export default function Despacho() {
  const location = useLocation()
  const navigate = useNavigate()
  const { ref: urlRef } = useParams()
  const { vertical } = useCompany()
  const itMode = vertical === 'it_support'
  const noun = itMode ? 'pedido' : 'despacho'
  const Noun = itMode ? 'Pedido' : 'Despacho'
  const nounPl = itMode ? 'pedidos' : 'despachos'
  const NounPl = itMode ? 'Pedidos' : 'Despachos'
  const { canWrite } = useModuleAccess()
  const canEditPedidos = canWrite('pedidos')
  const { modules } = useModules()
  const [dispatches, setDispatches] = useState([])
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [orders, setOrders] = useState([])
  const [quotes, setQuotes] = useState([])
  const [agents, setAgents] = useState([])
  const [quotesLoaded, setQuotesLoaded] = useState(false)
  const [pendingSelectId, setPendingSelectId] = useState(null)
  const [pendingFromOrder, setPendingFromOrder] = useState(null)

  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 320)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    getDispatches({ search: debouncedSearch || undefined, status: filterStatus || undefined })
      .then((r) => setDispatches(r.data))
      .catch(() => toast.error(`Error cargando ${nounPl}`))
  }, [debouncedSearch, filterStatus])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    getOrders().then((r) => setOrders(r.data)).catch(() => {})
    getAgents().then((r) => setAgents(r.data)).catch(() => {})
  }, [])
  // Cotizaciones: solo se cargan si el módulo está habilitado (respeta el toggle del
  // sysadmin). Si está apagado, se omite la llamada para no generar 403 innecesarios.
  useEffect(() => {
    if (modules === null) return
    if (modules.cotizaciones !== false) {
      getQuotes().then((r) => { setQuotes(r.data); setQuotesLoaded(true) }).catch(() => setQuotesLoaded(true))
    } else {
      setQuotes([]); setQuotesLoaded(true)
    }
  }, [modules])

  // Handle navigation from Orders page ("Ver despacho")
  useEffect(() => {
    const id = location.state?.selectDispatchId
    if (!id) return
    window.history.replaceState({}, '')
    setPendingSelectId(id)
  }, [location.state])

  useEffect(() => {
    if (!pendingSelectId || dispatches.length === 0) return
    const found = dispatches.find((d) => d.id === pendingSelectId)
    if (found) {
      setSelected(found)
      setShowForm(false)
      setMobileDetailOpen(true)
      setPendingSelectId(null)
    }
  }, [dispatches, pendingSelectId])

  // Handle navigation from Orders page ("Convertir a despacho") — step 1: capture
  useEffect(() => {
    const fromOrder = location.state?.fromOrder
    if (!fromOrder) return
    window.history.replaceState({}, '')
    setPendingFromOrder(fromOrder)
  }, [location.state])

  // Step 2: apply once quotes are loaded so we inherit quote sale prices
  useEffect(() => {
    if (!pendingFromOrder || !quotesLoaded) return
    getNextDispatchNumber().then((r) => r.data.number).catch(() => (itMode ? 'PED-0001' : 'DSP-0001')).then((num) => {
    const linkedQuote = quotes.find((q) => q.order_id === pendingFromOrder.id)
    const rawItems = linkedQuote?.items || pendingFromOrder.purchase_items
    const items = parseItems(rawItems)
    setSelected(null)
    setForm({
      ...EMPTY_FORM,
      dispatch_number: num,
      date: new Date().toISOString().slice(0, 10),
      title: pendingFromOrder.title || '',
      order_id: pendingFromOrder.id,
      items: items.some((it) => it.description?.trim()) ? items : [{ ...EMPTY_ITEM }],
      itbms_enabled: (linkedQuote ?? pendingFromOrder).itbms_enabled ?? false,
    })
    setShowForm(true)
    setMobileDetailOpen(true)
    setPendingFromOrder(null)
    }) // end getNextDispatchNumber.then
  }, [pendingFromOrder, quotesLoaded, quotes])

  // Auto-select from URL param (e.g. /despacho/DSP-0001)
  useEffect(() => {
    if (!urlRef) { if (selected) { setSelected(null); setMobileDetailOpen(false) } return }
    if (dispatches.length === 0) return
    if (selected?.dispatch_number === urlRef || String(selected?.id) === urlRef) return
    const found = dispatches.find((d) => d.dispatch_number === urlRef || String(d.id) === urlRef)
    if (found) { setSelected(found); setShowForm(false); setMobileDetailOpen(true) }
  }, [urlRef, dispatches])

  const refreshSelected = useCallback((id) => {
    getDispatches().then((r) => {
      const fresh = r.data.find((d) => d.id === id)
      if (fresh) setSelected(fresh)
      setDispatches(r.data)
    }).catch(() => {})
  }, [])

  const handleSelect = (d) => { setSelected(d); setShowForm(false); setMobileDetailOpen(true); navigate(`/pedidos/${d.dispatch_number || d.id}`) }

  const handleNew = async () => {
    setSelected(null)
    const num = await getNextDispatchNumber().then((r) => r.data.number).catch(() => (itMode ? 'PED-0001' : 'DSP-0001'))
    setForm({ ...EMPTY_FORM, dispatch_number: num, date: new Date().toISOString().slice(0, 10) })
    setShowForm(true)
    setMobileDetailOpen(true)
  }

  const handleEdit = () => {
    setForm({
      title: selected.title || '',
      dispatch_number: selected.dispatch_number || '',
      order_id: selected.order_id ?? '',
      quote_id: selected.quote_id ?? '',
      assigned_to_id: selected.assigned_to_id ?? '',
      client_name: selected.client_name || '',
      client_ruc: selected.client_ruc || '',
      client_address: selected.client_address || '',
      date: selected.date || new Date().toISOString().slice(0, 10),
      delivery_date: selected.delivery_date || '',
      status: selected.status || 'Borrador',
      notes: selected.notes || '',
      items: parseItems(selected.items),
      itbms_enabled: selected.itbms_enabled ?? false,
    })
    setShowForm(true)
  }

  const handleStatusChange = async (newStatus) => {
    try {
      const res = await updateDispatch(selected.id, { status: newStatus })
      setSelected(res.data)
      load()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error actualizando estado', { duration: 6000 })
    }
  }

  const handleAssignChange = async (dispatch, techId) => {
    try {
      const res = await updateDispatch(dispatch.id, { assigned_to_id: techId ? Number(techId) : null })
      setSelected(res.data)
      load()
      toast.success(techId ? 'Técnico asignado' : 'Asignación quitada')
    } catch {
      toast.error('Error al asignar técnico')
    }
  }

  const handleCancelDispatch = async () => {
    if (!selected) return
    const ok = window.confirm(
      '¿Cancelar este pedido?\n\nSe eliminará el certificado de garantía vinculado (si existe) y los artículos se devolverán al inventario. Esta acción no se puede deshacer.'
    )
    if (!ok) return
    try {
      const res = await cancelDispatch(selected.id)
      setSelected(res.data)
      load()
      toast.success('Pedido cancelado: inventario devuelto y garantía eliminada')
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error cancelando el pedido')
    }
  }

  const handleDeliveryDateChange = async (newDate) => {
    try {
      const res = await updateDispatch(selected.id, { delivery_date: newDate || null })
      setSelected(res.data)
    } catch {
      toast.error('Error guardando fecha de entrega')
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return toast.error('El título es requerido')
    if (!itMode && form.status !== 'Borrador' && form.status !== 'Cancelado' && !form.quote_id) return toast.error(`Se requiere una cotización vinculada para cambiar el estado del ${noun}`)
    const validItems = form.items.filter((it) => it.description?.trim())
    const { subtotal, itbmsAmt, total } = calcTotals(validItems, form.itbms_enabled)
    const payload = {
      title: form.title,
      dispatch_number: form.dispatch_number || null,
      order_id: form.order_id ? Number(form.order_id) : null,
      quote_id: form.quote_id ? Number(form.quote_id) : null,
      assigned_to_id: form.assigned_to_id ? Number(form.assigned_to_id) : null,
      client_name: form.client_name || null,
      client_ruc: form.client_ruc || null,
      client_address: form.client_address || null,
      date: form.date || null,
      delivery_date: form.delivery_date || null,
      status: form.status,
      notes: form.notes || null,
      items: validItems.length ? JSON.stringify(validItems) : null,
      itbms_enabled: form.itbms_enabled,
      subtotal: `$${fmtMoney(subtotal)}`,
      itbms_amount: form.itbms_enabled ? `$${fmtMoney(itbmsAmt)}` : null,
      total: `$${fmtMoney(total)}`,
    }
    setSaving(true)
    try {
      if (selected && showForm) {
        const res = await updateDispatch(selected.id, payload)
        setSelected(res.data)
        toast.success(`${Noun} actualizado`)
      } else {
        const res = await createDispatch(payload)
        setSelected(res.data)
        toast.success(`${Noun} guardado en la lista`)
      }
      setShowForm(false)
      load()
    } catch (err) {
      const detail = err?.response?.data?.detail
      let msg
      if (Array.isArray(detail) && detail.length) {
        msg = detail.map((d) => `${(d.loc || []).slice(1).join('.')}: ${d.msg}`).join('; ')
      } else {
        msg = (typeof detail === 'string' && detail) || `Error guardando ${noun}`
      }
      console.error('Error guardando despacho:', err?.response?.data)
      toast.error(msg, { duration: 6000 })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (d) => {
    if (!confirm(`¿Eliminar el ${noun} "${d.title}"?`)) return
    try {
      await deleteDispatch(d.id)
      toast.success(`${Noun} eliminado`)
      if (selected?.id === d.id) { setSelected(null); setMobileDetailOpen(false); navigate('/pedidos', { replace: true }) }
      load()
    } catch {
      toast.error(`Error eliminando ${noun}`)
    }
  }

  const handleBack = () => { setMobileDetailOpen(false); setShowForm(false); setSelected(null); navigate('/pedidos') }
  const detailSwipe = useTouchSwipe({ onSwipeRight: handleBack })

  const handlePrint = (d, autoprint = true) => {
    const items = parseItems(d.items)
    const origin = window.location.origin
    openDispatchWindow(d, buildDispatchHTML(d, items, origin), autoprint)
  }

  const handleShare = async (d) => {
    const items = parseItems(d.items)
    const origin = window.location.origin
    const filename = `${Noun}-${d.dispatch_number || d.id}.pdf`
    await sharePdfFromHtml(`${Noun} ${d.dispatch_number || d.id}`, buildDispatchHTML(d, items, origin), filename)
  }

  const displayedDispatches = onlyUnassigned ? dispatches.filter((d) => !d.assigned_to_id) : dispatches

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Vista lista: tabla full-width (estilo Tickets) */}
      <div className={`${(!selected && !showForm) ? 'flex' : 'hidden'} flex-1 flex-col bg-gray-50 overflow-hidden`}>
        <div className="px-4 sm:px-6 py-4 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{NounPl}</h1>
            <p className="text-xs text-gray-400 mt-0.5">{dispatches.length} {nounPl}</p>
          </div>
          {canEditPedidos && (
            <button onClick={handleNew} className="btn-primary flex items-center gap-1.5 text-sm px-3.5 py-2">
              <Plus size={15} /> Nuevo
            </button>
          )}
        </div>

        <div className="px-4 sm:px-6 pb-3 flex items-center gap-2 flex-wrap flex-shrink-0">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-8 w-full text-sm" placeholder={`Buscar ${nounPl}...`} value={search} onChange={(e) => setSearch(e.target.value)} style={{fontSize:'16px'}} />
          </div>
          <select className="input text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{fontSize:'16px'}}>
            <option value="">Todos los estados</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            onClick={() => setOnlyUnassigned((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${onlyUnassigned ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            <User size={12} /> Sin asignar <span className="font-bold">{dispatches.filter((d) => !d.assigned_to_id).length}</span>
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 sm:px-6 pb-6 min-h-0">
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">N°</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">TÍTULO</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 hidden sm:table-cell">CLIENTE</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">TÉCNICO</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 hidden lg:table-cell">PREPARACIÓN</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ESTADO</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 hidden md:table-cell">TOTAL</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 hidden md:table-cell">FECHA</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedDispatches.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-16 text-center text-gray-400 text-sm">
                      {onlyUnassigned ? `Sin ${nounPl} sin asignar` : `Sin ${nounPl} guardados`}
                    </td></tr>
                  )}
                  {displayedDispatches.map((d) => (
                    <tr key={d.id} onClick={() => handleSelect(d)}
                      className="border-b border-gray-50 last:border-0 cursor-pointer hover:bg-blue-50 transition-colors">
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">{d.dispatch_number || `#${d.id}`}</td>
                      <td className="px-4 py-3 max-w-[220px]">
                        <p className="font-medium text-gray-900 truncate" title={d.title}>{d.title}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate hidden sm:table-cell">{d.client_name || <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 max-w-[150px] truncate">
                        {d.assigned_to_name
                          ? <span className="inline-flex items-center gap-1 text-gray-700"><User size={12} className="text-gray-400" /> {d.assigned_to_name}</span>
                          : <span className="inline-flex items-center gap-1 text-amber-600"><User size={12} /> Sin asignar</span>}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {d.tasks_total > 0
                          ? <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${d.tasks_done === d.tasks_total ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-blue-600'}`}><ListChecks size={11} /> {d.tasks_done}/{d.tasks_total}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                      <td className="px-4 py-3 text-right font-medium text-gray-700 whitespace-nowrap hidden md:table-cell">{d.total || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap hidden md:table-cell">{d.date ? fmtD(d.date + 'T12:00:00') : fmtD(d.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Detalle / formulario a pantalla completa */}
      <div className={`${(selected || showForm) ? 'flex' : 'hidden'} flex-1 flex-col bg-gray-50 overflow-y-auto overscroll-contain min-h-0`} {...detailSwipe}>
        {showForm ? (
          <DispatchForm
            form={form} setForm={setForm}
            orders={orders}
            quotes={quotes}
            dispatches={dispatches}
            agents={agents}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); if (!selected) setMobileDetailOpen(false) }}
            saving={saving} isEdit={!!selected} onBack={handleBack}
          />
        ) : selected ? (
          <DispatchDetail
            dispatch={selected}
            agents={agents}
            onEdit={handleEdit}
            onDelete={() => handleDelete(selected)}
            onBack={handleBack}
            onPrint={(autoprint) => handlePrint(selected, autoprint)}
            onShare={() => handleShare(selected)}
            onAttachmentChange={() => refreshSelected(selected.id)}
            onViewOrder={(orderId) => navigate('/orders', { state: { selectOrderId: orderId } })}
            onStatusChange={handleStatusChange}
            onAssignChange={(techId) => handleAssignChange(selected, techId)}
            onCancel={handleCancelDispatch}
            onDeliveryDateChange={handleDeliveryDateChange}
            onCalendarChange={() => refreshSelected(selected.id)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center">
              <FileCheck size={24} className="text-blue-200" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-400">Selecciona un {noun} guardado</p>
              <p className="text-xs text-gray-300 mt-1">o usa "Nuevo" para crear uno</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Profit card ────────────────────────────────────────
function ProfitCard({ dispatch: d, dispatchItems }) {
  if (!d.order?.purchase_items) return null
  const costItems = parseItems(d.order.purchase_items)
  const { subtotal: costSubtotal } = calcTotals(costItems, false)
  if (costSubtotal <= 0) return null
  const { subtotal: saleSubtotal } = calcTotals(dispatchItems, false)
  if (saleSubtotal <= 0) return null
  const profit = saleSubtotal - costSubtotal
  const margin = (profit / costSubtotal) * 100
  const positive = profit >= 0

  return (
    <div className={`card border-l-4 ${positive ? 'border-l-emerald-400' : 'border-l-red-400'}`}>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Rentabilidad — solo informativo</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Costo pedido</p>
          <p className="font-semibold text-gray-700">${fmtMoney(costSubtotal)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Venta (s/ITBMS)</p>
          <p className="font-semibold text-gray-700">${fmtMoney(saleSubtotal)}</p>
        </div>
        <div>
          <p className={`text-xs mb-0.5 ${positive ? 'text-emerald-500' : 'text-red-400'}`}>Ganancia</p>
          <p className={`font-bold text-base ${positive ? 'text-emerald-700' : 'text-red-600'}`}>
            {positive ? '+' : ''}${fmtMoney(profit)}
          </p>
        </div>
        <div>
          <p className={`text-xs mb-0.5 ${positive ? 'text-emerald-500' : 'text-red-400'}`}>Margen</p>
          <p className={`font-bold text-base ${positive ? 'text-emerald-700' : 'text-red-600'}`}>
            {positive ? '+' : ''}{margin.toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  )
}

// ── StatusSelector ─────────────────────────────────────
function StatusSelector({ status, onChange, loading }) {
  const [open, setOpen] = useState(false)
  const ref = React.useRef()
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
        <div className="absolute top-full left-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-30 py-1 min-w-[200px]">
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

// ── Detail ─────────────────────────────────────────────
// ── Checklist de preparación ────────────────────────────
function DispatchChecklist({ dispatchId, onChanged }) {
  const [tasks, setTasks] = useState([])
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    getDispatchTasks(dispatchId).then((r) => setTasks(r.data)).catch(() => {})
  }, [dispatchId])
  useEffect(() => { load() }, [load])

  const add = async () => {
    const t = newTitle.trim()
    if (!t) return
    setBusy(true)
    try { await addDispatchTask(dispatchId, t); setNewTitle(''); load(); onChanged?.() }
    catch { toast.error('Error al agregar la tarea') }
    finally { setBusy(false) }
  }
  const toggle = async (task) => {
    try { await updateDispatchTask(dispatchId, task.id, { is_done: !task.is_done }); load(); onChanged?.() }
    catch { toast.error('Error al actualizar la tarea') }
  }
  const del = async (task) => {
    try { await deleteDispatchTask(dispatchId, task.id); load(); onChanged?.() }
    catch { toast.error('Error al eliminar la tarea') }
  }

  const done = tasks.filter((t) => t.is_done).length
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <ListChecks size={13} /> Preparación (checklist)
        </h3>
        {tasks.length > 0 && <span className="text-xs font-medium text-gray-500">{done}/{tasks.length}</span>}
      </div>
      {tasks.length > 0 && (
        <div className="w-full h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="space-y-1.5">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-2 group">
            <button onClick={() => toggle(task)} className="flex-shrink-0 text-gray-400 hover:text-blue-600">
              {task.is_done ? <CheckSquare size={16} className="text-emerald-600" /> : <Square size={16} />}
            </button>
            <span className={`flex-1 text-sm ${task.is_done ? 'line-through text-gray-400' : 'text-gray-700'}`}>{task.title}</span>
            {task.is_done && task.done_by_name && (
              <span className="text-[10px] text-gray-300 hidden sm:inline">{task.done_by_name}</span>
            )}
            <button onClick={() => del(task)} className="flex-shrink-0 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
              <X size={13} />
            </button>
          </div>
        ))}
        {tasks.length === 0 && <p className="text-xs text-gray-400">Sin tareas. Agrega los pasos de preparación (instalar parte, SO, apps, pruebas…).</p>}
      </div>
      <div className="flex gap-2 mt-3">
        <input
          className="input flex-1 text-sm" placeholder="Nueva tarea…" value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          style={{ fontSize: '16px' }}
        />
        <button onClick={add} disabled={busy || !newTitle.trim()} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
          <Plus size={14} /> Agregar
        </button>
      </div>
    </div>
  )
}

// ── Historial del pedido/despacho ───────────────────────
const DISPATCH_TL_ICON = {
  status_change: <PackageCheck size={12} />,
  assignment: <User size={12} />,
  task: <CheckSquare size={12} />,
  system: <Clock size={12} />,
  comment: <MessageSquare size={12} />,
}
function DispatchHistory({ dispatchId, version }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')

  const load = useCallback(() => {
    getDispatchTimeline(dispatchId).then((r) => setItems(r.data)).catch(() => {})
  }, [dispatchId])
  useEffect(() => { load() }, [load, version])

  const add = async () => {
    const t = text.trim()
    if (!t) return
    setBusy(true)
    try { await addDispatchTimeline(dispatchId, { content: t }); setText(''); load() }
    catch { toast.error('Error al agregar la nota') }
    finally { setBusy(false) }
  }

  const startEdit = (e) => { setEditingId(e.id); setEditText(e.content) }
  const cancelEdit = () => { setEditingId(null); setEditText('') }
  const saveEdit = async (e) => {
    const t = editText.trim()
    if (!t) return
    try { await updateDispatchTimeline(dispatchId, e.id, t); cancelEdit(); load() }
    catch (err) { toast.error(err?.response?.data?.detail || 'Error al editar la nota') }
  }
  const del = async (e) => {
    if (!window.confirm('¿Eliminar esta nota?')) return
    try { await deleteDispatchTimeline(dispatchId, e.id); load() }
    catch (err) { toast.error(err?.response?.data?.detail || 'Error al eliminar la nota') }
  }
  const canModify = (e) => e.entry_type === 'comment' && (
    e.user_id === user?.id || ['admin', 'supervisor', 'superadmin'].includes(user?.role)
  )

  return (
    <div className="card">
      <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <HistoryIcon size={16} className="text-gray-400" /> Historial
      </h3>
      <div className="space-y-4 mb-4">
        {items.length === 0 && <p className="text-sm text-gray-400 italic">Sin eventos todavía.</p>}
        {items.map((e) => {
          const isComment = e.entry_type === 'comment'
          const editing = editingId === e.id
          return (
            <div key={e.id} className="flex gap-3 group">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${isComment ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                {DISPATCH_TL_ICON[e.entry_type] || <MessageSquare size={12} />}
              </div>
              <div className="flex-1 min-w-0 py-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-700">{e.user_name || 'Sistema'}</span>
                  <span className="text-xs text-gray-400 ml-auto whitespace-nowrap">{fmtD(e.created_at)} · {fmtTime(e.created_at)}</span>
                  {canModify(e) && !editing && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => startEdit(e)} className="text-gray-300 hover:text-blue-600" title="Editar nota"><Pencil size={12} /></button>
                      <button onClick={() => del(e)} className="text-gray-300 hover:text-red-500" title="Eliminar nota"><Trash2 size={12} /></button>
                    </div>
                  )}
                </div>
                {editing ? (
                  <div className="mt-1">
                    <textarea className="input w-full text-sm resize-none h-16" value={editText} onChange={(ev) => setEditText(ev.target.value)} style={{ fontSize: '16px' }} autoFocus />
                    <div className="flex justify-end gap-2 mt-1">
                      <button onClick={cancelEdit} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">Cancelar</button>
                      <button onClick={() => saveEdit(e)} disabled={!editText.trim()} className="flex items-center gap-1 text-xs px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"><Save size={12} /> Guardar</button>
                    </div>
                  </div>
                ) : isComment ? (
                  <div className="mt-1 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap break-words">{e.content}</div>
                ) : (
                  <p className="text-xs text-gray-500 italic mt-0.5 whitespace-pre-wrap break-words">{e.content}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="border-t border-gray-100 pt-3">
        <textarea
          className="input w-full text-sm resize-none h-16" placeholder="Escribe una nota… (ej.: instalé RAM 8GB, Windows 11 + Office, pruebas OK)"
          value={text} onChange={(e) => setText(e.target.value)}
          style={{ fontSize: '16px' }}
        />
        <div className="flex justify-end mt-2">
          <button onClick={add} disabled={busy || !text.trim()} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm">
            <MessageSquare size={14} /> Agregar nota
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Partes instaladas (consumo de inventario) ───────────
function DispatchParts({ dispatchId, onChanged }) {
  const [parts, setParts] = useState([])
  const [q, setQ] = useState('')
  const [sugs, setSugs] = useState([])
  const [picked, setPicked] = useState(null)
  const [qty, setQty] = useState('1')
  const [busy, setBusy] = useState(false)
  const [showSugs, setShowSugs] = useState(false)

  const load = useCallback(() => {
    getDispatchParts(dispatchId).then((r) => setParts(r.data)).catch(() => {})
  }, [dispatchId])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!q.trim() || picked) { setSugs([]); return }
    let active = true
    const t = setTimeout(() => {
      searchInventory(q.trim()).then((r) => { if (active) { setSugs(r.data); setShowSugs(true) } }).catch(() => {})
    }, 250)
    return () => { active = false; clearTimeout(t) }
  }, [q, picked])

  const pick = (it) => { setPicked(it); setQ(`${it.code} — ${it.name}`); setShowSugs(false) }
  const clearPick = () => { setPicked(null); setQ(''); setSugs([]) }

  const add = async () => {
    if (!picked) return toast.error('Selecciona un artículo del inventario')
    const n = parseFloat(qty)
    if (!n || n <= 0) return toast.error('Cantidad inválida')
    setBusy(true)
    try {
      await addDispatchPart(dispatchId, picked.code, n)
      clearPick(); setQty('1'); load(); onChanged?.()
      toast.success('Parte descontada del inventario')
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al agregar la parte')
    } finally { setBusy(false) }
  }

  const del = async (p) => {
    try { await deleteDispatchPart(dispatchId, p.id); load(); onChanged?.(); toast.success('Parte devuelta al inventario') }
    catch { toast.error('Error al quitar la parte') }
  }

  const totalCost = parts.reduce((s, p) => s + (parseFloat(p.qty || 0) || 0) * (parseFloat(p.unit_cost || 0) || 0), 0)

  return (
    <div className="card">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
        <Wrench size={13} /> Partes instaladas (consumo de inventario)
      </h3>
      <div className="space-y-1.5 mb-3">
        {parts.length === 0 && <p className="text-xs text-gray-400">Sin partes. Agrega las que el técnico instaló; se descuentan del inventario y quedan trazadas.</p>}
        {parts.map((p) => (
          <div key={p.id} className="flex items-center gap-2 group text-sm">
            <span className="font-mono text-xs font-semibold text-gray-700 flex-shrink-0">{p.item_code}</span>
            <span className="text-gray-600 truncate flex-1">{p.item_name}</span>
            <span className="text-gray-500 flex-shrink-0">×{parseFloat(p.qty)}</span>
            {p.unit_cost && <span className="text-gray-400 text-xs flex-shrink-0 hidden sm:inline">${fmtMoney((parseFloat(p.qty) || 0) * (parseFloat(p.unit_cost) || 0))}</span>}
            <button onClick={() => del(p)} className="flex-shrink-0 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Quitar (devuelve al inventario)">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      {parts.length > 0 && (
        <div className="text-xs text-gray-500 mb-3 flex justify-between border-t border-gray-100 pt-2">
          <span>{parts.length} parte(s)</span>
          <span>Costo total: <b className="text-gray-700">${fmtMoney(totalCost)}</b></span>
        </div>
      )}
      <div className="flex gap-2 items-start">
        <div className="relative flex-1">
          <input
            className="input w-full text-sm" placeholder="Buscar artículo por código o descripción…"
            value={q}
            onChange={(e) => { setQ(e.target.value); if (picked) setPicked(null) }}
            onFocus={() => { if (sugs.length) setShowSugs(true) }}
            style={{ fontSize: '16px' }}
          />
          {picked && (
            <button onClick={clearPick} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500"><X size={14} /></button>
          )}
          {showSugs && sugs.length > 0 && !picked && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {sugs.map((it) => (
                <button key={it.id} onClick={() => pick(it)} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2 text-sm border-b border-gray-50 last:border-0">
                  <span className="font-mono text-xs font-semibold text-gray-700">{it.code}</span>
                  <span className="text-gray-600 truncate flex-1">{it.name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">stock {parseFloat(it.quantity || '0')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          type="number" min="0" step="0.01" className="input w-20 text-sm text-right" value={qty}
          onChange={(e) => setQty(e.target.value)} style={{ fontSize: '16px' }} title="Cantidad"
        />
        <button onClick={add} disabled={busy || !picked} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
          <Plus size={14} /> Agregar
        </button>
      </div>
    </div>
  )
}

function DispatchDetail({ dispatch: d, agents = [], onEdit, onDelete, onBack, onPrint, onShare, onAttachmentChange, onViewOrder, onStatusChange, onAssignChange, onCancel, onDeliveryDateChange, onCalendarChange }) {
  const navigate = useNavigate()
  const { vertical } = useCompany()
  const itMode = vertical === 'it_support'
  const noun = itMode ? 'pedido' : 'despacho'
  const Noun = itMode ? 'Pedido' : 'Despacho'
  const items = parseItems(d.items)
  const hasItems = items.some((it) => it.description?.trim())
  const { subtotal, itbmsAmt, total } = calcTotals(items, d.itbms_enabled)
  const [changingStatus, setChangingStatus] = useState(false)
  const [histVersion, setHistVersion] = useState(0)
  const [localDeliveryDate, setLocalDeliveryDate] = useState(d.delivery_date || '')
  const [creatingInvoice, setCreatingInvoice] = useState(false)

  const [showCalendarModal, setShowCalendarModal] = useState(false)
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [calForm, setCalForm] = useState({
    date: '', hour: '8', minute: '00', ampm: 'AM',
    duration_minutes: 60, location: '', notes: '',
    endMode: 'duration', endHour: '9', endMinute: '00', endAmpm: 'AM',
  })

  React.useEffect(() => {
    if (d.scheduled_at) {
      const utcDate = toUTC(d.scheduled_at)
      const local = toZonedTime(utcDate, 'America/Panama')
      const h24 = local.getHours()
      const h12 = h24 % 12 || 12
      setCalForm((f) => ({
        ...f,
        date: `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`,
        hour: String(h12),
        minute: String(local.getMinutes()).padStart(2, '0'),
        ampm: h24 >= 12 ? 'PM' : 'AM',
        duration_minutes: d.duration_minutes || 60,
      }))
    }
  }, [d.id])

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
      await createDispatchCalendarEvent({
        dispatch_id: d.id,
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
    if (!window.confirm(`¿Eliminar el evento de Google Calendar para este ${noun}?`)) return
    try {
      await deleteDispatchCalendarEvent(d.id)
      toast.success('Evento eliminado')
      onCalendarChange?.()
    } catch {
      toast.error('Error al eliminar evento')
    }
  }

  // Sync localDeliveryDate when dispatch changes
  React.useEffect(() => { setLocalDeliveryDate(d.delivery_date || '') }, [d.id, d.delivery_date])

  const handleCreateInvoice = async () => {
    if (creatingInvoice) return
    setCreatingInvoice(true)
    try {
      const r = await createInvoiceFromDispatch(d.id)
      toast.success(`Factura ${r.data.invoice_number} creada`)
      navigate('/facturas', { state: { selectInvoiceId: r.data.id } })
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error creando factura')
    } finally {
      setCreatingInvoice(false)
    }
  }

  const handleStatusSelect = async (val) => {
    if (!itMode && val !== 'Borrador' && val !== 'Cancelado' && !d.quote_id) {
      return toast.error(`Se requiere una cotización vinculada para cambiar el estado del ${noun}`)
    }
    // it_support: no se puede entregar sin garantía completa (con todas las series).
    if (itMode && val === 'Entregado' && d.warranty_status !== 'complete') {
      return toast.error('No se puede entregar: falta el certificado de garantía con el N° de serie de todos los equipos.')
    }
    setChangingStatus(true)
    await onStatusChange(val)
    setChangingStatus(false)
  }

  const handleDeliveryBlur = () => {
    if (localDeliveryDate !== (d.delivery_date || '')) {
      onDeliveryDateChange(localDeliveryDate)
    }
  }

  return (
    <>
    <div className="p-4 sm:p-6 max-w-2xl space-y-4">
      <button onClick={onBack} className="md:hidden flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft size={16} /> Volver
      </button>

      {/* Header — mismo estilo que Pedidos */}
      <div className="space-y-2">
        <div>
          {d.dispatch_number && (
            <span className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded inline-block mb-1">{d.dispatch_number}</span>
          )}
          <h2 className="text-base font-semibold text-gray-900 leading-snug">{d.title}</h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {d.order && (
              <button onClick={() => onViewOrder(d.order.id)} className="text-xs text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-1">
                <PackageCheck size={11} /> {d.order.title}
              </button>
            )}
            {d.quote && (
              <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded flex items-center gap-1">
                <FileText size={11} /> {d.quote.quote_number || `COT-${d.quote_id}`}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusSelector status={d.status} onChange={handleStatusSelect} loading={changingStatus} />
          <div className="flex items-center gap-1.5" title="Técnico asignado">
            <User size={14} className="text-gray-400" />
            <select
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-2 bg-white text-gray-700 max-w-[160px]"
              value={d.assigned_to_id || ''}
              onChange={(e) => onAssignChange?.(e.target.value)}
            >
              <option value="">Sin técnico</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
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
            <button onClick={() => setShowCalendarModal(true)} title="Agendar" className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors ${d.calendar_event_id ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-purple-600 hover:bg-purple-700 text-white'}`}>
              <CalendarDays size={13} /> <span className="hidden sm:inline">{d.calendar_event_id ? 'Reagendar' : 'Agendar'}</span>
            </button>
            {d.status !== 'Borrador' && d.status !== 'Cancelado' && (
              <button
                onClick={() => navigate('/warranties', { state: { fromDispatch: {
                  dispatch_id: d.id,
                  client_name: d.client_name || '',
                  client_ruc: d.client_ruc || '',
                  client_address: d.client_address || '',
                  dispatch_number: d.dispatch_number || `#${d.id}`,
                  items: parseItems(d.items).filter(it => it.description?.trim()).map(it => ({ description: it.description, category: it.category || '' })),
                } } })}
                title="Generar certificado de garantía de este pedido"
                className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors"
              >
                <ShieldCheck size={13} /> <span className="hidden sm:inline">Garantía</span>
              </button>
            )}
            {itMode && d.status !== 'Cancelado' && (
              <button
                onClick={onCancel}
                title="Cancelar pedido: elimina la garantía y devuelve los artículos al inventario"
                className="flex items-center gap-1.5 px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 active:bg-red-800 transition-colors"
              >
                <XCircle size={13} /> <span className="hidden sm:inline">Cancelar</span>
              </button>
            )}
            <button onClick={onEdit} className="btn-secondary flex items-center gap-1.5 text-sm">
              <Pencil size={13} /> <span className="hidden sm:inline">Editar</span>
            </button>
            <button onClick={onDelete} className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Preparación: checklist */}
      <DispatchChecklist dispatchId={d.id} onChanged={() => setHistVersion((v) => v + 1)} />

      {/* Partes instaladas (consumo de inventario) */}
      <DispatchParts dispatchId={d.id} onChanged={() => setHistVersion((v) => v + 1)} />

      {/* Aviso de flujo incompleto: falta la garantía con las series (it_support) */}
      {itMode && d.status !== 'Borrador' && d.status !== 'Cancelado' && d.warranty_status !== 'complete' && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">Proceso incompleto</p>
            <p className="text-xs mt-0.5">
              {d.warranty_status === 'incomplete'
                ? 'El certificado de garantía está incompleto: faltan los N° de serie de los equipos.'
                : 'Este pedido aún no tiene certificado de garantía.'}
              {' '}No podrá marcarse como <span className="font-medium">Entregado</span> hasta completarlo con "Garantía".
            </p>
          </div>
        </div>
      )}

      {/* Ticket relacionado (desde el pedido vinculado) */}
      {d.order?.ticket && (
        <div className="card">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <TicketIcon size={13} /> Ticket relacionado
          </h3>
          <a
            href={`/tickets/${d.order.ticket.id}`}
            className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
          >
            <span className="text-xs font-mono text-blue-400 flex-shrink-0">#{d.order.ticket.id}</span>
            <span className="font-medium text-sm text-blue-800 flex-1 min-w-0 truncate">{d.order.ticket.title}</span>
          </a>
        </div>
      )}

      {/* Factura vinculada del sistema (solo con facturación: no it_support) */}
      {(!itMode || d.inventory_applied) && (
      <div className="card">
        {!itMode && (<>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Receipt size={13} className="text-blue-500" /> Factura del sistema
        </h3>
        {d.invoice ? (
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => navigate('/facturas', { state: { selectInvoiceId: d.invoice.id } })}
              className="flex items-center gap-2 text-sm text-blue-600 hover:underline font-medium min-w-0"
            >
              <Tag size={13} className="flex-shrink-0" />
              <span className="truncate">
                {d.invoice.invoice_number || `FAC-${d.invoice.id}`}
                {d.invoice.client_name ? ` · ${d.invoice.client_name}` : ''}
              </span>
              <ExternalLink size={11} className="flex-shrink-0" />
            </button>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
              d.invoice.status === 'Pagada' ? 'bg-green-100 text-green-700' :
              d.invoice.status === 'Emitida' ? 'bg-blue-100 text-blue-700' :
              d.invoice.status === 'Anulada' ? 'bg-red-100 text-red-600' :
              'bg-gray-100 text-gray-600'
            }`}>{d.invoice.status}</span>
          </div>
        ) : (
          <button
            onClick={handleCreateInvoice}
            disabled={creatingInvoice}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 transition-colors disabled:opacity-50"
          >
            <FilePlus2 size={13} />
            {creatingInvoice ? 'Creando...' : 'Crear factura'}
          </button>
        )}
        </>)}
        {d.inventory_applied && (
          <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1">
            <CheckCircle2 size={11} /> Inventario descontado
          </p>
        )}
      </div>
      )}

      {/* Client info + dates */}
      {(d.client_name || d.client_ruc || d.client_address || d.date || true) && (
        <div className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
          {d.client_name && <div><p className="text-xs text-gray-400">Cliente</p><p className="text-sm font-semibold text-gray-900">{d.client_name}</p></div>}
          {d.client_ruc && <div><p className="text-xs text-gray-400">RUC</p><p className="text-sm font-medium text-gray-800">{d.client_ruc}</p></div>}
          {d.client_address && <div className="sm:col-span-2"><p className="text-xs text-gray-400">Dirección</p><p className="text-sm text-gray-700">{d.client_address}</p></div>}
          {d.date && <div><p className="text-xs text-gray-400">Fecha {noun}</p><p className="text-sm font-medium text-gray-800">{fmtD(d.date + 'T12:00:00')}</p></div>}
          <div>
            <p className="text-xs text-gray-400 mb-1">Fecha de entrega</p>
            <input
              type="date"
              value={localDeliveryDate}
              onChange={(e) => setLocalDeliveryDate(e.target.value)}
              onBlur={handleDeliveryBlur}
              className="input w-full text-sm"
              placeholder="Sin fecha"
              style={{fontSize:'16px'}}
            />
          </div>
        </div>
      )}

      {/* Items table */}
      <div className="card space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <Receipt size={13} /> Artículos
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
              <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>${fmtMoney(subtotal)}</span></div>
              {d.itbms_enabled && (
                <div className="flex justify-between text-amber-600"><span>ITBMS 7%</span><span>${fmtMoney(itbmsAmt)}</span></div>
              )}
              <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1">
                <span>Total</span><span className="text-blue-700">${fmtMoney(total)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      <ProfitCard dispatch={d} dispatchItems={items} />

      {d.notes && (
        <div className="card">
          <p className="text-xs text-gray-400 mb-1">Observaciones</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{d.notes}</p>
        </div>
      )}

      {/* Factura al cliente */}
      <div className="card">
        <DispatchAttachmentSection
          dispatchId={d.id}
          docType="cliente"
          label="Factura emitida al cliente"
          icon={<FileCheck size={13} />}
          attachments={d.attachments || []}
          onUploaded={onAttachmentChange}
          onDeleted={onAttachmentChange}
        />
      </div>

      {/* Scheduled */}
      {d.scheduled_at && (
        <div className="card space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <CalendarDays size={13} className="text-purple-500" /> Agendado
          </h3>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm font-medium text-gray-800">{fmtD(toUTC(d.scheduled_at).toISOString())} · {fmtTime(d.scheduled_at)}</p>
              <p className="text-xs text-gray-500">{d.duration_minutes || 60} min</p>
            </div>
            <div className="flex gap-2">
              {d.calendar_event_link && (
                <a href={d.calendar_event_link} target="_blank" rel="noreferrer"
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
        </div>
      )}

      {/* Historial del pedido */}
      <DispatchHistory dispatchId={d.id} version={`${d.status}|${d.assigned_to_id}|${histVersion}`} />
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
                {Noun} #{d.id} - {d.title}{d.client_name ? ` - ${d.client_name}` : ''}
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
              <input className="input" placeholder="Ej: Dirección del cliente"
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
              {creatingEvent ? 'Creando...' : (d.calendar_event_id ? 'Reagendar' : 'Crear evento')}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

// ── Form ───────────────────────────────────────────────
function DispatchForm({ form, setForm, orders, quotes = [], dispatches = [], agents = [], onSave, onCancel, saving, isEdit, onBack }) {
  const { vertical } = useCompany()
  const itMode = vertical === 'it_support'
  const noun = itMode ? 'pedido' : 'despacho'
  const Noun = itMode ? 'Pedido' : 'Despacho'
  const [isDirty, setIsDirty] = useState(false)
  const [clientSuggestions, setClientSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const suggestionsRef = useRef(null)
  const debounceRef = useRef(null)
  useFormGuard(isDirty)
  const set = (field) => (e) => { setIsDirty(true); setForm((f) => ({ ...f, [field]: e.target.value })) }

  const handleClientNameChange = (e) => {
    const val = e.target.value
    setIsDirty(true)
    setForm((f) => ({ ...f, client_name: val }))

    clearTimeout(debounceRef.current)
    if (!val.trim()) { setShowSuggestions(false); return }

    debounceRef.current = setTimeout(async () => {
      setLoadingSuggestions(true)
      try {
        const q = val.trim().toLowerCase()
        const [contactsRes, companiesRes] = await Promise.allSettled([
          getContacts(val.trim()),
          getCompanies(val.trim()),
        ])
        const contactsData = contactsRes.status === 'fulfilled' ? contactsRes.value.data : []
        const dbCompanies = companiesRes.status === 'fulfilled' ? companiesRes.value.data : []

        // Enrich map from past dispatches
        const rucMap = {}
        dispatches.forEach((d) => {
          if (d.client_name && d.client_ruc) {
            rucMap[d.client_name.toLowerCase().trim()] = { ruc: d.client_ruc, address: d.client_address || '' }
          }
        })

        // Company map: DB companies take precedence (canonical RUC/address)
        const companyMap = new Map()
        dbCompanies.forEach((co) => {
          companyMap.set(co.name.toLowerCase(), { type: 'company', name: co.name, ruc: co.ruc || '', address: co.address || '' })
        })
        // Fill in companies derived from contacts (only if not already in DB)
        contactsData.forEach((c) => {
          if (!c.company || !c.company.toLowerCase().includes(q)) return
          const key = c.company.toLowerCase()
          if (!companyMap.has(key)) {
            companyMap.set(key, { type: 'company', name: c.company, ruc: '', address: '' })
          }
          const co = companyMap.get(key)
          if (!co.ruc && c.ruc) co.ruc = c.ruc
          if (!co.address && c.address) co.address = c.address
        })

        // Individual contacts
        const fromAPI = contactsData.map((c) => ({
          type: 'contact',
          name: c.name,
          company: c.company || '',
          address: c.address || '',
          ruc: c.ruc || '',
        }))
        const enriched = fromAPI.map((c) => {
          const past = rucMap[c.name.toLowerCase().trim()]
          return past ? { ...c, ruc: c.ruc || past.ruc, address: c.address || past.address } : c
        })

        const all = [...Array.from(companyMap.values()), ...enriched]
        setClientSuggestions(all)
        setShowSuggestions(all.length > 0)
      } catch {
        setShowSuggestions(false)
      } finally {
        setLoadingSuggestions(false)
      }
    }, 250)
  }

  const selectClient = (client) => {
    setIsDirty(true)
    setForm((f) => ({
      ...f,
      client_name: client.name,
      client_ruc: client.ruc || f.client_ruc,
      client_address: client.address || f.client_address,
    }))
    setClientSuggestions([])
    setShowSuggestions(false)
  }

  // Close suggestions when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const setItem = (i, field, val) => { setIsDirty(true); setForm((f) => ({ ...f, items: f.items.map((it, idx) => idx === i ? { ...it, [field]: val } : it) })) }
  const addItem = () => { setIsDirty(true); setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] })) }
  const removeItem = (i) => { setIsDirty(true); setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) })) }

  const { subtotal, itbmsAmt, total } = calcTotals(form.items, form.itbms_enabled)

  // Profit calculation vs linked order
  const linkedOrder = form.order_id ? orders.find((o) => o.id === Number(form.order_id)) : null
  const costItems = linkedOrder ? parseItems(linkedOrder.purchase_items) : []
  const { subtotal: costSubtotal } = calcTotals(costItems, false)
  const profit = subtotal - costSubtotal
  const margin = costSubtotal > 0 ? (profit / costSubtotal) * 100 : null

  // Select from quote
  const [showQuoteSelect, setShowQuoteSelect] = useState(false)
  const [quoteSearch, setQuoteSearch] = useState('')

  const filteredQuotes = quotes.filter((q) =>
    (q.title || '').toLowerCase().includes(quoteSearch.toLowerCase()) ||
    (q.quote_number || '').toLowerCase().includes(quoteSearch.toLowerCase()) ||
    (q.client_name || '').toLowerCase().includes(quoteSearch.toLowerCase())
  )

  const convertFromQuote = (quote) => {
    const items = parseItems(quote.items)
    setIsDirty(true)
    setForm((f) => ({
      ...f,
      title: f.title || quote.title,
      quote_id: quote.id,
      client_name: f.client_name || quote.client_name || '',
      client_ruc: f.client_ruc || quote.client_ruc || '',
      client_address: f.client_address || quote.client_address || '',
      items: items.some((it) => it.description?.trim()) ? items : f.items,
      itbms_enabled: quote.itbms_enabled ?? f.itbms_enabled,
    }))
    setShowQuoteSelect(false)
    toast.success('Datos importados de la cotización')
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      <button onClick={onBack} className="md:hidden flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={16} /> Volver
      </button>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-gray-900">{isEdit ? `Editar ${noun}` : `Nuevo ${noun}`}</h2>
        {!itMode && (
        <button
          type="button"
          onClick={() => setShowQuoteSelect(true)}
          className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-800 font-medium px-3 py-2 rounded-lg border border-emerald-200 hover:bg-emerald-50 active:bg-emerald-100 transition-colors"
        >
          <FileText size={13} /> Seleccionar cotización
        </button>
        )}
      </div>

      <form id="dispatch-form" onSubmit={onSave} className="space-y-4 sticky-footer-form">
        {/* Header info */}
        <div className="card space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Título *</label>
              <input className="input w-full" value={form.title} onChange={set('title')} placeholder="Ej: Entrega de equipos a cliente" required style={{fontSize:'16px'}} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">N° de {noun}</label>
              <input className="input w-full font-mono" value={form.dispatch_number} onChange={set('dispatch_number')} placeholder={itMode ? 'PED-0001' : 'DSP-0001'} style={{fontSize:'16px'}} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fecha {noun}</label>
              <input className="input w-full" type="date" value={form.date} onChange={set('date')} style={{fontSize:'16px'}} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fecha de entrega</label>
              <input className="input w-full" type="date" value={form.delivery_date} onChange={set('delivery_date')} style={{fontSize:'16px'}} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Estado</label>
              <select className="input w-full" value={form.status} onChange={set('status')} style={{fontSize:'16px'}}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Técnico asignado</label>
              <select className="input w-full" value={form.assigned_to_id || ''} onChange={set('assigned_to_id')} style={{fontSize:'16px'}}>
                <option value="">Sin técnico</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {form.order_id && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Pedido vinculado:</span>
                <span className="text-xs font-medium text-blue-600">{(() => { const o = orders.find((o) => o.id === Number(form.order_id)); return o ? (o.order_number || `#${o.id}`) : `#${form.order_id}` })()} </span>
                <button type="button" onClick={() => { setIsDirty(true); setForm((f) => ({ ...f, order_id: '' })) }} className="text-gray-400 hover:text-red-500 ml-auto">
                  <X size={13} />
                </button>
              </div>
            )}
            {form.quote_id && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Cotización vinculada:</span>
                <span className="text-xs font-medium text-emerald-600">{(() => { const q = quotes.find((q) => q.id === Number(form.quote_id)); return q ? (q.quote_number || `COT-${q.id}`) : `COT-${form.quote_id}` })()} </span>
                <button type="button" onClick={() => { setIsDirty(true); setForm((f) => ({ ...f, quote_id: '' })) }} className="text-gray-400 hover:text-red-500 ml-auto">
                  <X size={13} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Client info */}
        <div className="card space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Datos del cliente</h3>
          <div ref={suggestionsRef} className="relative">
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre del cliente</label>
            <input
              className="input w-full"
              value={form.client_name}
              onChange={handleClientNameChange}
              onFocus={() => {
                if (form.client_name.trim().length >= 1 && clientSuggestions.length > 0) setShowSuggestions(true)
              }}
              placeholder="Nombre completo"
              autoComplete="off"
              style={{fontSize:'16px'}}
            />
            {(showSuggestions || loadingSuggestions) && (
              <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                {loadingSuggestions ? (
                  <p className="text-xs text-gray-400 px-4 py-3">Buscando...</p>
                ) : clientSuggestions.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); selectClient(c) }}
                    className={`w-full text-left px-4 py-2.5 hover:bg-blue-50 active:bg-blue-100 transition-colors border-b border-gray-50 last:border-0 ${c.type === 'company' ? 'bg-indigo-50/40' : ''}`}
                  >
                    {c.type === 'company' ? (
                      <div className="flex items-center gap-2">
                        <Building2 size={13} className="text-indigo-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-indigo-700">{c.name}</p>
                          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                            {c.ruc && <span className="text-xs text-indigo-400 font-mono">RUC: {c.ruc}</span>}
                            {c.address && <span className="text-xs text-gray-400 truncate">{c.address}</span>}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900">{c.name}</p>
                          {c.company && <span className="text-xs text-gray-400 truncate">· {c.company}</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {c.ruc && <span className="text-xs text-blue-400 font-mono">RUC: {c.ruc}</span>}
                          {c.address && <span className="text-xs text-gray-400 truncate">{c.address}</span>}
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">RUC</label>
              <input className="input w-full" value={form.client_ruc} onChange={set('client_ruc')} placeholder="Ej: 8-123-456 DV 12" style={{fontSize:'16px'}} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
              <input className="input w-full" value={form.client_address} onChange={set('client_address')} placeholder="Dirección de entrega" style={{fontSize:'16px'}} />
            </div>
          </div>
        </div>

        {/* Items */}
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

          {/* Profit summary vs linked order */}
          {linkedOrder && costSubtotal > 0 && (
            <div className="mt-2 pt-3 border-t border-dashed border-gray-200">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Rentabilidad estimada</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400 mb-0.5">Costo (pedido)</p>
                  <p className="font-semibold text-gray-700">${fmtMoney(costSubtotal)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400 mb-0.5">Venta (s/ITBMS)</p>
                  <p className="font-semibold text-gray-700">${fmtMoney(subtotal)}</p>
                </div>
                <div className={`rounded-lg px-3 py-2 ${profit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <p className={`mb-0.5 ${profit >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>Ganancia</p>
                  <p className={`font-bold ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {profit >= 0 ? '+' : ''}${fmtMoney(profit)}
                  </p>
                </div>
                <div className={`rounded-lg px-3 py-2 ${profit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <p className={`mb-0.5 ${profit >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>Margen</p>
                  <p className={`font-bold ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {margin !== null ? `${profit >= 0 ? '+' : ''}${margin.toFixed(1)}%` : '—'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="card">
          <label className="block text-xs font-medium text-gray-600 mb-1">Observaciones</label>
          <textarea className="input w-full h-16 resize-none" value={form.notes} onChange={set('notes')} placeholder={`Notas adicionales del ${noun}...`} style={{fontSize:'16px'}} />
        </div>

      </form>

      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 sm:px-6 py-3 flex items-center gap-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] z-10 -mx-4 sm:-mx-6">
        <span className={`text-xs flex items-center gap-1.5 ${isDirty ? 'text-amber-600' : 'text-gray-300'}`}>
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${isDirty ? 'bg-amber-500 animate-pulse' : 'bg-gray-300'}`} />
          {isDirty ? 'Sin guardar' : 'Sin cambios'}
        </span>
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm py-1.5 px-3">Cancelar</button>
          <button type="submit" form="dispatch-form" disabled={saving} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
            <Save size={13} />
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : `Crear ${noun}`}
          </button>
        </div>
      </div>

      {/* Select from quote modal */}
      {showQuoteSelect && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <FileText size={16} /> Seleccionar cotización
              </h3>
              <button onClick={() => setShowQuoteSelect(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-4">
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input w-full pl-9"
                  placeholder="Buscar cotización..."
                  value={quoteSearch}
                  onChange={(e) => setQuoteSearch(e.target.value)}
                  autoFocus
                  style={{fontSize:'16px'}}
                />
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1">
                {filteredQuotes.length === 0
                  ? <p className="text-sm text-gray-400 text-center py-6">Sin resultados</p>
                  : filteredQuotes.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => convertFromQuote(q)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-emerald-200 hover:bg-emerald-50 active:bg-emerald-100 text-left transition-colors"
                    >
                      <span className="text-xs font-mono text-gray-400 flex-shrink-0">{q.quote_number || `#${q.id}`}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{q.title}</p>
                        {q.client_name && <p className="text-xs text-gray-400 truncate">{q.client_name}</p>}
                      </div>
                      {q.total && <span className="text-xs text-gray-500 flex-shrink-0">{q.total}</span>}
                    </button>
                  ))
                }
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
