import { showConfirm } from '../utils/confirm'
import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import {
  getOpportunities, createOpportunity, updateOpportunity, deleteOpportunity,
  convertOpportunityToQuote, getOpportunityReports, getUsers,
  createOppVisit, rescheduleOppVisit, cancelOppVisit, deleteOppVisit,
  getContacts, getCompanies, getQuotes, linkQuoteToOpp, unlinkQuoteFromOpp,
} from '../services/api'
import ClientAutocomplete from '../components/ClientAutocomplete'
import {
  Search, Plus, Pencil, Trash2, ArrowLeft, X, Save,
  Target, User, Phone, Mail, MapPin, Calendar, CalendarDays,
  ClipboardList, TrendingUp, TrendingDown,
  DollarSign, BarChart2, Award, Percent, Clock, CheckCircle2, XCircle, ExternalLink,
  Link, Unlink, FileText,
} from 'lucide-react'
import { fmtD, fmtDT } from '../utils/fmt'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts'

// ── Constants ──────────────────────────────────────────
const STATUSES = ['Nueva', 'Contactada', 'Calificada', 'Propuesta', 'Negociación', 'Ganada', 'Perdida', 'Cancelada']
const PRIORITIES = ['Baja', 'Media', 'Alta']
const SOURCES = ['Web', 'Referido', 'Llamada', 'Email', 'Visita', 'Redes Sociales', 'Feria/Evento', 'Otro']
const CATEGORIES = ['Hardware', 'Software', 'Redes', 'Servicio Técnico', 'Consultoría', 'Mantenimiento', 'Capacitación', 'Otro']

const STATUS_STYLE = {
  'Nueva':       'bg-gray-100 text-gray-600',
  'Contactada':  'bg-cyan-100 text-cyan-700',
  'Calificada':  'bg-blue-100 text-blue-700',
  'Propuesta':   'bg-amber-100 text-amber-700',
  'Negociación': 'bg-orange-100 text-orange-700',
  'Ganada':      'bg-green-100 text-green-700',
  'Perdida':     'bg-red-100 text-red-600',
  'Cancelada':   'bg-slate-100 text-slate-500',
}
const STATUS_COLOR = {
  'Nueva': '#94a3b8', 'Contactada': '#22d3ee', 'Calificada': '#60a5fa',
  'Propuesta': '#fbbf24', 'Negociación': '#fb923c',
  'Ganada': '#34d399', 'Perdida': '#f87171', 'Cancelada': '#cbd5e1',
}

const PRIORITY_STYLE = {
  'Baja':  'bg-slate-100 text-slate-500',
  'Media': 'bg-blue-100 text-blue-600',
  'Alta':  'bg-red-100 text-red-600',
}

const EMPTY_FORM = {
  title: '', description: '', status: 'Nueva', priority: 'Media',
  source: '', estimated_value: '', probability: 50,
  expected_close_date: '', client_name: '', client_ruc: '',
  client_email: '', client_phone: '', client_address: '',
  category: '', notes: '', assigned_to_id: '',
}

