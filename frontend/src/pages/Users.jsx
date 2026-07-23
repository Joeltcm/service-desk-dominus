import { showConfirm } from '../utils/confirm'
import React, { useEffect, useState } from 'react'
import {
  getUsers, createUser, updateUser, deleteUser,
  getClientCategories, createClientCategory, updateClientCategory, deleteClientCategory,
  getCompanies,
} from '../services/api'
import { Plus, Edit, Trash2, X, Check, Save, Tag, Users as UsersIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFormGuard } from '../context/UnsavedChangesContext'
import { ROLES, ROLE_MAP } from './Settings'

const EMPTY_FORM = { name: '', email: '', password: '', role: 'client', phone: '', company: '', address: '', client_category_id: '' }
const EMPTY_CAT  = { name: '', color: '#3B82F6', description: '', order: 0 }

const CAT_COLORS = [
  '#3B82F6','#8B5CF6','#EC4899','#EF4444','#F97316','#EAB308',
  '#22C55E','#14B8A6','#06B6D4','#6366F1','#F59E0B','#6B7280',
]

export default function Users() {
  const [tab, setTab] = useState('usuarios')

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        <button
          onClick={() => setTab('usuarios')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            tab === 'usuarios'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <UsersIcon size={15} />
          Usuarios
        </button>
        <button
          onClick={() => setTab('categorias')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            tab === 'categorias'
              ? 'border-amber-500 text-amber-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Tag size={15} />
          Categorías de clientes
        </button>
      </div>

      {tab === 'usuarios'   && <UsersTab />}
      {tab === 'categorias' && <CategoriesTab />}
    </div>
  )
}

// ── Users tab ──────────────────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState([])
  const [categories, setCategories] = useState([])
  const [companies, setCompanies] = useState([])
  const [companyDrop, setCompanyDrop] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  useFormGuard(isDirty)

  const fetchUsers = () => {
    getUsers()
      .then((res) => setUsers(res.data))
      .catch(() => toast.error('Error cargando usuarios'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchUsers()
    getClientCategories().then(r => setCategories(r.data)).catch(() => {})
    getCompanies().then(r => setCompanies(r.data)).catch(() => {})
  }, [])

  const openCreate = () => { setEditUser(null); setForm(EMPTY_FORM); setCompanyDrop([]); setShowModal(true) }

  const openEdit = (user) => {
    setEditUser(user)
    setForm({
      name: user.name, email: user.email, password: '', role: user.role,
      phone: user.phone || '', company: user.company || '', address: user.address || '',
      client_category_id: user.client_category_id || '',
    })
    setCompanyDrop([])
    setShowModal(true)
  }

  const handleChange = (e) => {
    setIsDirty(true)
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form, client_category_id: form.client_category_id ? Number(form.client_category_id) : null }
      if (!payload.password) delete payload.password
      if (editUser) {
        await updateUser(editUser.id, payload)
        toast.success('Usuario actualizado')
      } else {
        await createUser(payload)
        toast.success('Usuario creado')
      }
      setIsDirty(false)
      setShowModal(false)
      fetchUsers()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error guardando usuario')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (user) => {
    if (!await showConfirm(`¿Desactivar al usuario ${user.name}?`)) return
    try {
      await deleteUser(user.id)
      toast.success('Usuario desactivado')
      fetchUsers()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    }
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nuevo Usuario
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500">Cargando...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">NOMBRE</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">EMAIL</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ROL</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">EMPRESA</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">CATEGORÍA</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ESTADO</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                        {u.name[0]?.toUpperCase()}
                      </div>
                      <span className="font-medium text-gray-900">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${ROLE_MAP[u.role]?.color || 'bg-gray-100 text-gray-700'}`}>
                      {ROLE_MAP[u.role]?.label || u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.company || '—'}</td>
                  <td className="px-4 py-3">
                    {u.client_category ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: u.client_category.color }}>
                        {u.client_category.name}
                      </span>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {u.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(u)} className="p-1.5 hover:bg-gray-200 rounded text-gray-500">
                        <Edit size={14} />
                      </button>
                      <button onClick={() => handleDelete(u)} className="p-1.5 hover:bg-red-100 rounded text-gray-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
              <h3 className="font-semibold text-gray-900">
                {editUser ? 'Editar Usuario' : 'Nuevo Usuario'}
              </h3>
              <button onClick={() => { setIsDirty(false); setShowModal(false) }}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="label">Nombre *</label>
                <input name="name" className="input" style={{fontSize:'16px'}} value={form.name} onChange={handleChange} required />
              </div>
              <div>
                <label className="label">Email *</label>
                <input type="email" name="email" className="input" style={{fontSize:'16px'}} value={form.email} onChange={handleChange} required />
              </div>
              <div>
                <label className="label">{editUser ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}</label>
                <input type="password" name="password" className="input" style={{fontSize:'16px'}}
                  value={form.password} onChange={handleChange} required={!editUser} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Rol</label>
                  <select name="role" className="input" style={{fontSize:'16px'}} value={form.role} onChange={handleChange}>
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Teléfono</label>
                  <input name="phone" className="input" style={{fontSize:'16px'}} value={form.phone} onChange={handleChange} />
                </div>
              </div>
              <div className="relative">
                <label className="label">Empresa</label>
                <input
                  name="company"
                  className="input"
                  style={{fontSize:'16px'}}
                  value={form.company}
                  onChange={(e) => {
                    const v = e.target.value
                    setIsDirty(true)
                    setForm((f) => ({ ...f, company: v }))
                    setCompanyDrop(v.trim() ? companies.filter((c) => c.name.toLowerCase().includes(v.toLowerCase())) : [])
                  }}
                  onBlur={() => setTimeout(() => setCompanyDrop([]), 150)}
                  autoComplete="off"
                />
                {companyDrop.length > 0 && (
                  <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {companyDrop.map((c) => (
                      <li key={c.id} onMouseDown={() => {
                        setForm((f) => ({ ...f, company: c.name, address: c.address || f.address }))
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
                <label className="label">Ubicación / Dirección</label>
                <input name="address" className="input" style={{fontSize:'16px'}} value={form.address}
                  onChange={handleChange} placeholder="Ej: Calle 50, Edificio Torre Global, Of. 12" />
              </div>
              {(form.role === 'client' || !form.role) && categories.length > 0 && (
                <div>
                  <label className="label">Categoría de cliente</label>
                  <select name="client_category_id" className="input" style={{fontSize:'16px'}}
                    value={form.client_category_id} onChange={handleChange}>
                    <option value="">Sin categoría</option>
                    {categories.filter(c => c.is_active).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setIsDirty(false); setShowModal(false) }} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

// ── Categories tab ─────────────────────────────────────────────────────────
function CategoriesTab() {
  const [cats, setCats]       = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm]       = useState(EMPTY_CAT)
  const [saving, setSaving]   = useState(false)

  const fetchCats = () =>
    getClientCategories()
      .then(r => setCats(r.data))
      .catch(() => toast.error('Error cargando categorías'))
      .finally(() => setLoading(false))

  useEffect(() => { fetchCats() }, [])

  const openCreate = () => { setEditing(null); setForm(EMPTY_CAT); setShowForm(true) }
  const openEdit   = (c) => {
    setEditing(c)
    setForm({ name: c.name, color: c.color, description: c.description || '', order: c.order })
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Ingresa un nombre')
    setSaving(true)
    try {
      const payload = { ...form, order: Number(form.order) || 0 }
      if (editing) { await updateClientCategory(editing.id, payload); toast.success('Categoría actualizada') }
      else          { await createClientCategory(payload);             toast.success('Categoría creada') }
      setShowForm(false)
      fetchCats()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error guardando') }
    finally { setSaving(false) }
  }

  const handleDelete = async (c) => {
    if (!await showConfirm(`¿Eliminar la categoría "${c.name}"?`)) return
    try { await deleteClientCategory(c.id); toast.success('Categoría eliminada'); fetchCats() }
    catch (err) { toast.error(err.response?.data?.detail || 'Error al eliminar') }
  }

  const toggleActive = async (c) => {
    try {
      await updateClientCategory(c.id, { is_active: !c.is_active })
      setCats(prev => prev.map(x => x.id === c.id ? { ...x, is_active: !c.is_active } : x))
    } catch { toast.error('Error') }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Define niveles de servicio: Premium, Estándar, VIP, etc.</p>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors">
          <Plus size={15} /> Nueva categoría
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500">Cargando...</div>
      ) : cats.length === 0 ? (
        <div className="text-center py-20">
          <Tag size={40} className="mx-auto mb-3 text-gray-200" />
          <p className="text-gray-400 font-medium">Sin categorías todavía</p>
          <p className="text-sm text-gray-400 mt-1">Crea la primera para asignarla a tus clientes</p>
          <button onClick={openCreate} className="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium">
            Crear categoría
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">NOMBRE</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">DESCRIPCIÓN</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ORDEN</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ESTADO</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {cats.map(c => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                      <span className="font-medium text-gray-900">{c.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: c.color }}>
                        {c.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.description || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.order}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.is_active ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleActive(c)} title={c.is_active ? 'Desactivar' : 'Activar'}
                        className={`p-1.5 rounded transition-colors ${c.is_active ? 'hover:bg-gray-200 text-gray-400' : 'hover:bg-green-100 text-gray-300 hover:text-green-600'}`}>
                        <Check size={14} />
                      </button>
                      <button onClick={() => openEdit(c)} className="p-1.5 hover:bg-gray-200 rounded text-gray-500">
                        <Edit size={14} />
                      </button>
                      <button onClick={() => handleDelete(c)} className="p-1.5 hover:bg-red-100 rounded text-gray-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-semibold text-gray-900">{editing ? 'Editar categoría' : 'Nueva categoría'}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="label">Nombre *</label>
                <input className="input" style={{ fontSize: '16px' }} value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Premium, Estándar, VIP..." required />
              </div>
              <div>
                <label className="label">Descripción</label>
                <input className="input" style={{ fontSize: '16px' }} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Descripción breve (opcional)" />
              </div>
              <div>
                <label className="label">Color</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {CAT_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                  <input type="color" value={form.color}
                    onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    className="w-7 h-7 rounded-full border border-gray-300 cursor-pointer overflow-hidden p-0"
                    title="Color personalizado" />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: form.color }}>
                    {form.name || 'Vista previa'}
                  </span>
                  <span className="text-xs text-gray-400">Vista previa</span>
                </div>
              </div>
              <div>
                <label className="label">Orden</label>
                <input type="number" className="input" style={{ fontSize: '16px' }} value={form.order}
                  onChange={e => setForm(f => ({ ...f, order: e.target.value }))} placeholder="0" min="0" />
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  <Save size={14} />{saving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
