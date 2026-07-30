import { showConfirm } from '../utils/confirm'
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getInventory, createInventoryItem, updateInventoryItem, deleteInventoryItem, getInventoryTransactions, withdrawInventoryItem, getAllInventoryTransactions, getSuppliers, importInventoryCSV } from '../services/api'
import { Package, Plus, Search, Edit, Trash2, X, AlertTriangle, ChevronDown, ChevronUp, History, TrendingDown, TrendingUp, Minus, ArrowDownCircle, ArrowUpCircle, List, ExternalLink, Upload, Download, FileText } from 'lucide-react'
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

const WAREHOUSES = ['principal', 'partes', 'impresoras_mps']
const WAREHOUSE_LABEL = {
  principal:       'Principal',
  partes:          'Bodega de Partes',
  impresoras_mps:  'Bodega de Impresoras MPS',
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
}

const SOURCE_COLOR = {
  invoice:         'bg-blue-100 text-blue-700',
  dispatch:        'bg-violet-100 text-violet-700',
  order:           'bg-amber-100 text-amber-700',
  manual:          'bg-gray-100 text-gray-600',
  consumo_interno: 'bg-orange-100 text-orange-700',
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
        {txn.notes && <p className="text-xs text-gray-400 truncate mt-0.5">{txn.notes}</p>}
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
  const warehouses = itMode ? WAREHOUSES.filter(w => w !== 'impresoras_mps') : WAREHOUSES
  const fileInputRef = React.useRef(null)
  const [suppliers, setSuppliers] = useState([])
  const [importing, setImporting] = useState(false)
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
  const [historyItem, setHistoryItem] = useState(null)
  const [historyTxns, setHistoryTxns] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [withdrawItem, setWithdrawItem] = useState(null)
  const [withdrawQty, setWithdrawQty] = useState('')
  const [withdrawMotivo, setWithdrawMotivo] = useState(MOTIVOS[0])
  const [withdrawSaving, setWithdrawSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    getInventory({ active_only: true })
      .then(r => setItems(r.data))
      .catch(() => toast.error('Error cargando inventario'))
      .finally(() => setLoading(false))
  }, [])

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

  const filtered = items.filter(it => {
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

  const handleDelete = async (item) => {
    if (!await showConfirm(`¿Eliminar "${item.name}"?`)) return
    try {
      const r = await deleteInventoryItem(item.id)
      toast.success(r.data?.message || 'Artículo eliminado')
      if (selected?.id === item.id) setShowForm(false)
      load()
    } catch {
      toast.error('Error eliminando artículo')
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

  const loadAllTxns = useCallback(() => {
    setAllTxnsLoading(true)
    getAllInventoryTransactions({ limit: 500 })
      .then(r => setAllTxns(r.data))
      .catch(() => toast.error('Error cargando movimientos'))
      .finally(() => setAllTxnsLoading(false))
  }, [])

  const handleTabChange = (t) => {
    setTab(t)
    if (t === 'movimientos' && allTxns.length === 0) loadAllTxns()
  }

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

  const openWithdraw = (item) => {
    setWithdrawItem(item)
    setWithdrawQty('')
    setWithdrawMotivo(MOTIVOS[0])
  }

  const handleWithdraw = async () => {
    const qty = parseFloat(withdrawQty)
    if (!qty || qty <= 0) return toast.error('Ingresa una cantidad válida')
    setWithdrawSaving(true)
    try {
      await withdrawInventoryItem(withdrawItem.id, { qty, motivo: withdrawMotivo })
      toast.success(`Salida registrada: -${qty} ${withdrawItem.unit || 'unidad'}`)
      setWithdrawItem(null)
      load()
      if (allTxns.length > 0) loadAllTxns()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al registrar salida')
    } finally {
      setWithdrawSaving(false)
    }
  }

  const lowStock = (it) => parseFloat(it.quantity || '0') <= 5 && parseFloat(it.quantity || '0') >= 0

  return (
    <div className="p-4 sm:p-6 w-full max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
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

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        <button
          onClick={() => handleTabChange('items')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'items' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <span className="flex items-center gap-1.5"><Package size={14} /> Artículos <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{items.length}</span></span>
        </button>
        <button
          onClick={() => handleTabChange('movimientos')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'movimientos' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <span className="flex items-center gap-1.5"><List size={14} /> Movimientos</span>
        </button>
      </div>

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
                        <td className="px-4 py-3 text-xs text-gray-500 hidden lg:table-cell max-w-xs truncate">{t.notes || '—'}</td>
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

      {/* ── Artículos tab ─────────────────────────── */}
      {tab === 'items' && <>

      {/* Stats */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
            <p className="text-xs text-gray-400 mb-1">Total artículos</p>
            <p className="text-2xl font-bold text-gray-900">{items.length}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 shadow-sm col-span-1">
            <p className="text-xs text-emerald-600 font-medium mb-1">Valor en bodega</p>
            <p className="text-2xl font-bold text-emerald-700">
              ${items.reduce((s, it) => s + (parseFloat(it.quantity || '0') || 0) * (parseFloat(it.cost_price || '0') || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className={`rounded-xl p-4 shadow-sm border ${items.filter(lowStock).length > 0 ? 'bg-orange-50 border-orange-100' : 'bg-white border-gray-100'}`}>
            <p className={`text-xs font-medium mb-1 ${items.filter(lowStock).length > 0 ? 'text-orange-500' : 'text-gray-400'}`}>Stock bajo (≤5)</p>
            <p className={`text-2xl font-bold ${items.filter(lowStock).length > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{items.filter(lowStock).length}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9 py-2 text-sm w-full"
            placeholder="Buscar por código, nombre..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {categories.length > 0 && (
          <select
            className="input py-2 text-sm"
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
          >
            <option value="">Todas las categorías</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select
          className="input py-2 text-sm"
          value={filterWarehouse}
          onChange={e => setFilterWarehouse(e.target.value)}
        >
          <option value="">Todas las bodegas</option>
          {warehouses.map(w => <option key={w} value={w}>{WAREHOUSE_LABEL[w]}</option>)}
        </select>
        <select className="input py-2 text-sm" value={filterCondition} onChange={e => setFilterCondition(e.target.value)}>
          <option value="">Toda condición</option>
          {CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
        </select>
        <select className="input py-2 text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Todo estado</option>
          {ITEM_STATUSES.map(s => <option key={s} value={s}>{ITEM_STATUS_LABEL[s]}</option>)}
        </select>
        {locations.length > 0 && (
          <select className="input py-2 text-sm" value={filterLocation} onChange={e => setFilterLocation(e.target.value)}>
            <option value="">Toda ubicación</option>
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
      </div>

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
                <th className="px-4 py-3 text-right font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('cost_price')}>
                  <span className="flex items-center gap-1 justify-end">Costo <SortIcon field="cost_price" /></span>
                </th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 cursor-pointer select-none hidden sm:table-cell" onClick={() => toggleSort('unit_price')}>
                  <span className="flex items-center gap-1 justify-end">Precio venta <SortIcon field="unit_price" /></span>
                </th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('quantity')}>
                  <span className="flex items-center gap-1 justify-end">Stock <SortIcon field="quantity" /></span>
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
                  <td className="px-4 py-3 font-mono text-xs text-blue-700 font-semibold">{it.code}</td>
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
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">${parseFloat(it.cost_price || '0').toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-blue-700 hidden sm:table-cell">${parseFloat(it.unit_price || '0').toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-semibold ${lowStock(it) ? 'text-orange-600' : 'text-gray-900'} flex items-center justify-end gap-1`}>
                      {lowStock(it) && <AlertTriangle size={12} />}
                      {fmtQty(it.quantity)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-emerald-700 hidden lg:table-cell">
                    ${((parseFloat(it.quantity || '0') || 0) * (parseFloat(it.cost_price || '0') || 0)).toFixed(2)}
                  </td>
                  <td className="px-2 py-3 sticky right-0 bg-white group-hover:bg-gray-50 z-10 shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.06)]">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openHistory(it)} className="p-1.5 rounded hover:bg-violet-50 text-gray-400 hover:text-violet-600" title="Historial">
                        <History size={14} />
                      </button>
                      {canEdit && (
                        <>
                          <button onClick={() => openWithdraw(it)} className="p-1.5 rounded hover:bg-orange-50 text-gray-400 hover:text-orange-600" title="Registrar salida">
                            <ArrowDownCircle size={14} />
                          </button>
                          <button onClick={() => openEdit(it)} className="p-1.5 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600" title="Editar">
                            <Edit size={14} />
                          </button>
                          <button onClick={() => handleDelete(it)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500" title="Eliminar">
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
            <AlertTriangle size={11} /> {items.filter(lowStock).length} con stock bajo (≤5)
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

      {/* Withdraw modal */}
      {withdrawItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h3 className="font-semibold text-gray-900">Registrar salida</h3>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">{withdrawItem.code} · {withdrawItem.name}</p>
              </div>
              <button onClick={() => setWithdrawItem(null)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-orange-50 border border-orange-100 rounded-lg px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs text-orange-600 font-medium">Stock disponible</span>
                <span className="text-lg font-bold text-orange-700">{fmtQty(withdrawItem.quantity)} {withdrawItem.unit || 'unidad'}</span>
              </div>
              <div>
                <label className="label">Cantidad a retirar *</label>
                <input
                  type="number" min="0.01" step="0.01"
                  className="input text-right text-lg font-semibold"
                  placeholder="0"
                  value={withdrawQty}
                  onChange={e => setWithdrawQty(e.target.value)}
                  style={{ fontSize: '16px' }}
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Motivo</label>
                <select
                  className="input"
                  value={withdrawMotivo}
                  onChange={e => setWithdrawMotivo(e.target.value)}
                >
                  {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t">
              <button onClick={() => setWithdrawItem(null)} className="btn-secondary">Cancelar</button>
              <button
                onClick={handleWithdraw}
                disabled={withdrawSaving || !withdrawQty}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-60 transition-colors text-sm"
              >
                <ArrowDownCircle size={15} />
                {withdrawSaving ? 'Registrando...' : 'Registrar salida'}
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
                  <label className="label">Stock</label>
                  <input type="number" min="0" step="0.01" className="input text-right" value={form.quantity}
                    onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} style={{ fontSize: '16px' }} />
                </div>
              </div>
              <div>
                <label className="label">Bodega</label>
                <select className="input" value={form.warehouse} onChange={e => setForm(f => ({ ...f, warehouse: e.target.value }))}>
                  {warehouses.map(w => <option key={w} value={w}>{WAREHOUSE_LABEL[w]}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Proveedor</label>
                <select className="input" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
                  <option value="">— Sin proveedor —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
    </div>
  )
}
