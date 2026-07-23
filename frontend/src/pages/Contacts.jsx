import { showConfirm } from '../utils/confirm'
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import {
  getContacts, createContact, updateContact, deleteContact, getClientTickets, updateUser, deleteUser,
  getCompanies, createCompany, updateCompany, deleteCompany, createUser, getClientCategories,
} from '../services/api'
import {
  Phone, Mail, Building2, MapPin, FileText, Hash,
  Plus, Search, X, Edit2, Trash2, Ticket,
  ExternalLink, Users, UserPlus, ChevronDown, ArrowLeft, KeyRound, Eye, EyeOff, UserCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import { useFormGuard } from '../context/UnsavedChangesContext'

const PRIORITY_COLORS = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}
const PRIORITY_LABELS = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' }
const EMPTY_FORM = { name: '', email: '', phone: '', company: '', ruc: '', address: '', notes: '' }

export default function Contacts() {
  const { isAgentOrAdmin } = useAuth()
  const navigate = useNavigate()
  const [isDirty, setIsDirty] = useState(false)
  useFormGuard(isDirty)

  const [activeTab, setActiveTab] = useState('contacts') // 'contacts' | 'companies'
  const [allContacts, setAllContacts] = useState([])
  const [dbCompanies, setDbCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [clientTickets, setClientTickets] = useState([])
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const detailSwipe = useTouchSwipe({ onSwipeRight: () => setMobileDetailOpen(false) })
  const [showCompanySuggestions, setShowCompanySuggestions] = useState(false)

  // Company edit modal
  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [companyForm, setCompanyForm] = useState({ name: '', ruc: '', address: '', phone: '', email: '', notes: '', client_category_id: '' })
  const [editingCompanyId, setEditingCompanyId] = useState(null) // null = create, number = update
  const [savingCompany, setSavingCompany] = useState(false)
  const [clientCategories, setClientCategories] = useState([])

  // Edit modal for system clients (phone/company/address only)
  const [showClientModal, setShowClientModal] = useState(false)
  const [clientEditTarget, setClientEditTarget] = useState(null)
  const [clientForm, setClientForm] = useState({ name: '', email: '', phone: '', company: '', address: '', role: 'client', client_category_id: '' })
  const [savingClient, setSavingClient] = useState(false)
  const [clientCompanyDrop, setClientCompanyDrop] = useState([])
  const [clientPassword, setClientPassword] = useState('')
  const [clientPasswordConfirm, setClientPasswordConfirm] = useState('')
  const [showClientPwd, setShowClientPwd] = useState(false)

  // Password section for manual contact → system account conversion (edit modal)
  const [contactPassword, setContactPassword] = useState('')
  const [contactPasswordConfirm, setContactPasswordConfirm] = useState('')
  const [showContactPwd, setShowContactPwd] = useState(false)

  // Dedicated promote modal
  const [showPromoteModal, setShowPromoteModal] = useState(false)
  const [promoteTarget, setPromoteTarget] = useState(null)
  const [promotePassword, setPromotePassword] = useState('')
  const [promotePasswordConfirm, setPromotePasswordConfirm] = useState('')
  const [showPromotePwd, setShowPromotePwd] = useState(false)
  const [promoting, setPromoting] = useState(false)

  const openPromote = (c) => {
    setPromoteTarget(c)
    setPromotePassword('')
    setPromotePasswordConfirm('')
    setShowPromotePwd(false)
    setShowPromoteModal(true)
  }

  const handlePromote = async (e) => {
    e.preventDefault()
    if (!promoteTarget.email?.trim()) return toast.error('El contacto necesita un email para crear la cuenta')
    if (promotePassword.length < 6) return toast.error('La contraseña debe tener al menos 6 caracteres')
    if (promotePassword !== promotePasswordConfirm) return toast.error('Las contraseñas no coinciden')
    setPromoting(true)
    try {
      await createUser({
        name: promoteTarget.name,
        email: promoteTarget.email,
        password: promotePassword,
        role: 'client',
        phone: promoteTarget.phone || null,
        company: promoteTarget.company || null,
        address: promoteTarget.address || null,
      })
      await deleteContact(promoteTarget.id)
      toast.success(`${promoteTarget.name} ahora es un cliente del sistema`)
      setShowPromoteModal(false)
      if (selected?.id === promoteTarget.id && selected?.source === 'contact') setSelected(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al promover el contacto')
    } finally {
      setPromoting(false)
    }
  }

  const load = useCallback(() => {
    setLoading(true)
    Promise.allSettled([getContacts(), getCompanies(), getClientCategories()])
      .then(([cr, comr, catr]) => {
        if (cr.status === 'fulfilled') setAllContacts(cr.value.data)
        else toast.error('Error cargando contactos')
        if (comr.status === 'fulfilled') setDbCompanies(comr.value.data)
        if (catr.status === 'fulfilled') setClientCategories(catr.value.data.filter((c) => c.is_active))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Unique company names for filter dropdown
  const companies = useMemo(() => {
    const set = new Set(allContacts.map((c) => c.company).filter(Boolean))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [allContacts])

  // Aggregated company data: DB companies take precedence, contacts fill the rest
  const companiesData = useMemo(() => {
    const map = new Map() // key: lowercase name
    // Seed from DB companies (canonical data)
    dbCompanies.forEach((co) => {
      map.set(co.name.toLowerCase(), { ...co, contacts: [], fromDB: true })
    })
    // Merge contacts
    allContacts.forEach((c) => {
      if (!c.company) return
      const key = c.company.toLowerCase()
      if (!map.has(key)) {
        map.set(key, { name: c.company, ruc: '', address: '', phone: '', email: '', notes: '', contacts: [], fromDB: false })
      }
      const co = map.get(key)
      co.contacts.push(c)
      if (!co.fromDB) {
        if (!co.ruc && c.ruc) co.ruc = c.ruc
        if (!co.address && c.address) co.address = c.address
        if (!co.phone && c.phone) co.phone = c.phone
        if (!co.email && c.email) co.email = c.email
      }
    })
    return Array.from(map.values()).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  }, [allContacts, dbCompanies])

  const filteredCompanies = useMemo(() => {
    if (!search) return companiesData
    const q = search.toLowerCase()
    return companiesData.filter((co) =>
      co.name.toLowerCase().includes(q) || co.ruc?.toLowerCase().includes(q)
    )
  }, [companiesData, search])

  // For new-contact form: company name → {ruc, address, phone, email} lookup
  const companyData = useMemo(() => {
    const map = new Map()
    companiesData.forEach((co) => map.set(co.name, { address: co.address || '', ruc: co.ruc || '', phone: co.phone || '', email: co.email || '' }))
    return map
  }, [companiesData])

  // company name (lowercase) → client_category for manual contacts
  const companyCategoryMap = useMemo(() => {
    const map = new Map()
    dbCompanies.forEach((co) => { if (co.client_category) map.set(co.name.toLowerCase(), co.client_category) })
    return map
  }, [dbCompanies])

  const defaultCategory = useMemo(() => clientCategories.find((c) => c.name === 'Estándar') || clientCategories[0] || null, [clientCategories])

  // Duplicate detection for the create/edit contact form
  const emailConflict = useMemo(() => {
    const email = form.email.trim().toLowerCase()
    if (!email) return null
    const match = allContacts.find((c) => {
      if (editing && c.source === 'contact' && c.id === editing.id) return false
      return (c.email || '').toLowerCase() === email
    })
    if (!match) return null
    const label = match.source === 'client' ? 'cliente del sistema' : match.source === 'agent' ? 'agente' : 'contacto manual'
    return `Ya existe un ${label} con ese email: ${match.name}`
  }, [form.email, allContacts, editing])

  const nameConflict = useMemo(() => {
    const name = form.name.trim().toLowerCase()
    const company = form.company.trim().toLowerCase()
    if (!name) return null
    const match = allContacts.find((c) => {
      if (editing && c.source === 'contact' && c.id === editing.id) return false
      const sameName = (c.name || '').toLowerCase() === name
      const sameCompany = !company || (c.company || '').toLowerCase() === company
      return sameName && sameCompany
    })
    if (!match) return null
    const label = match.source === 'client' ? 'cliente del sistema' : match.source === 'agent' ? 'agente' : 'contacto manual'
    return `Ya existe un ${label} con ese nombre: ${match.name}`
  }, [form.name, form.company, allContacts, editing])

  const contactCategory = (c) =>
    c.client_category ||
    (c.company ? companyCategoryMap.get(c.company.toLowerCase()) : null) ||
    defaultCategory

  const companySuggestions = useMemo(() => {
    const q = form.company.trim().toLowerCase()
    if (!q || !showCompanySuggestions) return []
    const results = []
    for (const [name, data] of companyData) {
      if (name.toLowerCase().includes(q)) results.push({ name, ...data })
      if (results.length >= 6) break
    }
    return results
  }, [form.company, showCompanySuggestions, companyData])

  // Filtered contacts list
  const contacts = useMemo(() => {
    const q = search.toLowerCase()
    return allContacts.filter((c) => {
      const matchSearch = !q || [c.name, c.email, c.company, c.phone].some((f) => f?.toLowerCase().includes(q))
      const matchCompany = !companyFilter || c.company === companyFilter
      return matchSearch && matchCompany
    })
  }, [allContacts, search, companyFilter])

  const handleSelect = (c) => {
    setSelected(c)
    setSelectedCompany(null)
    setMobileDetailOpen(true)
    if (c.source === 'client') {
      setTicketsLoading(true)
      setClientTickets([])
      getClientTickets(c.id)
        .then((r) => setClientTickets(r.data))
        .catch(() => {})
        .finally(() => setTicketsLoading(false))
    } else {
      setClientTickets([])
      setTicketsLoading(false)
    }
  }

  const handleSelectCompany = (co) => {
    setSelectedCompany(co)
    setSelected(null)
    setMobileDetailOpen(true)
  }

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowModal(true) }

  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setSearchParams({}, { replace: true })
      openCreate()
    }
  }, []) // eslint-disable-line

  // Auto-select contact when navigated from a ticket (e.g. /contacts?contact_id=42)
  useEffect(() => {
    const contactIdParam = searchParams.get('contact_id')
    if (!contactIdParam || allContacts.length === 0) return
    const found = allContacts.find(
      (c) => c.source === 'contact' && c.id === parseInt(contactIdParam, 10)
    )
    if (found) {
      handleSelect(found)
      setSearchParams({}, { replace: true })
    }
  }, [allContacts]) // eslint-disable-line

  const openEdit = (c, e) => {
    e?.stopPropagation()
    setEditing(c)
    setForm({ name: c.name, email: c.email, phone: c.phone, company: c.company, ruc: c.ruc || '', address: c.address, notes: c.notes })
    setContactPassword('')
    setContactPasswordConfirm('')
    setShowContactPwd(false)
    setShowModal(true)
  }

  const openClientEdit = (c, e) => {
    e?.stopPropagation()
    setClientEditTarget(c)
    setClientForm({ name: c.name || '', email: c.email || '', phone: c.phone || '', company: c.company || '', address: c.address || '', role: c.role || 'client', client_category_id: c.client_category_id || '' })
    setClientPassword('')
    setClientPasswordConfirm('')
    setShowClientPwd(false)
    setShowClientModal(true)
  }

  const openCompanyEdit = (co) => {
    setEditingCompanyId(co.fromDB ? co.id : null)
    setCompanyForm({
      name: co.name,
      ruc: co.ruc || '',
      address: co.address || '',
      phone: co.phone || '',
      email: co.email || '',
      notes: co.notes || '',
      client_category_id: co.client_category_id || '',
    })
    setShowCompanyModal(true)
  }

  const handleCompanySave = async (e) => {
    e.preventDefault()
    if (!companyForm.name.trim()) return toast.error('El nombre es requerido')
    setSavingCompany(true)
    const payload = { ...companyForm, client_category_id: companyForm.client_category_id || null }
    try {
      let saved
      if (editingCompanyId) {
        const r = await updateCompany(editingCompanyId, payload)
        saved = r.data
        setDbCompanies((prev) => prev.map((c) => c.id === editingCompanyId ? saved : c))
        if (selectedCompany?.id === editingCompanyId) {
          setSelectedCompany((prev) => ({ ...prev, ...saved, contacts: prev.contacts }))
        }
        toast.success('Empresa actualizada')
      } else {
        const r = await createCompany(payload)
        saved = r.data
        setDbCompanies((prev) => [saved, ...prev])
        toast.success('Empresa guardada')
      }
      setIsDirty(false)
      setShowCompanyModal(false)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error guardando empresa')
    } finally {
      setSavingCompany(false)
    }
  }

  const handleCompanyDelete = async (co) => {
    if (!co.fromDB) return
    if (!await showConfirm(`¿Eliminar la empresa "${co.name}" de la base de datos?`)) return
    try {
      await deleteCompany(co.id)
      setDbCompanies((prev) => prev.filter((c) => c.id !== co.id))
      if (selectedCompany?.id === co.id) setSelectedCompany(null)
      toast.success('Empresa eliminada')
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('El nombre es requerido')
    if (emailConflict) return toast.error(emailConflict)
    if (nameConflict) return toast.error(nameConflict)
    if (contactPassword) {
      if (contactPassword.length < 6) return toast.error('La contraseña debe tener al menos 6 caracteres')
      if (contactPassword !== contactPasswordConfirm) return toast.error('Las contraseñas no coinciden')
      if (!form.email.trim()) return toast.error('Se requiere un email para crear la cuenta de acceso')
    }
    setSaving(true)
    try {
      if (editing) {
        const r = await updateContact(editing.id, form)
        if (contactPassword) {
          // Convert contact to system client account
          await createUser({
            name: form.name,
            email: form.email,
            password: contactPassword,
            role: 'client',
            phone: form.phone || null,
            company: form.company || null,
            address: form.address || null,
          })
          await deleteContact(editing.id)
          toast.success('Cuenta de acceso creada. El contacto ahora es un cliente del sistema.')
          load()
          if (selected?.id === editing.id && selected?.source === 'contact') setSelected(null)
        } else {
          setAllContacts((prev) => prev.map((c) => (c.source === 'contact' && c.id === editing.id ? r.data : c)))
          if (selected?.id === editing.id && selected?.source === 'contact') setSelected(r.data)
          toast.success('Contacto actualizado')
        }
      } else {
        const r = await createContact(form)
        setAllContacts((prev) => [r.data, ...prev])
        toast.success('Contacto creado')
      }
      setIsDirty(false)
      setShowModal(false)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error guardando contacto')
    } finally {
      setSaving(false)
    }
  }

  const handleClientSave = async (e) => {
    e.preventDefault()
    if (clientPassword) {
      if (clientPassword.length < 6) return toast.error('La contraseña debe tener al menos 6 caracteres')
      if (clientPassword !== clientPasswordConfirm) return toast.error('Las contraseñas no coinciden')
    }
    setSavingClient(true)
    try {
      const newCatId = clientForm.client_category_id ? parseInt(clientForm.client_category_id) : null
      const payload = { ...clientForm, client_category_id: newCatId }
      if (clientPassword) payload.password = clientPassword
      await updateUser(clientEditTarget.id, payload)
      const newSource = clientForm.role === 'client' ? 'client' : 'agent'
      const newCat = newCatId ? clientCategories.find((c) => c.id === newCatId) : null
      const updated = {
        ...clientEditTarget, ...clientForm, source: newSource,
        client_category_id: newCatId,
        client_category: newCat ? { id: newCat.id, name: newCat.name, color: newCat.color } : null,
      }
      setAllContacts((prev) => prev.map((c) =>
        (c.id === clientEditTarget.id && (c.source === 'client' || c.source === 'agent')) ? updated : c
      ))
      if (selected?.id === clientEditTarget.id) setSelected(updated)
      toast.success(clientPassword ? 'Datos y contraseña actualizados' : 'Datos actualizados')
      setIsDirty(false)
      setShowClientModal(false)
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSavingClient(false)
    }
  }

  const handleClientDeactivate = async () => {
    const label = clientEditTarget?.source === 'agent' ? 'agente' : 'cliente'
    if (!await showConfirm(`¿Desactivar la cuenta de "${clientEditTarget?.name}"? El usuario no podrá iniciar sesión.`)) return
    try {
      await updateUser(clientEditTarget.id, { is_active: false })
      setAllContacts((prev) => prev.filter((c) => !(c.id === clientEditTarget.id && (c.source === 'client' || c.source === 'agent'))))
      if (selected?.id === clientEditTarget.id) setSelected(null)
      setShowClientModal(false)
      toast.success(`Cuenta de ${label} desactivada`)
    } catch {
      toast.error('Error al desactivar')
    }
  }

  const handleClientDelete = async () => {
    const label = clientEditTarget?.source === 'agent' ? 'agente' : 'cliente'
    if (!await showConfirm(`¿Eliminar al ${label} "${clientEditTarget?.name}" del sistema? Esta acción no se puede deshacer.`)) return
    try {
      await deleteUser(clientEditTarget.id)
      setAllContacts((prev) => prev.filter((c) => !(c.id === clientEditTarget.id && (c.source === 'client' || c.source === 'agent'))))
      if (selected?.id === clientEditTarget.id) setSelected(null)
      setShowClientModal(false)
      toast.success(`${label.charAt(0).toUpperCase() + label.slice(1)} eliminado`)
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const handleDelete = async (c, e) => {
    e?.stopPropagation()
    if (!await showConfirm(`¿Eliminar el contacto "${c.name}"?`)) return
    try {
      await deleteContact(c.id)
      setAllContacts((prev) => prev.filter((x) => !(x.source === 'contact' && x.id === c.id)))
      if (selected?.id === c.id && selected?.source === 'contact') setSelected(null)
      toast.success('Contacto eliminado')
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const clearFilters = () => { setSearch(''); setCompanyFilter('') }
  const hasFilters = search || companyFilter
  const initials = (name) => name?.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const avatarColor = (source) =>
    source === 'client' ? 'bg-blue-600' : source === 'agent' ? 'bg-violet-600' : 'bg-emerald-600'
  const roleLabel = (c) =>
    c.source === 'client' ? 'Cliente' : c.source === 'agent' ? (c.role === 'ventas' ? 'Ventas' : 'Agente') : null

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Lista lateral */}
      <div className={`${mobileDetailOpen ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 flex-shrink-0 border-r border-gray-200 flex-col bg-white`}>
        {/* Header */}
        <div className="p-4 border-b border-gray-200 space-y-2.5">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">Contactos</h1>
            <button onClick={openCreate} className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3">
              <Plus size={14} /> Nuevo
            </button>
          </div>

          {/* Tab switcher */}
          <div className="flex rounded-lg bg-gray-100 p-0.5 gap-0.5">
            <button
              onClick={() => setActiveTab('contacts')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'contacts' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Users size={13} /> Contactos
            </button>
            <button
              onClick={() => { setActiveTab('companies'); setSelected(null) }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'companies' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Building2 size={13} /> Empresas
              {companiesData.length > 0 && (
                <span className="bg-gray-200 text-gray-600 rounded-full px-1.5 text-xs leading-4">{companiesData.length}</span>
              )}
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-8 text-sm"
              style={{fontSize:'16px'}}
              placeholder={activeTab === 'contacts' ? 'Nombre, email, teléfono...' : 'Buscar empresa o RUC...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={13} />
              </button>
            )}
          </div>

          {activeTab === 'contacts' && (
            <>
              <div className="relative">
                <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <select
                  className="input pl-8 text-sm appearance-none pr-7"
                  style={{fontSize:'16px'}}
                  value={companyFilter}
                  onChange={(e) => setCompanyFilter(e.target.value)}
                >
                  <option value="">Todas las empresas</option>
                  {companies.map((co) => <option key={co} value={co}>{co}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex gap-3 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Cliente</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-500 inline-block" /> Agente</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Manual</span>
                </div>
                {hasFilters && (
                  <button onClick={clearFilters} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                    <X size={11} /> Limpiar
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400">
                {contacts.length} de {allContacts.length} contacto{allContacts.length !== 1 ? 's' : ''}
                {companyFilter && <span className="text-blue-600"> · {companyFilter}</span>}
              </p>
            </>
          )}

          {activeTab === 'companies' && (
            <p className="text-xs text-gray-400">{filteredCompanies.length} empresa{filteredCompanies.length !== 1 ? 's' : ''}</p>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {loading ? (
            <div className="p-6 text-center text-gray-400 text-sm">Cargando...</div>
          ) : activeTab === 'contacts' ? (
            contacts.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">
                {hasFilters ? 'Sin resultados para los filtros aplicados' : 'No hay contactos aún'}
              </div>
            ) : contacts.map((c) => (
              <div
                key={`${c.source}-${c.id}`}
                className={`group flex items-center gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  selected?.id === c.id && selected?.source === c.source ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                }`}
              >
                <button onClick={() => handleSelect(c)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <div className={`w-9 h-9 rounded-full ${avatarColor(c.source)} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                    {initials(c.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                      {isAgentOrAdmin && contactCategory(c) && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium text-white flex-shrink-0" style={{ backgroundColor: contactCategory(c).color }}>
                          {contactCategory(c).name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 truncate">{c.company || c.email || '—'}</p>
                  </div>
                </button>
                {c.ticket_count > 0 && (
                  <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 flex-shrink-0">{c.ticket_count}</span>
                )}
                {c.source === 'contact' && isAgentOrAdmin && (
                  <div className="flex gap-1 flex-shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => openEdit(c, e)} title="Editar" className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 active:bg-blue-100 transition-colors">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={(e) => handleDelete(c, e)} title="Eliminar" className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 active:bg-red-100 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))
          ) : (
            // Companies tab
            filteredCompanies.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">
                {search ? 'Sin resultados' : 'No hay empresas registradas aún'}
              </div>
            ) : filteredCompanies.map((co) => (
              <button
                key={co.name}
                onClick={() => handleSelectCompany(co)}
                className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left ${
                  selectedCompany?.name === co.name ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                }`}
              >
                <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white flex-shrink-0">
                  <Building2 size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-medium text-gray-900 truncate">{co.name}</p>
                    {co.client_category && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium text-white flex-shrink-0" style={{ backgroundColor: co.client_category.color }}>
                        {co.client_category.name}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    {co.contacts.length} contacto{co.contacts.length !== 1 ? 's' : ''}
                    {co.ruc ? ` · ${co.ruc}` : ''}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className={`${mobileDetailOpen ? 'flex' : 'hidden sm:flex'} flex-1 flex-col overflow-y-auto overscroll-contain min-h-0 bg-gray-50`} {...detailSwipe}>
        {selectedCompany ? (
          <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5 w-full">
            <button onClick={() => setMobileDetailOpen(false)} className="sm:hidden flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 -mb-1">
              <ArrowLeft size={16} /> Volver a la lista
            </button>
            <div className="card flex items-start gap-4">
              <div className="w-16 h-16 rounded-xl bg-indigo-600 flex items-center justify-center text-white flex-shrink-0">
                <Building2 size={28} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{selectedCompany.name}</h2>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <span className={`badge text-xs ${selectedCompany.fromDB ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>
                        {selectedCompany.fromDB ? 'Empresa registrada' : 'Derivada de contactos'}
                      </span>
                      {selectedCompany.client_category && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: selectedCompany.client_category.color }}>
                          {selectedCompany.client_category.name}
                        </span>
                      )}
                    </div>
                  </div>
                  {isAgentOrAdmin && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => openCompanyEdit(selectedCompany)} className="btn-secondary text-sm flex items-center gap-1.5">
                        <Edit2 size={13} /> {selectedCompany.fromDB ? 'Editar' : 'Registrar'}
                      </button>
                      {selectedCompany.fromDB && (
                        <button onClick={() => handleCompanyDelete(selectedCompany)} className="btn-secondary text-sm text-red-600 hover:bg-red-50 flex items-center gap-1.5">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {(selectedCompany.ruc || selectedCompany.phone || selectedCompany.email || selectedCompany.address) && (
              <div className="card space-y-3">
                <h3 className="font-semibold text-gray-900 text-sm">Información</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedCompany.ruc && <InfoRow icon={Hash} label="RUC" value={selectedCompany.ruc} />}
                  {selectedCompany.phone && <InfoRow icon={Phone} label="Teléfono" value={selectedCompany.phone} />}
                  {selectedCompany.email && <InfoRow icon={Mail} label="Email" value={selectedCompany.email} />}
                  {selectedCompany.address && <InfoRow icon={MapPin} label="Dirección" value={selectedCompany.address} />}
                </div>
                {!selectedCompany.fromDB && <p className="text-xs text-gray-400">Datos tomados de los contactos vinculados · Registra la empresa para editarlos</p>}
              </div>
            )}

            <div className="card space-y-3">
              <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                <Users size={14} className="text-gray-400" />
                Contactos vinculados
                <span className="bg-indigo-100 text-indigo-700 text-xs rounded-full px-2 py-0.5">{selectedCompany.contacts.length}</span>
              </h3>
              <div className="space-y-2">
                {selectedCompany.contacts.map((c) => (
                  <button
                    key={`${c.source}-${c.id}`}
                    onClick={() => { setActiveTab('contacts'); handleSelect(c) }}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className={`w-8 h-8 rounded-full ${avatarColor(c.source)} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                      {initials(c.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{c.name}</p>
                      {c.email && <p className="text-xs text-gray-400 truncate">{c.email}</p>}
                    </div>
                    <span className={`badge text-xs flex-shrink-0 ${c.source === 'client' ? 'bg-blue-100 text-blue-700' : c.source === 'agent' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {c.source === 'client' ? 'Cliente' : c.source === 'agent' ? (c.role === 'ventas' ? 'Ventas' : 'Agente') : 'Manual'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : selected ? (
          <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5 w-full">
            <button onClick={() => setMobileDetailOpen(false)} className="sm:hidden flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 -mb-1">
              <ArrowLeft size={16} /> Volver a la lista
            </button>
            <div className="card flex items-start gap-4">
              <div className={`w-16 h-16 rounded-xl ${avatarColor(selected.source)} flex items-center justify-center text-white text-xl font-bold flex-shrink-0`}>
                {initials(selected.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{selected.name}</h2>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <span className={`badge text-xs ${selected.source === 'client' ? 'bg-blue-100 text-blue-700' : selected.source === 'agent' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {selected.source === 'client' ? 'Cliente · Sistema' : selected.source === 'agent' ? `${roleLabel(selected)} · Sistema` : 'Contacto manual'}
                      </span>
                      {isAgentOrAdmin && contactCategory(selected) && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: contactCategory(selected).color }}>
                          {contactCategory(selected).name}
                        </span>
                      )}
                    </div>
                  </div>
                  {isAgentOrAdmin && (
                    <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                      {selected.source === 'contact' ? (
                        <>
                          <button onClick={() => openPromote(selected)} className="btn-secondary text-sm flex items-center gap-1.5 text-blue-600 hover:bg-blue-50 border-blue-200">
                            <UserCheck size={13} /> Promover
                          </button>
                          <button onClick={(e) => openEdit(selected, e)} className="btn-secondary text-sm flex items-center gap-1.5">
                            <Edit2 size={13} /> Editar
                          </button>
                          <button onClick={(e) => handleDelete(selected, e)} className="btn-secondary text-sm text-red-600 hover:bg-red-50 flex items-center gap-1.5">
                            <Trash2 size={13} />
                          </button>
                        </>
                      ) : (
                        <button onClick={(e) => openClientEdit(selected, e)} className="btn-secondary text-sm flex items-center gap-1.5">
                          <Edit2 size={13} /> Editar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="card space-y-3">
              <h3 className="font-semibold text-gray-900 text-sm">Información de contacto</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <InfoRow icon={Mail} label="Email" value={selected.email || '—'} />
                <InfoRow icon={Phone} label="Teléfono" value={selected.phone || '—'} />
                <InfoRow icon={Building2} label="Empresa" value={selected.company || '—'} />
                {selected.ruc && <InfoRow icon={Hash} label="RUC" value={selected.ruc} />}
                {selected.address && <InfoRow icon={MapPin} label="Dirección" value={selected.address} />}
              </div>
              {selected.company && (
                <button
                  onClick={() => { setCompanyFilter(selected.company); setSelected(null) }}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1 pt-1"
                >
                  <Building2 size={11} /> Ver todos los contactos de "{selected.company}"
                </button>
              )}
              {selected.notes && (
                <div className="pt-2 border-t border-gray-100">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText size={13} className="text-gray-400" />
                    <span className="text-xs text-gray-400">Notas</span>
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}
            </div>

            {selected.source === 'client' && isAgentOrAdmin && (
              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/tickets/new?client_id=${selected.id}`)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
                >
                  <Plus size={14} /> Nuevo Ticket
                </button>
                <button
                  onClick={() => navigate(`/tickets?client_id=${selected.id}`)}
                  className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  <Ticket size={14} /> Ver todos
                </button>
              </div>
            )}

            {selected.source === 'client' && (
              <div className="card space-y-3">
                <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                  <Ticket size={14} className="text-gray-400" />
                  Tickets recientes
                  {selected.ticket_count > 0 && (
                    <span className="bg-blue-100 text-blue-700 text-xs rounded-full px-2 py-0.5">{selected.ticket_count}</span>
                  )}
                </h3>
                {ticketsLoading ? (
                  <p className="text-sm text-gray-400">Cargando tickets...</p>
                ) : clientTickets.length === 0 ? (
                  <p className="text-sm text-gray-400">Sin tickets registrados</p>
                ) : (
                  <div className="space-y-2">
                    {clientTickets.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => navigate(`/tickets/${t.id}`)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors text-left"
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.status?.color || '#6B7280' }} />
                        <span className="flex-1 text-sm text-gray-800 truncate">#{t.id} — {t.title}</span>
                        <span className={`badge text-xs ${PRIORITY_COLORS[t.priority] || 'bg-gray-100 text-gray-600'}`}>
                          {PRIORITY_LABELS[t.priority] || t.priority}
                        </span>
                        <ExternalLink size={12} className="text-gray-300 flex-shrink-0" />
                      </button>
                    ))}
                    {selected.ticket_count > 10 && (
                      <button onClick={() => navigate(`/tickets?client=${selected.id}`)} className="text-xs text-blue-600 hover:underline pt-1">
                        Ver todos los tickets →
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : companyFilter ? (
          <div className="p-4 sm:p-6 w-full">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0">
                <Building2 size={22} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-gray-900 truncate">{companyFilter}</h2>
                <p className="text-sm text-gray-400">{contacts.length} contacto{contacts.length !== 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => setCompanyFilter('')} className="text-xs text-blue-600 hover:underline flex-shrink-0">Ver todos</button>
            </div>
            <div className="space-y-2">
              {contacts.map((c) => (
                <button
                  key={`${c.source}-${c.id}`}
                  onClick={() => handleSelect(c)}
                  className="w-full flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all text-left group"
                >
                  <div className={`w-10 h-10 rounded-full ${avatarColor(c.source)} flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>
                    {initials(c.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">{c.name}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                      {c.email && <span className="flex items-center gap-1 text-xs text-gray-400"><Mail size={11} /> {c.email}</span>}
                      {c.phone && <span className="flex items-center gap-1 text-xs text-gray-400"><Phone size={11} /> {c.phone}</span>}
                    </div>
                  </div>
                  {c.ticket_count > 0 && (
                    <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 rounded-full px-2.5 py-1 flex-shrink-0 font-medium">
                      <Ticket size={11} /> {c.ticket_count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            {activeTab === 'companies'
              ? <Building2 size={48} className="mb-3 opacity-30" />
              : <Users size={48} className="mb-3 opacity-30" />}
            <p className="text-sm">
              {activeTab === 'companies' ? 'Selecciona una empresa para ver sus detalles' : 'Selecciona un contacto para ver sus detalles'}
            </p>
          </div>
        )}
      </div>

      {/* Modal: create/edit manual contact */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="font-bold text-gray-900 flex items-center gap-2">
                <UserPlus size={16} />
                {editing ? 'Editar contacto' : 'Nuevo contacto'}
              </h2>
              <button onClick={() => { setIsDirty(false); setShowModal(false) }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="label">Nombre *</label>
                <input className={`input ${nameConflict ? 'border-orange-400 focus:ring-orange-400' : ''}`} style={{fontSize:'16px'}} value={form.name} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, name: e.target.value })) }} placeholder="Nombre completo" required />
                {nameConflict && <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">⚠ {nameConflict}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Email</label>
                  <input type="email" className={`input ${emailConflict ? 'border-orange-400 focus:ring-orange-400' : ''}`} style={{fontSize:'16px'}} value={form.email} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, email: e.target.value })) }} placeholder="correo@ejemplo.com" />
                  {emailConflict && <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">⚠ {emailConflict}</p>}
                </div>
                <div>
                  <label className="label">Teléfono</label>
                  <input className="input" style={{fontSize:'16px'}} value={form.phone} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, phone: e.target.value })) }} placeholder="+507 6000-0000" />
                </div>
              </div>
              <div className="relative">
                <label className="label">Empresa</label>
                <input
                  className="input"
                  style={{fontSize:'16px'}}
                  value={form.company}
                  onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, company: e.target.value })) }}
                  placeholder="Nombre de la empresa"
                  autoComplete="off"
                  onFocus={() => setShowCompanySuggestions(true)}
                  onBlur={() => setTimeout(() => setShowCompanySuggestions(false), 150)}
                />
                {companySuggestions.length > 0 && (
                  <ul className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                    {companySuggestions.map((s) => (
                      <li key={s.name}>
                        <button
                          type="button"
                          onMouseDown={() => {
                            setForm((f) => ({ ...f, company: s.name, address: f.address || s.address, ruc: f.ruc || s.ruc || '', phone: f.phone || s.phone || '', email: f.email || s.email || '' }))
                            setShowCompanySuggestions(false)
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 transition-colors"
                        >
                          <p className="text-sm font-medium text-gray-900">{s.name}</p>
                          {s.ruc && <p className="text-xs text-gray-400">RUC: {s.ruc}</p>}
                          {s.address && <p className="text-xs text-gray-400 truncate">{s.address}</p>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <label className="label">RUC</label>
                <input className="input" style={{fontSize:'16px'}} value={form.ruc} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, ruc: e.target.value })) }} placeholder="RUC de la empresa" />
              </div>
              <div>
                <label className="label">Dirección</label>
                <input className="input" style={{fontSize:'16px'}} value={form.address} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, address: e.target.value })) }} placeholder="Dirección física" />
              </div>
              <div>
                <label className="label">Notas</label>
                <textarea className="input resize-none" style={{fontSize:'16px'}} rows={3} value={form.notes} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, notes: e.target.value })) }} placeholder="Notas adicionales..." />
              </div>

              {/* Password / account section — only when editing an existing manual contact */}
              {editing && (
                <div className="border border-dashed border-gray-300 rounded-lg p-4 space-y-3 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <KeyRound size={14} className="text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">Crear cuenta de acceso al sistema</span>
                  </div>
                  <p className="text-xs text-gray-400">Si ingresas una contraseña, este contacto se convertirá en un cliente con acceso al portal. El contacto manual será reemplazado por la cuenta de sistema.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="label">Nueva contraseña</label>
                      <div className="relative">
                        <input
                          type={showContactPwd ? 'text' : 'password'}
                          className="input pr-9"
                          style={{fontSize:'16px'}}
                          value={contactPassword}
                          onChange={(e) => setContactPassword(e.target.value)}
                          placeholder="Mínimo 6 caracteres"
                          autoComplete="new-password"
                        />
                        <button type="button" onClick={() => setShowContactPwd((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          {showContactPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="label">Confirmar contraseña</label>
                      <input
                        type={showContactPwd ? 'text' : 'password'}
                        className={`input ${contactPassword && contactPasswordConfirm && contactPassword !== contactPasswordConfirm ? 'border-red-400' : ''}`}
                        style={{fontSize:'16px'}}
                        value={contactPasswordConfirm}
                        onChange={(e) => setContactPasswordConfirm(e.target.value)}
                        placeholder="Repetir contraseña"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <div>
                  {editing && (
                    <button
                      type="button"
                      onClick={() => { setShowModal(false); handleDelete(editing) }}
                      className="btn-secondary text-red-600 hover:bg-red-50 flex items-center gap-1.5 text-sm"
                    >
                      <Trash2 size={13} /> Eliminar
                    </button>
                  )}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => { setIsDirty(false); setShowModal(false) }} className="btn-secondary">Cancelar</button>
                  <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear contacto'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: create/edit company */}
      {showCompanyModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="font-bold text-gray-900 flex items-center gap-2">
                <Building2 size={16} />
                {editingCompanyId ? 'Editar empresa' : 'Registrar empresa'}
              </h2>
              <button onClick={() => { setIsDirty(false); setShowCompanyModal(false) }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCompanySave} className="p-5 space-y-4">
              <div>
                <label className="label">Nombre *</label>
                <input className="input" style={{fontSize:'16px'}} value={companyForm.name} onChange={(e) => { setIsDirty(true); setCompanyForm((f) => ({ ...f, name: e.target.value })) }} placeholder="Nombre de la empresa" required />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">RUC</label>
                  <input className="input" style={{fontSize:'16px'}} value={companyForm.ruc} onChange={(e) => { setIsDirty(true); setCompanyForm((f) => ({ ...f, ruc: e.target.value })) }} placeholder="RUC" />
                </div>
                <div>
                  <label className="label">Teléfono</label>
                  <input className="input" style={{fontSize:'16px'}} value={companyForm.phone} onChange={(e) => { setIsDirty(true); setCompanyForm((f) => ({ ...f, phone: e.target.value })) }} placeholder="+507 000-0000" />
                </div>
              </div>
              <div>
                <label className="label">Email</label>
                <input type="email" className="input" style={{fontSize:'16px'}} value={companyForm.email} onChange={(e) => { setIsDirty(true); setCompanyForm((f) => ({ ...f, email: e.target.value })) }} placeholder="contacto@empresa.com" />
              </div>
              <div>
                <label className="label">Dirección</label>
                <input className="input" style={{fontSize:'16px'}} value={companyForm.address} onChange={(e) => { setIsDirty(true); setCompanyForm((f) => ({ ...f, address: e.target.value })) }} placeholder="Dirección física" />
              </div>
              <div>
                <label className="label">Notas</label>
                <textarea className="input resize-none" style={{fontSize:'16px'}} rows={2} value={companyForm.notes} onChange={(e) => { setIsDirty(true); setCompanyForm((f) => ({ ...f, notes: e.target.value })) }} placeholder="Notas adicionales..." />
              </div>
              {clientCategories.length > 0 && (
                <div>
                  <label className="label">Categoría de cliente</label>
                  <select
                    className="input"
                    style={{fontSize:'16px'}}
                    value={companyForm.client_category_id}
                    onChange={(e) => { setIsDirty(true); setCompanyForm((f) => ({ ...f, client_category_id: e.target.value ? parseInt(e.target.value) : '' })) }}
                  >
                    <option value="">Sin categoría</option>
                    {clientCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                  {companyForm.client_category_id && (
                    <p className="text-xs text-gray-500 mt-1">Los usuarios clientes de esta empresa heredarán esta categoría al guardar.</p>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between pt-2">
                <div>
                  {editingCompanyId && (
                    <button
                      type="button"
                      onClick={() => { setShowCompanyModal(false); handleCompanyDelete(selectedCompany || { id: editingCompanyId, name: companyForm.name, fromDB: true }) }}
                      className="btn-secondary text-red-600 hover:bg-red-50 flex items-center gap-1.5 text-sm"
                    >
                      <Trash2 size={13} /> Eliminar empresa
                    </button>
                  )}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => { setIsDirty(false); setShowCompanyModal(false) }} className="btn-secondary">Cancelar</button>
                  <button type="submit" disabled={savingCompany} className="btn-primary">
                    {savingCompany ? 'Guardando...' : editingCompanyId ? 'Guardar cambios' : 'Registrar empresa'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: promote manual contact to system client */}
      {showPromoteModal && promoteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="font-bold text-gray-900 flex items-center gap-2">
                <UserCheck size={16} className="text-blue-600" /> Promover a cliente del sistema
              </h2>
              <button onClick={() => setShowPromoteModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handlePromote} className="p-5 space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 space-y-1">
                <p className="text-sm font-semibold text-blue-900">{promoteTarget.name}</p>
                {promoteTarget.email
                  ? <p className="text-xs text-blue-700">{promoteTarget.email}</p>
                  : <p className="text-xs text-red-600 font-medium">⚠ Sin email — requerido para crear la cuenta</p>}
                {promoteTarget.company && <p className="text-xs text-blue-600">{promoteTarget.company}</p>}
              </div>
              <p className="text-xs text-gray-500">
                El contacto manual será eliminado y reemplazado por una cuenta de cliente en el sistema con acceso al portal.
              </p>
              {!promoteTarget.email && (
                <div>
                  <label className="label">Email *</label>
                  <input
                    type="email"
                    className="input"
                    style={{fontSize:'16px'}}
                    placeholder="correo@ejemplo.com"
                    value={promoteTarget.email || ''}
                    onChange={(e) => setPromoteTarget((p) => ({ ...p, email: e.target.value }))}
                    required
                  />
                </div>
              )}
              <div>
                <label className="label">Contraseña de acceso *</label>
                <div className="relative">
                  <input
                    type={showPromotePwd ? 'text' : 'password'}
                    className="input pr-9"
                    style={{fontSize:'16px'}}
                    value={promotePassword}
                    onChange={(e) => setPromotePassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    autoComplete="new-password"
                    autoFocus
                    required
                  />
                  <button type="button" onClick={() => setShowPromotePwd((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPromotePwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Confirmar contraseña *</label>
                <input
                  type={showPromotePwd ? 'text' : 'password'}
                  className={`input ${promotePassword && promotePasswordConfirm && promotePassword !== promotePasswordConfirm ? 'border-red-400' : ''}`}
                  style={{fontSize:'16px'}}
                  value={promotePasswordConfirm}
                  onChange={(e) => setPromotePasswordConfirm(e.target.value)}
                  placeholder="Repetir contraseña"
                  autoComplete="new-password"
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowPromoteModal(false)} className="btn-secondary">Cancelar</button>
                <button
                  type="submit"
                  disabled={promoting}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors text-sm"
                >
                  <UserCheck size={14} />
                  {promoting ? 'Promoviendo...' : 'Promover a cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: edit system user (client or agent) */}
      {showClientModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="font-bold text-gray-900 flex items-center gap-2">
                <Edit2 size={16} /> Editar usuario del sistema
              </h2>
              <button onClick={() => { setIsDirty(false); setShowClientModal(false) }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleClientSave} className="p-5 space-y-4">
              <div>
                <label className="label">Nombre *</label>
                <input className="input" style={{fontSize:'16px'}} value={clientForm.name} onChange={(e) => { setIsDirty(true); setClientForm((f) => ({ ...f, name: e.target.value })) }} placeholder="Nombre completo" required />
              </div>
              <div>
                <label className="label">Email</label>
                <input type="email" className="input" style={{fontSize:'16px'}} value={clientForm.email} onChange={(e) => { setIsDirty(true); setClientForm((f) => ({ ...f, email: e.target.value })) }} placeholder="correo@ejemplo.com" />
              </div>
              <div>
                <label className="label">Teléfono</label>
                <input className="input" style={{fontSize:'16px'}} value={clientForm.phone} onChange={(e) => { setIsDirty(true); setClientForm((f) => ({ ...f, phone: e.target.value })) }} placeholder="+507 6000-0000" />
              </div>
              <div className="relative">
                <label className="label">Empresa</label>
                <input className="input" style={{fontSize:'16px'}} value={clientForm.company}
                  onChange={(e) => {
                    const v = e.target.value
                    setIsDirty(true)
                    setClientForm((f) => ({ ...f, company: v }))
                    setClientCompanyDrop(v.trim() ? dbCompanies.filter((c) => c.name.toLowerCase().includes(v.toLowerCase())) : [])
                  }}
                  onBlur={() => setTimeout(() => setClientCompanyDrop([]), 150)}
                  placeholder="Nombre de la empresa" autoComplete="off" />
                {clientCompanyDrop.length > 0 && (
                  <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {clientCompanyDrop.map((c) => (
                      <li key={c.id} onMouseDown={() => {
                        setIsDirty(true)
                        setClientForm((f) => ({ ...f, company: c.name, address: c.address || f.address }))
                        setClientCompanyDrop([])
                      }} className="px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm">
                        <span className="font-medium">{c.name}</span>
                        {c.ruc && <span className="text-gray-400 ml-2 text-xs">RUC: {c.ruc}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <label className="label">Dirección</label>
                <input className="input" style={{fontSize:'16px'}} value={clientForm.address} onChange={(e) => { setIsDirty(true); setClientForm((f) => ({ ...f, address: e.target.value })) }} placeholder="Dirección física" />
              </div>
              <div>
                <label className="label">Rol en el sistema</label>
                <select className="input" style={{fontSize:'16px'}} value={clientForm.role} onChange={(e) => { setIsDirty(true); setClientForm((f) => ({ ...f, role: e.target.value })) }}>
                  <option value="client">Cliente</option>
                  <option value="agent">Agente</option>
                  <option value="ventas">Ventas</option>
                </select>
              </div>

              {clientForm.role === 'client' && clientCategories.length > 0 && (
                <div>
                  <label className="label">Categoría</label>
                  <select
                    className="input"
                    style={{fontSize:'16px'}}
                    value={clientForm.client_category_id}
                    onChange={(e) => { setIsDirty(true); setClientForm((f) => ({ ...f, client_category_id: e.target.value })) }}
                  >
                    <option value="">Sin categoría</option>
                    {clientCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Change password */}
              <div className="border border-dashed border-gray-300 rounded-lg p-4 space-y-3 bg-gray-50">
                <div className="flex items-center gap-2">
                  <KeyRound size={14} className="text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Cambiar contraseña</span>
                  <span className="text-xs text-gray-400">(opcional)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Nueva contraseña</label>
                    <div className="relative">
                      <input
                        type={showClientPwd ? 'text' : 'password'}
                        className="input pr-9"
                        style={{fontSize:'16px'}}
                        value={clientPassword}
                        onChange={(e) => setClientPassword(e.target.value)}
                        placeholder="Mínimo 6 caracteres"
                        autoComplete="new-password"
                      />
                      <button type="button" onClick={() => setShowClientPwd((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showClientPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="label">Confirmar</label>
                    <input
                      type={showClientPwd ? 'text' : 'password'}
                      className={`input ${clientPassword && clientPasswordConfirm && clientPassword !== clientPasswordConfirm ? 'border-red-400' : ''}`}
                      style={{fontSize:'16px'}}
                      value={clientPasswordConfirm}
                      onChange={(e) => setClientPasswordConfirm(e.target.value)}
                      placeholder="Repetir contraseña"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleClientDeactivate}
                    className="btn-secondary text-amber-600 hover:bg-amber-50 flex items-center gap-1.5 text-sm"
                  >
                    Desactivar cuenta
                  </button>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => { setIsDirty(false); setShowClientModal(false) }} className="btn-secondary">Cancelar</button>
                    <button type="submit" disabled={savingClient} className="btn-primary">
                      {savingClient ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClientDelete}
                  className="btn-secondary text-red-600 hover:bg-red-50 flex items-center gap-1.5 text-sm self-start"
                >
                  <Trash2 size={13} /> Eliminar usuario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
        <Icon size={13} className="text-gray-500" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-900 truncate">{value}</p>
      </div>
    </div>
  )
}
