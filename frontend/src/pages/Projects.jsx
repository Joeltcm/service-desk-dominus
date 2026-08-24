import { showConfirm } from '../utils/confirm'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import {
  getProjects, getProject, createProject, updateProject, deleteProject,
  getProjectTickets, linkTicketToProject, unlinkTicketFromProject, setTicketWeight,
  getTickets, getClients, getQuotes,
} from '../services/api'
import {
  Plus, Search, Pencil, Trash2, X, Save, ArrowLeft, FolderKanban,
  CheckCircle2, Clock, PauseCircle, XCircle, Ticket, Link2, Unlink,
  CalendarDays, DollarSign, User, ChevronRight, BarChart2, Percent, AlertTriangle,
} from 'lucide-react'
import { fmtD } from '../utils/fmt'
import toast from 'react-hot-toast'

const STATUSES = ['Activo', 'En pausa', 'Completado', 'Cancelado']

const STATUS_STYLE = {
  'Activo':     { cls: 'bg-blue-100 text-blue-700',   icon: Clock },
  'En pausa':   { cls: 'bg-amber-100 text-amber-700', icon: PauseCircle },
  'Completado': { cls: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  'Cancelado':  { cls: 'bg-red-100 text-red-700',     icon: XCircle },
}

const PRIORITY_STYLE = {
  low:      'bg-gray-100 text-gray-600',
  medium:   'bg-blue-100 text-blue-700',
  high:     'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}
const PRIORITY_LABEL = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' }

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || { cls: 'bg-gray-100 text-gray-600', icon: Clock }
  const Icon = s.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${s.cls}`}>
      <Icon size={10} /> {status}
    </span>
  )
}

function ProgressBar({ progress, resolved, total }) {
  const color = progress === 100 ? 'bg-green-500' : progress >= 50 ? 'bg-blue-500' : 'bg-amber-400'
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{resolved}/{total} tickets resueltos</span>
        <span className="font-semibold">{progress}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

const EMPTY_FORM = {
  name: '', description: '', status: 'Activo',
  client_id: null, start_date: '', end_date: '', budget: '', quote_id: null, notes: '',
}

export default function Projects() {
  const navigate = useNavigate()
  const { ref: urlRef } = useParams()
  const [projects, setProjects]       = useState([])
  const [selected, setSelected]       = useState(null)
  const [search, setSearch]           = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [loading, setLoading]         = useState(true)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)

  // Form
  const [isEditing, setIsEditing]   = useState(false)
  const [isNew, setIsNew]           = useState(false)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [saving, setSaving]         = useState(false)

  // Tickets panel
  const [projectTickets, setProjectTickets] = useState([])
  const [ticketSearch, setTicketSearch]     = useState('')
  const [ticketResults, setTicketResults]   = useState([])
  const [linkSearch, setLinkSearch]         = useState('')
  const [linkDropOpen, setLinkDropOpen]     = useState(false)

  // Weights
  const [weightMode, setWeightMode]   = useState(false)   // show weight inputs
  const [weights, setWeights]         = useState({})      // { [ticketId]: string }
  const [savingWeight, setSavingWeight] = useState(null)  // ticketId being saved

  // Autocomplete data
  const [clients, setClients]   = useState([])
  const [quotes, setQuotes]     = useState([])
  const [clientQuery, setClientQuery]   = useState('')
  const [clientDropOpen, setClientDropOpen] = useState(false)
  const [quoteQuery, setQuoteQuery]     = useState('')
  const [quoteDropOpen, setQuoteDropOpen] = useState(false)

  const leftSwipe  = useTouchSwipe({ onSwipeLeft: () => setMobileDetailOpen(true) })
  const rightSwipe = useTouchSwipe({ onSwipeRight: () => { setMobileDetailOpen(false); navigate(-1) } })

  const loadReqRef = useRef(0)
  const load = useCallback(async () => {
    const reqId = ++loadReqRef.current
    setLoading(true)
    try {
      const params = {}
      if (search) params.search = search
      if (filterStatus) params.status = filterStatus
      const r = await getProjects(params)
      if (loadReqRef.current === reqId) setProjects(r.data)
    } catch { if (loadReqRef.current === reqId) toast.error('Error cargando proyectos') }
    finally { if (loadReqRef.current === reqId) setLoading(false) }
  }, [search, filterStatus])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!urlRef) { if (selected) { setSelected(null); setMobileDetailOpen(false) } return }
    if (projects.length === 0) return
    if (selected && String(selected.id) === urlRef) return
    const found = projects.find((p) => String(p.id) === urlRef)
    if (found) { selectProject(found) }
  }, [urlRef, projects]) // eslint-disable-line

  useEffect(() => {
    getClients().then(r => setClients(r.data)).catch(() => {})
    getQuotes({ limit: 100 }).then(r => setQuotes(r.data)).catch(() => {})
  }, [])

  const ticketsReqRef = useRef(0)
  const loadProjectTickets = async (projectId) => {
    const reqId = ++ticketsReqRef.current
    try {
      const r = await getProjectTickets(projectId)
      if (ticketsReqRef.current !== reqId) return
      setProjectTickets(r.data)
      setWeightMode(false)
    } catch { if (ticketsReqRef.current === reqId) setProjectTickets([]) }
  }

  const selectProject = async (p) => {
    setSelected(p)
    setMobileDetailOpen(true)
    setIsEditing(false)
    setIsNew(false)
    navigate('/projects/' + p.id)
    await loadProjectTickets(p.id)
  }

  const openNew = () => {
    setSelected(null)
    setIsNew(true)
    setIsEditing(true)
    setForm(EMPTY_FORM)
    setClientQuery('')
    setQuoteQuery('')
    setMobileDetailOpen(true)
  }

  const openEdit = (p) => {
    setForm({
      name: p.name || '',
      description: p.description || '',
      status: p.status || 'Activo',
      client_id: p.client_id || null,
      start_date: p.start_date || '',
      end_date: p.end_date || '',
      budget: p.budget || '',
      quote_id: p.quote_id || null,
      notes: p.notes || '',
    })
    setClientQuery(p.client?.name || '')
    setQuoteQuery(p.quote_id ? `COT-${p.quote_id}` : '')
    setIsNew(false)
    setIsEditing(true)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setIsNew(false)
    if (isNew) { setSelected(null); navigate('/projects', { replace: true }) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        ...form,
        client_id: form.client_id || null,
        quote_id: form.quote_id || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        budget: form.budget || null,
      }
      if (isNew) {
        const r = await createProject(payload)
        setProjects(prev => [r.data, ...prev])
        setSelected(r.data)
        setProjectTickets([])
        toast.success('Proyecto creado')
      } else {
        const r = await updateProject(selected.id, payload)
        const updated = r.data
        setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
        setSelected(updated)
        toast.success('Proyecto actualizado')
      }
      setIsEditing(false)
      setIsNew(false)
    } catch { toast.error('Error guardando proyecto') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!selected || !await showConfirm(`¿Eliminar el proyecto "${selected.name}"? Los tickets vinculados no se eliminarán.`)) return
    try {
      await deleteProject(selected.id)
      setProjects(prev => prev.filter(p => p.id !== selected.id))
      setSelected(null)
      setMobileDetailOpen(false)
      navigate('/projects', { replace: true })
      toast.success('Proyecto eliminado')
    } catch { toast.error('Error eliminando proyecto') }
  }

  const handleUnlink = async (ticketId) => {
    try {
      await unlinkTicketFromProject(selected.id, ticketId)
      setProjectTickets(prev => prev.filter(t => t.id !== ticketId))
      setWeights(prev => { const n = { ...prev }; delete n[ticketId]; return n })
      const r = await getProject(selected.id)
      setSelected(r.data)
      setProjects(prev => prev.map(p => p.id === r.data.id ? r.data : p))
    } catch { toast.error('Error desvinculando ticket') }
  }

  const handleSaveWeight = async (ticketId) => {
    const raw = weights[ticketId]
    const w = raw === '' || raw == null ? null : parseFloat(raw)
    if (w !== null && (isNaN(w) || w < 0 || w > 100)) return toast.error('El peso debe ser un número entre 0 y 100')
    setSavingWeight(ticketId)
    try {
      await setTicketWeight(selected.id, ticketId, w)
      setProjectTickets(prev => prev.map(t => t.id === ticketId ? { ...t, project_weight: w } : t))
      const r = await getProject(selected.id)
      setSelected(r.data)
      setProjects(prev => prev.map(p => p.id === r.data.id ? r.data : p))
    } catch { toast.error('Error guardando peso') }
    finally { setSavingWeight(null) }
  }

  const enterWeightMode = () => {
    const initial = {}
    projectTickets.forEach(t => { initial[t.id] = t.project_weight != null ? String(t.project_weight) : '' })
    setWeights(initial)
    setWeightMode(true)
  }

  // Search tickets to link
  useEffect(() => {
    if (!linkSearch.trim()) { setTicketResults([]); return }
    let cancelled = false
    const t = setTimeout(() => {
      getTickets({ search: linkSearch, limit: 8 })
        .then(r => { if (!cancelled) setTicketResults(r.data.filter(t => t.project_id !== selected?.id)) })
        .catch(() => {})
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [linkSearch, selected])

  const handleLinkTicket = async (ticket) => {
    try {
      await linkTicketToProject(selected.id, ticket.id)
      await loadProjectTickets(selected.id)
      const r = await getProject(selected.id)
      setSelected(r.data)
      setProjects(prev => prev.map(p => p.id === r.data.id ? r.data : p))
      setLinkSearch('')
      setLinkDropOpen(false)
      toast.success(`Ticket #${ticket.id} vinculado`)
    } catch { toast.error('Error vinculando ticket') }
  }

  // Client autocomplete filter
  const clientResults = clientQuery.trim()
    ? clients.filter(c => c.name?.toLowerCase().includes(clientQuery.toLowerCase()) || c.company?.toLowerCase().includes(clientQuery.toLowerCase())).slice(0, 6)
    : clients.slice(0, 6)

  // Quote autocomplete filter
  const quoteResults = quoteQuery.trim()
    ? quotes.filter(q => (q.quote_number || '').toLowerCase().includes(quoteQuery.toLowerCase()) || (q.client_name || '').toLowerCase().includes(quoteQuery.toLowerCase())).slice(0, 6)
    : quotes.slice(0, 6)

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Left panel: list ── */}
      <div
        className={`${mobileDetailOpen ? 'hidden sm:flex' : 'flex'} flex-col w-full sm:w-80 lg:w-96 border-r border-gray-200 bg-white flex-shrink-0`}
        {...leftSwipe}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3 md:pr-14 lg:pr-28">
            <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <FolderKanban size={20} className="text-indigo-500" /> Proyectos
            </h1>
            <button onClick={openNew} className="flex items-center gap-1.5 text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">
              <Plus size={14} /> Nuevo
            </button>
          </div>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-8 text-sm"
              placeholder="Buscar proyecto..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ fontSize: '16px' }}
            />
          </div>
          <select
            className="input text-sm w-full"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            style={{ fontSize: '16px' }}
          >
            <option value="">Todos los estados</option>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 divide-y divide-gray-50">
          {loading ? (
            <div className="p-6 text-center text-gray-400 text-sm">Cargando...</div>
          ) : projects.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">
              <FolderKanban size={32} className="mx-auto mb-2 opacity-30" />
              No hay proyectos
            </div>
          ) : projects.map(p => (
            <button
              key={p.id}
              onClick={() => selectProject(p)}
              className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${selected?.id === p.id ? 'bg-indigo-50 border-l-2 border-indigo-500' : ''}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="font-semibold text-gray-900 text-sm leading-snug line-clamp-1">{p.name}</span>
                <StatusBadge status={p.status} />
              </div>
              {p.client && <p className="text-xs text-gray-500 mb-2 flex items-center gap-1"><User size={10} />{p.client.name}</p>}
              <ProgressBar progress={p.progress} resolved={p.resolved_tickets} total={p.total_tickets} />
            </button>
          ))}
        </div>
      </div>

      {/* ── Right panel: detail / form ── */}
      <div
        className={`${mobileDetailOpen ? 'flex' : 'hidden sm:flex'} flex-col flex-1 overflow-y-auto overscroll-contain min-h-0 bg-gray-50`}
        {...rightSwipe}
      >
        {isEditing ? (
          /* ── Edit / New form ── */
          <div className="p-4 sm:p-6 max-w-2xl mx-auto w-full">
            <button onClick={() => { cancelEdit(); navigate(-1) }} className="sm:hidden flex items-center gap-2 text-sm text-gray-500 mb-4">
              <ArrowLeft size={16} /> Volver
            </button>
            <h2 className="text-lg font-bold text-gray-900 mb-5">{isNew ? 'Nuevo proyecto' : 'Editar proyecto'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Nombre *</label>
                <input className="input" style={{ fontSize: '16px' }} required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Descripción</label>
                <textarea className="input h-20 resize-none" style={{ fontSize: '16px' }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Estado</label>
                  <select className="input" style={{ fontSize: '16px' }} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Presupuesto</label>
                  <input className="input" style={{ fontSize: '16px' }} placeholder="Ej: $5,000" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Fecha inicio</label>
                  <input type="date" className="input" style={{ fontSize: '16px' }} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Fecha fin estimada</label>
                  <input type="date" className="input" style={{ fontSize: '16px' }} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                </div>
              </div>

              {/* Client autocomplete */}
              <div className="relative">
                <label className="label">Cliente</label>
                <input
                  className="input" style={{ fontSize: '16px' }}
                  placeholder="Buscar cliente..."
                  value={clientQuery}
                  onChange={e => { setClientQuery(e.target.value); setClientDropOpen(true); if (!e.target.value) setForm(f => ({ ...f, client_id: null })) }}
                  onFocus={() => setClientDropOpen(true)}
                  onBlur={() => setTimeout(() => setClientDropOpen(false), 150)}
                />
                {form.client_id && <button type="button" onClick={() => { setClientQuery(''); setForm(f => ({ ...f, client_id: null })) }} className="absolute right-2 top-7 text-gray-400 hover:text-gray-600">×</button>}
                {clientDropOpen && clientResults.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {clientResults.map(c => (
                      <button key={c.id} type="button" className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                        onClick={() => { setForm(f => ({ ...f, client_id: c.id })); setClientQuery(c.name); setClientDropOpen(false) }}>
                        <div className="font-medium">{c.name}</div>
                        {c.company && <div className="text-xs text-gray-400">{c.company}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quote autocomplete */}
              <div className="relative">
                <label className="label">Cotización vinculada</label>
                <input
                  className="input" style={{ fontSize: '16px' }}
                  placeholder="Buscar cotización..."
                  value={quoteQuery}
                  onChange={e => { setQuoteQuery(e.target.value); setQuoteDropOpen(true); if (!e.target.value) setForm(f => ({ ...f, quote_id: null })) }}
                  onFocus={() => setQuoteDropOpen(true)}
                  onBlur={() => setTimeout(() => setQuoteDropOpen(false), 150)}
                />
                {form.quote_id && <button type="button" onClick={() => { setQuoteQuery(''); setForm(f => ({ ...f, quote_id: null })) }} className="absolute right-2 top-7 text-gray-400 hover:text-gray-600">×</button>}
                {quoteDropOpen && quoteResults.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {quoteResults.map(q => (
                      <button key={q.id} type="button" className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                        onClick={() => { setForm(f => ({ ...f, quote_id: q.id })); setQuoteQuery(q.quote_number || `COT-${q.id}`); setQuoteDropOpen(false) }}>
                        <span className="font-mono text-blue-700 text-xs">{q.quote_number || `COT-${q.id}`}</span>
                        {q.client_name && <span className="text-gray-500 ml-2 text-xs">{q.client_name}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="label">Notas internas</label>
                <textarea className="input h-20 resize-none" style={{ fontSize: '16px' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={cancelEdit} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
                  <Save size={14} /> {saving ? 'Guardando...' : isNew ? 'Crear proyecto' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        ) : selected ? (
          /* ── Project detail ── */
          <div className="p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
            <button onClick={() => { setMobileDetailOpen(false); navigate(-1) }} className="sm:hidden flex items-center gap-2 text-sm text-gray-500">
              <ArrowLeft size={16} /> Volver
            </button>

            {/* Header card */}
            <div className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h2 className="text-xl font-bold text-gray-900 leading-snug">{selected.name}</h2>
                    <StatusBadge status={selected.status} />
                  </div>
                  {selected.client && (
                    <p className="text-sm text-gray-500 flex items-center gap-1.5">
                      <User size={13} /> {selected.client.name}
                      {selected.client.company && <span className="text-gray-400">— {selected.client.company}</span>}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => openEdit(selected)} className="btn-secondary flex items-center gap-1.5 text-sm"><Pencil size={13} /> Editar</button>
                  <button onClick={handleDelete} className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"><Trash2 size={13} /></button>
                </div>
              </div>

              {selected.description && (
                <p className="mt-3 text-sm text-gray-600 leading-relaxed">{selected.description}</p>
              )}

              {/* Meta row */}
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
                {selected.start_date && (
                  <span className="flex items-center gap-1"><CalendarDays size={11} /> Inicio: {fmtD(selected.start_date)}</span>
                )}
                {selected.end_date && (
                  <span className="flex items-center gap-1"><CalendarDays size={11} /> Fin: {fmtD(selected.end_date)}</span>
                )}
                {selected.budget && (
                  <span className="flex items-center gap-1"><DollarSign size={11} /> {selected.budget}</span>
                )}
                {selected.quote_id && (
                  <button onClick={() => navigate('/quotes')} className="flex items-center gap-1 text-blue-600 hover:underline">
                    <Link2 size={11} /> COT-{selected.quote_id}
                  </button>
                )}
              </div>

              {/* Progress */}
              <div className="mt-4">
                <ProgressBar progress={selected.progress} resolved={selected.resolved_tickets} total={selected.total_tickets} />
              </div>
            </div>

            {/* Notes */}
            {selected.notes && (
              <div className="card">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Notas</h3>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{selected.notes}</p>
              </div>
            )}

            {/* Tickets */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Ticket size={15} /> Tickets ({projectTickets.length})</h3>
                {projectTickets.length > 0 && !isEditing && (
                  <button
                    onClick={weightMode ? () => setWeightMode(false) : enterWeightMode}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${weightMode ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                  >
                    <Percent size={12} /> {weightMode ? 'Cerrar pesos' : 'Asignar pesos'}
                  </button>
                )}
              </div>

              {/* Link ticket search */}
              <div className="relative mb-4">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input pl-8 text-sm"
                  style={{ fontSize: '16px' }}
                  placeholder="Buscar y vincular ticket..."
                  value={linkSearch}
                  onChange={e => { setLinkSearch(e.target.value); setLinkDropOpen(true) }}
                  onFocus={() => setLinkDropOpen(true)}
                  onBlur={() => setTimeout(() => setLinkDropOpen(false), 200)}
                />
                {linkDropOpen && ticketResults.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {ticketResults.map(t => (
                      <button key={t.id} type="button"
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-50 last:border-0 flex items-start gap-2"
                        onClick={() => handleLinkTicket(t)}>
                        <span className="font-mono text-gray-400 text-xs mt-0.5">#{t.id}</span>
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate">{t.title}</div>
                          <div className="text-xs text-gray-400">{t.client?.name} · {t.status_rel?.name}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {projectTickets.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No hay tickets vinculados. Busca arriba para agregar.</p>
              ) : (
                <>
                  {/* Weight summary banner */}
                  {weightMode && (() => {
                    const total = projectTickets.reduce((s, t) => s + (parseFloat(weights[t.id] ?? t.project_weight ?? 0) || 0), 0)
                    const diff = Math.round((100 - total) * 10) / 10
                    const ok = Math.abs(total - 100) < 0.1
                    return (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-3 ${ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
                        {ok ? <CheckCircle2 size={13}/> : <AlertTriangle size={13}/>}
                        <span>Total asignado: <b>{Math.round(total * 10)/10}%</b></span>
                        {!ok && diff > 0 && <span className="ml-auto">Faltan {diff}% por asignar</span>}
                        {!ok && diff < 0 && <span className="ml-auto">Excede en {Math.abs(diff)}%</span>}
                        {ok && <span className="ml-auto font-medium">✓ Suma 100%</span>}
                      </div>
                    )
                  })()}
                  <div className="space-y-2">
                    {projectTickets.map(t => (
                      <div key={t.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 group transition-colors">
                        <button onClick={() => navigate(`/tickets/${t.id}`)} className="flex-1 min-w-0 text-left flex items-start gap-2">
                          <span className="font-mono text-xs text-gray-400 mt-0.5 flex-shrink-0">#{t.id}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              <span className="text-xs text-gray-400">{t.status_rel?.name}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_STYLE[t.priority] || ''}`}>{PRIORITY_LABEL[t.priority]}</span>
                              {t.client && <span className="text-xs text-gray-400">{t.client.name}</span>}
                              {!weightMode && t.project_weight != null && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold flex items-center gap-0.5">
                                  <Percent size={10}/>{t.project_weight}%
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                        {weightMode ? (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <div className="relative">
                              <input
                                type="number" min="0" max="100" step="0.5"
                                className="input text-right w-20 text-sm pr-6 py-1"
                                style={{ fontSize: '14px' }}
                                placeholder="—"
                                value={weights[t.id] ?? ''}
                                onChange={e => setWeights(p => ({ ...p, [t.id]: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && handleSaveWeight(t.id)}
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">%</span>
                            </div>
                            <button
                              onClick={() => handleSaveWeight(t.id)}
                              disabled={savingWeight === t.id}
                              className="p-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
                              title="Guardar"
                            >
                              <Save size={13} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => navigate(`/tickets/${t.id}`)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded opacity-0 group-hover:opacity-100 transition-all">
                              <ChevronRight size={14} />
                            </button>
                            <button onClick={() => handleUnlink(t.id)} title="Desvincular" className="p-1.5 text-gray-400 hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-all">
                              <Unlink size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <FolderKanban size={48} className="mb-3 opacity-30" />
            <p className="text-sm">Selecciona un proyecto o crea uno nuevo</p>
          </div>
        )}
      </div>
    </div>
  )
}
