import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { fmtDT } from '../utils/fmt'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getInventory, createInventoryItem, updateInventoryItem, deleteInventoryItem, getInventoryTransactions, withdrawInventoryItem, receiveInventoryItem, adjustInventoryItem, updateInventoryPending, getAllInventoryTransactions, getInventoryReportPdf, getSuppliers, createSupplier, importInventoryCSV, getReceiptsPendingReview, getOversoldReport } from '../services/api'
import { Package, Plus, Search, Edit, Trash2, X, AlertTriangle, ChevronDown, ChevronUp, History, TrendingDown, TrendingUp, Minus, ArrowDownCircle, ArrowUpCircle, List, ExternalLink, Upload, Download, FileText, PackagePlus, Scale, Lock, CalendarClock, ClipboardList, Undo2 } from 'lucide-react'
import ReceiptOrders from '../components/ReceiptOrders'
import ReceiptOrdersPanel from '../components/ReceiptOrdersPanel'
import SupplierReturnsPanel from '../components/SupplierReturnsPanel'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useCompany, getCompanyCache } from '../context/CompanyContext'
import { useModuleAccess } from '../context/RoleFeaturesContext'
import { openPdfWindow } from '../utils/pdfViewer'

const EMPTY_FORM = {
  code: '', name: '', description: '', unit: 'unidad',
  unit_price: '0.00', cost_price: '0.00', quantity: '0', category: '', notes: '', warehouse: 'principal', supplier_id: '',
  condition: 'nuevo', item_status: 'ingresado', location: '',
}

const UNITS = ['unidad', 'caja', 'metro', 'rollo', 'par', 'juego', 'litro', 'kg', 'hora']

const WAREHOUSES = ['principal', 'partes', 'impresoras_mps', 'herramientas_microsoldadura']
const WAREHOUSE_LABEL = {
  principal:                    'Principal',
  partes:                       'Bodega de Partes',
  impresoras_mps:               'Bodega de Impresoras MPS',
  herramientas_microsoldadura:  'Herramientas Microsoldadura',
}

const CONDITIONS = ['nuevo', 'funcional', 'dañado', 'incompleto']
const CONDITION_LABEL = { nuevo: 'Nuevo', funcional: 'Funcional', 'dañado': 'Dañado', incompleto: 'Incompleto' }
const CONDITION_COLOR = {
  nuevo:      'bg-emerald-100 text-emerald-700',
  funcional:  'bg-blue-100 text-blue-700',
  'dañado':   'bg-red-100 text-red-700',
  incompleto: 'bg-amber-100 text-amber-700',
}

const ITEM_STATUSES = ['ingresado', 'revisado', 'por_devolver']
const ITEM_STATUS_LABEL = { ingresado: 'Ingresado', revisado: 'Revisado', por_devolver: 'Por devolver' }
const ITEM_STATUS_COLOR = {
  ingresado:    'bg-slate-100 text-slate-700',
  revisado:     'bg-indigo-100 text-indigo-700',
  por_devolver: 'bg-orange-100 text-orange-700',
}

function fmtQty(q) {
  const n = parseFloat(q || '0')
  return isNaN(n) ? '0' : n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2)
}

const SOURCE_LABEL = {
  manual:           'Ajuste manual',
  dispatch:            'Salida por pedido',
  dispatch_revert:     'Reposición de pedido',
  ticket_part:         'Salida por ticket (parte)',
  ticket_part_return:  'Devolución de parte (ticket)',
  invoice:             'Factura',
  order:               'Pedido',
  consumo_interno:     'Consumo interno',
  recepcion:           'Recepción de proveedor',
  ajuste:              'Ajuste de inventario',
  inventario_inicial:  'Inventario inicial',
  baja:                'Baja de inventario',
  dispatch_part:       'Parte instalada (pedido)',
  dispatch_part_return: 'Reverso de parte (pedido)',
}

const SOURCE_COLOR = {
  invoice:         'bg-blue-100 text-blue-700',
  dispatch:        'bg-violet-100 text-violet-700',
  order:           'bg-amber-100 text-amber-700',
  manual:          'bg-gray-100 text-gray-600',
  consumo_interno: 'bg-orange-100 text-orange-700',
  recepcion:       'bg-emerald-100 text-emerald-700',
  ajuste:          'bg-sky-100 text-sky-700',
  inventario_inicial: 'bg-gray-100 text-gray-600',
  baja:            'bg-red-100 text-red-700',
  dispatch_part:   'bg-violet-100 text-violet-700',
  dispatch_part_return: 'bg-teal-100 text-teal-700',
}

const MOTIVOS = ['Consumo interno', 'Uso en taller', 'Compra para empresa', 'Dañado/descarte', 'Pérdida', 'Otro']