function fmtMoney(n) {
  const v = parseFloat(String(n || '0').replace(/[^\d.]/g, '') || '0')
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Badge components ────────────────────────────────────
function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function PriorityBadge({ priority }) {
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLE[priority] || 'bg-gray-100 text-gray-600'}`}>
      {priority}
    </span>
  )
}

// ── Dashboard ───────────────────────────────────────────
function Dashboard({ reports }) {
  if (!reports) return <div className="p-8 text-center text-gray-400">Cargando...</div>

  const { by_user = [], by_status = {} } = reports
  const totalPipeline = by_user.reduce((s, u) => s + u.pipeline_value, 0)
  const totalWon = by_user.reduce((s, u) => s + u.won_value, 0)
  const totalGanadas = by_user.reduce((s, u) => s + u.ganada, 0)
  const totalPerdidas = by_user.reduce((s, u) => s + u.perdida, 0)
  const globalWinRate = (totalGanadas + totalPerdidas) > 0
    ? Math.round(totalGanadas / (totalGanadas + totalPerdidas) * 100) : 0

  const chartData = STATUSES.map(s => ({ name: s, value: by_status[s] || 0, fill: STATUS_COLOR[s] })).filter(d => d.value > 0)

  return (
    <div className="p-4 sm:p-6 space-y-6 overflow-y-auto">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Pipeline total</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmtMoney(totalPipeline)}</p>
          <p className="text-xs text-gray-400 mt-1">oportunidades activas</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Valor ganado</p>
          <p className="text-xl font-bold text-green-600 mt-1">{fmtMoney(totalWon)}</p>
          <p className="text-xs text-gray-400 mt-1">{totalGanadas} cerradas ganadas</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Tasa de éxito</p>
          <p className="text-xl font-bold text-blue-600 mt-1">{globalWinRate}%</p>
          <p className="text-xs text-gray-400 mt-1">{totalPerdidas} perdidas</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Por vendedor</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{by_user.length}</p>
          <p className="text-xs text-gray-400 mt-1">vendedores activos</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Chart */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <BarChart2 size={14} className="text-violet-500" /> Por etapa
          </h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-400 text-sm py-12">Sin datos</p>
          )}
        </div>

        {/* Pie */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Award size={14} className="text-violet-500" /> Distribución
          </h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`} labelLine={false}>
                  {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-400 text-sm py-12">Sin datos</p>
          )}
        </div>
      </div>

      {/* Per-salesperson table */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <User size={14} className="text-violet-500" /> Por vendedor
        </h3>
        {by_user.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-6">Sin datos</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-2 pr-4 text-xs font-semibold text-gray-500 uppercase">Vendedor</th>
                <th className="text-right pb-2 pr-4 text-xs font-semibold text-gray-500 uppercase">Total</th>
                <th className="text-right pb-2 pr-4 text-xs font-semibold text-gray-500 uppercase">Ganadas</th>
                <th className="text-right pb-2 pr-4 text-xs font-semibold text-gray-500 uppercase">Perdidas</th>
                <th className="text-right pb-2 pr-4 text-xs font-semibold text-gray-500 uppercase">Win %</th>
                <th className="text-right pb-2 pr-4 text-xs font-semibold text-gray-500 uppercase">Pipeline</th>
                <th className="text-right pb-2 text-xs font-semibold text-gray-500 uppercase">Ganado</th>
              </tr>
            </thead>
            <tbody>
              {by_user.map((u) => (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5 pr-4 font-medium text-gray-900">{u.name}</td>
                  <td className="py-2.5 pr-4 text-right text-gray-600">{u.total}</td>
                  <td className="py-2.5 pr-4 text-right">
                    <span className="text-green-600 font-medium">{u.ganada}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-right">
                    <span className="text-red-500">{u.perdida}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-right">
                    <span className={`font-semibold ${u.win_rate >= 50 ? 'text-green-600' : u.win_rate >= 25 ? 'text-amber-500' : 'text-red-500'}`}>
                      {u.win_rate}%
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right text-gray-700">{fmtMoney(u.pipeline_value)}</td>
                  <td className="py-2.5 text-right font-semibold text-green-600">{fmtMoney(u.won_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── VisitsSection ───────────────────────────────────────
function VisitsSection({ opp, onVisitsChanged }) {
  const [showForm, setShowForm] = useState(false)
  const [editingVisit, setEditingVisit] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ scheduled_at: '', duration_minutes: 60, notes: '', location: '' })

  const openNew = () => {
    setEditingVisit(null)
    setForm({ scheduled_at: '', duration_minutes: 60, notes: '', location: '' })
    setShowForm(true)
  }

  const openEdit = (v) => {
    setEditingVisit(v)
    const dt = new Date(v.scheduled_at)
    const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    setForm({ scheduled_at: local, duration_minutes: v.duration_minutes || 60, notes: v.notes || '', location: '' })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.scheduled_at) return toast.error('Selecciona fecha y hora')
    setSaving(true)
    try {
      const dt = new Date(form.scheduled_at).toISOString()
      const payload = { opportunity_id: opp.id, scheduled_at: dt, duration_minutes: Number(form.duration_minutes), notes: form.notes || null, location: form.location || null }
      if (editingVisit) {
        await rescheduleOppVisit(opp.id, editingVisit.id, { scheduled_at: dt, duration_minutes: Number(form.duration_minutes), notes: form.notes || null })
        toast.success('Visita actualizada')
      } else {
        await createOppVisit(opp.id, payload)
        toast.success(payload.location || !opp ? 'Visita agendada' : opp.assignee ? 'Visita agendada (y en Google Calendar si está conectado)' : 'Visita agendada')
      }
      setShowForm(false)
      onVisitsChanged()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error guardando visita')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = async (v) => {
    if (!await showConfirm('¿Cancelar esta visita?')) return
    try {
      await cancelOppVisit(opp.id, v.id)
      toast.success('Visita cancelada')
      onVisitsChanged()
    } catch { toast.error('Error cancelando visita') }
  }

  const handleDelete = async (v) => {
    if (!await showConfirm('¿Eliminar esta visita?')) return
    try {
      await deleteOppVisit(opp.id, v.id)
      toast.success('Visita eliminada')
      onVisitsChanged()
    } catch { toast.error('Error eliminando visita') }
  }

  const visits = opp.visits || []
  const active = visits.filter(v => v.status !== 'cancelled')
  const cancelled = visits.filter(v => v.status === 'cancelled')

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
          <CalendarDays size={12} /> Visitas agendadas
        </p>
        {visits.length < 10 && !showForm && (
          <button onClick={openNew} className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium px-2 py-1 rounded-lg border border-violet-200 hover:bg-violet-50 transition-colors">
            <Plus size={11} /> Agendar
          </button>
        )}
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="bg-violet-50 border border-violet-100 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-violet-700">{editingVisit ? 'Reagendar visita' : 'Nueva visita'}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="label text-xs">Fecha y hora *</label>
              <input type="datetime-local" className="input text-sm" value={form.scheduled_at} onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))} style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="label text-xs">Duración (min)</label>
              <select className="input text-sm" value={form.duration_minutes} onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))} style={{ fontSize: '16px' }}>
                {[30, 45, 60, 90, 120, 180, 240].map(m => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
            {!editingVisit && (
              <div>
                <label className="label text-xs">Ubicación</label>
                <input className="input text-sm" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Dirección..." style={{ fontSize: '16px' }} />
              </div>
            )}
            <div className="col-span-2">
              <label className="label text-xs">Notas</label>
              <textarea className="input text-sm resize-none" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notas para la visita..." style={{ fontSize: '16px' }} />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} disabled={saving} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-50">
              <Save size={11} /> {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Active visits */}
      {active.length === 0 && !showForm && (
        <p className="text-xs text-gray-300 text-center py-2">Sin visitas agendadas</p>
      )}
      {active.map(v => (
        <div key={v.id} className="flex items-start gap-3 p-2.5 bg-white border border-gray-100 rounded-lg">
          <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Clock size={13} className="text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800">{fmtDT(v.scheduled_at)}</p>
            <p className="text-xs text-gray-400">{v.duration_minutes} min{v.notes && ` · ${v.notes}`}</p>
            {v.calendar_event_link && (
              <a href={v.calendar_event_link} target="_blank" rel="noreferrer" className="text-xs text-blue-500 flex items-center gap-1 mt-0.5 hover:underline">
                <ExternalLink size={10} /> Ver en Google Calendar
              </a>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => openEdit(v)} className="p-1.5 rounded text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors">
              <Pencil size={12} />
            </button>
            <button onClick={() => handleCancel(v)} className="p-1.5 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
              <XCircle size={12} />
            </button>
            <button onClick={() => handleDelete(v)} className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}

      {/* Cancelled visits (collapsed) */}
      {cancelled.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-400 hover:text-gray-600 select-none">{cancelled.length} cancelada{cancelled.length !== 1 ? 's' : ''}</summary>
          <div className="mt-2 space-y-1.5">
            {cancelled.map(v => (
              <div key={v.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg opacity-60">
                <XCircle size={11} className="text-gray-400 flex-shrink-0" />
                <span className="text-gray-500 line-through">{fmtDT(v.scheduled_at)}</span>
                <button onClick={() => handleDelete(v)} className="ml-auto text-gray-300 hover:text-red-400 transition-colors">
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ── QuoteLinkModal ──────────────────────────────────────
const QUOTE_STATUS_STYLE = {
  'Borrador':   'bg-gray-100 text-gray-600',
  'Enviada':    'bg-blue-100 text-blue-700',
  'Aprobada':   'bg-green-100 text-green-700',
  'Rechazada':  'bg-red-100 text-red-600',
  'Vencida':    'bg-orange-100 text-orange-600',
  'En Pedido':  'bg-violet-100 text-violet-700',
  'Facturada':  'bg-emerald-100 text-emerald-700',
}

function QuoteLinkModal({ onSelect, onClose }) {
  const [search, setSearch] = useState('')
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      getQuotes({ search: search || undefined }).then(r => setQuotes(r.data)).catch(() => {}).finally(() => setLoading(false))
    }, 320)
    return () => clearTimeout(t)
  }, [search])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh] mx-2">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Link size={15} className="text-violet-500" /> Vincular cotización existente
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="px-4 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              className="input pl-8 text-sm"
              placeholder="Buscar por número, título, cliente..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ fontSize: '16px' }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 divide-y divide-gray-50">
          {loading && <p className="text-center text-sm text-gray-400 py-8">Cargando...</p>}
          {!loading && quotes.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">Sin cotizaciones</p>
          )}
          {quotes.map(q => (
            <button
              key={q.id}
              onClick={() => onSelect(q)}
              className="w-full text-left px-4 py-3 hover:bg-violet-50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={13} className="text-gray-400 flex-shrink-0" />
                  <span className="text-xs font-mono text-gray-500 flex-shrink-0">{q.quote_number}</span>
                  <span className="text-sm font-medium text-gray-800 truncate">{q.title}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${QUOTE_STATUS_STYLE[q.status] || 'bg-gray-100 text-gray-600'}`}>
                  {q.status}
                </span>
              </div>
              {q.client_name && (
                <p className="text-xs text-gray-400 mt-0.5 pl-5">{q.client_name}{q.total ? ` · $${parseFloat(q.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}</p>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── OppDetail ───────────────────────────────────────────
function OppDetail({ opp, onEdit, onDelete, onConvert, converting, onVisitsChanged, onQuoteLinked, onQuoteUnlinked }) {
  const navigate = useNavigate()
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [linking, setLinking] = useState(false)
  const canConvert = !opp.quote_id && !['Ganada', 'Perdida', 'Cancelada'].includes(opp.status)

  const handleLinkSelect = async (quote) => {
    setShowLinkModal(false)
    setLinking(true)
    try {
      await linkQuoteToOpp(opp.id, quote.id)
      toast.success(`Cotización ${quote.quote_number} vinculada`)
      onQuoteLinked()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error vinculando cotización')
    } finally {
      setLinking(false)
    }
  }

  const handleUnlink = async () => {
    if (!await showConfirm('¿Desvincular la cotización de esta oportunidad?')) return
    try {
      await unlinkQuoteFromOpp(opp.id)
      toast.success('Cotización desvinculada')
      onQuoteUnlinked()
    } catch {
      toast.error('Error desvinculando cotización')
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {showLinkModal && <QuoteLinkModal onSelect={handleLinkSelect} onClose={() => setShowLinkModal(false)} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-gray-900 leading-tight">{opp.title}</h2>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <StatusBadge status={opp.status} />
            <PriorityBadge priority={opp.priority} />
            {opp.category && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{opp.category}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            <Pencil size={13} /> Editar
          </button>
          <button onClick={onDelete} className="p-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Sección de cotización */}
      {opp.quote_id ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 overflow-hidden">
          <button
            onClick={() => navigate('/quotes', { state: { selectQuoteId: opp.quote_id } })}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-emerald-100 transition-colors text-left"
          >
            <ClipboardList size={16} className="text-emerald-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-emerald-800">
                {opp.quote?.quote_number || `Cotización #${opp.quote_id}`}
              </p>
              {opp.quote && (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${QUOTE_STATUS_STYLE[opp.quote.status] || 'bg-gray-100 text-gray-600'}`}>
                    {opp.quote.status}
                  </span>
                  {opp.quote.total && (
                    <span className="text-xs text-emerald-600 font-medium">
                      ${parseFloat(opp.quote.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
              )}
            </div>
            <ExternalLink size={13} className="text-emerald-500 flex-shrink-0" />
          </button>
          <div className="flex border-t border-emerald-200">
            <button
              onClick={() => setShowLinkModal(true)}
              disabled={linking}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-emerald-700 hover:bg-emerald-100 transition-colors font-medium"
            >
              <Link size={11} /> Cambiar
            </button>
            <div className="w-px bg-emerald-200" />
            <button
              onClick={handleUnlink}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors font-medium"
            >
              <Unlink size={11} /> Desvincular
            </button>
          </div>
        </div>
      ) : canConvert ? (
        <div className="space-y-2">
          <button
            onClick={onConvert}
            disabled={converting || linking}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            <ClipboardList size={16} />
            {converting ? 'Generando cotización...' : 'Generar Cotización'}
          </button>
          <button
            onClick={() => setShowLinkModal(true)}
            disabled={linking}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-violet-200 text-violet-600 hover:bg-violet-50 font-medium rounded-xl transition-colors text-sm disabled:opacity-50"
          >
            <Link size={14} />
            {linking ? 'Vinculando...' : 'Vincular cotización existente'}
          </button>
        </div>
      ) : null}

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Client */}
        {(opp.client_name || opp.client_ruc || opp.client_email || opp.client_phone) && (
          <div className="card space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Cliente</p>
            {opp.client_name && <p className="text-sm font-medium text-gray-900">{opp.client_name}</p>}
            {opp.client_ruc && <p className="text-xs text-gray-500">RUC: {opp.client_ruc}</p>}
            {opp.client_email && (
              <p className="text-xs text-gray-500 flex items-center gap-1.5">
                <Mail size={11} /> {opp.client_email}
              </p>
            )}
            {opp.client_phone && (
              <p className="text-xs text-gray-500 flex items-center gap-1.5">
                <Phone size={11} /> {opp.client_phone}
              </p>
            )}
            {opp.client_address && (
              <p className="text-xs text-gray-500 flex items-center gap-1.5">
                <MapPin size={11} /> {opp.client_address}
              </p>
            )}
          </div>
        )}

        {/* Opportunity details */}
        <div className="card space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Oportunidad</p>
          {opp.estimated_value && (
            <div className="flex items-center gap-1.5">
              <DollarSign size={12} className="text-green-500" />
              <span className="text-sm font-semibold text-green-700">{fmtMoney(opp.estimated_value)}</span>
              <span className="text-xs text-gray-400">valor estimado</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Percent size={12} className="text-blue-400" />
            <span className="text-sm font-medium text-gray-700">{opp.probability}%</span>
            <span className="text-xs text-gray-400">probabilidad</span>
          </div>
          {/* Probability bar */}
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full bg-violet-500 transition-all"
              style={{ width: `${opp.probability}%` }}
            />
          </div>
          {opp.expected_close_date && (
            <div className="flex items-center gap-1.5 pt-1">
              <Calendar size={11} className="text-gray-400" />
              <span className="text-xs text-gray-500">Cierre esperado: {fmtD(opp.expected_close_date)}</span>
            </div>
          )}
          {opp.source && (
            <p className="text-xs text-gray-500">Origen: <span className="font-medium">{opp.source}</span></p>
          )}
          {opp.assignee && (
            <p className="text-xs text-gray-500 flex items-center gap-1.5">
              <User size={11} /> Vendedor: <span className="font-medium">{opp.assignee.name}</span>
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      {opp.description && (
        <div className="card">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Descripción</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{opp.description}</p>
        </div>
      )}

      {/* Notes */}
      {opp.notes && (
        <div className="card bg-amber-50 border-amber-100">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Notas</p>
          <p className="text-sm text-amber-800 whitespace-pre-wrap">{opp.notes}</p>
        </div>
      )}

      {/* Visits */}
      <VisitsSection opp={opp} onVisitsChanged={onVisitsChanged} />

      <p className="text-xs text-gray-300 text-right">Creada: {fmtD(opp.created_at)}</p>
    </div>
  )
}

// ── OppForm ─────────────────────────────────────────────
function OppForm({ initial, users, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY_FORM)
  const [contacts, setContacts] = useState([])
  const [companies, setCompanies] = useState([])
  const [clientQuery, setClientQuery] = useState(initial?.client_name || '')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    Promise.allSettled([getContacts(), getCompanies()]).then(([cr, comr]) => {
      if (cr.status === 'fulfilled') setContacts(cr.value.data)
      if (comr.status === 'fulfilled') setCompanies(comr.value.data)
    })
  }, [])

  const handleSelectClient = (s) => {
    setClientQuery(s.name || '')
    setForm(f => ({
      ...f,
      client_name:    s.name    || f.client_name,
      client_ruc:     s.ruc     || f.client_ruc,
      client_email:   s.email   || f.client_email,
      client_phone:   s.phone   || f.client_phone,
      client_address: s.address || f.client_address,
    }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.title.trim()) return toast.error('El título es requerido')
    const payload = {
      ...form,
      probability: Number(form.probability) || 50,
      assigned_to_id: form.assigned_to_id ? Number(form.assigned_to_id) : null,
      estimated_value: form.estimated_value || null,
      expected_close_date: form.expected_close_date || null,
      source: form.source || null,
      category: form.category || null,
    }
    onSave(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between -mb-1">
        <h2 className="font-bold text-gray-900">{initial ? 'Editar oportunidad' : 'Nueva oportunidad'}</h2>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X size={18} />
        </button>
      </div>

      {/* Title */}
      <div className="card space-y-3">
        <div>
          <label className="label">Título *</label>
          <input className="input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Nombre de la oportunidad" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Descripción</label>
          <textarea className="input resize-none" rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Detalles de la oportunidad..." style={{ fontSize: '16px' }} />
        </div>
      </div>

      {/* Status & Priority */}
      <div className="card grid grid-cols-2 gap-3">
        <div>
          <label className="label">Estado</label>
          <select className="input" value={form.status} onChange={e => set('status', e.target.value)} style={{ fontSize: '16px' }}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Prioridad</label>
          <select className="input" value={form.priority} onChange={e => set('priority', e.target.value)} style={{ fontSize: '16px' }}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Categoría</label>
          <select className="input" value={form.category} onChange={e => set('category', e.target.value)} style={{ fontSize: '16px' }}>
            <option value="">— Sin categoría —</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Origen</label>
          <select className="input" value={form.source} onChange={e => set('source', e.target.value)} style={{ fontSize: '16px' }}>
            <option value="">— Sin origen —</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Value & Probability */}
      <div className="card grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Valor estimado</label>
          <input className="input" value={form.estimated_value} onChange={e => set('estimated_value', e.target.value)} placeholder="0.00" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Probabilidad ({form.probability}%)</label>
          <input
            type="range" min={0} max={100} step={5}
            className="w-full mt-2 accent-violet-600"
            value={form.probability}
            onChange={e => set('probability', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Cierre esperado</label>
          <input type="date" className="input" value={form.expected_close_date} onChange={e => set('expected_close_date', e.target.value)} style={{ fontSize: '16px' }} />
        </div>
      </div>

      {/* Client */}
      <div className="card space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Datos del cliente</p>
        <ClientAutocomplete
          field="name"
          label="Nombre / Empresa"
          value={clientQuery}
          onChange={(v) => { setClientQuery(v); set('client_name', v) }}
          onSelect={handleSelectClient}
          contacts={contacts}
          companies={companies}
          placeholder="Buscar en contactos o escribir nombre..."
          inputClassName="input"
          labelClassName="label"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ClientAutocomplete field="ruc" label="RUC" value={form.client_ruc}
            onChange={(v) => set('client_ruc', v)} onSelect={handleSelectClient}
            contacts={contacts} companies={companies} placeholder="RUC"
            inputClassName="input" labelClassName="label" />
          <ClientAutocomplete field="email" label="Email" type="email" value={form.client_email}
            onChange={(v) => set('client_email', v)} onSelect={handleSelectClient}
            contacts={contacts} companies={companies} placeholder="correo@ejemplo.com"
            inputClassName="input" labelClassName="label" />
          <ClientAutocomplete field="phone" label="Teléfono" value={form.client_phone}
            onChange={(v) => set('client_phone', v)} onSelect={handleSelectClient}
            contacts={contacts} companies={companies} placeholder="6xxx-xxxx"
            inputClassName="input" labelClassName="label" />
          <ClientAutocomplete field="address" label="Dirección" value={form.client_address}
            onChange={(v) => set('client_address', v)} onSelect={handleSelectClient}
            contacts={contacts} companies={companies} placeholder="Dirección"
            inputClassName="input" labelClassName="label" />
        </div>
      </div>

      {/* Assignment & notes */}
      <div className="card space-y-3">
        <div>
          <label className="label">Asignar a vendedor</label>
          <select className="input" value={form.assigned_to_id} onChange={e => set('assigned_to_id', e.target.value)} style={{ fontSize: '16px' }}>
            <option value="">— Sin asignar —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Notas</label>
          <textarea className="input resize-none" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Notas internas..." style={{ fontSize: '16px' }} />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 px-5 py-2.5 disabled:opacity-50">
          <Save size={14} /> {saving ? 'Guardando...' : 'Guardar'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
      </div>
    </form>
  )
}

// ── Main page ────────────────────────────────────────────
export default function Oportunidades() {
  const navigate = useNavigate()
  const { ref: urlRef } = useParams()
  const [opps, setOpps] = useState([])
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [converting, setConverting] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const detailSwipe = useTouchSwipe({ onSwipeRight: () => { setMobileDetailOpen(false); navigate(-1) } })
  const [activeTab, setActiveTab] = useState('list')
  const [reports, setReports] = useState(null)
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPriority, setFilterPriority] = useState('')

  const loadOpps = useCallback(async () => {
    try {
      const params = {}
      if (search) params.search = search
      if (filterStatus) params.status = filterStatus
      if (filterPriority) params.priority = filterPriority
      const res = await getOpportunities(params)
      setOpps(res.data)
    } catch {
      toast.error('Error cargando oportunidades')
    }
  }, [search, filterStatus, filterPriority])

  useEffect(() => { loadOpps() }, [loadOpps])

  useEffect(() => {
    if (!urlRef) { if (selected) { setSelected(null); setMobileDetailOpen(false) } return }
    if (opps.length === 0) return
    if (String(selected?.id) === urlRef) return
    const found = opps.find(o => String(o.id) === urlRef)
    if (found) { setSelected(found); setEditing(false); setMobileDetailOpen(true) }
  }, [urlRef, opps])

  useEffect(() => {
    getUsers().then(r => setUsers(r.data.filter(u => ['admin', 'agent', 'ventas'].includes(u.role)))).catch(() => {})
  }, [])

  useEffect(() => {
    if (activeTab === 'dashboard') {
      getOpportunityReports().then(r => setReports(r.data)).catch(() => toast.error('Error cargando reporte'))
    }
  }, [activeTab])

  const handleNew = () => {
    setSelected(null)
    setEditing(true)
    setIsNew(true)
    setMobileDetailOpen(true)
  }

  const handleEdit = () => setEditing(true)

  const handleSave = async (payload) => {
    setSaving(true)
    try {
      if (isNew) {
        const res = await createOpportunity(payload)
        setSelected(res.data)
        toast.success('Oportunidad creada')
      } else {
        const res = await updateOpportunity(selected.id, payload)
        setSelected(res.data)
        toast.success('Oportunidad actualizada')
      }
      setEditing(false)
      setIsNew(false)
      loadOpps()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error guardando oportunidad')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    if (!await showConfirm(`¿Eliminar "${selected.title}"?`)) return
    try {
      await deleteOpportunity(selected.id)
      toast.success('Oportunidad eliminada')
      setSelected(null)
      setMobileDetailOpen(false)
      navigate('/oportunidades', { replace: true })
      loadOpps()
    } catch {
      toast.error('Error eliminando oportunidad')
    }
  }

  const handleConvert = async () => {
    if (!selected) return
    setConverting(true)
    try {
      const res = await convertOpportunityToQuote(selected.id)
      toast.success(`Cotización ${res.data.quote_number} creada`)
      // Reload opp to get updated quote_id
      const updated = await getOpportunities({ search: '', status: '', priority: '' })
      setOpps(updated.data)
      const fresh = updated.data.find(o => o.id === selected.id)
      if (fresh) setSelected(fresh)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error generando cotización')
    } finally {
      setConverting(false)
    }
  }

  const handleCancel = () => {
    setEditing(false)
    setIsNew(false)
    if (isNew) { setMobileDetailOpen(false); setSelected(null); navigate('/oportunidades', { replace: true }) }
  }

  const filtered = opps

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <button
          onClick={() => setActiveTab('list')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${activeTab === 'list' ? 'bg-violet-100 text-violet-700' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <Target size={14} /> Oportunidades
        </button>
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-violet-100 text-violet-700' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <BarChart2 size={14} /> Tablero
        </button>
      </div>

      {activeTab === 'dashboard' ? (
        <div className="flex-1 overflow-y-auto">
          <Dashboard reports={reports} />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel */}
          <div className={`${mobileDetailOpen ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-gray-200 bg-white flex-shrink-0`}>
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-lg font-bold text-gray-900">Oportunidades</h1>
                  <p className="text-xs text-violet-500 font-medium mt-0.5">{filtered.length} registrada{filtered.length !== 1 ? 's' : ''}</p>
                </div>
                <button onClick={handleNew} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
                  <Plus size={15} /> Nueva
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="px-4 py-3 space-y-2 border-b border-gray-100">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input pl-8 w-full text-sm"
                  placeholder="Buscar..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ fontSize: '16px' }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select className="input text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ fontSize: '16px' }}>
                  <option value="">Todos los estados</option>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="input text-sm" value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={{ fontSize: '16px' }}>
                  <option value="">Toda prioridad</option>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                  <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center mb-4">
                    <Target size={28} className="text-violet-300" />
                  </div>
                  <p className="text-sm font-medium text-gray-400">Sin oportunidades</p>
                  <p className="text-xs text-gray-300 mt-1">Usa "Nueva" para registrar tu primera oportunidad</p>
                </div>
              ) : filtered.map(opp => (
                <button
                  key={opp.id}
                  onClick={() => { setSelected(opp); setEditing(false); setMobileDetailOpen(true); navigate(`/oportunidades/${opp.id}`) }}
                  className={`w-full flex items-start gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left ${selected?.id === opp.id ? 'bg-violet-50 border-l-2 border-l-violet-500' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{opp.title}</p>
                    {opp.client_name && <p className="text-xs text-gray-400 truncate mt-0.5">{opp.client_name}</p>}
                    {opp.estimated_value && (
                      <p className="text-xs font-semibold text-green-600 mt-0.5">{fmtMoney(opp.estimated_value)}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0 flex flex-col items-end gap-1">
                    {opp.expected_close_date && (
                      <span className="text-xs text-gray-300">{fmtD(opp.expected_close_date)}</span>
                    )}
                    <StatusBadge status={opp.status} />
                    <div className="flex items-center gap-1">
                      {opp.priority === 'Alta' && <PriorityBadge priority={opp.priority} />}
                      {opp.quote_id && (
                        <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-medium">
                          <FileText size={9} /> COT
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div className={`${mobileDetailOpen ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-y-auto overscroll-contain min-h-0 bg-gray-50`} {...detailSwipe}>
            {mobileDetailOpen && (
              <button
                onClick={() => { setMobileDetailOpen(false); navigate(-1) }}
                className="md:hidden flex items-center gap-2 text-sm text-gray-500 px-4 py-3 border-b border-gray-100 bg-white"
              >
                <ArrowLeft size={16} /> Volver
              </button>
            )}

            {editing ? (
              <OppForm
                initial={isNew ? null : {
                  ...selected,
                  assigned_to_id: selected?.assigned_to_id || '',
                  expected_close_date: selected?.expected_close_date || '',
                  source: selected?.source || '',
                  category: selected?.category || '',
                  description: selected?.description || '',
                  notes: selected?.notes || '',
                  estimated_value: selected?.estimated_value || '',
                }}
                users={users}
                onSave={handleSave}
                onCancel={handleCancel}
                saving={saving}
              />
            ) : selected ? (
              <OppDetail
                opp={selected}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onConvert={handleConvert}
                converting={converting}
                onVisitsChanged={async () => {
                  await loadOpps()
                  const res = await getOpportunities({})
                  const fresh = res.data.find(o => o.id === selected.id)
                  if (fresh) setSelected(fresh)
                }}
                onQuoteLinked={async () => {
                  await loadOpps()
                  const res = await getOpportunities({})
                  const fresh = res.data.find(o => o.id === selected.id)
                  if (fresh) setSelected(fresh)
                }}
                onQuoteUnlinked={async () => {
                  await loadOpps()
                  const res = await getOpportunities({})
                  const fresh = res.data.find(o => o.id === selected.id)
                  if (fresh) setSelected(fresh)
                }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 text-center px-4">
                <div className="w-20 h-20 rounded-2xl bg-violet-50 flex items-center justify-center mb-4">
                  <Target size={36} className="text-violet-200" />
                </div>
                <p className="text-sm font-medium text-gray-400">Selecciona una oportunidad</p>
                <p className="text-xs text-gray-300 mt-1">o crea una nueva con el botón "Nueva"</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
