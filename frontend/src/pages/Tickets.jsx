import { showConfirm } from '../utils/confirm'
import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getTickets, getStatuses, getCategories, deleteTickets, getAgents, updateTicket } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import StatusBadge from '../components/StatusBadge'
import PriorityBadge from '../components/PriorityBadge'
import { Plus, Search, Calendar, Trash2, X, AlertTriangle, ShieldCheck, ShieldAlert, ShieldOff, Clock, CheckCircle, CircleDot, ChevronRight, Tag, ArrowUpDown } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { fmtDT, fmtD } from '../utils/fmt'
import { getSLAInfo, fmtSlaRemaining, SLA_TOTAL } from '../utils/sla'
import toast from 'react-hot-toast'

export default function Tickets() {
  const [tickets, setTickets] = useState([])
  const [statuses, setStatuses] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [deleting, setDeleting] = useState(false)
  const [bulkStatusId, setBulkStatusId] = useState('')
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [sortKey, setSortKey] = useState('created_at_desc')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [agents, setAgents] = useState([])
  const PER_PAGE = 50

  const filterStatus     = searchParams.get('status')           || '__open__'
  const filterPriority   = searchParams.get('priority')         || ''
  const filterCategory   = searchParams.get('category')         || ''
  const filterClient     = searchParams.get('client_id')        || ''
  const filterAgent      = searchParams.get('agent')            || ''
  const filterTag        = searchParams.get('tag')              || ''
  const filterSla        = searchParams.get('sla')              || ''

  const setFilter = (key, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  const { isAgentOrAdmin, user } = useAuth()
  const { vertical, company_sidebar_color, company_accent_color, company_name } = useCompany()
  const itMode = vertical === 'it_support'
  const navigate = useNavigate()

  useEffect(() => {
    getAgents().then((r) => setAgents(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 320)
    return () => clearTimeout(t)
  }, [search])

  const fetchTickets = (pg = page) => {
    setLoading(true)
    const status     = searchParams.get('status')          || '__open__'
    const priority   = searchParams.get('priority')        || ''
    const category   = searchParams.get('category')        || ''
    const clientId   = searchParams.get('client_id')       || ''
    const agent      = searchParams.get('agent')           || ''
    const tag        = searchParams.get('tag')             || ''
    const apiStatusId = status === '__open__' ? undefined : (status || undefined)
    Promise.all([
      getTickets({
        search: debouncedSearch,
        status_id: apiStatusId,
        priority: priority || undefined,
        category: category || undefined,
        client_id: clientId || undefined,
        assigned_to_id: agent || undefined,
        tag: tag || undefined,
        page: pg,
        limit: PER_PAGE,
      }),
      getStatuses(),
      getCategories(),
    ])
      .then(([ticketsRes, statusRes, catRes]) => {
        let data = ticketsRes.data
        if (status === '__open__') {
          data = data.filter((t) => !t.status_rel?.is_closed)
        }
        setTickets(data)
        setHasMore(ticketsRes.data.length === PER_PAGE)
        setStatuses(statusRes.data)
        setCategories(catRes.data)
        setSelected(new Set())
      })
      .catch(() => toast.error('Error cargando tickets'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setPage(1)
    fetchTickets(1)
  }, [debouncedSearch, searchParams])

  const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }
  const sortedTickets = [...tickets].sort((a, b) => {
    if (sortKey === 'created_at_asc') return new Date(a.created_at) - new Date(b.created_at)
    if (sortKey === 'priority_asc')   return (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
    if (sortKey === 'priority_desc')  return (PRIORITY_ORDER[b.priority] ?? 2) - (PRIORITY_ORDER[a.priority] ?? 2)
    if (sortKey === 'sla_asc') {
      const ai = getSLAInfo(a), bi = getSLAInfo(b)
      return (ai?.remaining_min ?? 99999) - (bi?.remaining_min ?? 99999)
    }
    return new Date(b.created_at) - new Date(a.created_at) // created_at_desc (default)
  })

  const displayedTickets = filterSla
    ? sortedTickets.filter((t) => {
        const info = getSLAInfo(t)
        if (filterSla === 'breached') return info?.breached && !info?.resolved
        if (filterSla === 'warning') {
          const total = { critical: 240, high: 540, medium: 1620, low: 2700 }[t.priority] || 1620
          return info && !info.breached && !info.paused && (info.remaining_min / total) < 0.20
        }
        if (filterSla === 'unassigned') return !t.assigned_agent
        return true
      })
    : sortedTickets

  const allIds = displayedTickets.map((t) => t.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const slaBreachedCount = tickets.filter((t) => { const i = getSLAInfo(t); return i?.breached && !i?.resolved }).length
  const slaWarningCount = tickets.filter((t) => {
    const i = getSLAInfo(t); if (!i || i.breached || i.paused) return false
    const total = { critical: 240, high: 540, medium: 1620, low: 2700 }[t.priority] || 1620
    return (i.remaining_min / total) < 0.20
  }).length
  const unassignedCount = tickets.filter((t) => !t.assigned_agent).length
  const someSelected = selected.size > 0

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(allIds))
    }
  }

  const toggleOne = (id, e) => {
    e.stopPropagation()
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleBulkStatus = async () => {
    if (!bulkStatusId) return
    const ids = Array.from(selected)
    setBulkUpdating(true)
    try {
      await Promise.all(ids.map((id) => updateTicket(id, { status_id: parseInt(bulkStatusId) })))
      toast.success(`${ids.length} ticket${ids.length !== 1 ? 's' : ''} actualizado${ids.length !== 1 ? 's' : ''}`)
      setBulkStatusId('')
      fetchTickets()
    } catch {
      toast.error('Error actualizando tickets')
    } finally {
      setBulkUpdating(false)
    }
  }

  const handleDelete = async () => {
    const ids = Array.from(selected)
    const count = ids.length
    if (!await showConfirm(`¿Eliminar ${count} ticket${count !== 1 ? 's' : ''}? Esta acción no se puede deshacer.`)) return
    setDeleting(true)
    try {
      await deleteTickets(ids)
      toast.success(`${count} ticket${count !== 1 ? 's' : ''} eliminado${count !== 1 ? 's' : ''}`)
      fetchTickets()
    } catch {
      toast.error('Error al eliminar tickets')
    } finally {
      setDeleting(false)
    }
  }

  // ── Vista cliente ──────────────────────────────────────
  if (!isAgentOrAdmin) {
    const open = tickets.filter((t) => !t.status_rel?.is_closed)
    const resolved = tickets.filter((t) => t.status_rel?.is_closed)

    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        {/* Hero de bienvenida */}
        <div
          className="rounded-2xl p-5 sm:p-6 mb-5 text-white shadow-sm"
          style={{ background: `linear-gradient(135deg, ${company_sidebar_color || '#1a3353'} 0%, ${company_accent_color || '#3b82f6'} 100%)` }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold leading-tight">
                Hola{user?.name ? `, ${user.name.split(' ')[0]}` : ''} <span className="align-middle">👋</span>
              </h1>
              <p className="text-sm text-white/75 mt-1 truncate">
                Centro de soporte{company_name ? ` · ${company_name}` : ''}
              </p>
            </div>
            <button
              onClick={() => navigate('/tickets/new')}
              className="flex items-center gap-2 text-sm font-medium bg-white/15 hover:bg-white/25 border border-white/25 text-white rounded-lg px-3.5 py-2 transition-colors flex-shrink-0"
            >
              <Plus size={15} /> Nueva solicitud
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="card text-center py-4">
            <p className="text-2xl font-bold text-gray-900">{tickets.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Total</p>
          </div>
          <div className="card text-center py-4">
            <p className="text-2xl font-bold text-orange-500">{open.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">En proceso</p>
          </div>
          <div className="card text-center py-4">
            <p className="text-2xl font-bold text-green-500">{resolved.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Resueltos</p>
          </div>
        </div>

        {/* Panel: filtros + lista */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
        {/* Filtros */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9 w-full" style={{ fontSize: '16px' }} placeholder="Buscar solicitud..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input w-auto text-sm" value={filterStatus} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">Todos</option>
            <option value="__open__">En proceso</option>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400 text-sm">Cargando...</div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <CircleDot size={28} className="text-gray-300" />
            </div>
            <p className="text-gray-500 font-medium">No tienes solicitudes aún</p>
            <p className="text-gray-400 text-sm mt-1 mb-5">Crea una nueva solicitud de soporte para comenzar</p>
            <button onClick={() => navigate('/tickets/new')} className="btn-primary">
              Crear primera solicitud
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => {
              const isResolved = t.status_rel?.is_closed
              const statusColor = t.status_rel?.color || '#6b7280'
              return (
                <button
                  key={t.id}
                  onClick={() => navigate(`/tickets/${t.id}`)}
                  className="w-full text-left card hover:shadow-md transition-all duration-150 hover:-translate-y-0.5 group p-0 overflow-hidden"
                >
                  <div className="flex">
                    {/* Color bar */}
                    <div className="w-1 flex-shrink-0 rounded-l-xl" style={{ backgroundColor: statusColor }} />

                    <div className="flex-1 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Number + category */}
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-xs font-mono text-gray-400">#{t.id}</span>
                            {t.category && (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                                <Tag size={10} /> {t.category}
                              </span>
                            )}
                          </div>
                          {/* Title */}
                          <p className="font-semibold text-gray-900 leading-snug group-hover:text-[#1a3353] transition-colors">
                            {t.title}
                          </p>

                          {/* Footer info */}
                          <div className="flex flex-wrap items-center gap-3 mt-2.5">
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              <Clock size={11} /> {fmtD(t.created_at)}
                            </span>
                            {t.scheduled_at && (
                              <span className="text-xs text-blue-600 flex items-center gap-1 font-medium">
                                <Calendar size={11} /> Cita: {fmtDT(t.scheduled_at, 'dd/MM hh:mm aa')}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Status + chevron */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: statusColor }}>
                            {t.status_rel?.name || 'Sin estado'}
                          </span>
                          <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
        </div>
      </div>
    )
  }

  // ── Vista agente / admin ────────────────────────────────
  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Tickets</h1>
          <p className="text-sm text-gray-500 mt-0.5">{displayedTickets.length}{filterSla ? ` / ${tickets.length}` : ''} ticket(s) encontrado(s)</p>
        </div>
        <button onClick={() => navigate('/tickets/new')} className="btn-primary flex items-center gap-2 text-sm">
          <Plus size={16} />
          <span className="hidden sm:inline">Nuevo Ticket</span>
          <span className="sm:hidden">Nuevo</span>
        </button>
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3 mb-4">
        <div className="relative col-span-2 sm:flex-1 sm:min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9 w-full"
            style={{ fontSize: '16px' }}
            placeholder="Buscar tickets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input w-full sm:w-auto text-sm" value={filterStatus} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="__open__">No resueltos</option>
          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input w-full sm:w-auto text-sm" value={filterPriority} onChange={(e) => setFilter('priority', e.target.value)}>
          <option value="">Todas las prioridades</option>
          <option value="low">Baja</option>
          <option value="medium">Media</option>
          <option value="high">Alta</option>
          <option value="critical">Crítica</option>
        </select>
        <select className="input w-full sm:w-auto text-sm col-span-2 sm:col-auto" value={filterCategory} onChange={(e) => setFilter('category', e.target.value)}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        {agents.length > 0 && (
          <select className="input w-full sm:w-auto text-sm col-span-2 sm:col-auto" value={filterAgent} onChange={(e) => setFilter('agent', e.target.value)}>
            <option value="">Todos los agentes</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <div className="relative col-span-2 sm:col-auto">
          <Tag size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            className="input w-full sm:w-36 text-sm pl-8"
            placeholder="Etiqueta..."
            value={filterTag}
            onChange={(e) => setFilter('tag', e.target.value)}
          />
        </div>
        <div className="relative col-span-2 sm:col-auto">
          <ArrowUpDown size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <select className="input w-full sm:w-auto text-sm pl-8" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            <option value="created_at_desc">Más recientes</option>
            <option value="created_at_asc">Más antiguos</option>
            <option value="priority_asc">Prioridad ↑</option>
            <option value="priority_desc">Prioridad ↓</option>
            <option value="sla_asc">SLA urgente primero</option>
          </select>
        </div>
      </div>

      {/* Banner filtro por cliente */}
      {filterClient && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-sm">
          <span className="text-blue-700 font-medium flex-1">Filtrando tickets de un cliente específico</span>
          <button onClick={() => setFilter('client_id', '')} className="text-blue-500 hover:text-blue-700 flex items-center gap-1 text-xs font-medium">
            <X size={12} /> Quitar filtro
          </button>
        </div>
      )}

      {/* Chips SLA */}
      {(slaBreachedCount > 0 || slaWarningCount > 0 || unassignedCount > 0) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {slaBreachedCount > 0 && (
            <button
              onClick={() => setFilter('sla', filterSla === 'breached' ? '' : 'breached')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${filterSla === 'breached' ? 'bg-red-600 text-white border-red-600' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}>
              <AlertTriangle size={11} /> SLA Vencido <span className="font-bold">{slaBreachedCount}</span>
            </button>
          )}
          {slaWarningCount > 0 && (
            <button
              onClick={() => setFilter('sla', filterSla === 'warning' ? '' : 'warning')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${filterSla === 'warning' ? 'bg-orange-500 text-white border-orange-500' : 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100'}`}>
              <ShieldAlert size={11} /> Por Vencer <span className="font-bold">{slaWarningCount}</span>
            </button>
          )}
          {unassignedCount > 0 && (
            <button
              onClick={() => setFilter('sla', filterSla === 'unassigned' ? '' : 'unassigned')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${filterSla === 'unassigned' ? 'bg-gray-700 text-white border-gray-700' : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'}`}>
              <ShieldOff size={11} /> Sin Asignar <span className="font-bold">{unassignedCount}</span>
            </button>
          )}
        </div>
      )}

      {/* Barra de acciones al seleccionar */}
      {someSelected && (
        <div className="flex flex-wrap items-center gap-2 mb-4 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
          <span className="text-sm font-medium text-blue-700">
            {selected.size} ticket{selected.size !== 1 ? 's' : ''} seleccionado{selected.size !== 1 ? 's' : ''}
          </span>
          <div className="flex-1" />
          <select
            value={bulkStatusId}
            onChange={(e) => setBulkStatusId(e.target.value)}
            className="input text-sm py-1 h-8 w-auto"
            style={{ fontSize: '16px' }}>
            <option value="">Cambiar estado...</option>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button
            onClick={handleBulkStatus}
            disabled={!bulkStatusId || bulkUpdating}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40">
            <CheckCircle size={14} />
            {bulkUpdating ? 'Aplicando...' : 'Aplicar'}
          </button>
          <div className="w-px h-5 bg-blue-200" />
          <button onClick={() => setSelected(new Set())} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700">
            <X size={13} /> Deseleccionar
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            <Trash2 size={14} />
            {deleting ? 'Eliminando...' : `Eliminar`}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-500">Cargando...</div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-400">No hay tickets que mostrar</p>
          <button onClick={() => navigate('/tickets/new')} className="btn-primary mt-4">Crear primer ticket</button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Mobile: card list */}
          <div className="md:hidden divide-y divide-gray-100">
            {displayedTickets.map((t) => {
              const isChecked = selected.has(t.id)
              const slaInfo = getSLAInfo(t)
              const slaBreached = slaInfo?.breached && !slaInfo?.resolved
              return (
                <div key={t.id}
                  className={`p-4 cursor-pointer transition-colors border-l-4 ${isChecked ? 'bg-red-50 border-red-400' : slaBreached ? 'bg-red-50/60 border-red-400 hover:bg-red-50' : 'border-transparent hover:bg-gray-50'}`}
                  onClick={() => navigate(`/tickets/${t.id}`)}>
                  <div className="flex items-start gap-3">
                    <div onClick={(e) => toggleOne(t.id, e)} className="pt-0.5 flex-shrink-0">
                      <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-blue-600" checked={isChecked} onChange={() => {}} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-gray-400 font-mono">#{t.id}</span>
                        {t.category && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{t.category}</span>}
                      </div>
                      <p className="font-semibold text-gray-900 text-sm leading-tight line-clamp-2">{t.title}</p>
                      {t.client?.company && <p className="text-xs text-gray-500 mt-0.5 truncate">{t.client.company}</p>}
                      <p className="text-xs text-gray-400 truncate">{t.client?.name}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <StatusBadge status={t.status_rel} />
                        <PriorityBadge priority={t.priority} />
                        <SlaBadge ticket={t} />
                        {t.scheduled_at && (
                          <span className="flex items-center gap-1 text-xs text-blue-600">
                            <Calendar size={11} />
                            {fmtDT(t.scheduled_at, 'dd/MM hh:mm aa')}
                          </span>
                        )}
                      </div>
                      {t.tags && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {t.tags.split(',').filter(Boolean).map((tag) => (
                            <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); setFilter('tag', tag.trim()) }}>
                              #{tag.trim()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" checked={allSelected} onChange={toggleAll} />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">TÍTULO</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">CATEGORÍA</th>
                  {itMode && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">CARGADOR</th>}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">EMPRESA</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">CONTACTO</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">AGENTE</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">PRIORIDAD</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ESTADO</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">FECHA</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">CITA</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">SLA</th>
                </tr>
              </thead>
              <tbody>
                {displayedTickets.map((t) => {
                  const isChecked = selected.has(t.id)
                  const slaInfo = getSLAInfo(t)
                  const slaBreached = slaInfo?.breached && !slaInfo?.resolved
                  return (
                    <tr key={t.id}
                      className={`border-b border-gray-50 cursor-pointer transition-colors ${isChecked ? 'bg-red-50 hover:bg-red-50' : slaBreached ? 'bg-red-50/40 hover:bg-red-50/60' : 'hover:bg-blue-50'}`}
                      onClick={() => navigate(`/tickets/${t.id}`)}>
                      <td className="px-4 py-3 w-10" onClick={(e) => toggleOne(t.id, e)}>
                        <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" checked={isChecked} onChange={() => {}} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono">#{t.id}</td>
                      <td className="px-4 py-3 max-w-[220px]">
                        <p className="font-medium text-gray-900 truncate" title={t.title}>{t.title}</p>
                        {t.tags && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {t.tags.split(',').filter(Boolean).map((tag) => (
                              <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 cursor-pointer"
                                onClick={(e) => { e.stopPropagation(); setFilter('tag', tag.trim()) }}>
                                #{tag.trim()}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {t.category ? <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700 max-w-[120px] truncate">{t.category}</span> : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      {itMode && (
                        <td className="px-4 py-3">
                          {t.charger ? <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700">{t.charger}</span> : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 text-gray-500 text-sm max-w-[140px] truncate">{t.client?.company || <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[120px] truncate">{t.client?.name}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[120px] truncate">{t.assigned_agent?.name || <span className="text-gray-300">Sin asignar</span>}</td>
                      <td className="px-4 py-3"><PriorityBadge priority={t.priority} /></td>
                      <td className="px-4 py-3"><StatusBadge status={t.status_rel} /></td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmtD(t.created_at)}</td>
                      <td className="px-4 py-3">
                        {t.scheduled_at && (
                          <span className="flex items-center gap-1 text-xs text-blue-600">
                            <Calendar size={12} />
                            {fmtDT(t.scheduled_at, 'dd/MM hh:mm aa')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3"><SlaBadge ticket={t} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Paginación */}
      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between mt-4 px-1">
          <button
            disabled={page === 1}
            onClick={() => { const p = page - 1; setPage(p); fetchTickets(p) }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
            ← Anterior
          </button>
          <span className="text-sm text-gray-500">Página {page}</span>
          <button
            disabled={!hasMore}
            onClick={() => { const p = page + 1; setPage(p); fetchTickets(p) }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
            Siguiente →
          </button>
        </div>
      )}
    </div>
  )
}


function SlaBadge({ ticket }) {
  const info = getSLAInfo(ticket)
  if (!info) return <span className="text-gray-300 text-xs">—</span>

  const { breached, paused, remaining_min, resolved } = info
  const total = SLA_TOTAL[ticket.priority] || 1620
  // Alerta cuando queda menos del 20% del tiempo total
  const warn = !breached && !paused && (remaining_min / total) < 0.20

  if (resolved && !breached) return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
      <ShieldCheck size={11} /> SLA OK
    </span>
  )

  if (paused) return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
      <ShieldOff size={11} /> Pausado
    </span>
  )

  if (breached) return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
      <AlertTriangle size={11} /> Vencido
    </span>
  )

  if (warn) return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold">
      <span className="relative flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-orange-500 block animate-ping absolute" />
        <span className="w-2 h-2 rounded-full bg-orange-500 block relative" />
      </span>
      <ShieldAlert size={11} />
      Vence en {fmtSlaRemaining(remaining_min)}
    </span>
  )

  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
      <ShieldCheck size={11} /> {fmtSlaRemaining(remaining_min)}
    </span>
  )
}