function TxnRow({ txn }) {
  const delta = parseFloat(txn.qty_delta || '0')
  const isPos = delta > 0
  const isNeg = delta < 0
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${isPos ? 'bg-emerald-100' : isNeg ? 'bg-red-100' : 'bg-gray-100'}`}>
        {isPos ? <TrendingUp size={13} className="text-emerald-600" /> : isNeg ? <TrendingDown size={13} className="text-red-500" /> : <Minus size={13} className="text-gray-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-gray-700">{SOURCE_LABEL[txn.source_type] || txn.source_type}</span>
          <span className={`text-sm font-bold flex-shrink-0 ${isPos ? 'text-emerald-600' : isNeg ? 'text-red-500' : 'text-gray-400'}`}>
            {isPos ? '+' : ''}{delta % 1 === 0 ? Math.round(delta) : delta.toFixed(2)}
          </span>
        </div>
        {txn.notes && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap break-words">{txn.notes}</p>}
        <p className="text-xs text-gray-300 mt-0.5">
          {format(new Date(txn.created_at), "d MMM yyyy, HH:mm", { locale: es })}
        </p>
      </div>
    </div>
  )
}

export default function Inventario() {
  const navigate = useNavigate()
  const { vertical } = useCompany()
  const itMode = vertical === 'it_support'
  const { canWrite } = useModuleAccess()
  const canEdit = canWrite('inventario')  // false = solo lectura
  // En it_support se oculta la bodega de impresoras MPS.
  const warehouses = itMode
    ? WAREHOUSES.filter(w => w !== 'impresoras_mps')
    : WAREHOUSES.filter(w => w !== 'herramientas_microsoldadura')
  const fileInputRef = React.useRef(null)
  const [suppliers, setSuppliers] = useState([])
  const [importing, setImporting] = useState(false)
  const [showReceipts, setShowReceipts] = useState(false)
  const [pendingReview, setPendingReview] = useState({ orders: 0, items: 0 })
  const [oversold, setOversold] = useState([])
  const [showOversold, setShowOversold] = useState(false)
  const loadOversold = useCallback(() => {
    getOversoldReport().then(r => setOversold(r.data || [])).catch(() => {})
  }, [])
  const loadPending = useCallback(() => {
    getReceiptsPendingReview().then(r => setPendingReview(r.data || { orders: 0, items: 0 })).catch(() => {})
  }, [])
  useEffect(() => { loadPending(); loadOversold() }, [loadPending, loadOversold])
  // Al cerrar el modal de órdenes, recalcular pendientes (por si se revisaron ítems)
  useEffect(() => { if (!showReceipts) loadPending() }, [showReceipts, loadPending])
  // Tooltip flotante (portal) para los íconos de acción — evita que la tabla con overflow lo recorte
  const [tip, setTip] = useState(null) // { text, x, y }
  const showTip = useCallback((e) => {
    const btn = e.target.closest('button[data-tip]')
    if (!btn) return
    const r = btn.getBoundingClientRect()
    setTip({ text: btn.dataset.tip, x: r.left + r.width / 2, y: r.top })
  }, [])
  const hideTip = useCallback(() => setTip(null), [])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [sortField, setSortField] = useState('code')
  const [sortDir, setSortDir] = useState('asc')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterWarehouse, setFilterWarehouse] = useState('')
  const [filterCondition, setFilterCondition] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [tab, setTab] = useState('items')
  const [allTxns, setAllTxns] = useState([])
  const [allTxnsLoading, setAllTxnsLoading] = useState(false)
  const [txnFilter, setTxnFilter] = useState('all')
  const [txnSearch, setTxnSearch] = useState('')
  const [txnFrom, setTxnFrom] = useState('')
  const [txnTo, setTxnTo] = useState('')
  // Reportes
  const [reportFrom, setReportFrom] = useState('')
  const [reportTo, setReportTo] = useState('')
  const [reportDir, setReportDir] = useState('all')       // all | entradas | salidas
  const [reportSup, setReportSup] = useState('')          // supplier_id
  const [reportTxns, setReportTxns] = useState([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportRan, setReportRan] = useState(false)
  const [reportPdfLoading, setReportPdfLoading] = useState(false)
  const [historyItem, setHistoryItem] = useState(null)
  const [historyTxns, setHistoryTxns] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [etaItem, setEtaItem] = useState(null)
  const [etaValue, setEtaValue] = useState('')
  const [etaSaving, setEtaSaving] = useState(false)
  const [withdrawItem, setWithdrawItem] = useState(null)
  const [withdrawQty, setWithdrawQty] = useState('')
  const [withdrawMotivo, setWithdrawMotivo] = useState(MOTIVOS[0])
  const [withdrawJustif, setWithdrawJustif] = useState('')
  const [withdrawSaving, setWithdrawSaving] = useState(false)
  const [manualExit, setManualExit] = useState(false)  // salida manual desde el botón superior (elige artículo)
  const [exitSearch, setExitSearch] = useState('')     // buscador de artículo en la salida manual
  const [adjustItem, setAdjustItem] = useState(null)
  const [adjustForm, setAdjustForm] = useState({ new_qty: '', justification: '' })
  const [adjustSaving, setAdjustSaving] = useState(false)
  const [deleteItem, setDeleteItem] = useState(null)
  const [deleteJustif, setDeleteJustif] = useState('')
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [receiveItem, setReceiveItem] = useState(null)
  const [receiveForm, setReceiveForm] = useState({ supplier_id: '', qty: '', cost: '', notes: '' })
  const [receiveSaving, setReceiveSaving] = useState(false)
  const [showNewSupplier, setShowNewSupplier] = useState(false)
  const EMPTY_NEW_SUPPLIER = { name: '', contact_name: '', category: '', phone: '', email: '', website: '', address: '', notes: '' }
  const [newSupplier, setNewSupplier] = useState(EMPTY_NEW_SUPPLIER)
  const [newSupplierSaving, setNewSupplierSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    getInventory({ active_only: true })
      .then(r => setItems(r.data))
      .catch(() => toast.error('Error cargando inventario'))
      .finally(() => setLoading(false))
    loadOversold()
  }, [loadOversold])

  useEffect(() => { load() }, [load])
  useEffect(() => { getSuppliers().then(r => setSuppliers(r.data)).catch(() => {}) }, [])

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))].sort()
  const locations = [...new Set(items.map(i => i.location).filter(Boolean))].sort()
  // Descripciones existentes (para autocomplete y detección de duplicados)
  const descriptions = [...new Set(items.map(i => i.description).filter(Boolean))].sort()
  const names = [...new Set(items.map(i => i.name).filter(Boolean))].sort()

  // Aviso: descripción igual a otro artículo YA cargado con un código distinto.
  const descDup = (() => {
    const d = (form.description || '').trim().toLowerCase()
    if (!d) return null
    return items.find(it => (it.description || '').trim().toLowerCase() === d && it.code !== form.code) || null
  })()

  // Partes especiales aún pendientes por recibir: van en su propia tarjeta, no en la tabla.
  const isPending = (it) => (parseFloat(it.pending_qty || '0') || 0) > 0
  const pendingItems = items.filter(isPending)
  const stockItems = items.filter(it => !isPending(it))  // inventario real (sin pendientes por recibir)

  const filtered = items.filter(it => {
    if (isPending(it)) return false  // excluidas de la tabla principal hasta que se reciban
    const q = search.toLowerCase()
    const matchSearch = !q || it.code.toLowerCase().includes(q) || it.name.toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q) || (it.location || '').toLowerCase().includes(q)
    const matchCat = !filterCategory || it.category === filterCategory
    const matchWarehouse = !filterWarehouse || it.warehouse === filterWarehouse
    const matchCondition = !filterCondition || it.condition === filterCondition
    const matchStatus = !filterStatus || it.item_status === filterStatus
    const matchLocation = !filterLocation || it.location === filterLocation
    return matchSearch && matchCat && matchWarehouse && matchCondition && matchStatus && matchLocation
  }).sort((a, b) => {
    let va = a[sortField] || ''
    let vb = b[sortField] || ''
    if (sortField === 'quantity' || sortField === 'unit_price' || sortField === 'cost_price') {
      va = parseFloat(va) || 0; vb = parseFloat(vb) || 0
      return sortDir === 'asc' ? va - vb : vb - va
    }
    return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
  })

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  const openNew = () => {
    setSelected(null)
    setForm({ ...EMPTY_FORM })
    setShowForm(true)
  }

  const openEdit = (item) => {
    setSelected(item)
    setForm({
      code: item.code, name: item.name, description: item.description || '',
      unit: item.unit || 'unidad', unit_price: item.unit_price || '0.00',
      cost_price: item.cost_price || '0.00',
      quantity: item.quantity || '0', category: item.category || '', notes: item.notes || '',
      warehouse: item.warehouse || 'principal',
      supplier_id: item.supplier_id || '',
      condition: item.condition || 'nuevo',
      item_status: item.item_status || 'ingresado',
      location: item.location || '',
    })
    setShowForm(true)
  }

  const handleImportCSV = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''  // permite re-seleccionar el mismo archivo
    if (!file) return
    setImporting(true)
    try {
      const { data } = await importInventoryCSV(file)
      const parts = [`${data.created} creado(s)`, `${data.updated} actualizado(s)`]
      if (data.error_count) parts.push(`${data.error_count} con aviso`)
      toast.success(`Importación: ${parts.join(' · ')}`, { duration: 6000 })
      if (data.error_count && data.errors?.length) {
        const preview = data.errors.slice(0, 5).map(er => `Fila ${er.row}: ${er.message}`).join('\n')
        toast(preview, { duration: 9000, icon: '⚠️' })
      }
      load()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al importar el CSV')
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = () => {
    const headers = ['codigo', 'nombre', 'categoria', 'descripcion', 'unidad', 'precio_venta', 'costo', 'stock', 'proveedor', 'bodega', 'condicion', 'estado', 'ubicacion']
    const example = ['CAB-001', 'Cable HDMI 2m', 'Cables', 'Cable HDMI alta velocidad', 'unidad', '12.50', '7.00', '10', '', 'Principal', 'nuevo', 'ingresado', 'Estante A-3']
    const csv = headers.join(',') + '\n' + example.join(',') + '\n'
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'plantilla_inventario.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const exportCSV = () => {
    if (filtered.length === 0) { toast.error('No hay artículos para exportar'); return }
    const headers = ['codigo', 'nombre', 'categoria', 'descripcion', 'unidad', 'precio_venta', 'costo', 'stock', 'proveedor', 'bodega', 'condicion', 'estado', 'ubicacion']
    const supplierName = (id) => suppliers.find(s => s.id === id)?.name || ''
    const esc = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const lines = filtered.map(it => [
      it.code, it.name, it.category || '', it.description || '', it.unit || '', it.unit_price || '', it.cost_price || '', it.quantity || '',
      supplierName(it.supplier_id), WAREHOUSE_LABEL[it.warehouse] || it.warehouse || '', it.condition || '', it.item_status || '', it.location || '',
    ].map(esc).join(','))
    const csv = headers.join(',') + '\n' + lines.join('\n') + '\n'
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `inventario_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const exportPDF = () => {
    if (filtered.length === 0) { toast.error('No hay artículos para exportar'); return }
    const co = getCompanyCache()
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const supplierName = (id) => suppliers.find(s => s.id === id)?.name || '—'
    const th = 'padding:5px 6px;text-align:left;font-size:7.5pt;border:1px solid #2d4d7a;white-space:nowrap'
    const td = 'padding:4px 6px;border:1px solid #d1d5db;font-size:7.5pt;vertical-align:top'
    const rows = filtered.map((it, i) => `<tr style="background:${i % 2 ? '#fff' : '#f8f9fb'}">
      <td style="${td};font-family:monospace">${esc(it.code)}</td>
      <td style="${td}">${esc(it.name)}${it.description ? `<div style="font-size:6.5pt;color:#666">${esc(it.description)}</div>` : ''}</td>
      <td style="${td}">${esc(it.category || '—')}</td>
      <td style="${td}">${esc(CONDITION_LABEL[it.condition] || it.condition || '—')}</td>
      <td style="${td}">${esc(ITEM_STATUS_LABEL[it.item_status] || it.item_status || '—')}</td>
      <td style="${td}">${esc(it.location || '—')}</td>
      <td style="${td}">${esc(WAREHOUSE_LABEL[it.warehouse] || it.warehouse || '—')}</td>
      <td style="${td};text-align:right;white-space:nowrap">${esc(fmtQty(it.quantity))} ${esc(it.unit || '')}</td>
      <td style="${td}">${esc(supplierName(it.supplier_id))}</td>
      <td style="${td};text-align:right">$${parseFloat(it.cost_price || '0').toFixed(2)}</td>
      <td style="${td};text-align:right">$${parseFloat(it.unit_price || '0').toFixed(2)}</td>
    </tr>`).join('')
    const totalValue = filtered.reduce((s, it) => s + (parseFloat(it.quantity || '0') || 0) * (parseFloat(it.cost_price || '0') || 0), 0)
    const filterNote = [
      filterCategory && `Categoría: ${filterCategory}`,
      filterWarehouse && `Bodega: ${WAREHOUSE_LABEL[filterWarehouse]}`,
      filterCondition && `Condición: ${CONDITION_LABEL[filterCondition]}`,
      filterStatus && `Estado: ${ITEM_STATUS_LABEL[filterStatus]}`,
      filterLocation && `Ubicación: ${filterLocation}`,
      search && `Búsqueda: "${search}"`,
    ].filter(Boolean).join(' · ')
    const body = `<div style="font-family:Arial,sans-serif;color:#111;padding:4px">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #1e3a5f;padding-bottom:6px;margin-bottom:8px">
        <div><div style="font-size:14pt;font-weight:bold;color:#1e3a5f">${esc(co.company_name || 'Inventario')}</div>
        <div style="font-size:8pt;color:#555">Reporte de inventario${filterNote ? ` · ${esc(filterNote)}` : ''}</div></div>
        <div style="text-align:right;font-size:8pt;color:#555">${filtered.length} artículo(s)<br>Valor total: <b>$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1e3a5f;color:#fff">
          <th style="${th}">Código</th><th style="${th}">Nombre / Descripción</th><th style="${th}">Categoría</th>
          <th style="${th}">Condición</th><th style="${th}">Estado</th><th style="${th}">Ubicación</th><th style="${th}">Bodega</th>
          <th style="${th};text-align:right">Stock</th><th style="${th}">Proveedor</th>
          <th style="${th};text-align:right">Costo</th><th style="${th};text-align:right">P. venta</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
    openPdfWindow('Inventario', body, { extraCss: '@page{size:A4 landscape;margin:8mm}' })
  }

  const handleSave = async () => {
    if (!form.code.trim()) return toast.error('El código es obligatorio')
    if (!form.name.trim()) return toast.error('El nombre es obligatorio')
    setSaving(true)
    const payload = { ...form, supplier_id: form.supplier_id ? Number(form.supplier_id) : null }
    try {
      if (selected) {
        await updateInventoryItem(selected.id, payload)
        toast.success('Artículo actualizado')
      } else {
        await createInventoryItem(payload)
        toast.success('Artículo creado')
      }
      setShowForm(false)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error guardando artículo')
    } finally {
      setSaving(false)
    }
  }

  const openDelete = (item) => {
    setDeleteJustif('')
    setDeleteItem(item)
  }

  const confirmDelete = async () => {
    const justif = deleteJustif.trim()
    if (!justif) return toast.error('La justificación de la baja es obligatoria')
    setDeleteSaving(true)
    try {
      const r = await deleteInventoryItem(deleteItem.id, justif)
      toast.success(r.data?.message || 'Artículo dado de baja')
      if (selected?.id === deleteItem.id) setShowForm(false)
      setDeleteItem(null)
      load()
      if (allTxns.length > 0) loadAllTxns()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al dar de baja el artículo')
    } finally {
      setDeleteSaving(false)
    }
  }

  const openHistory = async (item) => {
    setHistoryItem(item)
    setHistoryTxns([])
    setHistoryLoading(true)
    try {
      const r = await getInventoryTransactions(item.id)
      setHistoryTxns(r.data)
    } catch {
      toast.error('Error cargando historial')
    } finally {
      setHistoryLoading(false)
    }
  }

  const loadAllTxns = useCallback((opts = {}) => {
    setAllTxnsLoading(true)
    getAllInventoryTransactions({ limit: 1000, ...opts })
      .then(r => setAllTxns(r.data))
      .catch(() => toast.error('Error cargando movimientos'))
      .finally(() => setAllTxnsLoading(false))
  }, [])

  // Recarga Movimientos desde el backend cuando cambian las fechas (para traer datos fuera del set reciente)
  const applyTxnDates = (from, to) => {
    setTxnFrom(from); setTxnTo(to)
    loadAllTxns({ date_from: from || undefined, date_to: to || undefined })
  }

  const handleTabChange = (t) => {
    setTab(t)
    if (t === 'movimientos' && allTxns.length === 0) loadAllTxns()
  }

  // ── Órdenes de recibo: modal (crear/editar) + panel (tab) ──
  const [searchParams, setSearchParams] = useSearchParams()
  const [receiptsInitial, setReceiptsInitial] = useState(null)
  const [receiptsTick, setReceiptsTick] = useState(0)
  const [returnsTick, setReturnsTick] = useState(0)
  const openReceiptEditor = useCallback((id, edit = false) => {
    setReceiptsInitial({ mode: id ? 'edit' : 'new', id, edit })
    setShowReceipts(true)
  }, [])
  // FAB / enlace externo: crear orden de recibo con ?action=new-receipt
  useEffect(() => {
    if (searchParams.get('action') === 'new-receipt') {
      setTab('ordenes')
      openReceiptEditor(null)
      const sp = new URLSearchParams(searchParams); sp.delete('action')
      setSearchParams(sp, { replace: true })
    }
  }, []) // eslint-disable-line

  const filteredTxns = useMemo(() => {
    return allTxns.filter(t => {
      const delta = parseFloat(t.qty_delta || '0')
      if (txnFilter === 'entradas' && delta <= 0) return false
      if (txnFilter === 'salidas'  && delta >= 0) return false
      if (txnSearch) {
        const q = txnSearch.toLowerCase()
        const matchCode   = t.item_code?.toLowerCase().includes(q)
        const matchName   = t.item_name?.toLowerCase().includes(q)
        const matchNote   = t.notes?.toLowerCase().includes(q)
        const matchLabel  = t.source_label?.toLowerCase().includes(q)
        const matchClient  = t.client_name?.toLowerCase().includes(q)
        const matchCompany = t.client_company?.toLowerCase().includes(q)
        if (!matchCode && !matchName && !matchNote && !matchLabel && !matchClient && !matchCompany) return false
      }
      return true
    })
  }, [allTxns, txnFilter, txnSearch])

  // ── Reportes ─────────────────────────────────────
  const runReport = () => {
    setReportLoading(true)
    setReportRan(true)
    getAllInventoryTransactions({
      date_from: reportFrom || undefined,
      date_to: reportTo || undefined,
      supplier_id: reportSup || undefined,
      limit: 2000,
    })
      .then(r => setReportTxns(r.data))
      .catch(() => toast.error('Error generando el reporte'))
      .finally(() => setReportLoading(false))
  }

  const reportData = useMemo(() => {
    const rows = reportTxns
      .map(t => {
        const qty = parseFloat(t.qty_delta || '0') || 0
        const cost = parseFloat(t.unit_cost || '0') || 0
        return { ...t, _qty: qty, _cost: cost, _value: Math.abs(qty) * cost }
      })
      .filter(r => {
        if (reportDir === 'entradas' && r._qty <= 0) return false
        if (reportDir === 'salidas'  && r._qty >= 0) return false
        return true
      })
    const ent = rows.filter(r => r._qty > 0)
    const sal = rows.filter(r => r._qty < 0)
    const sum = (arr, k) => arr.reduce((s, r) => s + r[k], 0)
    const bySupplier = {}
    ent.forEach(r => {
      const k = r.supplier_name || 'Sin proveedor'
      if (!bySupplier[k]) bySupplier[k] = { qty: 0, val: 0 }
      bySupplier[k].qty += r._qty
      bySupplier[k].val += r._value
    })
    return {
      rows,
      entQty: sum(ent, '_qty'), entVal: sum(ent, '_value'),
      salQty: sum(sal, '_qty') * -1, salVal: sum(sal, '_value'),
      bySupplier: Object.entries(bySupplier).sort((a, b) => b[1].val - a[1].val),
    }
  }, [reportTxns, reportDir])

  const money = (v) => `$${(v || 0).toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const exportReportCSV = () => {
    const headers = ['fecha', 'codigo', 'articulo', 'tipo', 'proveedor', 'cantidad', 'costo_unitario', 'valor', 'notas']
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [headers.join(',')]
    reportData.rows.forEach(r => {
      lines.push([
        esc(format(new Date(r.created_at), 'yyyy-MM-dd HH:mm')),
        esc(r.item_code), esc(r.item_name || ''),
        esc(SOURCE_LABEL[r.source_type] || r.source_type),
        esc(r.supplier_name || ''),
        esc(r._qty), esc(r._cost.toFixed(2)), esc(r._value.toFixed(2)),
        esc(r.notes || ''),
      ].join(','))
    })
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte-movimientos-${reportFrom || 'inicio'}_${reportTo || 'hoy'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadReportPDF = async () => {
    setReportPdfLoading(true)
    try {
      const r = await getInventoryReportPdf({
        date_from: reportFrom || undefined,
        date_to: reportTo || undefined,
        direction: reportDir,
        supplier_id: reportSup || undefined,
      })
      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }))
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      toast.error('No se pudo generar el PDF')
    } finally {
      setReportPdfLoading(false)
    }
  }

  const resetWithdraw = () => { setWithdrawItem(null); setManualExit(false); setWithdrawQty(''); setWithdrawMotivo(MOTIVOS[0]); setWithdrawJustif(''); setExitSearch('') }

  const openWithdraw = (item) => {
    setManualExit(false)
    setWithdrawItem(item)
    setWithdrawQty('')
    setWithdrawMotivo(MOTIVOS[0])
    setWithdrawJustif('')
  }

  const openManualExit = () => {
    setWithdrawItem(null)
    setWithdrawQty('')
    setWithdrawMotivo(MOTIVOS[0])
    setWithdrawJustif('')
    setExitSearch('')
    setManualExit(true)
  }

  const handleWithdraw = async () => {
    if (!withdrawItem) return toast.error('Selecciona un artículo')
    const qty = parseFloat(withdrawQty)
    if (!qty || qty <= 0) return toast.error('Ingresa una cantidad válida')
    if (withdrawMotivo === 'Otro' && !withdrawJustif.trim()) return toast.error('La justificación es obligatoria cuando el motivo es "Otro"')
    setWithdrawSaving(true)
    try {
      await withdrawInventoryItem(withdrawItem.id, { qty, motivo: withdrawMotivo, justificacion: withdrawJustif.trim() || null })
      toast.success(`Salida registrada: -${qty} ${withdrawItem.unit || 'unidad'}`)
      resetWithdraw()
      load()
      if (allTxns.length > 0) loadAllTxns()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al registrar salida')
    } finally {
      setWithdrawSaving(false)
    }
  }

  const openReceive = (item) => {
    setReceiveForm({ supplier_id: item.supplier_id ? String(item.supplier_id) : '', qty: '', cost: '', notes: '' })
    setReceiveItem(item)
  }

  const openEta = (item) => { setEtaValue(item.pending_eta || ''); setEtaItem(item) }
  const saveEta = async () => {
    setEtaSaving(true)
    try {
      await updateInventoryPending(etaItem.id, { expected_date: etaValue || null })
      toast.success('Fecha estimada actualizada')
      setEtaItem(null); load()
    } catch { toast.error('Error al actualizar la fecha') }
    finally { setEtaSaving(false) }
  }

  const handleReceive = async () => {
    const qty = parseFloat(receiveForm.qty)
    const cost = parseFloat(receiveForm.cost)
    if (!receiveForm.supplier_id) return toast.error('Selecciona el proveedor')
    if (!qty || qty <= 0) return toast.error('Ingresa una cantidad válida')
    if (receiveForm.cost === '' || isNaN(cost) || cost < 0) return toast.error('Ingresa el costo unitario')
    setReceiveSaving(true)
    try {
      await receiveInventoryItem(receiveItem.id, {
        supplier_id: Number(receiveForm.supplier_id), qty, cost,
        notes: receiveForm.notes?.trim() || null,
      })
      toast.success(`Recepción registrada: +${qty} ${receiveItem.unit || 'unidad'}`)
      setReceiveItem(null)
      load()
      if (allTxns.length > 0) loadAllTxns()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al registrar la recepción')
    } finally {
      setReceiveSaving(false)
    }
  }

  const openAdjust = (item) => {
    setAdjustForm({ new_qty: fmtQty(item.quantity), justification: '' })
    setAdjustItem(item)
  }

  const handleAdjust = async () => {
    const newQty = parseFloat(adjustForm.new_qty)
    if (isNaN(newQty) || newQty < 0) return toast.error('Ingresa la cantidad real (conteo)')
    if (!adjustForm.justification.trim()) return toast.error('La justificación del ajuste es obligatoria')
    setAdjustSaving(true)
    try {
      await adjustInventoryItem(adjustItem.id, { new_qty: newQty, justification: adjustForm.justification.trim() })
      toast.success('Ajuste registrado ✓')
      setAdjustItem(null)
      load()
      if (allTxns.length > 0) loadAllTxns()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al registrar el ajuste')
    } finally {
      setAdjustSaving(false)
    }
  }

  const handleCreateSupplier = async () => {
    const name = newSupplier.name.trim()
    if (!name) return toast.error('Ingresa el nombre del proveedor')
    setNewSupplierSaving(true)
    try {
      const clean = (v) => (v && v.trim() ? v.trim() : null)
      const r = await createSupplier({
        name,
        contact_name: clean(newSupplier.contact_name),
        category: clean(newSupplier.category),
        phone: clean(newSupplier.phone),
        email: clean(newSupplier.email),
        website: clean(newSupplier.website),
        address: clean(newSupplier.address),
        notes: clean(newSupplier.notes),
      })
      setSuppliers(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)))
      setReceiveForm(f => ({ ...f, supplier_id: String(r.data.id) }))
      setShowNewSupplier(false)
      setNewSupplier(EMPTY_NEW_SUPPLIER)
      toast.success('Proveedor creado ✓')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al crear el proveedor')
    } finally {
      setNewSupplierSaving(false)
    }
  }

  const lowStock = (it) => parseFloat(it.quantity || '0') <= 5 && parseFloat(it.quantity || '0') >= 0
  const negStock = (it) => (parseFloat(it.quantity || '0') || 0) < 0

  return (
    <div className="p-4 sm:p-6 w-full max-w-7xl mx-auto">
      {tip && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none -translate-x-1/2 -translate-y-full px-2 py-1 rounded-md bg-gray-900 text-white text-xs font-medium whitespace-nowrap shadow-lg"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.text}
          <span className="absolute left-1/2 top-full -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-900" />
        </div>,
        document.body
      )}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap lg:pr-28">
        <div className="flex items-center gap-2">
          <Package size={22} className="text-emerald-600" />
          <h1 className="text-xl font-bold text-gray-900">Inventario</h1>
        </div>
        {tab === 'items' && (
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportCSV} />
            <button onClick={downloadTemplate} title="Descargar plantilla CSV" className="btn-secondary flex items-center gap-2 text-sm">
              <Download size={14} /> <span className="hidden sm:inline">Plantilla</span>
            </button>
            {canEdit && (
              <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-60">
                <Upload size={14} /> {importing ? 'Importando…' : 'Importar CSV'}
              </button>
            )}
            <button onClick={exportCSV} title="Exportar a CSV lo filtrado" className="btn-secondary flex items-center gap-2 text-sm">
              <Download size={14} /> <span className="hidden sm:inline">Exportar CSV</span>
            </button>
            <button onClick={exportPDF} title="Exportar a PDF lo filtrado" className="btn-secondary flex items-center gap-2 text-sm">
              <FileText size={14} /> <span className="hidden sm:inline">Exportar PDF</span>
            </button>
            {canEdit && (
              <button onClick={openManualExit} title="Registrar una salida manual de inventario" className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 transition-colors">
                <ArrowDownCircle size={15} /> <span className="hidden sm:inline">Salida manual</span>
              </button>
            )}
            {canEdit && (
              <button onClick={() => handleTabChange('ordenes')} title="Órdenes de recibo de inventario" className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors font-medium whitespace-nowrap">
                <ClipboardList size={15} /> Órdenes de recibo
                {pendingReview.items > 0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">{pendingReview.items}</span>}
              </button>
            )}
            {canEdit && (
              <button onClick={openNew} className="btn-primary flex items-center gap-2">
                <Plus size={15} /> <span className="hidden sm:inline">Nuevo artículo</span><span className="sm:hidden">Nuevo</span>
              </button>
            )}
          </div>
        )}
        {tab === 'movimientos' && (
          <button onClick={loadAllTxns} className="btn-secondary flex items-center gap-2 text-sm">
            <History size={14} /> Actualizar
          </button>
        )}
      </div>

      {/* Tabs — barra desplazable en móvil para no empujar la página (scroll horizontal) */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <button
          onClick={() => handleTabChange('items')}
          className={`shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'items' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <span className="flex items-center gap-1.5"><Package size={14} /> Artículos <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{stockItems.length}</span></span>
        </button>
        <button
          onClick={() => handleTabChange('movimientos')}
          className={`shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'movimientos' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <span className="flex items-center gap-1.5"><List size={14} /> Movimientos</span>
        </button>
        <button
          onClick={() => handleTabChange('reportes')}
          className={`shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'reportes' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <span className="flex items-center gap-1.5"><FileText size={14} /> Reportes</span>
        </button>
        <button
          onClick={() => handleTabChange('ordenes')}
          className={`shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'ordenes' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <span className="flex items-center gap-1.5">
            <ClipboardList size={14} /> <span className="sm:hidden">Órdenes</span><span className="hidden sm:inline">Órdenes de recibo</span>
            {pendingReview.items > 0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">{pendingReview.items}</span>}
          </span>
        </button>
        <button
          onClick={() => handleTabChange('devoluciones')}
          className={`shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'devoluciones' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <span className="flex items-center gap-1.5"><Undo2 size={14} /> Devoluciones</span>
        </button>
      </div>

      {/* Banner: órdenes de recibo con artículos pendientes por revisar */}
      {pendingReview.items > 0 && (
        <div className="mb-4 flex items-center gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle size={18} className="text-amber-600 shrink-0" />
          <div className="flex-1 min-w-[200px] text-sm text-amber-800">
            <b>{pendingReview.items}</b> artículo(s) de <b>{pendingReview.orders}</b> orden(es) de recibo ingresadas al inventario están <b>pendientes por revisar</b>.
          </div>
          <button onClick={() => handleTabChange('ordenes')} className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 whitespace-nowrap">Revisar órdenes</button>
        </div>
      )}

      {/* Banner: artículos vendidos sin stock (existencia negativa) */}
      {oversold.length > 0 && (
        <div className="mb-4 flex items-center gap-3 flex-wrap bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={18} className="text-red-600 shrink-0" />
          <div className="flex-1 min-w-[200px] text-sm text-red-800">
            <b>{oversold.length}</b> artículo(s) con <b>existencia negativa</b> (vendidos sin stock, por reponer).
          </div>
          <button onClick={() => setShowOversold(true)} className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 whitespace-nowrap">Ver detalle</button>
        </div>
      )}

      {/* ── Movimientos tab ─────────────────────────── */}
      {tab === 'movimientos' && (
        <div>
          <div className="flex gap-2 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9 py-2 text-sm w-full"
                placeholder="Buscar artículo, código, documento..."
                value={txnSearch}
                onChange={e => setTxnSearch(e.target.value)}
              />
            </div>
            <select className="input py-2 text-sm" value={txnFilter} onChange={e => setTxnFilter(e.target.value)}>
              <option value="all">Todos los movimientos</option>
              <option value="entradas">Solo entradas (+)</option>
              <option value="salidas">Solo salidas (−)</option>
            </select>
            <div className="flex items-center gap-1.5">
              <input type="date" className="input py-2 text-sm" value={txnFrom} onChange={e => applyTxnDates(e.target.value, txnTo)} title="Desde" />
              <span className="text-gray-400 text-sm">–</span>
              <input type="date" className="input py-2 text-sm" value={txnTo} onChange={e => applyTxnDates(txnFrom, e.target.value)} title="Hasta" />
              {(txnFrom || txnTo) && (
                <button onClick={() => applyTxnDates('', '')} className="text-xs text-gray-500 hover:text-gray-700 px-2" title="Limpiar fechas">Limpiar</button>
              )}
            </div>
          </div>

          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Fecha</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Artículo</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Tipo</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 hidden sm:table-cell">Cliente / Empresa</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 hidden md:table-cell">Vinculado a</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 hidden lg:table-cell">Notas</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {allTxnsLoading && (
                    <tr><td colSpan={7} className="py-10 text-center text-gray-400">Cargando movimientos...</td></tr>
                  )}
                  {!allTxnsLoading && filteredTxns.length === 0 && (
                    <tr><td colSpan={7} className="py-10 text-center text-gray-400">Sin movimientos registrados</td></tr>
                  )}
                  {!allTxnsLoading && filteredTxns.map(t => {
                    const delta = parseFloat(t.qty_delta || '0')
                    const isPos = delta > 0
                    return (
                      <tr key={t.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {format(new Date(t.created_at), "d MMM yyyy, HH:mm", { locale: es })}
                        </td>
                        <td className="px-4 py-3 min-w-0">
                          <div className="font-medium text-gray-900 text-sm truncate">{t.item_name || t.item_code}</div>
                          <div className="text-xs text-gray-400 font-mono">{t.item_code}</div>
                          {/* Empresa/cliente visible en móvil dentro de la celda artículo */}
                          {(t.client_company || t.client_name) && (
                            <div className="sm:hidden mt-1 border-t border-gray-100 pt-1">
                              {t.client_company && (
                                <div className="text-xs font-semibold text-gray-700 truncate">{t.client_company}</div>
                              )}
                              {t.client_name && (
                                <div className={`text-xs truncate ${t.client_company ? 'text-gray-400' : 'text-gray-700 font-medium'}`}>{t.client_name}</div>
                              )}
                              {t.ticket_id && (
                                <button
                                  onClick={() => navigate(`/tickets/${t.ticket_id}`)}
                                  className="flex items-center gap-0.5 text-[11px] text-blue-500 hover:text-blue-700 font-mono mt-0.5"
                                >
                                  <ExternalLink size={9} /> Ticket #{t.ticket_id}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_COLOR[t.source_type] || 'bg-gray-100 text-gray-600'}`}>
                            {SOURCE_LABEL[t.source_type] || t.source_type}
                          </span>
                          {/* "Vinculado a" visible en móvil/tablet dentro de la celda Tipo */}
                          {t.source_label && (
                            <div className="md:hidden mt-1 text-[11px] font-mono text-gray-400 truncate max-w-[110px]">{t.source_label}</div>
                          )}
                          {/* Justificación/notas visible en móvil/tablet (la columna Notas está oculta bajo lg) */}
                          {t.notes && (
                            <div className="lg:hidden mt-1 text-[11px] text-gray-500 break-words max-w-[160px] whitespace-pre-wrap">{t.notes}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          {(t.client_company || t.client_name) ? (
                            <div className="min-w-0">
                              {t.client_company && (
                                <div className="text-xs font-semibold text-gray-800 truncate max-w-[160px]">{t.client_company}</div>
                              )}
                              {t.client_name && (
                                <div className={`text-xs truncate max-w-[160px] ${t.client_company ? 'text-gray-400' : 'text-gray-700 font-medium'}`}>{t.client_name}</div>
                              )}
                              {t.ticket_id && (
                                <button
                                  onClick={() => navigate(`/tickets/${t.ticket_id}`)}
                                  className="flex items-center gap-0.5 text-[11px] text-blue-500 hover:text-blue-700 font-mono mt-0.5 hover:underline"
                                >
                                  <ExternalLink size={9} /> Ticket #{t.ticket_id}
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          {t.source_label
                            ? <span className="text-xs font-mono bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{t.source_label}</span>
                            : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 hidden lg:table-cell max-w-xs break-words whitespace-pre-wrap" title={t.notes || ''}>{t.notes || '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-bold text-base flex items-center justify-end gap-1 ${isPos ? 'text-emerald-600' : 'text-red-500'}`}>
                            {isPos ? <ArrowUpCircle size={14} /> : <ArrowDownCircle size={14} />}
                            {isPos ? '+' : ''}{delta % 1 === 0 ? Math.round(delta) : delta.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {!allTxnsLoading && filteredTxns.length > 0 && (
            <div className="mt-3 text-xs text-gray-400 flex gap-4 flex-wrap">
              <span>{filteredTxns.length} movimientos</span>
              <span className="text-emerald-600">{filteredTxns.filter(t => parseFloat(t.qty_delta) > 0).length} entradas</span>
              <span className="text-red-500">{filteredTxns.filter(t => parseFloat(t.qty_delta) < 0).length} salidas</span>
            </div>
          )}
        </div>
      )}

      {/* ── Reportes tab ─────────────────────────── */}
      {tab === 'reportes' && (
        <div>
          {/* Filtros */}
          <div className="card p-4 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="label">Desde</label>
                <input type="date" className="input" value={reportFrom} onChange={e => setReportFrom(e.target.value)} />
              </div>
              <div>
                <label className="label">Hasta</label>
                <input type="date" className="input" value={reportTo} onChange={e => setReportTo(e.target.value)} />
              </div>
              <div>
                <label className="label">Tipo</label>
                <select className="input" value={reportDir} onChange={e => setReportDir(e.target.value)}>
                  <option value="all">Entradas y salidas</option>
                  <option value="entradas">Solo entradas</option>
                  <option value="salidas">Solo salidas</option>
                </select>
              </div>
              <div>
                <label className="label">Proveedor</label>
                <select className="input" value={reportSup} onChange={e => setReportSup(e.target.value)}>
                  <option value="">Todos</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button onClick={runReport} disabled={reportLoading}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-60 text-sm">
                <FileText size={15} /> {reportLoading ? 'Generando...' : 'Generar reporte'}
              </button>
              <button onClick={exportReportCSV} disabled={!reportData.rows.length}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 text-sm">
                <Download size={15} /> Exportar CSV
              </button>
              <button onClick={downloadReportPDF} disabled={!reportData.rows.length || reportPdfLoading}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 text-sm">
                <FileText size={15} /> {reportPdfLoading ? 'Generando PDF...' : 'Descargar PDF'}
              </button>
            </div>
          </div>

          {reportLoading && <div className="py-10 text-center text-gray-400">Generando reporte...</div>}

          {!reportLoading && reportRan && (
            <>
              {/* Resumen */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div className="card p-4">
                  <div className="text-xs text-gray-500 mb-1">Entradas</div>
                  <div className="text-2xl font-bold text-emerald-600">{money(reportData.entVal)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{reportData.entQty.toLocaleString('es-PA')} unidades</div>
                </div>
                <div className="card p-4">
                  <div className="text-xs text-gray-500 mb-1">Salidas</div>
                  <div className="text-2xl font-bold text-red-500">{money(reportData.salVal)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{reportData.salQty.toLocaleString('es-PA')} unidades</div>
                </div>
                <div className="card p-4">
                  <div className="text-xs text-gray-500 mb-1">Neto (entradas − salidas)</div>
                  <div className={`text-2xl font-bold ${reportData.entVal - reportData.salVal >= 0 ? 'text-gray-900' : 'text-red-500'}`}>{money(reportData.entVal - reportData.salVal)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{(reportData.entQty - reportData.salQty).toLocaleString('es-PA')} unidades</div>
                </div>
              </div>

              {/* Entradas por proveedor */}
              {reportData.bySupplier.length > 0 && reportDir !== 'salidas' && (
                <div className="card overflow-hidden p-0 mb-4">
                  <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-semibold text-gray-700">Entradas por proveedor</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Proveedor</th>
                          <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Cantidad</th>
                          <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.bySupplier.map(([name, g]) => (
                          <tr key={name} className="border-b border-gray-50 last:border-0">
                            <td className="px-4 py-2.5 text-gray-800">{name}</td>
                            <td className="px-4 py-2.5 text-right text-gray-600">{g.qty.toLocaleString('es-PA')}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">{money(g.val)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Detalle */}
              <div className="card overflow-hidden p-0">
                <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-semibold text-gray-700">Detalle ({reportData.rows.length} movimiento(s))</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Fecha</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Artículo</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Tipo</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-gray-600 hidden sm:table-cell">Proveedor</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Cant.</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-gray-600 hidden sm:table-cell">Costo u.</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.rows.length === 0 && (
                        <tr><td colSpan={7} className="py-10 text-center text-gray-400">Sin movimientos en el rango seleccionado</td></tr>
                      )}
                      {reportData.rows.map(r => (
                        <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">{format(new Date(r.created_at), 'd MMM yyyy, HH:mm', { locale: es })}</td>
                          <td className="px-4 py-2.5">
                            <div className="font-mono text-xs font-semibold text-gray-800">{r.item_code}</div>
                            <div className="text-xs text-gray-400 truncate max-w-[160px]">{r.item_name}</div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${SOURCE_COLOR[r.source_type] || 'bg-gray-100 text-gray-600'}`}>{SOURCE_LABEL[r.source_type] || r.source_type}</span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 text-xs hidden sm:table-cell">{r.supplier_name || '—'}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${r._qty > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{r._qty > 0 ? '+' : ''}{r._qty % 1 === 0 ? r._qty : r._qty.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600 hidden sm:table-cell">{money(r._cost)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{money(r._value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Órdenes de recibo tab ─────────────────── */}
      {tab === 'ordenes' && (
        <ReceiptOrdersPanel
          suppliers={suppliers}
          onOpenEditor={openReceiptEditor}
          onChanged={() => { load(); loadPending(); setReturnsTick(t => t + 1) }}
          refreshTick={receiptsTick}
        />
      )}

      {tab === 'devoluciones' && <SupplierReturnsPanel refreshTick={returnsTick} />}

      {/* ── Artículos tab ─────────────────────────── */}
      {tab === 'items' && <>

      {/* Stats */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
            <p className="text-xs text-gray-400 mb-1">Total artículos</p>
            <p className="text-2xl font-bold text-gray-900">{stockItems.length}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 shadow-sm col-span-1">
            <p className="text-xs text-emerald-600 font-medium mb-1">Valor en bodega</p>
            <p className="text-2xl font-bold text-emerald-700">
              ${stockItems.reduce((s, it) => s + (parseFloat(it.quantity || '0') || 0) * (parseFloat(it.cost_price || '0') || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 shadow-sm col-span-1">
            <p className="text-xs text-blue-600 font-medium mb-1">Valor de venta</p>
            <p className="text-2xl font-bold text-blue-700">
              ${stockItems.reduce((s, it) => s + (parseFloat(it.quantity || '0') || 0) * (parseFloat(it.unit_price || '0') || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className={`rounded-xl p-4 shadow-sm border ${stockItems.filter(lowStock).length > 0 ? 'bg-orange-50 border-orange-100' : 'bg-white border-gray-100'}`}>
            <p className={`text-xs font-medium mb-1 ${stockItems.filter(lowStock).length > 0 ? 'text-orange-500' : 'text-gray-400'}`}>Stock bajo (≤5)</p>
            <p className={`text-2xl font-bold ${stockItems.filter(lowStock).length > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{stockItems.filter(lowStock).length}</p>
          </div>
        </div>
      )}

      {/* Filters: buscador en una fila + filtros en grilla compacta */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9 py-2 text-sm w-full"
            placeholder="Buscar por código, nombre..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
          {categories.length > 0 && (
            <select className="input py-2 text-sm w-full" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
              <option value="">Todas las categorías</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select className="input py-2 text-sm w-full" value={filterWarehouse} onChange={e => setFilterWarehouse(e.target.value)}>
            <option value="">Todas las bodegas</option>
            {warehouses.map(w => <option key={w} value={w}>{WAREHOUSE_LABEL[w]}</option>)}
          </select>
          <select className="input py-2 text-sm w-full" value={filterCondition} onChange={e => setFilterCondition(e.target.value)}>
            <option value="">Toda condición</option>
            {CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
          </select>
          <select className="input py-2 text-sm w-full" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Todo estado</option>
            {ITEM_STATUSES.map(s => <option key={s} value={s}>{ITEM_STATUS_LABEL[s]}</option>)}
          </select>
          {locations.length > 0 && (
            <select className="input py-2 text-sm w-full" value={filterLocation} onChange={e => setFilterLocation(e.target.value)}>
              <option value="">Toda ubicación</option>
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Pendientes por recibir (partes especiales aprobadas, aún no llegan) */}
      {pendingItems.length > 0 && (
        <div className="card mb-4">
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock size={15} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-gray-800">Pendientes por recibir</h3>
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">{pendingItems.length}</span>
            <span className="text-xs text-gray-400 hidden sm:inline">— pasan al inventario al recibirlas</span>
          </div>
          <div className="space-y-2">
            {pendingItems.map(it => {
              const overdue = it.pending_eta && new Date(it.pending_eta) < new Date(new Date().toDateString())
              const eta = it.pending_eta ? `${it.pending_eta.slice(8, 10)}/${it.pending_eta.slice(5, 7)}/${it.pending_eta.slice(0, 4)}` : null
              const m = (it.code || '').match(/^ESP-T(\d+)-/)
              return (
                <div key={it.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-amber-100 bg-amber-50/40 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] font-semibold text-gray-500">{it.code}</span>
                      <span className="text-sm font-medium text-gray-800">{it.name}</span>
                      <span className="text-xs text-gray-500">× {fmtQty(it.pending_qty)}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                      {m && <a href={`/tickets/${m[1]}`} className="text-blue-500 hover:text-blue-700">Ticket #{m[1]}</a>}
                      {it.supplier_name && <span>· {it.supplier_name}</span>}
                      <button onClick={() => openEta(it)} disabled={!canEdit}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium ${overdue ? 'text-red-600' : 'text-amber-700'} ${canEdit ? 'hover:bg-amber-100' : ''}`}
                        title={canEdit ? 'Editar fecha estimada de llegada' : undefined}>
                        <CalendarClock size={11} /> {eta ? `ETA ${eta}${overdue ? ' (atrasada)' : ''}` : 'Definir ETA'}
                      </button>
                    </div>
                  </div>
                  {canEdit && (
                    <button onClick={() => openReceive(it)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 flex-shrink-0">
                      <PackagePlus size={13} /> Recibir
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="relative">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('code')}>
                  <span className="flex items-center gap-1">Código <SortIcon field="code" /></span>
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('name')}>
                  <span className="flex items-center gap-1">Nombre <SortIcon field="name" /></span>
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 hidden sm:table-cell" onClick={() => toggleSort('category')}>
                  <span className="flex items-center gap-1 cursor-pointer select-none">Categoría <SortIcon field="category" /></span>
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 hidden lg:table-cell">Bodega</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 hidden lg:table-cell">Condición</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 hidden lg:table-cell">Estado</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 hidden lg:table-cell">Ubicación</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 hidden md:table-cell">Unidad</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('quantity')}>
                  <span className="flex items-center gap-1 justify-end">Stock <SortIcon field="quantity" /></span>
                </th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('cost_price')}>
                  <span className="flex items-center gap-1 justify-end">Costo <SortIcon field="cost_price" /></span>
                </th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 cursor-pointer select-none hidden sm:table-cell" onClick={() => toggleSort('unit_price')}>
                  <span className="flex items-center gap-1 justify-end">Precio venta <SortIcon field="unit_price" /></span>
                </th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 hidden lg:table-cell">Valor</th>
                <th className="px-2 py-3 sticky right-0 bg-gray-50 z-10 shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.06)]" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={13} className="py-10 text-center text-gray-400">Cargando...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={13} className="py-10 text-center text-gray-400">
                  {search || filterCategory || filterWarehouse ? 'Sin resultados' : 'No hay artículos en el inventario'}
                </td></tr>
              )}
              {filtered.map(it => (
                <tr key={it.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors group">
                  <td className="px-4 py-3 font-mono text-xs text-blue-700 font-semibold">
                    {it.code}
                    {it.needs_code && <span className="block mt-0.5 text-[9px] font-sans font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded px-1 py-0.5 whitespace-nowrap" title="Artículo creado desde una orden de recibo; asígnale un código real">⚠ Sin código</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-900 font-medium">{it.name}
                    {it.description && <p className="text-xs text-gray-400 truncate max-w-xs">{it.description}</p>}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 lg:hidden">
                      {it.condition && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${CONDITION_COLOR[it.condition] || 'bg-gray-100 text-gray-600'}`}>{CONDITION_LABEL[it.condition] || it.condition}</span>}
                      {it.item_status && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${ITEM_STATUS_COLOR[it.item_status] || 'bg-gray-100 text-gray-600'}`}>{ITEM_STATUS_LABEL[it.item_status] || it.item_status}</span>}
                      {it.location && <span className="text-[10px] text-gray-500">📍 {it.location}</span>}
                    </div>
                    {/* "Valor" visible en móvil/tablet dentro de la celda Nombre */}
                    <p className="text-xs text-emerald-700 font-semibold lg:hidden mt-0.5">
                      Valor: ${((parseFloat(it.quantity || '0') || 0) * (parseFloat(it.cost_price || '0') || 0)).toFixed(2)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                    {it.category ? <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">{it.category}</span> : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden lg:table-cell text-xs">{WAREHOUSE_LABEL[it.warehouse] || it.warehouse || 'Principal'}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {it.condition ? <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${CONDITION_COLOR[it.condition] || 'bg-gray-100 text-gray-600'}`}>{CONDITION_LABEL[it.condition] || it.condition}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {it.item_status ? <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${ITEM_STATUS_COLOR[it.item_status] || 'bg-gray-100 text-gray-600'}`}>{ITEM_STATUS_LABEL[it.item_status] || it.item_status}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell text-xs">{it.location || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell text-xs">{it.unit || 'unidad'}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-semibold ${negStock(it) ? 'text-red-600' : lowStock(it) ? 'text-orange-600' : 'text-gray-900'} flex items-center justify-end gap-1`} title={negStock(it) ? 'Vendido sin stock · por reponer' : undefined}>
                      {(negStock(it) || lowStock(it)) && <AlertTriangle size={12} />}
                      {fmtQty(it.quantity)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">${parseFloat(it.cost_price || '0').toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-blue-700 hidden sm:table-cell">${parseFloat(it.unit_price || '0').toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-emerald-700 hidden lg:table-cell">
                    ${((parseFloat(it.quantity || '0') || 0) * (parseFloat(it.cost_price || '0') || 0)).toFixed(2)}
                  </td>
                  <td className="px-2 py-3 sticky right-0 bg-white group-hover:bg-gray-50 z-10 shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.06)]">
                    <div className="flex gap-0.5 justify-end" onMouseOver={showTip} onMouseOut={hideTip}>
                      <button onClick={() => openHistory(it)} className="p-1 rounded hover:bg-violet-50 text-gray-400 hover:text-violet-600" data-tip="Historial" aria-label="Historial">
                        <History size={14} />
                      </button>
                      {canEdit && (
                        <>
                          <button onClick={() => openReceive(it)} className="p-1 rounded hover:bg-emerald-50 text-gray-400 hover:text-emerald-600" data-tip="Recibir stock (de proveedor)" aria-label="Recibir stock de proveedor">
                            <PackagePlus size={14} />
                          </button>
                          <button onClick={() => openWithdraw(it)} className="p-1 rounded hover:bg-orange-50 text-gray-400 hover:text-orange-600" data-tip="Registrar salida" aria-label="Registrar salida">
                            <ArrowDownCircle size={14} />
                          </button>
                          <button onClick={() => openAdjust(it)} className="p-1 rounded hover:bg-sky-50 text-gray-400 hover:text-sky-600" data-tip="Ajuste de inventario (con justificación)" aria-label="Ajuste de inventario">
                            <Scale size={14} />
                          </button>
                          <button onClick={() => openEdit(it)} className="p-1 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600" data-tip="Editar" aria-label="Editar">
                            <Edit size={14} />
                          </button>
                          <button onClick={() => openDelete(it)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500" data-tip="Dar de baja" aria-label="Dar de baja">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent sm:hidden" />
        </div>
      </div>

      {/* Summary bar */}
      {!loading && items.length > 0 && (
        <div className="mt-3 flex gap-4 text-xs text-gray-500 flex-wrap">
          <span>{filtered.length} artículos mostrados</span>
          <span className="text-orange-500 flex items-center gap-1">
            <AlertTriangle size={11} /> {stockItems.filter(lowStock).length} con stock bajo (≤5)
          </span>
          <span className="ml-auto font-semibold text-emerald-700">
            Valor total en bodega: ${filtered.reduce((s, it) => s + (parseFloat(it.quantity || '0') || 0) * (parseFloat(it.cost_price || '0') || 0), 0).toFixed(2)}
          </span>
        </div>
      )}

      {/* History modal */}
      {historyItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 truncate">Historial: {historyItem.name}</h3>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">{historyItem.code} · Stock actual: {fmtQty(historyItem.quantity)} {historyItem.unit || 'unidad'}</p>
              </div>
              <button onClick={() => setHistoryItem(null)} className="ml-3 flex-shrink-0">
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3">
              {historyLoading && (
                <p className="text-sm text-gray-400 text-center py-8">Cargando historial...</p>
              )}
              {!historyLoading && historyTxns.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">Sin movimientos registrados</p>
              )}
              {!historyLoading && historyTxns.map(txn => <TxnRow key={txn.id} txn={txn} />)}
            </div>
            <div className="p-4 border-t flex-shrink-0 flex justify-end">
              <button onClick={() => setHistoryItem(null)} className="btn-secondary text-sm">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      </> /* end tab items */}

      {/* Salida manual / Registrar salida */}
      {(withdrawItem || manualExit) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h3 className="font-semibold text-gray-900">{manualExit ? 'Salida manual' : 'Registrar salida'}</h3>
                {withdrawItem
                  ? <p className="text-xs text-gray-400 mt-0.5 font-mono">{withdrawItem.code} · {withdrawItem.name}</p>
                  : <p className="text-xs text-gray-400 mt-0.5">Elige el artículo y registra la salida</p>}
              </div>
              <button onClick={resetWithdraw}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {manualExit && !withdrawItem ? (
                <div>
                  <label className="label">Artículo *</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input className="input pl-9" placeholder="Buscar por código o descripción…" value={exitSearch}
                      onChange={e => setExitSearch(e.target.value)} style={{ fontSize: '16px' }} autoFocus />
                  </div>
                  {(() => {
                    const q = exitSearch.trim().toLowerCase()
                    const matches = items
                      .filter(x => x.is_active !== false && !isPending(x) && (!q || `${x.code} ${x.name}`.toLowerCase().includes(q)))
                      .slice(0, 40)
                    return (
                      <div className="mt-2 border border-gray-200 rounded-lg max-h-56 overflow-y-auto divide-y divide-gray-50">
                        {matches.length === 0 ? (
                          <p className="px-3 py-6 text-center text-xs text-gray-400">Sin coincidencias</p>
                        ) : matches.map(x => (
                          <button key={x.id} type="button" onClick={() => setWithdrawItem(x)}
                            className="w-full text-left px-3 py-2 hover:bg-orange-50 transition-colors flex items-center justify-between gap-2">
                            <span className="min-w-0">
                              <span className="font-mono text-xs text-blue-700">{x.code}</span>
                              <span className="block text-sm text-gray-800 truncate">{x.name}</span>
                            </span>
                            <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">stock: {fmtQty(x.quantity)}</span>
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              ) : (
                <>
                  <div className="bg-orange-50 border border-orange-100 rounded-lg px-4 py-2.5 flex items-center justify-between">
                    <span className="text-xs text-orange-600 font-medium">Stock disponible</span>
                    <span className="text-lg font-bold text-orange-700">{fmtQty(withdrawItem.quantity)} {withdrawItem.unit || 'unidad'}</span>
                  </div>
                  {manualExit && (
                    <button type="button" onClick={() => setWithdrawItem(null)} className="text-xs text-blue-600 hover:text-blue-800">← Cambiar artículo</button>
                  )}
                  <div>
                    <label className="label">Cantidad a retirar *</label>
                    <input type="number" min="0.01" step="0.01" className="input text-right text-lg font-semibold"
                      placeholder="0" value={withdrawQty} onChange={e => setWithdrawQty(e.target.value)}
                      style={{ fontSize: '16px' }} autoFocus />
                  </div>
                  <div>
                    <label className="label">Motivo</label>
                    <select className="input" value={withdrawMotivo} onChange={e => setWithdrawMotivo(e.target.value)} style={{ fontSize: '16px' }}>
                      {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Justificación{withdrawMotivo === 'Otro' ? ' *' : ' (opcional)'}</label>
                    <input className="input" placeholder="Detalle de la salida…" value={withdrawJustif}
                      onChange={e => setWithdrawJustif(e.target.value)} style={{ fontSize: '16px' }} />
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-3 p-5 border-t">
              <button onClick={resetWithdraw} className="btn-secondary">Cancelar</button>
              <button
                onClick={handleWithdraw}
                disabled={withdrawSaving || !withdrawItem || !withdrawQty || (withdrawMotivo === 'Otro' && !withdrawJustif.trim())}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-60 transition-colors text-sm"
              >
                <ArrowDownCircle size={15} />
                {withdrawSaving ? 'Registrando...' : 'Registrar salida'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recibir stock (de proveedor) */}
      {etaItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h3 className="font-semibold text-gray-900">Fecha estimada de llegada</h3>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">{etaItem.code} · {etaItem.name}</p>
              </div>
              <button onClick={() => setEtaItem(null)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-500">Actualiza cuándo esperas recibir esta parte pendiente. Déjala vacía si aún no la sabes.</p>
              <input type="date" className="input w-full" value={etaValue} onChange={e => setEtaValue(e.target.value)} style={{ fontSize: '16px' }} />
            </div>
            <div className="flex justify-end gap-3 p-5 border-t">
              {etaValue && <button onClick={() => setEtaValue('')} className="text-sm text-gray-500 hover:text-gray-700 mr-auto">Quitar fecha</button>}
              <button onClick={() => setEtaItem(null)} className="btn-secondary">Cancelar</button>
              <button onClick={saveEta} disabled={etaSaving} className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 disabled:opacity-60 text-sm">
                {etaSaving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {receiveItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h3 className="font-semibold text-gray-900">Recibir stock</h3>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">{receiveItem.code} · {receiveItem.name}</p>
              </div>
              <button onClick={() => setReceiveItem(null)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs text-emerald-600 font-medium">Stock actual</span>
                <span className="text-lg font-bold text-emerald-700">{fmtQty(receiveItem.quantity)} {receiveItem.unit || 'unidad'}</span>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="label">Proveedor *</label>
                  <button type="button" onClick={() => { setNewSupplier(EMPTY_NEW_SUPPLIER); setShowNewSupplier(true) }}
                    className="text-xs font-medium text-emerald-600 hover:text-emerald-800 flex items-center gap-1">
                    <Plus size={12} /> Nuevo proveedor
                  </button>
                </div>
                <select
                  className="input"
                  value={receiveForm.supplier_id}
                  onChange={e => setReceiveForm(f => ({ ...f, supplier_id: e.target.value }))}
                  style={{ fontSize: '16px' }}
                >
                  <option value="">Seleccionar proveedor…</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Cantidad recibida *</label>
                  <input
                    type="number" min="0.01" step="0.01"
                    className="input text-right text-lg font-semibold"
                    placeholder="0"
                    value={receiveForm.qty}
                    onChange={e => setReceiveForm(f => ({ ...f, qty: e.target.value }))}
                    style={{ fontSize: '16px' }}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label">Costo unitario *</label>
                  <input
                    type="number" min="0" step="0.01"
                    className="input text-right text-lg font-semibold"
                    placeholder="0.00"
                    value={receiveForm.cost}
                    onChange={e => setReceiveForm(f => ({ ...f, cost: e.target.value }))}
                    style={{ fontSize: '16px' }}
                  />
                </div>
              </div>
              <div>
                <label className="label">Notas (opcional)</label>
                <input
                  className="input"
                  placeholder="N° factura, remisión, observación…"
                  value={receiveForm.notes}
                  onChange={e => setReceiveForm(f => ({ ...f, notes: e.target.value }))}
                  style={{ fontSize: '16px' }}
                />
              </div>
              <p className="text-xs text-gray-400 leading-snug">
                El costo del artículo se recalculará como <b>promedio ponderado</b>. Esta entrada queda registrada en <b>Movimientos</b> con su proveedor.
              </p>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t">
              <button onClick={() => setReceiveItem(null)} className="btn-secondary">Cancelar</button>
              <button
                onClick={handleReceive}
                disabled={receiveSaving || !receiveForm.supplier_id || !receiveForm.qty || receiveForm.cost === ''}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors text-sm"
              >
                <PackagePlus size={15} />
                {receiveSaving ? 'Registrando...' : 'Recibir stock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ajuste de inventario (con justificación obligatoria) */}
      {adjustItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h3 className="font-semibold text-gray-900">Ajuste de inventario</h3>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">{adjustItem.code} · {adjustItem.name}</p>
              </div>
              <button onClick={() => setAdjustItem(null)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-sky-50 border border-sky-100 rounded-lg px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs text-sky-600 font-medium">Stock actual (sistema)</span>
                <span className="text-lg font-bold text-sky-700">{fmtQty(adjustItem.quantity)} {adjustItem.unit || 'unidad'}</span>
              </div>
              <div>
                <label className="label">Cantidad real (conteo) *</label>
                <input type="number" min="0" step="0.01" className="input text-right text-lg font-semibold"
                  placeholder="0" value={adjustForm.new_qty}
                  onChange={e => setAdjustForm(f => ({ ...f, new_qty: e.target.value }))}
                  style={{ fontSize: '16px' }} autoFocus />
                {adjustForm.new_qty !== '' && !isNaN(parseFloat(adjustForm.new_qty)) && (
                  <p className="text-xs text-gray-400 mt-1">
                    Diferencia: <b className={parseFloat(adjustForm.new_qty) - parseFloat(adjustItem.quantity || 0) >= 0 ? 'text-emerald-600' : 'text-orange-600'}>
                      {(parseFloat(adjustForm.new_qty) - parseFloat(adjustItem.quantity || 0) >= 0 ? '+' : '')}{(parseFloat(adjustForm.new_qty) - parseFloat(adjustItem.quantity || 0)).toFixed(2).replace(/\.00$/, '')}
                    </b>
                  </p>
                )}
              </div>
              <div>
                <label className="label">Justificación *</label>
                <textarea className="input h-16 resize-none" placeholder="Conteo físico, merma, corrección de error…"
                  value={adjustForm.justification}
                  onChange={e => setAdjustForm(f => ({ ...f, justification: e.target.value }))}
                  style={{ fontSize: '16px' }} />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t">
              <button onClick={() => setAdjustItem(null)} className="btn-secondary">Cancelar</button>
              <button onClick={handleAdjust}
                disabled={adjustSaving || adjustForm.new_qty === '' || !adjustForm.justification.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg font-medium hover:bg-sky-700 disabled:opacity-60 transition-colors text-sm">
                <Scale size={15} />
                {adjustSaving ? 'Registrando...' : 'Registrar ajuste'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h3 className="font-semibold text-gray-900">Dar de baja artículo</h3>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">{deleteItem.code} · {deleteItem.name}</p>
              </div>
              <button onClick={() => setDeleteItem(null)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {parseFloat(deleteItem.quantity || 0) > 0 ? (
                <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-2.5 text-sm text-red-700">
                  Este artículo aún tiene <b>{fmtQty(deleteItem.quantity)} {deleteItem.unit || 'unidad'}</b> en stock. Al darlo de baja se registrará la salida de esa cantidad en el historial.
                </div>
              ) : (
                <div className="bg-gray-50 border border-gray-100 rounded-lg px-4 py-2.5 text-sm text-gray-600">
                  El artículo se desactivará y quedará registrado en el historial con su motivo (no se elimina permanentemente).
                </div>
              )}
              <div>
                <label className="label">Justificación de la baja *</label>
                <textarea className="input h-16 resize-none" placeholder="Obsoleto, dañado, error de registro, ya no se maneja…"
                  value={deleteJustif}
                  onChange={e => setDeleteJustif(e.target.value)}
                  style={{ fontSize: '16px' }} autoFocus />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t">
              <button onClick={() => setDeleteItem(null)} className="btn-secondary">Cancelar</button>
              <button onClick={confirmDelete}
                disabled={deleteSaving || !deleteJustif.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-60 transition-colors text-sm">
                <Trash2 size={15} />
                {deleteSaving ? 'Dando de baja...' : 'Dar de baja'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nuevo proveedor (desde el formulario de artículo) — todos los campos */}
      {showNewSupplier && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
              <h3 className="font-semibold text-gray-900">Nuevo proveedor</h3>
              <button onClick={() => setShowNewSupplier(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">Nombre *</label>
                <input className="input" placeholder="Nombre del proveedor" value={newSupplier.name}
                  onChange={e => setNewSupplier(s => ({ ...s, name: e.target.value }))} style={{ fontSize: '16px' }} autoFocus />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Persona de contacto</label>
                  <input className="input" placeholder="Nombre completo" value={newSupplier.contact_name}
                    onChange={e => setNewSupplier(s => ({ ...s, contact_name: e.target.value }))} style={{ fontSize: '16px' }} />
                </div>
                <div>
                  <label className="label">Categoría</label>
                  <input className="input" list="new-supplier-cats" placeholder="Selecciona o escribe una categoría" value={newSupplier.category}
                    onChange={e => setNewSupplier(s => ({ ...s, category: e.target.value }))} style={{ fontSize: '16px' }} />
                  <datalist id="new-supplier-cats">
                    {[...new Set(suppliers.map(s => s.category).filter(Boolean))].map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div>
                  <label className="label">Teléfono</label>
                  <input className="input" placeholder="+507 000-0000" value={newSupplier.phone}
                    onChange={e => setNewSupplier(s => ({ ...s, phone: e.target.value }))} style={{ fontSize: '16px' }} />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input className="input" type="email" placeholder="correo@ejemplo.com" value={newSupplier.email}
                    onChange={e => setNewSupplier(s => ({ ...s, email: e.target.value }))} style={{ fontSize: '16px' }} />
                </div>
              </div>
              <div>
                <label className="label">Sitio web</label>
                <input className="input" placeholder="https://..." value={newSupplier.website}
                  onChange={e => setNewSupplier(s => ({ ...s, website: e.target.value }))} style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="label">Dirección</label>
                <input className="input" placeholder="Dirección física" value={newSupplier.address}
                  onChange={e => setNewSupplier(s => ({ ...s, address: e.target.value }))} style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="label">Notas</label>
                <textarea className="input h-20 resize-none" placeholder="Información adicional..." value={newSupplier.notes}
                  onChange={e => setNewSupplier(s => ({ ...s, notes: e.target.value }))} style={{ fontSize: '16px' }} />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t sticky bottom-0 bg-white">
              <button onClick={() => setShowNewSupplier(false)} className="btn-secondary">Cancelar</button>
              <button onClick={handleCreateSupplier} disabled={newSupplierSaving || !newSupplier.name.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors text-sm">
                <Plus size={15} />
                {newSupplierSaving ? 'Creando...' : 'Crear y seleccionar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form panel */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
              <h3 className="font-semibold text-gray-900">{selected ? 'Editar artículo' : 'Nuevo artículo'}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Código *</label>
                  <input className="input" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                    placeholder="Ej: CAB-001" style={{ fontSize: '16px' }} autoFocus={!selected} />
                </div>
                <div>
                  <label className="label">Categoría</label>
                  <input className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="Ej: Cables" style={{ fontSize: '16px' }} list="inv-cats" />
                  <datalist id="inv-cats">
                    {categories.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>
              <div>
                <label className="label">Nombre *</label>
                <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nombre del artículo o servicio" style={{ fontSize: '16px' }} list="inv-names" />
                <datalist id="inv-names">
                  {names.map(n => <option key={n} value={n} />)}
                </datalist>
              </div>
              <div>
                <label className="label">Descripción</label>
                <input className="input" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Descripción del artículo" style={{ fontSize: '16px' }} list="inv-descs" />
                <datalist id="inv-descs">
                  {descriptions.map(d => <option key={d} value={d} />)}
                </datalist>
                {descDup && (
                  <p className="text-xs text-amber-600 mt-1 flex items-start gap-1">
                    <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                    <span>Esta descripción ya existe en <span className="font-semibold">{descDup.code}</span>
                      {descDup.name ? ` · ${descDup.name}` : ''} (código distinto). ¿Es un duplicado?</span>
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="label">Unidad</label>
                  <select className="input" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Precio venta</label>
                  <input type="number" min="0" step="0.01" className="input text-right" value={form.unit_price}
                    onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))} style={{ fontSize: '16px' }} />
                </div>
                <div>
                  <label className="label">Costo unit.</label>
                  <input type="number" min="0" step="0.01" className="input text-right" value={form.cost_price}
                    onChange={e => setForm(f => ({ ...f, cost_price: e.target.value }))} style={{ fontSize: '16px' }}
                    title="Costo de compra — se usa para calcular rentabilidad en facturas" />
                </div>
                <div>
                  <label className="label">{selected ? 'Stock actual' : 'Stock inicial'}</label>
                  {selected ? (
                    <>
                      <div className="input bg-gray-50 text-gray-500 flex items-center justify-between cursor-not-allowed">
                        <span className="flex-1 text-right">{fmtQty(form.quantity)}</span>
                        <Lock size={13} className="text-gray-400 ml-2 flex-shrink-0" />
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1 leading-snug">Se ajusta con Recibir / Salida / Ajuste (queda trazado).</p>
                    </>
                  ) : (
                    <input type="number" min="0" step="0.01" className="input text-right" value={form.quantity}
                      onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} style={{ fontSize: '16px' }} />
                  )}
                </div>
              </div>
              <div>
                <label className="label">Bodega</label>
                <select className="input" value={form.warehouse} onChange={e => setForm(f => ({ ...f, warehouse: e.target.value }))}>
                  {warehouses.map(w => <option key={w} value={w}>{WAREHOUSE_LABEL[w]}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="label">Condición</label>
                  <select className="input" value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                    {CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Estado</label>
                  <select className="input" value={form.item_status} onChange={e => setForm(f => ({ ...f, item_status: e.target.value }))}>
                    {ITEM_STATUSES.map(s => <option key={s} value={s}>{ITEM_STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Ubicación</label>
                  <input className="input" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    placeholder="Ej: Estante A-3" style={{ fontSize: '16px' }} list="inv-locs" />
                  <datalist id="inv-locs">
                    {locations.map(l => <option key={l} value={l} />)}
                  </datalist>
                </div>
              </div>
              <div>
                <label className="label">Notas</label>
                <textarea className="input h-16 resize-none" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t flex-shrink-0">
              <button onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-60">
                {saving ? 'Guardando...' : selected ? 'Guardar cambios' : 'Crear artículo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceipts && (
        <ReceiptOrders
          suppliers={suppliers}
          initial={receiptsInitial}
          onClose={() => { setShowReceipts(false); setReceiptsInitial(null); setReceiptsTick(t => t + 1) }}
          onApplied={() => { load(); loadPending() }}
        />
      )}

      {/* Reporte: artículos vendidos sin stock (trazabilidad) */}
      {showOversold && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-3" onClick={() => setShowOversold(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-600" />
                <h2 className="text-base font-bold text-gray-900">Vendidos sin stock</h2>
                <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">{oversold.length}</span>
              </div>
              <button onClick={() => setShowOversold(false)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {oversold.length === 0 ? (
                <p className="text-center text-gray-400 py-10 text-sm">No hay artículos con stock negativo.</p>
              ) : oversold.map((it) => (
                <div key={it.id} className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                    <div className="min-w-0">
                      <span className="font-semibold text-gray-800">{it.name}</span>
                      <span className="text-xs text-gray-400 ml-2 font-mono">{it.code}</span>
                    </div>
                    <span className="text-sm font-bold text-red-600 whitespace-nowrap">{it.quantity} {it.unit || ''}</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {(it.sales || []).length === 0 ? (
                      <div className="px-4 py-2 text-xs text-gray-400">Sin ventas registradas.</div>
                    ) : it.sales.map((s, i) => (
                      <div key={i} className="px-4 py-2 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium text-gray-700">{s.client_name || 'Cliente —'}</span>
                          {s.dispatch_number && <span className="text-xs text-blue-600 ml-2">{s.dispatch_number}</span>}
                        </div>
                        <div className="flex items-center gap-3 whitespace-nowrap">
                          <span className="text-red-600 font-medium">{s.qty}</span>
                          <span className="text-xs text-gray-400">{s.created_at ? fmtDT(s.created_at) : ''}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
