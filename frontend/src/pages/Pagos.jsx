import { showConfirm } from '../utils/confirm'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllPayments, updateInvoicePayment, deleteInvoicePayment, importPaymentsCSV } from '../services/api'
import {
  Wallet, Banknote, CreditCard, Building2, FileText, Smartphone,
  Search, Pencil, Trash2, X, Save, RefreshCw, Filter,
  CheckCircle2, Receipt, Upload,
} from 'lucide-react'
import { fmtD } from '../utils/fmt'
import toast from 'react-hot-toast'

const METHODS = ['Efectivo', 'Tarjeta', 'Transferencia', 'Cheque', 'Yappy']

const METHOD_STYLE = {
  Efectivo:      'bg-green-100 text-green-700',
  Tarjeta:       'bg-blue-100 text-blue-700',
  Transferencia: 'bg-purple-100 text-purple-700',
  Cheque:        'bg-amber-100 text-amber-700',
  Yappy:         'bg-cyan-100 text-cyan-700',
}
const METHOD_ICON = {
  Efectivo:      <Banknote size={12} />,
  Tarjeta:       <CreditCard size={12} />,
  Transferencia: <Building2 size={12} />,
  Cheque:        <FileText size={12} />,
  Yappy:         <Smartphone size={12} />,
}

const INV_STATUS_STYLE = {
  Pagada:  'bg-green-100 text-green-700',
  Emitida: 'bg-blue-100 text-blue-700',
  Vencida: 'bg-orange-100 text-orange-700',
  Borrador:'bg-gray-100 text-gray-500',
}

