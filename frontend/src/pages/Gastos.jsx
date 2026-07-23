import { showConfirm } from '../utils/confirm'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate, useParams } from 'react-router-dom'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import {
  getExpenses, getExpense, createExpense, updateExpense, deleteExpense,
  getExpenseSummary, getExpenseCategories, getSuppliers, createSupplier,
  uploadExpenseAttachment, deleteExpenseAttachment,
  expenseAttachmentDownloadUrl, downloadWithAuth,
  getOrderAttachments, orderAttachmentDownloadUrl,
} from '../services/api'
import {
  Search, Plus, Trash2, ArrowLeft, Save, X,
  Upload, Download, Paperclip, FileText, Edit, Truck,
  TrendingDown, Tag, Calendar, Building2,
  ChevronRight, AlertCircle, Link2, SlidersHorizontal,
  CreditCard, CheckCircle2, BarChart2, Banknote, ArrowLeftRight, Smartphone, Wallet,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { fmtD } from '../utils/fmt'
import { useAuth } from '../context/AuthContext'
import { useFormGuard } from '../context/UnsavedChangesContext'

const SUPPLIER_CATEGORIES = ['Hardware', 'Software', 'Consumibles', 'Servicios', 'Redes', 'Impresión', 'Otro']

const EMPTY_FORM = {
  concept: '',
  amount: '',
  category: '',
  date: '',
  supplier: '',
  payment_method: '',
  notes: '',
  is_payable: false,
  due_date: '',
  paid_at: '',
}

const PAYMENT_METHODS = [
  { value: 'Efectivo',            label: 'Efectivo',       Icon: Banknote,       color: 'text-green-600',  bg: 'bg-green-50  border-green-200' },
  { value: 'Transferencia',       label: 'Transferencia',  Icon: ArrowLeftRight, color: 'text-blue-600',   bg: 'bg-blue-50   border-blue-200'  },
  { value: 'Tarjeta de crédito',  label: 'Tarjeta',        Icon: CreditCard,     color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200'},
  { value: 'Yappy',               label: 'Yappy',          Icon: Smartphone,     color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200'},
]

function paymentIcon(method, size = 12) {
  const m = PAYMENT_METHODS.find((p) => p.value === method)
  if (!m) return null
  return <m.Icon size={size} className={m.color} />
}

function fmtMoney(n) {
  const num = parseFloat(String(n || '').replace(/[^\d.]/g, '') || '0')
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function parseAmount(raw) {
  return parseFloat(String(raw || '').replace(/[^\d.]/g, '') || '0')
}

const TYPE_STYLE = {
  manual: 'bg-blue-100 text-blue-700',
  pedido: 'bg-purple-100 text-purple-700',
}

// ── Category combo input ─────────────────────────────────
function CategoryInput({ value, onChange, categories, onNew }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()

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
      <div className="relative flex-1">
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
          <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-52 overflow-y-auto">
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

// ── Supplier autocomplete input ─────────────────────────
function SupplierInput({ value, onChange, suppliers, onNew }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()

  const suggestions = suppliers.filter((s) =>
    !value.trim() || s.name.toLowerCase().includes(value.toLowerCase())
  ).slice(0, 8)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="flex gap-2" ref={ref}>
      <div className="relative flex-1">
        <input
          className="input w-full"
          style={{ fontSize: '16px' }}
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Ej: Claro Panamá, Empresa XYZ..."
          autoComplete="off"
        />
        {open && suggestions.length > 0 && (
          <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-52 overflow-y-auto">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange(s.name)
                    setOpen(false)
                  }}
                  className="w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors"
                >
                  <p className="text-sm font-medium text-gray-900">{s.name}</p>
                  {(s.category || s.contact_name) && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {[s.category, s.contact_name].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={onNew}
        className="flex-shrink-0 flex items-center justify-center w-10 h-10 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors"
        title="Nuevo proveedor"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}

// ── Expense Form ────────────────────────────────────────
function ExpenseForm({ form, setForm, onSave, onCancel, saving, isEdit, categories, suppliers, onCategoryCreated, onSupplierCreated, pendingFiles, setPendingFiles }) {
  const [isDirty, setIsDirty] = useState(false)
  useFormGuard(isDirty)

  const set = (field) => (e) => { setIsDirty(true); setForm((f) => ({ ...f, [field]: e.target.value })) }
  const fileRef = useRef()

  // Quick-add category modal
  const [showCatModal, setShowCatModal] = useState(false)
  const [newCatName, setNewCatName] = useState('')

  const handleAddCategory = () => {
    const name = newCatName.trim()
    if (!name) return
    onCategoryCreated(name)
    setForm((f) => ({ ...f, category: name }))
    setShowCatModal(false)
    setNewCatName('')
  }

  // Quick-add supplier modal
  const [showSupModal, setShowSupModal] = useState(false)
  const [supForm, setSupForm] = useState({ name: '', category: '', phone: '', email: '' })
  const [creatingSup, setCreatingSup] = useState(false)

  // Supplier category combo
  const [supCategoryOptions, setSupCategoryOptions] = useState([...SUPPLIER_CATEGORIES])
  const [showSupCatModal, setShowSupCatModal] = useState(false)
  const [newSupCatName, setNewSupCatName] = useState('')

  const handleAddSupCategory = () => {
    const name = newSupCatName.trim()
    if (!name) return
    if (!supCategoryOptions.includes(name)) setSupCategoryOptions((prev) => [...prev, name])
    setSupForm((f) => ({ ...f, category: name }))
    setShowSupCatModal(false)
    setNewSupCatName('')
  }

  const handleCreateSupplier = async () => {
    if (!supForm.name.trim()) return
    setCreatingSup(true)
    try {
      const res = await createSupplier({
        name: supForm.name.trim(),
        category: supForm.category || null,
        phone: supForm.phone || null,
        email: supForm.email || null,
      })
      const newSup = res.data
      onSupplierCreated(newSup)
      setForm((f) => ({ ...f, supplier: newSup.name }))
      setShowSupModal(false)
      setSupForm({ name: '', category: '', phone: '', email: '' })
      toast.success(`Proveedor "${newSup.name}" creado`)
    } catch {
      toast.error('Error creando proveedor')
    } finally {
      setCreatingSup(false)
    }
  }

  const handlePickFiles = (e) => {
    const picked = Array.from(e.target.files || [])
    if (!picked.length) return
    setIsDirty(true)
    setPendingFiles((prev) => [...prev, ...picked])
    e.target.value = ''
  }

  const removePending = (idx) => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 flex-shrink-0">
        <button onClick={() => { setIsDirty(false); onCancel() }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 md:hidden">
          <ArrowLeft size={18} />
        </button>
        <h2 className="font-semibold text-gray-900">{isEdit ? 'Editar gasto' : 'Nuevo gasto'}</h2>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { setIsDirty(false); onCancel() }} className="btn-ghost text-sm px-3 py-1.5 hidden md:flex">
            Cancelar
          </button>
          <button onClick={onSave} disabled={saving} className="btn-primary text-sm px-3 py-1.5 flex items-center gap-1.5">
            <Save size={14} /> {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Concepto */}
        <div>
          <label className="label">Concepto *</label>
          <input
            className="input w-full"
            style={{ fontSize: '16px' }}
            value={form.concept}
            onChange={set('concept')}
            placeholder="Descripción del gasto"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Monto ($) *</label>
            <input
              className="input w-full text-right font-mono"
              style={{ fontSize: '16px' }}
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={set('amount')}
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="label">Fecha</label>
            <input
              className="input w-full"
              style={{ fontSize: '16px' }}
              type="date"
              value={form.date}
              onChange={set('date')}
            />
          </div>
        </div>

        {/* Categoría */}
        <div>
          <label className="label">Categoría</label>
          <CategoryInput
            value={form.category}
            onChange={(val) => { setIsDirty(true); setForm((f) => ({ ...f, category: val })) }}
            categories={categories}
            onNew={() => { setNewCatName(form.category.trim()); setShowCatModal(true) }}
          />
        </div>

        {/* Proveedor */}
        <div>
          <label className="label">Proveedor / Beneficiario</label>
          <SupplierInput
            value={form.supplier}
            onChange={(val) => { setIsDirty(true); setForm((f) => ({ ...f, supplier: val })) }}
            suppliers={suppliers}
            onNew={() => { setShowSupModal(true); setSupForm({ name: form.supplier.trim(), category: '', phone: '', email: '' }) }}
          />
        </div>

        {/* Método de pago */}
        <div>
          <label className="label">Método de pago</label>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map(({ value, label, Icon, color, bg }) => {
              const active = form.payment_method === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setIsDirty(true); setForm((f) => ({ ...f, payment_method: active ? '' : value })) }}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    active ? `${bg} ${color} border-current` : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <Icon size={15} className={active ? color : 'text-gray-400'} />
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Notas */}
        <div>
          <label className="label">Notas</label>
          <textarea
            className="input w-full resize-none h-20"
            style={{ fontSize: '16px' }}
            value={form.notes}
            onChange={set('notes')}
            placeholder="Observaciones adicionales..."
          />
        </div>

        {/* Cuenta por pagar */}
        <div className={`rounded-lg border p-3 space-y-3 ${form.is_payable ? 'border-orange-200 bg-orange-50' : 'border-gray-100 bg-gray-50'}`}>
          <button
            type="button"
            onClick={() => { setIsDirty(true); setForm((f) => ({ ...f, is_payable: !f.is_payable, due_date: '', paid_at: '' })) }}
            className="flex items-center gap-2 w-full text-left"
          >
            <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors ${form.is_payable ? 'bg-orange-500' : 'bg-white border-2 border-gray-300'}`}>
              {form.is_payable && <CheckCircle2 size={13} className="text-white" />}
            </div>
            <span className={`text-sm font-medium ${form.is_payable ? 'text-orange-700' : 'text-gray-600'}`}>
              <CreditCard size={13} className="inline mr-1" />Cuenta por pagar
            </span>
          </button>
          {form.is_payable && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-orange-700">Fecha límite</label>
                <input className="input w-full" type="date" style={{ fontSize: '16px' }} value={form.due_date} onChange={set('due_date')} />
              </div>
              <div>
                <label className="label text-orange-700">Fecha de pago</label>
                <input className="input w-full" type="date" style={{ fontSize: '16px' }} value={form.paid_at} onChange={set('paid_at')} placeholder="Sin pagar" />
              </div>
            </div>
          )}
        </div>

        {/* Comprobantes / adjuntos */}
        <div>
          <label className="label">Comprobantes / Facturas</label>
          <input
            ref={fileRef} type="file" className="hidden" multiple
            onChange={handlePickFiles}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          />

          {pendingFiles.length === 0 ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-200 rounded-lg py-5 flex flex-col items-center gap-2 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
            >
              <Upload size={20} className="opacity-50" />
              Adjuntar comprobante o factura
            </button>
          ) : (
            <div className="space-y-1.5">
              {pendingFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg">
                  <FileText size={14} className="text-blue-400 flex-shrink-0" />
                  <span className="flex-1 text-xs text-gray-700 truncate font-medium">{f.name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                  <button
                    type="button"
                    onClick={() => removePending(i)}
                    className="p-1 rounded hover:bg-blue-100 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-blue-600 hover:text-blue-700 font-medium border border-dashed border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <Upload size={12} /> Agregar otro archivo
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick-add category modal */}
      {showCatModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Tag size={16} /> Nueva categoría
              </h3>
              <button type="button" onClick={() => setShowCatModal(false)}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <div className="p-5">
              <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
              <input
                className="input w-full"
                style={{ fontSize: '16px' }}
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Ej: Seguros, Capacitación..."
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
              />
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button type="button" onClick={() => setShowCatModal(false)} className="btn-secondary">
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleAddCategory}
                disabled={!newCatName.trim()}
                className="btn-primary"
              >
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick-add supplier modal */}
      {showSupModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Truck size={16} /> Nuevo proveedor
              </h3>
              <button type="button" onClick={() => setShowSupModal(false)}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                <input
                  className="input w-full"
                  style={{ fontSize: '16px' }}
                  value={supForm.name}
                  onChange={(e) => setSupForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nombre del proveedor"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Categoría</label>
                <CategoryInput
                  value={supForm.category}
                  onChange={(val) => setSupForm((f) => ({ ...f, category: val }))}
                  categories={supCategoryOptions}
                  onNew={() => { setNewSupCatName(supForm.category.trim()); setShowSupCatModal(true) }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
                  <input
                    className="input w-full"
                    style={{ fontSize: '16px' }}
                    value={supForm.phone}
                    onChange={(e) => setSupForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+507 000-0000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input
                    className="input w-full"
                    style={{ fontSize: '16px' }}
                    type="email"
                    value={supForm.email}
                    onChange={(e) => setSupForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="email@empresa.com"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button type="button" onClick={() => setShowSupModal(false)} className="btn-secondary">
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateSupplier}
                disabled={!supForm.name.trim() || creatingSup}
                className="btn-primary"
              >
                {creatingSup ? 'Creando...' : 'Crear proveedor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supplier category mini-modal (z-[60] above supplier modal z-50) */}
      {showSupCatModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Tag size={16} /> Nueva categoría
              </h3>
              <button type="button" onClick={() => setShowSupCatModal(false)}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <div className="p-5">
              <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
              <input
                className="input w-full"
                style={{ fontSize: '16px' }}
                value={newSupCatName}
                onChange={(e) => setNewSupCatName(e.target.value)}
                placeholder="Ej: Logística, Seguros..."
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddSupCategory()}
              />
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button type="button" onClick={() => setShowSupCatModal(false)} className="btn-secondary">
                Cancelar
              </button>
              <button type="button" onClick={handleAddSupCategory} disabled={!newSupCatName.trim()} className="btn-primary">
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function fileIcon(ct = '') {
  if (ct.startsWith('image/')) return '🖼️'
  if (ct === 'application/pdf') return '📄'
  if (ct.includes('word')) return '📝'
  if (ct.includes('excel') || ct.includes('spreadsheet')) return '📊'
  return '📎'
}

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── Attachment panel ─────────────────────────────────────
function AttachmentPanel({ expense, onRefresh, fileRef, uploading }) {
  const handleDelete = async (att) => {
    if (!await showConfirm(`¿Eliminar "${att.original_name}"?`)) return
    try {
      await deleteExpenseAttachment(expense.id, att.id)
      onRefresh()
      toast.success('Adjunto eliminado')
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const atts = expense.attachments || []

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <FileText size={13} /> Comprobantes y Facturas
        </h4>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
        >
          <Upload size={12} /> {uploading ? 'Subiendo...' : 'Adjuntar'}
        </button>
      </div>

      {atts.length === 0 ? (
        <p className="text-xs text-gray-300 italic">Sin archivos adjuntos</p>
      ) : (
        <div className="space-y-1.5">
          {atts.map((att) => (
            <div key={att.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
              <span className="text-base leading-none">{fileIcon(att.content_type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{att.original_name}</p>
                <p className="text-xs text-gray-400">{fmtSize(att.file_size)}</p>
              </div>
              <button
                onClick={() => downloadWithAuth(expenseAttachmentDownloadUrl(expense.id, att.id), att.original_name)}
                className="p-1 text-gray-400 hover:text-blue-600"
                title="Descargar"
              >
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

// ── Order attachments (read-only, shown in linked expense) ─
function OrderAttachmentsPanel({ orderId }) {
  const [atts, setAtts] = useState([])

  useEffect(() => {
    if (!orderId) return
    getOrderAttachments(orderId)
      .then((r) => setAtts(r.data.filter((a) => a.doc_type === 'proveedor')))
      .catch(() => {})
  }, [orderId])

  if (atts.length === 0) return null

  return (
    <div className="card">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-3">
        <FileText size={13} /> Facturas del pedido
      </h4>
      <div className="space-y-1.5">
        {atts.map((att) => (
          <div key={att.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
            <span className="text-base leading-none">{fileIcon(att.content_type)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate">{att.original_name}</p>
              <p className="text-xs text-gray-400">{fmtSize(att.file_size)}</p>
            </div>
            <button
              onClick={() => downloadWithAuth(orderAttachmentDownloadUrl(orderId, att.id), att.original_name)}
              className="p-1 text-gray-400 hover:text-blue-600"
              title="Descargar"
            >
              <Download size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Expense Detail ──────────────────────────────────────
function ExpenseDetail({ expense, onEdit, onDelete, onBack, onRefresh, isAdmin, allExpenses = [] }) {
  const fileRef = useRef()
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await uploadExpenseAttachment(expense.id, file)
      onRefresh()
      toast.success('Archivo adjuntado')
    } catch {
      toast.error('Error al adjuntar')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-gray-100 flex-shrink-0">
        {/* Title row */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <button onClick={onBack} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 md:hidden flex-shrink-0">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            {expense.type === 'pedido' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium inline-flex items-center gap-1 mb-1">
                <Link2 size={10} /> Pedido
              </span>
            )}
            <h2 className="font-semibold text-gray-900 truncate leading-tight">{expense.concept}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {expense.date ? fmtD(expense.date) : 'Sin fecha'}
              {expense.category && <> &nbsp;·&nbsp; {expense.category}</>}
            </p>
          </div>
        </div>
        {/* Action buttons row */}
        <div className="flex items-center gap-2 px-4 pb-3">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors disabled:opacity-60 flex-1 sm:flex-none justify-center sm:justify-start"
          >
            <Upload size={14} />
            <span>{uploading ? 'Subiendo...' : 'Adjuntar'}</span>
          </button>
          <input
            ref={fileRef} type="file" className="hidden" onChange={handleUpload}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          />
          {expense.type !== 'pedido' && (
            <button
              onClick={onEdit}
              className="btn-secondary flex items-center gap-1.5 text-sm flex-1 sm:flex-none justify-center sm:justify-start"
            >
              <Edit size={14} /> Editar
            </button>
          )}
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors flex-1 sm:flex-none justify-center sm:justify-start"
          >
            <Trash2 size={14} /> Eliminar
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Amount card */}
        <div className="bg-gradient-to-br from-red-50 to-orange-50 border border-red-100 rounded-xl p-5 text-center">
          <p className="text-xs text-gray-500 mb-1">Monto del gasto</p>
          <p className="text-3xl font-bold text-red-600">{fmtMoney(expense.amount)}</p>
        </div>

        {/* Info grid */}
        <div className="card grid grid-cols-2 gap-3 text-sm">
          {expense.supplier && (
            <div className="col-span-2">
              <p className="text-xs text-gray-400 flex items-center gap-1 mb-0.5"><Building2 size={11} /> Proveedor</p>
              <p className="font-medium text-gray-900">{expense.supplier}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400 flex items-center gap-1 mb-0.5"><Calendar size={11} /> Fecha</p>
            <p className="font-medium text-gray-900">{expense.date ? fmtD(expense.date) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 flex items-center gap-1 mb-0.5"><Tag size={11} /> Categoría</p>
            <p className="font-medium text-gray-900">{expense.category || '—'}</p>
          </div>
          {expense.payment_method && (() => {
            const m = PAYMENT_METHODS.find((p) => p.value === expense.payment_method)
            return (
              <div className="col-span-2">
                <p className="text-xs text-gray-400 flex items-center gap-1 mb-0.5"><Wallet size={11} /> Método de pago</p>
                <p className={`font-medium flex items-center gap-1.5 ${m?.color || 'text-gray-900'}`}>
                  {m && <m.Icon size={14} />} {expense.payment_method}
                </p>
              </div>
            )
          })()}
          {expense.order && (
            <div className="col-span-2">
              <p className="text-xs text-gray-400 flex items-center gap-1 mb-0.5"><Link2 size={11} /> Pedido vinculado</p>
              <p className="font-medium text-gray-900">
                {expense.order.order_number || `#${expense.order.id}`} — {expense.order.title}
              </p>
            </div>
          )}
          {expense.notes && (
            <div className="col-span-2">
              <p className="text-xs text-gray-400 mb-0.5">Notas</p>
              <p className="text-gray-700 whitespace-pre-wrap">{expense.notes}</p>
            </div>
          )}
        </div>

        {/* Bank transactions linked to this order */}
        {expense.type === 'pedido' && expense.order_id && (() => {
          const payments = allExpenses.filter(
            (e) => e.type === 'manual' && e.order_id === expense.order_id
          )
          if (!payments.length) return null
          return (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                <CreditCard size={12} /> Transacciones bancarias vinculadas
              </p>
              {payments.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm">
                  <CreditCard size={14} className="text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 truncate">{p.concept}</p>
                    <p className="text-xs text-gray-500">{p.supplier || ''}{p.date ? ` · ${fmtD(p.date)}` : ''}</p>
                  </div>
                  <span className="font-bold text-blue-700 flex-shrink-0">{fmtMoney(p.amount)}</span>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Linked-order notice */}
        {expense.type === 'pedido' && (
          <div className="flex items-start gap-2 p-3 bg-purple-50 border border-purple-100 rounded-lg text-xs text-purple-700">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            Este gasto se generó automáticamente desde un pedido. Para modificar el monto, edita el pedido correspondiente.
          </div>
        )}

        {/* Order supplier invoices (read-only) */}
        {expense.type === 'pedido' && expense.order_id && (
          <OrderAttachmentsPanel orderId={expense.order_id} />
        )}

        {/* Expense own attachments */}
        <AttachmentPanel expense={expense} onRefresh={onRefresh} fileRef={fileRef} uploading={uploading} />
      </div>
    </div>
  )
}

// ── Summary bar ─────────────────────────────────────────
function SummaryBar({ dateFrom, dateTo }) {
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    const params = {}
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo
    getExpenseSummary(params)
      .then((r) => setSummary(r.data))
      .catch(() => {})
  }, [dateFrom, dateTo])

  if (!summary) return null

  const topCats = Object.entries(summary.by_category).slice(0, 4)

  return (
    <div className="px-4 py-3 bg-white border-b border-gray-100 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{summary.count} gasto{summary.count !== 1 ? 's' : ''}</span>
        <span className="text-sm font-bold text-red-600">{fmtMoney(String(summary.total))}</span>
      </div>
      {summary.payable_count > 0 && (
        <div className="flex items-center justify-between bg-orange-50 border border-orange-100 rounded-lg px-3 py-1.5">
          <span className="text-xs text-orange-600 flex items-center gap-1">
            <CreditCard size={11} /> {summary.payable_count} cuenta{summary.payable_count !== 1 ? 's' : ''} por pagar
          </span>
          <span className="text-xs font-bold text-orange-600">{fmtMoney(String(summary.payable_total))}</span>
        </div>
      )}
      {topCats.length > 0 && (
        <div className="space-y-1">
          {topCats.map(([cat, amt]) => {
            const pct = summary.total > 0 ? (amt / summary.total) * 100 : 0
            return (
              <div key={cat}>
                <div className="flex justify-between text-xs text-gray-500 mb-0.5">
                  <span className="truncate">{cat}</span>
                  <span className="flex-shrink-0 ml-2 font-medium">{fmtMoney(String(amt))}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main component ──────────────────────────────────────
export default function Gastos() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'supervisor'
  const navigate = useNavigate()
  const { ref: urlRef } = useParams()

  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [selected, setSelected] = useState(null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const detailSwipe = useTouchSwipe({ onSwipeRight: () => { setMobileDetailOpen(false); navigate(-1) } })
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [pendingFiles, setPendingFiles] = useState([])
  const [saving, setSaving] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterPayment, setFilterPayment] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 320)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    setLoading(true)
    const params = {}
    if (debouncedSearch) params.search = debouncedSearch
    if (filterCategory) params.category = filterCategory
    if (filterType) params.type = filterType
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo
    getExpenses(params)
      .then((r) => setExpenses(r.data))
      .catch(() => toast.error('Error cargando gastos'))
      .finally(() => setLoading(false))
  }, [debouncedSearch, filterCategory, filterType, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!urlRef) { if (selected) { setSelected(null); setMobileDetailOpen(false) } return }
    if (expenses.length === 0) return
    if (selected && String(selected.id) === urlRef) return
    const found = expenses.find((e) => String(e.id) === urlRef)
    if (found) { setSelected(found); setShowForm(false); setMobileDetailOpen(true) }
  }, [urlRef, expenses]) // eslint-disable-line

  useEffect(() => {
    getExpenseCategories().then((r) => setCategories(r.data)).catch(() => {})
    getSuppliers().then((r) => setSuppliers(r.data)).catch(() => {})
  }, [])

  // Merge formal suppliers with unique supplier names from existing expenses
  const supplierOptions = React.useMemo(() => {
    const formalNames = new Set(suppliers.map((s) => s.name.toLowerCase()))
    const fromExpenses = expenses
      .map((e) => e.supplier)
      .filter((s) => s && !formalNames.has(s.toLowerCase()))
    const unique = [...new Set(fromExpenses)]
    return [
      ...suppliers,
      ...unique.map((name) => ({ id: `exp-${name}`, name })),
    ]
  }, [suppliers, expenses])

  const refreshSelected = useCallback((id) => {
    // Re-fetch the selected expense to update attachments
    load()
    if (selected?.id === id) {
      getExpenses({})
        .then((r) => {
          const fresh = r.data.find((e) => e.id === id)
          if (fresh) setSelected(fresh)
        })
        .catch(() => {})
    }
  }, [selected, load])

  const handleNew = () => {
    setSelected(null)
    setForm(EMPTY_FORM)
    setPendingFiles([])
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

  const handleSelect = (expense) => {
    setSelected(expense)
    setShowForm(false)
    setMobileDetailOpen(true)
    navigate('/gastos/' + expense.id)
  }

  const handleEdit = () => {
    if (!selected) return
    setForm({
      concept: selected.concept || '',
      amount: selected.amount || '',
      category: selected.category || '',
      date: selected.date || '',
      supplier: selected.supplier || '',
      payment_method: selected.payment_method || '',
      notes: selected.notes || '',
      is_payable: selected.is_payable || false,
      due_date: selected.due_date || '',
      paid_at: selected.paid_at || '',
    })
    setPendingFiles([])
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.concept.trim()) { toast.error('El concepto es obligatorio'); return }
    if (!form.amount || parseAmount(form.amount) <= 0) { toast.error('Ingresa un monto válido'); return }
    setSaving(true)
    try {
      const payload = {
        concept: form.concept.trim(),
        amount: parseAmount(form.amount).toFixed(2),
        category: form.category || null,
        date: form.date || null,
        supplier: form.supplier.trim() || null,
        payment_method: form.payment_method || null,
        notes: form.notes.trim() || null,
        is_payable: form.is_payable,
        due_date: form.is_payable ? (form.due_date || null) : null,
        paid_at: form.is_payable ? (form.paid_at || null) : null,
      }
      let savedExpense
      if (selected && showForm) {
        const updated = await updateExpense(selected.id, payload)
        savedExpense = updated.data
      } else {
        const created = await createExpense(payload)
        savedExpense = created.data
      }

      // Upload any pending files
      if (pendingFiles.length > 0) {
        await Promise.allSettled(
          pendingFiles.map((file) => uploadExpenseAttachment(savedExpense.id, file))
        )
        setPendingFiles([])
        // Re-fetch to get attachments included
        const fresh = await getExpense(savedExpense.id)
        savedExpense = fresh.data
      }

      setSelected(savedExpense)
      setShowForm(false)
      load()
      toast.success('Gasto guardado')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    if (!await showConfirm('¿Eliminar este gasto?')) return
    try {
      await deleteExpense(selected.id)
      setSelected(null)
      setMobileDetailOpen(false)
      navigate('/gastos', { replace: true })
      load()
      toast.success('Gasto eliminado')
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al eliminar')
    }
  }

  const handleDeleteById = async (e, exp) => {
    e.stopPropagation()
    if (!await showConfirm(`¿Eliminar "${exp.concept}"?`)) return
    try {
      await deleteExpense(exp.id)
      if (selected?.id === exp.id) { setSelected(null); setMobileDetailOpen(false); navigate('/gastos', { replace: true }) }
      load()
      toast.success('Gasto eliminado')
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al eliminar')
    }
  }

  const handleBack = () => { setMobileDetailOpen(false); setShowForm(false); navigate(-1) }

  const filteredExpenses = expenses.filter((e) => {
    if (!filterPayment) return true
    if (filterPayment === '__none__') return !e.payment_method
    return e.payment_method === filterPayment
  })

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Left panel ── */}
      <div className={`${mobileDetailOpen ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-gray-200 bg-white flex-shrink-0`}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown size={18} className="text-red-500" />
              <h1 className="text-lg font-bold text-gray-900">Gastos</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/gastos/dashboard')}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                title="Dashboard de gastos"
              >
                <BarChart2 size={16} />
              </button>
              <button onClick={handleNew} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
                <Plus size={15} /> Nuevo
              </button>
            </div>
          </div>
        </div>

        {/* Search & filters */}
        <div className="px-4 py-3 space-y-2 border-b border-gray-100">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-8 w-full text-sm"
                style={{ fontSize: '16px' }}
                placeholder="Buscar por concepto, proveedor, categoría..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded-lg border transition-colors ${(showFilters || filterCategory || filterType || filterPayment || dateFrom || dateTo) ? 'bg-blue-50 border-blue-200 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
              title="Filtros"
            >
              <SlidersHorizontal size={16} />
            </button>
          </div>

          {showFilters && (
            <div className="space-y-2 pt-1">
              <select className="input w-full text-sm" style={{ fontSize: '16px' }} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                <option value="">Todas las categorías</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="input w-full text-sm" style={{ fontSize: '16px' }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="">Todos los tipos</option>
                <option value="manual">Manual</option>
                <option value="pedido">Desde pedido</option>
              </select>
              <select className="input w-full text-sm" style={{ fontSize: '16px' }} value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)}>
                <option value="">Todos los métodos de pago</option>
                <option value="__none__">⚠ Sin método clasificado</option>
                {PAYMENT_METHODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input className="input text-sm" style={{ fontSize: '16px' }} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="Desde" title="Desde" />
                <input className="input text-sm" style={{ fontSize: '16px' }} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="Hasta" title="Hasta" />
              </div>
              {(filterCategory || filterType || filterPayment || dateFrom || dateTo) && (
                <button
                  onClick={() => { setFilterCategory(''); setFilterType(''); setFilterPayment(''); setDateFrom(''); setDateTo('') }}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          )}
        </div>

        {/* Summary */}
        <SummaryBar dateFrom={dateFrom} dateTo={dateTo} />

        {/* List */}
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 divide-y divide-gray-50">
          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">Cargando...</div>
          ) : filteredExpenses.length === 0 ? (
            <div className="text-center py-16 px-4 space-y-3">
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                <TrendingDown size={20} className="text-red-200" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-400">Sin gastos registrados</p>
                <p className="text-xs text-gray-300 mt-1">Usa "Nuevo" para agregar un gasto manual</p>
              </div>
            </div>
          ) : (
            filteredExpenses.map((exp) => (
              <div
                key={exp.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelect(exp)}
                onKeyDown={(e) => e.key === 'Enter' && handleSelect(exp)}
                className={`group w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors cursor-pointer ${selected?.id === exp.id ? 'bg-red-50' : 'hover:bg-gray-50'}`}
              >
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-red-100">
                  <TrendingDown size={14} className="text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-sm truncate ${selected?.id === exp.id ? 'text-red-700' : 'text-gray-900'}`}>
                    {exp.concept}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs font-bold text-red-600">{fmtMoney(exp.amount)}</span>
                    {exp.category && (
                      <span className="text-xs text-gray-400 truncate">{exp.category}</span>
                    )}
                    {exp.date && (
                      <span className="text-xs text-gray-400">{fmtD(exp.date)}</span>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${TYPE_STYLE[exp.type] || 'bg-gray-100 text-gray-600'}`}>
                      {exp.type === 'pedido' ? 'Pedido' : 'Manual'}
                    </span>
                    {exp.is_payable && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5 ${exp.paid_at ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        <CreditCard size={9} /> {exp.paid_at ? 'Pagado' : 'Por pagar'}
                      </span>
                    )}
                    {exp.type === 'pedido' && exp.order_id && expenses.some(
                      (e) => e.type === 'manual' && e.order_id === exp.order_id
                    ) && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-600 flex items-center gap-0.5">
                        <CreditCard size={9} /> Pago
                      </span>
                    )}
                    {exp.payment_method && (
                      <span className="text-xs text-gray-500 flex items-center gap-0.5">
                        {paymentIcon(exp.payment_method, 10)}
                        <span className="hidden sm:inline">{exp.payment_method}</span>
                      </span>
                    )}
                    {exp.attachments?.length > 0 && (
                      <span className="text-xs text-gray-400 flex items-center gap-0.5">
                        <Paperclip size={10} /> {exp.attachments.length}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDeleteById(e, exp)}
                  className="sm:opacity-0 sm:group-hover:opacity-100 opacity-40 p-2 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"
                  title="Eliminar gasto"
                >
                  <Trash2 size={14} />
                </button>
                <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className={`${mobileDetailOpen ? 'flex' : 'hidden'} md:flex flex-1 flex-col bg-gray-50 overflow-y-auto overscroll-contain min-h-0`} {...detailSwipe}>
        {showForm ? (
          <ExpenseForm
            form={form}
            setForm={setForm}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setPendingFiles([]); if (!selected) setMobileDetailOpen(false) }}
            saving={saving}
            isEdit={!!selected}
            categories={categories}
            suppliers={supplierOptions}
            onCategoryCreated={(name) => setCategories((prev) => [...prev, name])}
            onSupplierCreated={(s) => setSuppliers((prev) => [s, ...prev])}
            pendingFiles={pendingFiles}
            setPendingFiles={setPendingFiles}
          />
        ) : selected ? (
          <ExpenseDetail
            expense={selected}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onBack={handleBack}
            onRefresh={() => refreshSelected(selected.id)}
            isAdmin={isAdmin}
            allExpenses={expenses}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center">
              <TrendingDown size={28} className="text-red-300" />
            </div>
            <div>
              <p className="font-medium text-gray-500">Selecciona un gasto</p>
              <p className="text-sm text-gray-400 mt-1">o crea uno nuevo con el botón "Nuevo"</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
