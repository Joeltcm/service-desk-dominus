import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  getTicket, createTicket, updateTicket,
  getStatuses, getAgents, getClients, createUser, getCategories,
  getContacts, getCompanies, uploadAttachment,
} from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useFormGuard } from '../context/UnsavedChangesContext'
import { ArrowLeft, UserPlus, X, Mail, Phone, Building2, MapPin, Save, Calendar, Clock, Paperclip, FileText, AlertTriangle } from 'lucide-react'
import { toUTC, getFmtTz } from '../utils/fmt'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import toast from 'react-hot-toast'

const PRIORITIES = [
  { value: 'low',      label: 'Baja' },
  { value: 'medium',   label: 'Media' },
  { value: 'high',     label: 'Alta' },
  { value: 'critical', label: 'Crítica' },
]

const EMPTY_CLIENT = { name: '', email: '', phone: '', company: '', address: '', password: '' }

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function TicketForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, isAgentOrAdmin } = useAuth()

  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status_id: '',
    client_id: '',
    assigned_to_id: '',
    category: '',
    location: '',
    cc_email: '',
    scheduled_at: '',
  })
  const [statuses, setStatuses]     = useState([])
  const [agents, setAgents]         = useState([])
  const [clients, setClients]       = useState([])
  const [categories, setCategories] = useState([])
  const [contacts, setContacts]     = useState([])
  const [companies, setCompanies]   = useState([])
  const [loading, setLoading]       = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [isDirty, setIsDirty] = useState(false)
  useFormGuard(isDirty)

  // Pending attachments (uploaded after ticket creation)
  const [pendingFiles, setPendingFiles] = useState([])
  const fileInputRef = useRef(null)
  const dropZoneRef = useRef(null)

  const addFiles = (files) => {
    const MAX = 20 * 1024 * 1024
    const valid = files.filter((f) => f.size <= MAX)
    if (valid.length < files.length) toast.error('Algunos archivos exceden 20 MB y no se agregarán')
    if (!valid.length) return
    setPendingFiles((prev) => [
      ...prev,
      ...valid.map((f) => ({ file: f, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null })),
    ])
    setIsDirty(true)
  }

  const removePendingFile = (idx) => {
    setPendingFiles((prev) => {
      const next = [...prev]
      if (next[idx]?.preview) URL.revokeObjectURL(next[idx].preview)
      next.splice(idx, 1)
      return next
    })
  }

  const handleFileSelect = (e) => {
    addFiles(Array.from(e.target.files || []))
    e.target.value = ''
  }

  const handleDropZoneDrop = (e) => {
    e.preventDefault()
    dropZoneRef.current?.classList.remove('border-blue-400', 'bg-blue-50')
    addFiles(Array.from(e.dataTransfer.files))
  }

  const handlePasteOnDesc = (e) => {
    const imageItems = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith('image/'))
    if (!imageItems.length) return
    e.preventDefault()
    addFiles(imageItems.map((i) => i.getAsFile()).filter(Boolean))
  }

  // Modal nuevo cliente
  const [showClientModal, setShowClientModal] = useState(false)
  const [clientForm, setClientForm] = useState({ ...EMPTY_CLIENT, password: genPassword() })
  const [savingClient, setSavingClient] = useState(false)
  const [clientCompanyDrop, setClientCompanyDrop] = useState([])

  // Autocomplete cliente
  const [clientQuery, setClientQuery] = useState('')
  const [showClientDrop, setShowClientDrop] = useState(false)
  const clientInputRef = useRef(null)
  const resetClientQueryRef = useRef(null)

  const clientOptions = useMemo(() => {
    const q = clientQuery.trim().toLowerCase()

    // 1. Empresas primero — siempre visibles (hasta 4 sin query, hasta 3 con query)
    const matchCompany = (co) => !q || co.name?.toLowerCase().includes(q) || co.ruc?.toLowerCase().includes(q)
    const companyResults = companies
      .filter(matchCompany)
      .slice(0, q ? 3 : 4)
      .map((co) => ({ id: `co-${co.id}`, name: co.name, company: co.name, email: co.email, phone: co.phone, address: co.address, ruc: co.ruc, _source: 'company', _raw: co }))

    // 2. Usuarios — cuando hay query, también los que coinciden por empresa
    const matchUser = (c) => c.name?.toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)
    const userMatches = q ? clients.filter(matchUser) : clients
    const userResults = userMatches.slice(0, 6).map((c) => ({ ...c, _source: 'user' }))

    // 3. Contactos (solo al buscar) — excluir si ya aparece como Usuario por email o nombre
    const userEmails = new Set(userResults.map(u => (u.email || '').toLowerCase()).filter(Boolean))
    const userNames  = new Set(userResults.map(u => (u.name  || '').toLowerCase()).filter(Boolean))
    const contactResults = q
      ? contacts
          .filter((c) => c.name?.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q))
          .filter((c) => {
            const em = (c.email || '').toLowerCase()
            const nm = (c.name  || '').toLowerCase()
            return !(em && userEmails.has(em)) && !(nm && userNames.has(nm))
          })
          .slice(0, 4)
          .map((c) => ({ id: `c-${c.id}`, name: c.name, company: c.company, email: c.email, phone: c.phone, address: c.address, ruc: c.ruc, _source: 'contact', _raw: c }))
      : []

    // Orden: empresas → usuarios → contactos
    return [...companyResults, ...userResults, ...contactResults]
  }, [clientQuery, clients, contacts, companies])

  const selectClient = (c) => {
    setShowClientDrop(false)
    if (c._source === 'user') {
      setIsDirty(true)
      setForm((f) => ({ ...f, client_id: c.id, location: c.address || '' }))
      setClientQuery(c.name + (c.company ? ` — ${c.company}` : ''))
    } else {
      // Contact or company: pre-fill the "nuevo cliente" modal
      setClientForm({
        name: c.name || '',
        email: c.email || '',
        phone: c.phone || '',
        company: c.company || '',
        address: c.address || '',
        password: genPassword(),
      })
      setClientQuery(c.name || '')
      setShowClientModal(true)
    }
  }

  useEffect(() => {
    if (!form.client_id) { setClientQuery(''); return }
    const c = clients.find((c) => c.id === parseInt(form.client_id))
    if (c) setClientQuery(c.name + (c.company ? ` — ${c.company}` : ''))
  }, [form.client_id, clients])

  // Keep ref fresh so onBlur timeout can read latest values without stale closures
  useEffect(() => {
    const cid = form.client_id
    const cls = clients
    resetClientQueryRef.current = () => {
      if (!cid) { setClientQuery(''); return }
      const c = cls.find((c) => c.id === parseInt(cid))
      setClientQuery(c ? c.name + (c.company ? ` — ${c.company}` : '') : '')
    }
  }, [form.client_id, clients])

  // Cliente seleccionado (para mostrar sus detalles)
  const selectedClient = clients.find((c) => c.id === parseInt(form.client_id)) || null

  useEffect(() => {
    const promises = [getStatuses(), getCategories()]
    if (isAgentOrAdmin) promises.push(getAgents(), getClients())
    Promise.all(promises)
      .then(([statusRes, catRes, agentRes, clientRes]) => {
        setStatuses(statusRes.data)
        setCategories(catRes.data)
        if (agentRes) setAgents(agentRes.data)
        if (clientRes) setClients(clientRes.data)
        if (!isEdit && statusRes.data.length > 0) {
          const def = statusRes.data.find((s) => s.is_default) || statusRes.data[0]
          const preClientId = searchParams.get('client_id')
          const clientId = isAgentOrAdmin ? (preClientId || '') : user.id
          setForm((f) => ({ ...f, status_id: def.id, client_id: clientId }))
          if (preClientId && clientRes) {
            const c = clientRes.data.find((c) => c.id === parseInt(preClientId))
            if (c) setClientQuery(c.name + (c.company ? ` — ${c.company}` : ''))
          }
        }
      })
      .catch(() => toast.error('Error cargando datos'))
      .finally(() => setInitialLoading(false))
    if (isAgentOrAdmin) {
      Promise.allSettled([getContacts(), getCompanies()])
        .then(([cr, comr]) => {
          if (cr.status === 'fulfilled') setContacts(cr.value.data)
          if (comr.status === 'fulfilled') setCompanies(comr.value.data)
        })
    }
  }, [])

  useEffect(() => {
    if (isEdit) {
      getTicket(id)
        .then((res) => {
          const t = res.data
          let scheduledLocal = ''
          if (t.scheduled_at) {
            const tz = getFmtTz()
            const local = toZonedTime(toUTC(t.scheduled_at), tz)
            scheduledLocal = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}T${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`
          }
          setForm({
            title: t.title,
            description: t.description || '',
            priority: t.priority,
            status_id: t.status_rel.id,
            client_id: t.client.id,
            assigned_to_id: t.assigned_agent?.id || '',
            category: t.category || '',
            location: t.location || '',
            cc_email: t.cc_email || '',
            scheduled_at: scheduledLocal,
          })
        })
        .catch(() => toast.error('Error cargando ticket'))
    }
  }, [id])

  const handleChange = (e) => {
    setIsDirty(true)
    const { name, value } = e.target
    setForm((f) => {
      const next = { ...f, [name]: value }
      if (name === 'client_id') {
        const client = value ? clients.find((c) => c.id === parseInt(value)) : null
        next.location = client?.address || ''
      }
      return next
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (isAgentOrAdmin && !form.client_id) {
      toast.error('Selecciona un cliente')
      clientInputRef.current?.focus()
      return
    }
    setLoading(true)
    try {
      const payload = {
        ...form,
        status_id: parseInt(form.status_id),
        client_id: isAgentOrAdmin ? parseInt(form.client_id) : user.id,
        assigned_to_id: form.assigned_to_id ? parseInt(form.assigned_to_id) : null,
        scheduled_at: form.scheduled_at
          ? fromZonedTime(form.scheduled_at, getFmtTz()).toISOString()
          : null,
      }
      setIsDirty(false)
      if (isEdit) {
        await updateTicket(id, payload)
        toast.success('Ticket actualizado')
        navigate(`/tickets/${id}`)
      } else {
        const res = await createTicket(payload)
        const newId = res.data.id
        if (pendingFiles.length > 0) {
          const results = await Promise.allSettled(pendingFiles.map(({ file }) => uploadAttachment(newId, file)))
          pendingFiles.forEach(({ preview }) => preview && URL.revokeObjectURL(preview))
          const failed = results.filter((r) => r.status === 'rejected').length
          if (failed > 0) toast.error(`${failed} archivo(s) no se pudieron subir`)
        }
        toast.success('Ticket creado')
        navigate(`/tickets/${newId}`)
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error guardando ticket')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateClient = async (e) => {
    e.preventDefault()
    if (savingClient) return
    if (!clientForm.name.trim()) {
      toast.error('El nombre es requerido')
      return
    }
    setSavingClient(true)
    try {
      const res = await createUser({
        name: clientForm.name,
        email: clientForm.email.trim() || null,
        phone: clientForm.phone,
        company: clientForm.company,
        address: clientForm.address,
        password: clientForm.password,
        role: 'client',
      })
      const newClient = res.data
      setClients((prev) => [...prev, newClient].sort((a, b) => a.name.localeCompare(b.name)))
      setForm((f) => ({ ...f, client_id: newClient.id, location: newClient.address || f.location }))
      setShowClientModal(false)
      setClientForm({ ...EMPTY_CLIENT, password: genPassword() })
      toast.success(`Cliente "${newClient.name}" creado y seleccionado`)
    } catch (err) {
      const detail = err.response?.data?.detail || ''
      // If email already exists as a user, find and select them directly
      if (detail === 'El email ya está registrado') {
        const existing = clients.find((c) => c.email?.toLowerCase() === clientForm.email.toLowerCase())
        if (existing) {
          setForm((f) => ({ ...f, client_id: existing.id, location: existing.address || f.location }))
          setShowClientModal(false)
          setClientForm({ ...EMPTY_CLIENT, password: genPassword() })
          toast.success(`"${existing.name}" ya existe — seleccionado automáticamente`)
          return
        }
        // User exists but isn't in local list yet — reload clients
        try {
          const fresh = await getClients()
          const found = fresh.data.find((c) => c.email?.toLowerCase() === clientForm.email.toLowerCase())
          if (found) {
            setClients(fresh.data)
            setForm((f) => ({ ...f, client_id: found.id, location: found.address || f.location }))
            setShowClientModal(false)
            setClientForm({ ...EMPTY_CLIENT, password: genPassword() })
            toast.success(`"${found.name}" ya existe — seleccionado automáticamente`)
            return
          }
        } catch {}
      }
      toast.error(detail || 'Error creando cliente')
    } finally {
      setSavingClient(false)
    }
  }

  const openClientModal = () => {
    setClientForm({ name: clientQuery.includes(' — ') ? '' : clientQuery, email: '', phone: '', company: '', address: '', password: genPassword() })
    setShowClientModal(true)
  }

  if (initialLoading) return <div className="p-8 text-center text-gray-500">Cargando...</div>

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 mb-6">
        <ArrowLeft size={16} /> Volver
      </button>

      <div className="card">
        <h1 className="text-xl font-bold text-gray-900 mb-6">
          {isEdit ? `Editar Ticket #${id}` : 'Nuevo Ticket'}
        </h1>

        <form id="ticket-form" onSubmit={handleSubmit} className="space-y-5 sticky-footer-form">
          <div>
            <label className="label">Título *</label>
            <input name="title" className="input" style={{fontSize:'16px'}} value={form.title} onChange={handleChange} required />
          </div>

          <div>
            <label className="label">Descripción</label>
            <textarea
              name="description"
              className="input h-28 resize-none"
              style={{fontSize:'16px'}}
              value={form.description}
              onChange={handleChange}
              onPaste={handlePasteOnDesc}
              placeholder="Describe el problema o solicitud..."
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Adjuntos</label>
              {pendingFiles.length > 0 && (
                <span className="text-xs text-gray-400">{pendingFiles.length} archivo(s) pendiente(s)</span>
              )}
            </div>
            <div
              ref={dropZoneRef}
              className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/40 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); dropZoneRef.current?.classList.add('border-blue-400', 'bg-blue-50') }}
              onDragLeave={() => dropZoneRef.current?.classList.remove('border-blue-400', 'bg-blue-50')}
              onDrop={handleDropZoneDrop}
            >
              <Paperclip size={15} className="mx-auto mb-1 opacity-50" />
              <span>Haz clic, arrastra archivos o pega imágenes aquí</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
            {pendingFiles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {pendingFiles.map(({ file, preview }, idx) => (
                  <div key={idx} className="relative group flex flex-col items-center" style={{maxWidth:'72px'}}>
                    {preview ? (
                      <img src={preview} alt={file.name} className="h-16 w-16 object-cover rounded-lg border border-gray-200 flex-shrink-0" />
                    ) : (
                      <div className="h-16 w-16 flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-500 flex-shrink-0">
                        <FileText size={18} className="mb-1 text-gray-400" />
                        <span className="uppercase font-mono">{file.name.split('.').pop()}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removePendingFile(idx)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity leading-none"
                    >×</button>
                    <span className="text-xs text-gray-400 mt-1 w-full truncate text-center">{file.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Prioridad</label>
              <select name="priority" className="input" style={{fontSize:'16px'}} value={form.priority} onChange={handleChange}>
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Estado *</label>
              <select name="status_id" className="input" style={{fontSize:'16px'}} value={form.status_id} onChange={handleChange} required>
                <option value="">Seleccionar...</option>
                {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {/* ── Sección Cliente ── */}
          {isAgentOrAdmin && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">Cliente *</label>
                <button
                  type="button"
                  onClick={openClientModal}
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  <UserPlus size={13} />
                  Nuevo cliente
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="relative">
                  <input
                    ref={clientInputRef}
                    type="text"
                    className="input pr-8"
                    style={{fontSize:'16px'}}
                    value={clientQuery}
                    onChange={(e) => {
                      setClientQuery(e.target.value)
                      setShowClientDrop(true)
                    }}
                    onFocus={() => setShowClientDrop(true)}
                    onBlur={() => setTimeout(() => {
                      setShowClientDrop(false)
                      resetClientQueryRef.current?.()
                    }, 150)}
                    placeholder="Buscar cliente por nombre, empresa o email..."
                  />
                  {form.client_id && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setIsDirty(true)
                        setForm((f) => ({ ...f, client_id: '', location: '' }))
                        setClientQuery('')
                        clientInputRef.current?.focus()
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X size={14} />
                    </button>
                  )}
                  {showClientDrop && clientOptions.length > 0 && (
                    <ul className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                      {clientOptions.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); selectClient(c) }}
                            className={`w-full text-left px-3 py-2.5 hover:bg-blue-50 text-sm border-b border-gray-50 last:border-0 flex items-start gap-2.5 ${form.client_id === c.id ? 'bg-blue-50' : ''}`}
                          >
                            <span className={`mt-0.5 flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${
                              c._source === 'company' ? 'bg-indigo-100 text-indigo-700'
                              : c._source === 'contact' ? 'bg-blue-100 text-blue-600'
                              : 'bg-gray-100 text-gray-500'
                            }`}>
                              {c._source === 'company' ? 'Empresa' : c._source === 'contact' ? 'Contacto' : 'Usuario'}
                            </span>
                            <div className="min-w-0">
                              <div className="font-medium text-gray-900 truncate">{c.name}</div>
                              {(c.company || c.email) && (
                                <div className="text-xs text-gray-500 mt-0.5 truncate">
                                  {c._source === 'company'
                                    ? c.email
                                    : [c._source === 'user' ? c.company : c.company, c.email].filter(Boolean).join(' · ')}
                                </div>
                              )}
                              {c._source === 'contact' && (
                                <div className="text-xs text-amber-600 mt-0.5">Crear cuenta de acceso</div>
                              )}
                              {c._source === 'company' && (
                                <div className="text-xs text-indigo-500 mt-0.5">Ticket a nombre de la empresa</div>
                              )}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <label className="label">Asignar a</label>
                  <select name="assigned_to_id" className="input" style={{fontSize:'16px'}} value={form.assigned_to_id} onChange={handleChange}>
                    <option value="">Sin asignar</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Datos del cliente seleccionado */}
              {selectedClient && (
                <div className="mt-2 p-3 bg-blue-50 border border-blue-100 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                  {selectedClient.email && (
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <Mail size={11} className="text-blue-400 flex-shrink-0" />
                      <span className="truncate">{selectedClient.email}</span>
                    </div>
                  )}
                  {selectedClient.phone && (
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <Phone size={11} className="text-blue-400 flex-shrink-0" />
                      <span>{selectedClient.phone}</span>
                    </div>
                  )}
                  {selectedClient.company && (
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <Building2 size={11} className="text-blue-400 flex-shrink-0" />
                      <span className="truncate">{selectedClient.company}</span>
                    </div>
                  )}
                  {selectedClient.address && (
                    <div className="flex items-center gap-2 text-xs text-gray-600 col-span-2">
                      <MapPin size={11} className="text-blue-400 flex-shrink-0" />
                      <span className="truncate">{selectedClient.address}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Categoría</label>
              <select name="category" className="input" style={{fontSize:'16px'}} value={form.category} onChange={handleChange}>
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Ubicación</label>
              <input
                name="location"
                className="input"
                style={{fontSize:'16px'}}
                value={form.location}
                onChange={handleChange}
                placeholder="Ej: Oficina Central, Av. Balboa"
              />
              {selectedClient && form.location && form.location === selectedClient.address ? (
                <p className="text-xs text-blue-500 mt-1 flex items-center gap-1">
                  <MapPin size={10} /> Heredada del perfil del cliente
                </p>
              ) : selectedClient && !selectedClient.address ? (
                <p className="text-xs text-amber-500 mt-1 flex items-center gap-1">
                  <MapPin size={10} /> El cliente no tiene dirección registrada — ingresa la ubicación manualmente
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <label className="label">CC (correo con copia)</label>
            <input
              name="cc_email"
              type="text"
              className="input"
              style={{fontSize:'16px'}}
              value={form.cc_email}
              onChange={handleChange}
              placeholder="correo1@ejemplo.com, correo2@ejemplo.com"
            />
            <p className="text-xs text-gray-400 mt-1">Separa varias direcciones con coma. Recibirán copia de todas las notificaciones del ticket.</p>
          </div>

          {isAgentOrAdmin && (
            <div>
              <label className="label flex items-center gap-1.5">
                <Calendar size={13} className="text-gray-400" /> Cita programada
                <span className="text-xs font-normal text-gray-400">(opcional)</span>
              </label>
              <div className="relative">
                <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  name="scheduled_at"
                  type="datetime-local"
                  className="input pl-9"
                  style={{fontSize:'16px'}}
                  value={form.scheduled_at}
                  onChange={handleChange}
                />
              </div>
              {form.scheduled_at && (() => {
                const h = parseInt(form.scheduled_at.split('T')[1]?.split(':')[0] ?? '0', 10)
                return h >= 18 ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                    <AlertTriangle size={12} /> Fuera de horario laboral
                  </p>
                ) : null
              })()}
              {form.scheduled_at && (
                <button
                  type="button"
                  onClick={() => { setIsDirty(true); setForm((f) => ({ ...f, scheduled_at: '' })) }}
                  className="mt-1 text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                >
                  <X size={11} /> Quitar cita
                </button>
              )}
            </div>
          )}

        </form>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 sm:px-6 py-3 flex items-center gap-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] z-10 -mx-4 sm:-mx-6">
        <span className={`text-xs flex items-center gap-1.5 ${isDirty ? 'text-amber-600' : 'text-gray-300'}`}>
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${isDirty ? 'bg-amber-500 animate-pulse' : 'bg-gray-300'}`} />
          {isDirty ? 'Sin guardar' : 'Sin cambios'}
        </span>
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary text-sm py-1.5 px-3">Cancelar</button>
          <button type="submit" form="ticket-form" disabled={loading} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
            <Save size={13} />
            {loading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear Ticket'}
          </button>
        </div>
      </div>

      {/* Modal nuevo cliente */}
      {showClientModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 flex-shrink-0">
              <h2 className="font-bold text-gray-900 flex items-center gap-2">
                <UserPlus size={16} /> Nuevo cliente
              </h2>
              <button onClick={() => setShowClientModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateClient} className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Nombre completo *</label>
                  <input
                    className="input"
                    style={{fontSize:'16px'}}
                    value={clientForm.name}
                    onChange={(e) => setClientForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Nombre del cliente"
                    autoFocus
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="label">Teléfono</label>
                  <input
                    className="input"
                    style={{fontSize:'16px'}}
                    value={clientForm.phone}
                    onChange={(e) => setClientForm((f) => ({ ...f, phone: e.target.value }))}
                    inputMode="tel"
                    placeholder="+507 6000-0000"
                  />
                </div>
                <div className="col-span-2">
                  <label className="label">Email <span className="text-gray-400 font-normal text-xs">(opcional)</span></label>
                  <input
                    type="email"
                    className="input"
                    style={{fontSize:'16px'}}
                    value={clientForm.email}
                    onChange={(e) => setClientForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="correo@empresa.com"
                  />
                </div>
                <div className="relative">
                  <label className="label">Empresa</label>
                  <input
                    className="input"
                    style={{fontSize:'16px'}}
                    value={clientForm.company}
                    onChange={(e) => {
                      const v = e.target.value
                      setClientForm((f) => ({ ...f, company: v }))
                      setClientCompanyDrop(v.trim() ? companies.filter((c) => c.name.toLowerCase().includes(v.toLowerCase())) : [])
                    }}
                    onBlur={() => setTimeout(() => setClientCompanyDrop([]), 150)}
                    placeholder="Nombre de la empresa"
                    autoComplete="off"
                  />
                  {clientCompanyDrop.length > 0 && (
                    <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {clientCompanyDrop.map((c) => (
                        <li key={c.id} onMouseDown={() => {
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
              </div>

              <div>
                <label className="label">Ubicación / Dirección</label>
                <input
                  className="input"
                  style={{fontSize:'16px'}}
                  value={clientForm.address}
                  onChange={(e) => setClientForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Ej: Calle 50, Edificio Torre Global, Of. 12"
                />
              </div>

              <div>
                <label className="label">Contraseña de acceso</label>
                <div className="flex gap-2">
                  <input
                    className="input flex-1 font-mono text-sm"
                    style={{fontSize:'16px'}}
                    value={clientForm.password}
                    onChange={(e) => setClientForm((f) => ({ ...f, password: e.target.value }))}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setClientForm((f) => ({ ...f, password: genPassword() }))}
                    className="btn-secondary text-xs whitespace-nowrap"
                  >
                    Generar
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">El cliente usará esta contraseña para acceder al sistema.</p>
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setShowClientModal(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={savingClient} className="btn-primary flex items-center gap-2">
                  <UserPlus size={14} />
                  {savingClient ? 'Creando...' : 'Crear y seleccionar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
