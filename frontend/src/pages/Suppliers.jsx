import { showConfirm } from '../utils/confirm'
import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import {
  getSuppliers, createSupplier, updateSupplier, deleteSupplier,
  uploadSupplierLogo, deleteSupplierLogo, supplierLogoUrl,
} from '../services/api'
import {
  Search, Plus, Pencil, Trash2, Building2,
  Phone, Mail, Globe, MapPin, Tag, User, FileText,
  ChevronRight, ArrowLeft, Camera, X, Save,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useFormGuard } from '../context/UnsavedChangesContext'

const CATEGORIES = ['Hardware', 'Software', 'Consumibles', 'Servicios', 'Redes', 'Impresión', 'Otro']

function SupplierCategoryInput({ value, onChange, categories, onNew }) {
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

const AVATAR_COLORS = [
  'bg-violet-600', 'bg-blue-600', 'bg-emerald-600',
  'bg-orange-500', 'bg-rose-600', 'bg-cyan-600', 'bg-amber-500',
]

function avatarColor(name = '') {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}

function initials(name = '') {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

function SupplierAvatar({ supplier, size = 'md', onClick, uploading }) {
  const sizeClass = size === 'lg' ? 'w-16 h-16 text-xl rounded-2xl' : 'w-10 h-10 text-sm rounded-xl'
  const hasLogo = !!supplier.logo_path

  return (
    <div className={`relative flex-shrink-0 ${onClick ? 'cursor-pointer group' : ''}`} onClick={onClick}>
      <div className={`${sizeClass} ${hasLogo ? '' : avatarColor(supplier.name)} flex items-center justify-center text-white font-bold overflow-hidden`}>
        {hasLogo
          ? <img src={supplierLogoUrl(supplier.id)} alt={supplier.name} className="w-full h-full object-cover" key={supplier.logo_path} />
          : initials(supplier.name)
        }
      </div>
      {onClick && (
        <div className={`absolute inset-0 ${sizeClass} flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity`}>
          {uploading
            ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Camera size={size === 'lg' ? 18 : 13} className="text-white" />
          }
        </div>
      )}
    </div>
  )
}

const EMPTY_FORM = {
  name: '', contact_name: '', phone: '', email: '',
  address: '', website: '', category: '', notes: '',
}

export default function Suppliers() {
  const navigate = useNavigate()
  const { ref: urlRef } = useParams()
  const [suppliers, setSuppliers] = useState([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const detailSwipe = useTouchSwipe({ onSwipeRight: () => { setMobileDetailOpen(false); navigate(-1) } })
  const logoInputRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 320)
    return () => clearTimeout(t)
  }, [search])

  const load = (keepSelected = false) => {
    getSuppliers({ q: debouncedSearch || undefined, category: filterCategory || undefined })
      .then((r) => {
        setSuppliers(r.data)
        if (keepSelected && selected) {
          const fresh = r.data.find((s) => s.id === selected.id)
          if (fresh) setSelected(fresh)
        }
      })
      .catch(() => toast.error('Error cargando proveedores'))
  }

  useEffect(() => { load() }, [debouncedSearch, filterCategory])

  useEffect(() => {
    if (!urlRef) { if (selected) { setSelected(null); setMobileDetailOpen(false) } return }
    if (suppliers.length === 0) return
    if (selected && String(selected.id) === urlRef) return
    const found = suppliers.find((s) => String(s.id) === urlRef)
    if (found) { setSelected(found); setShowForm(false); setMobileDetailOpen(true) }
  }, [urlRef, suppliers]) // eslint-disable-line

  const handleSelect = (s) => {
    setSelected(s)
    setShowForm(false)
    setMobileDetailOpen(true)
    navigate('/suppliers/' + s.id)
  }

  const handleNew = () => {
    setSelected(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
    setMobileDetailOpen(true)
  }

  const handleEdit = () => {
    setForm({
      name: selected.name || '',
      contact_name: selected.contact_name || '',
      phone: selected.phone || '',
      email: selected.email || '',
      address: selected.address || '',
      website: selected.website || '',
      category: selected.category || '',
      notes: selected.notes || '',
    })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('El nombre es requerido')
    setSaving(true)
    try {
      if (selected && showForm) {
        const updated = await updateSupplier(selected.id, form)
        toast.success('Proveedor actualizado')
        setSelected(updated.data)
      } else {
        const created = await createSupplier(form)
        toast.success('Proveedor creado')
        setSelected(created.data)
      }
      setShowForm(false)
      load()
    } catch {
      toast.error('Error guardando proveedor')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (s) => {
    if (!await showConfirm(`¿Eliminar "${s.name}"? Esta acción no se puede deshacer.`)) return
    try {
      await deleteSupplier(s.id)
      toast.success('Proveedor eliminado')
      if (selected?.id === s.id) { setSelected(null); setMobileDetailOpen(false); navigate('/suppliers', { replace: true }) }
      load()
    } catch {
      toast.error('Error eliminando proveedor')
    }
  }

  const handleLogoClick = () => {
    if (!selected || showForm) return
    logoInputRef.current?.click()
  }

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const res = await uploadSupplierLogo(selected.id, file)
      setSelected(res.data)
      load()
      toast.success('Logo actualizado')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error subiendo imagen')
    } finally {
      setUploading(false)
    }
  }

  const handleLogoDelete = async () => {
    setUploading(true)
    try {
      const res = await deleteSupplierLogo(selected.id)
      setSelected(res.data)
      load()
      toast.success('Logo eliminado')
    } catch {
      toast.error('Error eliminando logo')
    } finally {
      setUploading(false)
    }
  }

  const handleBack = () => {
    setMobileDetailOpen(false)
    setShowForm(false)
    navigate(-1)
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <input
        ref={logoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleLogoChange}
      />

      {/* Left panel */}
      <div className={`${mobileDetailOpen ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-gray-200 bg-white flex-shrink-0`}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 md:pr-14 lg:pr-28">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Proveedores</h1>
            <p className="text-xs text-gray-400">{suppliers.length} proveedor{suppliers.length !== 1 ? 'es' : ''}</p>
          </div>
          <button onClick={handleNew} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
            <Plus size={15} /> Nuevo
          </button>
        </div>

        <div className="px-4 py-3 space-y-2 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-8 w-full text-sm"
              placeholder="Buscar proveedores..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="input w-full text-sm" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="">Todas las categorías</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 divide-y divide-gray-50">
          {suppliers.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">Sin proveedores</div>
          ) : suppliers.map((s) => (
            <button
              key={s.id}
              onClick={() => handleSelect(s)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${selected?.id === s.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            >
              <SupplierAvatar supplier={s} size="md" />
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm truncate ${selected?.id === s.id ? 'text-blue-700' : 'text-gray-900'}`}>{s.name}</p>
                <p className="text-xs text-gray-400 truncate">
                  {s.category && <span className="text-gray-500">{s.category}</span>}
                  {s.category && s.contact_name && ' · '}
                  {s.contact_name}
                </p>
              </div>
              <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className={`${mobileDetailOpen ? 'flex' : 'hidden'} md:flex flex-1 flex-col bg-gray-50 overflow-y-auto overscroll-contain min-h-0`} {...detailSwipe}>
        {showForm ? (
          <SupplierForm
            form={form}
            setForm={setForm}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); if (!selected) setMobileDetailOpen(false) }}
            saving={saving}
            isEdit={!!selected}
            onBack={handleBack}
          />
        ) : selected ? (
          <SupplierDetail
            supplier={selected}
            onEdit={handleEdit}
            onDelete={() => handleDelete(selected)}
            onBack={handleBack}
            onLogoClick={handleLogoClick}
            onLogoDelete={handleLogoDelete}
            uploading={uploading}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Selecciona un proveedor o crea uno nuevo
          </div>
        )}
      </div>
    </div>
  )
}

function SupplierDetail({ supplier, onEdit, onDelete, onBack, onLogoClick, onLogoDelete, uploading }) {
  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      <button onClick={onBack} className="md:hidden flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={16} /> Volver
      </button>

      <div className="flex items-start gap-4 mb-6">
        {/* Clickable logo */}
        <div className="flex flex-col items-center gap-1.5">
          <SupplierAvatar supplier={supplier} size="lg" onClick={onLogoClick} uploading={uploading} />
          {supplier.logo_path && (
            <button
              onClick={onLogoDelete}
              disabled={uploading}
              className="text-xs text-red-500 hover:text-red-700 flex items-center gap-0.5 disabled:opacity-40"
            >
              <X size={10} /> Quitar
            </button>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-gray-900 leading-tight">{supplier.name}</h2>
          {supplier.category && (
            <span className="inline-flex items-center gap-1 mt-1 text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
              <Tag size={10} /> {supplier.category}
            </span>
          )}
          <p className="text-xs text-gray-400 mt-2">Haz clic en el logo para cambiar la imagen</p>
        </div>

        <div className="flex gap-2 flex-shrink-0">
          <button onClick={onEdit} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Pencil size={13} /> <span className="hidden sm:inline">Editar</span>
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"
          >
            <Trash2 size={13} /> <span className="hidden sm:inline">Eliminar</span>
          </button>
        </div>
      </div>

      <div className="card space-y-4">
        {supplier.contact_name && <Row icon={<User size={15} />} label="Contacto" value={supplier.contact_name} />}
        {supplier.phone && (
          <Row icon={<Phone size={15} />} label="Teléfono"
            value={<a href={`tel:${supplier.phone}`} className="text-blue-600 hover:underline">{supplier.phone}</a>}
          />
        )}
        {supplier.email && (
          <Row icon={<Mail size={15} />} label="Email"
            value={<a href={`mailto:${supplier.email}`} className="text-blue-600 hover:underline">{supplier.email}</a>}
          />
        )}
        {supplier.website && (
          <Row icon={<Globe size={15} />} label="Sitio web"
            value={<a href={supplier.website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{supplier.website}</a>}
          />
        )}
        {supplier.address && <Row icon={<MapPin size={15} />} label="Dirección" value={supplier.address} />}
        {supplier.notes && (
          <div className="pt-2 border-t border-gray-100">
            <div className="flex items-center gap-2 text-xs text-gray-400 font-medium mb-1.5">
              <FileText size={13} /> NOTAS
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{supplier.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-gray-400 mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-sm text-gray-800">{value}</p>
      </div>
    </div>
  )
}

function SupplierForm({ form, setForm, onSave, onCancel, saving, isEdit, onBack }) {
  const [isDirty, setIsDirty] = useState(false)
  useFormGuard(isDirty)
  const set = (field) => (e) => { setIsDirty(true); setForm((f) => ({ ...f, [field]: e.target.value })) }

  const [categoryOptions, setCategoryOptions] = useState([...CATEGORIES])
  const [showCatModal, setShowCatModal] = useState(false)
  const [newCatName, setNewCatName] = useState('')

  const handleAddCategory = () => {
    const name = newCatName.trim()
    if (!name) return
    if (!categoryOptions.includes(name)) setCategoryOptions((prev) => [...prev, name])
    setForm((f) => ({ ...f, category: name }))
    setIsDirty(true)
    setShowCatModal(false)
    setNewCatName('')
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      <button onClick={onBack} className="md:hidden flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={16} /> Volver
      </button>

      <h2 className="text-lg font-bold text-gray-900 mb-5">
        {isEdit ? 'Editar proveedor' : 'Nuevo proveedor'}
      </h2>

      <form id="supplier-form" onSubmit={onSave} className="card space-y-4 sticky-footer-form">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
          <input className="input w-full" value={form.name} onChange={set('name')} placeholder="Nombre del proveedor" required />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Persona de contacto</label>
            <input className="input w-full" value={form.contact_name} onChange={set('contact_name')} placeholder="Nombre completo" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Categoría</label>
            <SupplierCategoryInput
              value={form.category || ''}
              onChange={(val) => { setIsDirty(true); setForm((f) => ({ ...f, category: val })) }}
              categories={categoryOptions}
              onNew={() => { setNewCatName((form.category || '').trim()); setShowCatModal(true) }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
            <input className="input w-full" value={form.phone} onChange={set('phone')} placeholder="+507 000-0000" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input className="input w-full" type="email" value={form.email} onChange={set('email')} placeholder="correo@ejemplo.com" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Sitio web</label>
          <input className="input w-full" value={form.website} onChange={set('website')} placeholder="https://..." />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
          <input className="input w-full" value={form.address} onChange={set('address')} placeholder="Dirección física" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notas</label>
          <textarea className="input w-full h-24 resize-none" value={form.notes} onChange={set('notes')} placeholder="Información adicional..." />
        </div>

      </form>

      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 sm:px-6 py-3 flex items-center gap-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] z-10 -mx-4 sm:-mx-6">
        <span className={`text-xs flex items-center gap-1.5 ${isDirty ? 'text-amber-600' : 'text-gray-300'}`}>
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${isDirty ? 'bg-amber-500 animate-pulse' : 'bg-gray-300'}`} />
          {isDirty ? 'Sin guardar' : 'Sin cambios'}
        </span>
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm py-1.5 px-3">Cancelar</button>
          <button type="submit" form="supplier-form" disabled={saving} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
            <Save size={13} />
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear proveedor'}
          </button>
        </div>
      </div>

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
                placeholder="Ej: Logística, Seguros..."
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
              />
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button type="button" onClick={() => setShowCatModal(false)} className="btn-secondary">
                Cancelar
              </button>
              <button type="button" onClick={handleAddCategory} disabled={!newCatName.trim()} className="btn-primary">
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