function fmtMoney(n) {
  const num = parseFloat(String(n || '').replace(/[^\d.]/g, '') || '0')
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function parseAmt(n) {
  return parseFloat(String(n || '').replace(/[^\d.]/g, '') || '0')
}

// ── Edit modal ─────────────────────────────────────────
function EditModal({ payment, onClose, onSaved }) {
  const [form, setForm] = useState({
    amount: payment.amount,
    method: payment.method,
    date: String(payment.date),
    notes: payment.notes || '',
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.amount || !form.date) return toast.error('Monto y fecha son requeridos')
    setSaving(true)
    try {
      await updateInvoicePayment(payment.invoice_id, payment.id, {
        amount: form.amount,
        method: form.method,
        date: form.date,
        notes: form.notes || null,
      })
      toast.success('Pago actualizado')
      onSaved()
    } catch {
      toast.error('Error al actualizar el pago')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Editar pago</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            Factura: <span className="font-mono font-semibold text-gray-700">{payment.invoice_number || `#${payment.invoice_id}`}</span>
            {payment.client_name && <> · {payment.client_name}</>}
          </div>

          <div>
            <label className="label">Monto</label>
            <input
              type="number" min="0" step="0.01" required
              className="input w-full"
              style={{ fontSize: '16px' }}
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">Método de pago</label>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map(m => (
                <button key={m} type="button"
                  onClick={() => setForm(f => ({ ...f, method: m }))}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors justify-center ${form.method === m ? `${METHOD_STYLE[m]} border-current` : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  {METHOD_ICON[m]} {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Fecha</label>
            <input
              type="date" required
              className="input w-full"
              style={{ fontSize: '16px' }}
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">Notas (opcional)</label>
            <input
              className="input w-full"
              style={{ fontSize: '16px' }}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Referencia, número de cheque..."
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary py-2.5">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 btn-primary py-2.5 flex items-center justify-center gap-1.5">
              <Save size={14} /> {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────
export default function Pagos() {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const csvInputRef = useRef(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (methodFilter) params.method = methodFilter
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const r = await getAllPayments(params)
      setPayments(r.data || [])
    } catch {
      setPayments([])
    } finally {
      setLoading(false)
    }
  }, [methodFilter, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const handleDelete = async (p) => {
    if (!await showConfirm(`¿Eliminar pago de ${fmtMoney(p.amount)} (${p.method})?`)) return
    setDeleting(p.id)
    try {
      await deleteInvoicePayment(p.invoice_id, p.id)
      toast.success('Pago eliminado')
      load()
    } catch {
      toast.error('Error al eliminar el pago')
    } finally {
      setDeleting(null)
    }
  }

  const handleCSVImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    try {
      const r = await importPaymentsCSV(file)
      setImportResult(r.data)
      if (r.data.imported > 0) load()
    } catch {
      toast.error('Error al importar el CSV')
    } finally {
      setImporting(false)
    }
  }

  const filtered = payments.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (p.invoice_number || '').toLowerCase().includes(q) ||
      (p.client_name || '').toLowerCase().includes(q) ||
      (p.notes || '').toLowerCase().includes(q) ||
      p.method.toLowerCase().includes(q)
    )
  })

  const total = filtered.reduce((s, p) => s + parseAmt(p.amount), 0)
  const byMethod = METHODS.reduce((acc, m) => {
    acc[m] = filtered.filter(p => p.method === m).reduce((s, p) => s + parseAmt(p.amount), 0)
    return acc
  }, {})

  const hasFilters = methodFilter || dateFrom || dateTo

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {editing && (
        <EditModal
          payment={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}

      {importResult && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Resultado de importación</h2>
              <button onClick={() => setImportResult(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-green-700">{importResult.imported}</p>
                  <p className="text-xs text-green-600 mt-0.5">Pagos importados</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-amber-700">{importResult.skipped}</p>
                  <p className="text-xs text-amber-600 mt-0.5">Omitidos</p>
                </div>
              </div>
              {importResult.skipped_list?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Facturas no encontradas</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {importResult.skipped_list.map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-1.5">
                        <span className="font-mono font-semibold text-gray-700">{s.invoice}</span>
                        <span className="text-gray-500 truncate ml-2 min-w-0 flex-1">{s.client}</span>
                        {s.amount && <span className="text-gray-600 ml-2 shrink-0">${parseFloat(s.amount).toFixed(2)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => setImportResult(null)} className="w-full btn-primary py-2.5">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap md:pr-14 lg:pr-28">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/15 flex items-center justify-center">
            <Wallet size={18} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Pagos Recibidos</h1>
            <p className="text-xs text-gray-400">Todos los pagos registrados en facturas</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => csvInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors disabled:opacity-50"
          >
            <Upload size={13} /> {importing ? 'Importando...' : 'Importar CSV'}
          </button>
          <button
            onClick={() => navigate('/facturas')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
          >
            <Receipt size={13} /> Ver Facturas
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {METHODS.map(m => (
          <div key={m} className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium ${METHOD_STYLE[m]}`}>
                {METHOD_ICON[m]} {m}
              </span>
            </div>
            <p className="text-base font-bold text-gray-900">{fmtMoney(byMethod[m])}</p>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="bg-indigo-50 rounded-xl border border-indigo-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={16} className="text-indigo-600" />
          <span className="text-sm font-medium text-indigo-700">Total recibido</span>
          {filtered.length !== payments.length && (
            <span className="text-xs text-indigo-400">({filtered.length} de {payments.length} pagos)</span>
          )}
        </div>
        <span className="text-lg font-bold text-indigo-700">{fmtMoney(total)}</span>
      </div>

      {/* Search + filters */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input w-full pl-9 py-2 text-sm"
              placeholder="Buscar por factura, cliente, método..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ fontSize: '16px' }}
            />
          </div>
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${hasFilters ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            <Filter size={14} /> Filtros {hasFilters && '·'}
          </button>
        </div>

        {showFilters && (
          <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm flex flex-wrap gap-3 items-end">
            <div>
              <label className="label">Método</label>
              <select className="input text-sm py-1.5" style={{ fontSize: '16px' }} value={methodFilter} onChange={e => setMethodFilter(e.target.value)}>
                <option value="">Todos</option>
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Desde</label>
              <input type="date" className="input text-sm py-1.5" style={{ fontSize: '16px' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">Hasta</label>
              <input type="date" className="input text-sm py-1.5" style={{ fontSize: '16px' }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            {hasFilters && (
              <button onClick={() => { setMethodFilter(''); setDateFrom(''); setDateTo('') }} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 pb-1">
                <X size={12} /> Limpiar
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Cargando...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Wallet size={32} className="mx-auto text-gray-200 mb-2" />
            <p className="text-gray-400 text-sm">No hay pagos registrados</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Fecha</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-3 py-3">Factura</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-3 py-3 hidden sm:table-cell">Cliente</th>
                  <th className="text-center text-xs font-medium text-gray-400 px-3 py-3">Método</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-3 py-3 hidden md:table-cell">Notas</th>
                  <th className="text-right text-xs font-medium text-gray-400 px-3 py-3">Monto</th>
                  <th className="pb-2 pr-2 w-20" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtD(p.date)}</td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-xs font-semibold text-gray-700">
                        {p.invoice_number || `#${p.invoice_id}`}
                      </span>
                      {p.invoice_status && (
                        <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-medium ${INV_STATUS_STYLE[p.invoice_status] || 'bg-gray-100 text-gray-500'}`}>
                          {p.invoice_status}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-700 hidden sm:table-cell max-w-[160px] truncate">
                      {p.client_name || '—'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${METHOD_STYLE[p.method] || 'bg-gray-100 text-gray-600'}`}>
                        {METHOD_ICON[p.method]} {p.method}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-400 hidden md:table-cell max-w-[160px] truncate">
                      {p.notes || '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-sm text-gray-900 whitespace-nowrap">
                      {fmtMoney(p.amount)}
                    </td>
                    <td className="px-3 py-3 pr-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditing(p)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                          title="Editar"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(p)}
                          disabled={deleting === p.id}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
