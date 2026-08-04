import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAgenda, syncCalendar, getCalendarStatus, getAgents, cancelTicketVisit } from '../services/api'
import {
  ChevronLeft, ChevronRight, Calendar, MapPin, Tag,
  ExternalLink, List, CalendarDays, Clock, RefreshCw, User, XCircle, Wifi
} from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, isSameMonth, isSameDay, addMonths, subMonths
} from 'date-fns'
import { es } from 'date-fns/locale'
import { formatInTimeZone } from 'date-fns-tz'
import toast from 'react-hot-toast'
import { fmtTime, fmtHourLabel, getFmtTz, toUTC } from '../utils/fmt'
import { useModules } from '../context/ModulesContext'

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7) // 7:00 → 21:00
const HOUR_HEIGHT = 64 // px per hour
const START_HOUR = 7
const GOOGLE_COLOR = '#34A853'

function evKey(ev) {
  if (ev.source === 'google') return `google-${ev.google_event_id}`
  if (ev.source === 'order') return `order-${ev.order_id}`
  if (ev.source === 'dispatch') return `dispatch-${ev.dispatch_id}`
  return `ticket-${ev.ticket_id}`
}
const REMOTE_COLOR = '#7C3AED' // violet-600

function evColor(ev) {
  if (ev.visit_status === 'cancelled') return '#EF4444'
  if (ev.is_remote) return REMOTE_COLOR
  if (ev.source === 'google') return GOOGLE_COLOR
  return ev.status?.color || '#3B82F6'
}
function evClick(ev, navigate) {
  if (ev.source === 'google') {
    if (ev.calendar_event_link) window.open(ev.calendar_event_link, '_blank')
  } else if (ev.source === 'order') {
    navigate('/orders')
  } else if (ev.source === 'dispatch') {
    navigate('/pedidos')
  } else {
    navigate(`/tickets/${ev.ticket_id}`)
  }
}
function evLabel(ev) {
  if (ev.source === 'google') return ev.raw_title
  if (ev.source === 'order') return `Pedido #${ev.order_id} ${ev.raw_title}`
  if (ev.source === 'dispatch') return `Pedido #${ev.dispatch_id} ${ev.raw_title}`
  return `#${ev.ticket_id} ${ev.raw_title}`
}

function evTop(ev) {
  const d = toUTC(ev.scheduled_at)
  const tz = getFmtTz()
  const h = parseInt(formatInTimeZone(d, tz, 'H'))
  const m = parseInt(formatInTimeZone(d, tz, 'm'))
  return ((h - START_HOUR) + m / 60) * HOUR_HEIGHT
}
function evHeight(ev) {
  return Math.max(((ev.duration_minutes || 60) / 60) * HOUR_HEIGHT, 24)
}

function fmtHour(h) { return fmtHourLabel(h) }

export default function Agenda() {
  const navigate = useNavigate()
  const { modules } = useModules()
  const gcalEnabled = modules?.google_calendar !== false
  const [currentDate, setCurrentDate] = useState(new Date())
  const [view, setView] = useState('month') // month | week | day | list
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [calConnected, setCalConnected] = useState(false)
  const [agentFilter, setAgentFilter] = useState('')
  const [agents, setAgents] = useState([])
  const [cancelling, setCancelling] = useState(null)
  const fetchedRef = useRef(new Set())

  const handleCancelVisit = async (visitId, e) => {
    e.stopPropagation()
    setCancelling(visitId)
    try {
      await cancelTicketVisit(visitId)
      setEvents(prev => prev.map(ev =>
        ev.visit_id === visitId ? { ...ev, visit_status: 'cancelled' } : ev
      ))
      toast.success('Visita cancelada — quedará en rojo en Google Calendar')
    } catch {
      toast.error('Error al cancelar visita')
    } finally {
      setCancelling(null)
    }
  }

  const checkCalConnected = () =>
    getCalendarStatus().then(r => setCalConnected(!!r.data?.connected)).catch(() => setCalConnected(false))

  useEffect(() => {
    checkCalConnected()
    getAgents().then(r => setAgents(r.data || [])).catch(() => {})
    // Re-check when tab becomes visible (user may have connected from Profile)
    const onVisible = () => { if (!document.hidden) checkCalConnected() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await syncCalendar()
      const d = res.data ?? {}
      const updated  = d.updated  ?? 0
      const found    = d.found    ?? '?'
      const matched  = d.matched  ?? '?'
      const unmatched = d.unmatched ?? 0
      if (updated > 0) {
        toast.success(`${updated} evento(s) actualizado(s) desde Google Calendar`)
      } else if (matched === 0 && found > 0) {
        toast.error(`Sin coincidencias — Google: ${found} eventos, BD: ${d.db_records ?? 0} registros con ID (0 coinciden). Los IDs de Google no coinciden con los almacenados.`, { duration: 8000 })
      } else if (found === 0) {
        toast.error('Google Calendar devolvió 0 eventos en el período ±1 año')
      } else {
        toast.success(`Sincronizado (sin cambios de horario) · Google: ${found} · Coincidencias: ${matched}${unmatched > 0 ? ` · Sin coincidir: ${unmatched}` : ''}`)
      }
      fetchedRef.current.clear()
      setEvents([])
      const y = currentDate.getFullYear()
      const m = currentDate.getMonth() + 1
      const r = await getAgenda(y, m)
      setEvents(r.data.events || [])
    } catch (err) {
      // Re-check real connection status after any sync failure
      getCalendarStatus()
        .then(r => setCalConnected(!!r.data?.connected))
        .catch(() => setCalConnected(false))
    } finally {
      setSyncing(false)
    }
  }

  const fetchMonth = useCallback(async (year, month) => {
    const key = `${year}-${String(month).padStart(2, '0')}`
    if (fetchedRef.current.has(key)) return
    fetchedRef.current.add(key)
    setLoading(true)
    try {
      const res = await getAgenda(year, month)
      setEvents((prev) => {
        const filtered = prev.filter((ev) => ev.scheduled_at.slice(0, 7) !== key)
        return [...filtered, ...(res.data.events || [])]
      })
    } catch {
      fetchedRef.current.delete(key)
      toast.error('Error cargando agenda')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const y = currentDate.getFullYear()
    const m = currentDate.getMonth() + 1
    fetchMonth(y, m)

    // For week view fetch adjacent months if week crosses boundary
    if (view === 'week') {
      const ws = startOfWeek(currentDate)
      const we = endOfWeek(currentDate)
      if (ws.getMonth() + 1 !== m) fetchMonth(ws.getFullYear(), ws.getMonth() + 1)
      if (we.getMonth() + 1 !== m) fetchMonth(we.getFullYear(), we.getMonth() + 1)
    }
  }, [currentDate, view, fetchMonth])

  // Auto-sync con Google Calendar cada 10 minutos (solo si está conectado)
  const currentDateRef = useRef(currentDate)
  useEffect(() => { currentDateRef.current = currentDate }, [currentDate])

  useEffect(() => {
    if (!calConnected) return
    const autoSync = async () => {
      try {
        const res = await syncCalendar()
        if ((res.data?.updated ?? 0) > 0) {
          fetchedRef.current.clear()
          setEvents([])
          const y = currentDateRef.current.getFullYear()
          const m = currentDateRef.current.getMonth() + 1
          const r = await getAgenda(y, m)
          setEvents(r.data.events || [])
          toast.success(`Agenda actualizada automáticamente (${res.data.updated} cambio${res.data.updated !== 1 ? 's' : ''} desde Google Calendar)`)
        }
      } catch {
        // silencioso
      }
    }
    const id = setInterval(autoSync, 10 * 60 * 1000)
    return () => clearInterval(id)
  }, [calConnected])

  // ── Navigation ──────────────────────────────────────
  const prev = () => {
    if (view === 'month' || view === 'list') setCurrentDate((d) => subMonths(d, 1))
    else if (view === 'week') setCurrentDate((d) => addDays(d, -7))
    else setCurrentDate((d) => addDays(d, -1))
  }
  const next = () => {
    if (view === 'month' || view === 'list') setCurrentDate((d) => addMonths(d, 1))
    else if (view === 'week') setCurrentDate((d) => addDays(d, 7))
    else setCurrentDate((d) => addDays(d, 1))
  }
  const goToday = () => setCurrentDate(new Date())

  // ── Title ────────────────────────────────────────────
  const title = (() => {
    if (view === 'month' || view === 'list')
      return format(currentDate, 'MMMM yyyy', { locale: es }).replace(/^\w/, c => c.toUpperCase())
    if (view === 'week') {
      const ws = startOfWeek(currentDate)
      const we = endOfWeek(currentDate)
      return ws.getMonth() === we.getMonth()
        ? `${format(ws, 'd')} – ${format(we, 'd')} de ${format(ws, 'MMMM yyyy', { locale: es })}`
        : `${format(ws, "d 'de' MMM", { locale: es })} – ${format(we, "d 'de' MMM yyyy", { locale: es })}`
    }
    return format(currentDate, "EEEE d 'de' MMMM yyyy", { locale: es }).replace(/^\w/, c => c.toUpperCase())
  })()

  const matchAgent = (ev) => !agentFilter || ev.assigned_agent === agentFilter

  // ── Events for current period ─────────────────────────
  const periodEvents = (() => {
    if (view === 'month' || view === 'list') {
      return events.filter((ev) => isSameMonth(toUTC(ev.scheduled_at), currentDate) && matchAgent(ev))
        .sort((a, b) => toUTC(a.scheduled_at) - toUTC(b.scheduled_at))
    }
    if (view === 'week') {
      const ws = startOfWeek(currentDate)
      const we = endOfWeek(currentDate)
      return events.filter((ev) => { const d = toUTC(ev.scheduled_at); return d >= ws && d <= we && matchAgent(ev) })
        .sort((a, b) => toUTC(a.scheduled_at) - toUTC(b.scheduled_at))
    }
    return events.filter((ev) => isSameDay(toUTC(ev.scheduled_at), currentDate) && matchAgent(ev))
      .sort((a, b) => toUTC(a.scheduled_at) - toUTC(b.scheduled_at))
  })()

  const eventsForDay = (day) => events.filter((ev) => isSameDay(toUTC(ev.scheduled_at), day) && matchAgent(ev))

  // ── Month grid ────────────────────────────────────────
  const calStart = startOfWeek(startOfMonth(currentDate))
  const calEnd   = endOfWeek(endOfMonth(currentDate))
  const days = []
  let d = calStart
  while (d <= calEnd) { days.push(d); d = addDays(d, 1) }

  const [selectedDay, setSelectedDay] = useState(null)

  const goDay = (day) => { setCurrentDate(day); setView('day') }

  const VIEWS = [
    { key: 'month', label: 'Mes',    Icon: CalendarDays },
    { key: 'week',  label: 'Semana', Icon: CalendarDays },
    { key: 'day',   label: 'Día',    Icon: Clock },
    { key: 'list',  label: 'Lista',  Icon: List },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* ── Header ── */}
      <div className="flex items-start sm:items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Agenda</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {title} · <span className="font-medium">{periodEvents.length}</span> cita{periodEvents.length !== 1 ? 's' : ''}
            {agentFilter && <span className="ml-2 text-blue-600 font-medium">· {agentFilter}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {VIEWS.map(({ key, label, Icon }) => (
              <button key={key} onClick={() => setView(key)}
                className={`px-2 sm:px-3 py-1.5 flex items-center gap-1 sm:gap-1.5 transition-colors border-r border-gray-200 last:border-0 ${
                  view === key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                <Icon size={13} /> <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
          <button onClick={goToday} className="btn-secondary text-sm">Hoy</button>
          {gcalEnabled && calConnected && (
            <button onClick={handleSync} disabled={syncing} title="Sincronizar con Google Calendar" className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{syncing ? 'Sincronizando...' : 'Sync'}</span>
            </button>
          )}
          {agents.length > 0 && (
            <div className="relative">
              <User size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <select
                value={agentFilter}
                onChange={e => setAgentFilter(e.target.value)}
                className={`pl-7 pr-7 py-1.5 text-sm rounded-lg border transition-colors appearance-none cursor-pointer ${agentFilter ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                <option value="">Todos los agentes</option>
                {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-1">
            <button onClick={prev} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"><ChevronLeft size={16} /></button>
            <button onClick={next} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {loading && <div className="text-center py-10 text-gray-400 text-sm">Cargando...</div>}

      {!loading && view === 'week' && (
        <WeekView events={periodEvents} currentDate={currentDate} navigate={navigate} onDayClick={goDay} />
      )}

      {!loading && view === 'day' && (
        <DayView events={periodEvents} currentDate={currentDate} navigate={navigate} onCancel={handleCancelVisit} cancelling={cancelling} />
      )}

      {!loading && view === 'list' && (
        <ListView events={periodEvents} navigate={navigate} onCancel={handleCancelVisit} cancelling={cancelling} />
      )}

      {!loading && view === 'month' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Month grid */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
              {DAY_LABELS.map((dl) => (
                <div key={dl} className="py-2 text-center text-xs font-semibold text-gray-400">{dl}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day, i) => {
                const dayEvs = eventsForDay(day)
                const inMonth  = isSameMonth(day, currentDate)
                const isToday  = isSameDay(day, new Date())
                const isSel    = selectedDay && isSameDay(day, selectedDay)
                return (
                  <div key={i} onClick={() => setSelectedDay(day)}
                    className={`min-h-[80px] p-1.5 border-b border-r border-gray-50 cursor-pointer transition-colors
                      ${!inMonth ? 'bg-gray-50/50' : 'hover:bg-blue-50/30'}
                      ${isSel ? 'bg-blue-50 ring-1 ring-blue-200 ring-inset' : ''}`}>
                    <span className={`text-xs font-medium inline-flex w-6 h-6 items-center justify-center rounded-full
                      ${isToday ? 'bg-blue-600 text-white' : inMonth ? 'text-gray-700' : 'text-gray-300'}`}>
                      {format(day, 'd')}
                    </span>
                    <div className="mt-0.5 space-y-0.5">
                      {dayEvs.slice(0, 2).map((ev) => (
                        <div key={evKey(ev)}
                          className="text-xs px-1 py-0.5 rounded truncate text-white font-medium"
                          style={{ backgroundColor: evColor(ev) }}
                          title={ev.title}>
                          {fmtTime(ev.scheduled_at)} {ev.raw_title}
                        </div>
                      ))}
                      {dayEvs.length > 2 && <div className="text-xs text-gray-400 pl-1">+{dayEvs.length - 2} más</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Side panel */}
          <div className="space-y-3">
            {selectedDay ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900 text-sm">
                    {format(selectedDay, "EEEE d 'de' MMMM", { locale: es }).replace(/^\w/, c => c.toUpperCase())}
                  </h3>
                  <button onClick={() => goDay(selectedDay)} className="text-xs text-blue-600 hover:underline">
                    Ver día →
                  </button>
                </div>
                {eventsForDay(selectedDay).length === 0 ? (
                  <div className="card py-8 text-center">
                    <Calendar size={28} className="mx-auto text-gray-200 mb-2" />
                    <p className="text-sm text-gray-400">Sin citas este día</p>
                  </div>
                ) : (
                  eventsForDay(selectedDay).map((ev) => <EventCard key={evKey(ev)} ev={ev} navigate={navigate} onCancel={handleCancelVisit} cancelling={cancelling} />)
                )}
              </>
            ) : (
              <div className="card py-8 text-center">
                <CalendarDays size={28} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">Selecciona un día para ver las citas</p>
              </div>
            )}

            {periodEvents.filter(ev => toUTC(ev.scheduled_at) >= new Date()).length > 0 && (
              <div className="card">
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Próximas del mes</h4>
                <div className="space-y-2">
                  {periodEvents.filter(ev => toUTC(ev.scheduled_at) >= new Date()).slice(0, 5).map((ev) => (
                    <button key={evKey(ev)} onClick={() => evClick(ev, navigate)}
                      className="w-full text-left flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                      <div className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: evColor(ev) }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-900 truncate">{evLabel(ev)}</p>
                        <p className="text-xs text-gray-400">
                          {formatInTimeZone(toUTC(ev.scheduled_at), getFmtTz(), "d MMM", { locale: es })} · {fmtTime(ev.scheduled_at)}
                          {ev.location && ` · ${ev.location}`}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Week View ─────────────────────────────────────────────
function WeekView({ events, currentDate, navigate, onDayClick }) {
  const weekStart = startOfWeek(currentDate)
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const totalH    = HOURS.length * HOUR_HEIGHT
  const scrollRef = useRef(null)

  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  const tz = getFmtTz()
  const nowH = parseInt(formatInTimeZone(now, tz, 'H'))
  const nowM = parseInt(formatInTimeZone(now, tz, 'm'))
  const nowTop = ((nowH - START_HOUR) + nowM / 60) * HOUR_HEIGHT
  const showNow = nowH >= START_HOUR && nowH < START_HOUR + HOURS.length
  const isCurrentWeek = weekDays.some(d => isSameDay(d, now))

  useEffect(() => {
    if (scrollRef.current && showNow) {
      scrollRef.current.scrollTop = Math.max(0, nowTop - 120)
    }
  }, []) // eslint-disable-line

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Single container handles both x (mobile) and y scrolling so header stays aligned */}
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: '62vh' }}>
        <div style={{ minWidth: '560px' }}>

        {/* Day headers — sticky vertically, scrolls horizontally with body */}
        <div className="sticky top-0 z-10 grid border-b border-gray-100 bg-gray-50" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
          <div className="py-2" />
          {weekDays.map((day) => {
            const isToday = isSameDay(day, new Date())
            return (
              <div key={day.toISOString()}
                className="py-2 text-center border-l border-gray-100 cursor-pointer hover:bg-blue-50 transition-colors"
                onClick={() => onDayClick(day)}>
                <p className="text-xs text-gray-500 uppercase">{format(day, 'EEE', { locale: es })}</p>
                <p className={`text-sm font-bold mt-0.5 w-7 h-7 mx-auto rounded-full flex items-center justify-center
                  ${isToday ? 'bg-blue-600 text-white' : 'text-gray-800'}`}>
                  {format(day, 'd')}
                </p>
              </div>
            )
          })}
        </div>

        {/* Time grid — absolute positioning */}
        <div className="flex relative" style={{ height: totalH }}>
          {/* Hour labels */}
          <div className="w-14 flex-shrink-0 relative">
            {HOURS.map((h) => (
              <div key={h} className="absolute w-full border-b border-gray-100"
                style={{ top: (h - START_HOUR) * HOUR_HEIGHT, height: HOUR_HEIGHT }}>
                <span className="absolute -top-2.5 right-1.5 text-xs text-gray-400 select-none whitespace-nowrap">
                  {fmtHour(h)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((day) => {
            const dayEvs = events.filter((ev) => isSameDay(toUTC(ev.scheduled_at), day))
            const isToday = isSameDay(day, new Date())
            return (
              <div key={day.toISOString()}
                className={`flex-1 border-l border-gray-100 relative ${isToday ? 'bg-blue-50/20' : ''}`}
                style={{ height: totalH }}>
                {HOURS.map((h) => (
                  <div key={h} className="absolute w-full border-b border-gray-100"
                    style={{ top: (h - START_HOUR) * HOUR_HEIGHT, height: HOUR_HEIGHT }} />
                ))}
                {dayEvs.map((ev) => (
                  <button key={evKey(ev)}
                    onClick={() => evClick(ev, navigate)}
                    className="absolute left-0.5 right-0.5 rounded text-white text-xs font-medium text-left px-1 py-0.5 overflow-hidden hover:opacity-90 transition-opacity z-10"
                    style={{
                      top: evTop(ev),
                      height: evHeight(ev),
                      backgroundColor: evColor(ev),
                    }}
                    title={ev.title}>
                    <span className="block font-bold leading-tight truncate">{fmtTime(ev.scheduled_at)}</span>
                    <span className="block truncate leading-tight">{evLabel(ev)}</span>
                  </button>
                ))}
              </div>
            )
          })}

          {/* Current time indicator */}
          {showNow && isCurrentWeek && (
            <div className="absolute z-20 pointer-events-none flex items-center"
              style={{ top: nowTop, left: 56, right: 0 }}>
              <div className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0 -translate-x-[5px]" />
              <div className="flex-1 h-px bg-red-500" />
            </div>
          )}
        </div>
        </div>{/* minWidth wrapper */}
      </div>{/* scrollRef */}
    </div>
  )
}

// ── Day View ──────────────────────────────────────────────
function DayView({ events, currentDate, navigate, onCancel, cancelling }) {
  const isToday = isSameDay(currentDate, new Date())
  const hasAny = events.length > 0
  const scrollRef = useRef(null)

  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  const tz = getFmtTz()
  const nowH = parseInt(formatInTimeZone(now, tz, 'H'))
  const nowM = parseInt(formatInTimeZone(now, tz, 'm'))
  const nowTop = ((nowH - START_HOUR) + nowM / 60) * HOUR_HEIGHT
  const showNow = isToday && nowH >= START_HOUR && nowH < START_HOUR + HOURS.length

  useEffect(() => {
    if (scrollRef.current && showNow) {
      scrollRef.current.scrollTop = Math.max(0, nowTop - 120)
    }
  }, []) // eslint-disable-line

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Time grid */}
      <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className={`px-4 py-3 border-b border-gray-100 flex items-center gap-3 ${isToday ? 'bg-blue-50' : 'bg-gray-50'}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg flex-shrink-0
            ${isToday ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>
            {format(currentDate, 'd')}
          </div>
          <div>
            <p className="font-semibold text-gray-900 capitalize">
              {format(currentDate, "EEEE", { locale: es })}
            </p>
            <p className="text-xs text-gray-500">
              {format(currentDate, "d 'de' MMMM yyyy", { locale: es })}
              {isToday && <span className="ml-2 text-blue-600 font-medium">· Hoy</span>}
            </p>
          </div>
          <span className="ml-auto text-sm font-medium text-gray-500">{events.length} cita{events.length !== 1 ? 's' : ''}</span>
        </div>

        <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: '65vh' }}>
          <div className="flex" style={{ height: HOURS.length * HOUR_HEIGHT }}>
            {/* Hour labels */}
            <div className="w-16 flex-shrink-0 relative">
              {HOURS.map((h) => (
                <div key={h} className="absolute w-full border-b border-gray-100"
                  style={{ top: (h - START_HOUR) * HOUR_HEIGHT, height: HOUR_HEIGHT }}>
                  <span className="absolute -top-2.5 right-3 text-xs text-gray-400 select-none whitespace-nowrap">
                    {fmtHour(h)}
                  </span>
                </div>
              ))}
            </div>
            {/* Events area */}
            <div className="flex-1 border-l border-gray-100 relative" style={{ height: HOURS.length * HOUR_HEIGHT }}>
              {HOURS.map((h) => (
                <div key={h} className="absolute w-full border-b border-gray-100"
                  style={{ top: (h - START_HOUR) * HOUR_HEIGHT, height: HOUR_HEIGHT }} />
              ))}
              {/* Current time indicator */}
              {showNow && (
                <div className="absolute z-20 pointer-events-none flex items-center"
                  style={{ top: nowTop, left: 0, right: 0 }}>
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0 -translate-x-[5px]" />
                  <div className="flex-1 h-px bg-red-500" />
                </div>
              )}
              {events.map((ev) => (
                <div key={evKey(ev)}
                  className="absolute left-2 right-2 rounded-lg border bg-white cursor-pointer hover:shadow-md transition-shadow overflow-hidden z-10"
                  style={{
                    top: evTop(ev),
                    height: evHeight(ev),
                    borderLeftColor: evColor(ev),
                    borderLeftWidth: 4,
                    borderColor: '#E5E7EB',
                  }}
                  onClick={() => evClick(ev, navigate)}>
                  <div className="px-2 py-1 h-full overflow-hidden">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold whitespace-nowrap" style={{ color: evColor(ev) }}>{fmtTime(ev.scheduled_at)}</span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {ev.duration_minutes < 60
                          ? `${ev.duration_minutes} min`
                          : `${ev.duration_minutes / 60}h${ev.duration_minutes % 60 ? ` ${ev.duration_minutes % 60}m` : ''}`}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 truncate leading-tight">{evLabel(ev)}</p>
                    {evHeight(ev) > 56 && ev.location && (
                      <span className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                        <MapPin size={10} />{ev.location}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Summary panel */}
      <div className="space-y-3">
        {hasAny ? (
          <>
            <h3 className="font-semibold text-gray-900 text-sm">Resumen del día</h3>
            <div className="space-y-2">
              {events.map((ev) => (
                <div key={evKey(ev)} className={`card p-3 hover:shadow-md transition-shadow cursor-pointer ${ev.visit_status === 'cancelled' ? 'opacity-60 bg-red-50 border-red-100' : ''}`}
                  onClick={() => evClick(ev, navigate)}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold" style={{ color: evColor(ev) }}>{fmtTime(ev.scheduled_at)}</span>
                      {ev.source === 'google' ? (
                        <span className="badge text-white text-xs" style={{ backgroundColor: GOOGLE_COLOR }}>Google</span>
                      ) : ev.visit_status === 'cancelled' ? (
                        <span className="badge bg-red-100 text-red-600 text-xs">Cancelada</span>
                      ) : (
                        <span className="badge text-white text-xs" style={{ backgroundColor: ev.status?.color || '#6B7280' }}>
                          {ev.status?.name}
                        </span>
                      )}
                    </div>
                    {ev.source === 'ticket' && ev.visit_id && ev.visit_status !== 'cancelled' && (
                      <button onClick={(e) => onCancel(ev.visit_id, e)} disabled={cancelling === ev.visit_id}
                        className="p-1 rounded text-gray-300 hover:text-red-500 disabled:opacity-50 flex-shrink-0" title="Cancelar visita">
                        <XCircle size={14} />
                      </button>
                    )}
                  </div>
                  <p className={`text-sm font-semibold truncate ${ev.visit_status === 'cancelled' ? 'text-red-400 line-through' : 'text-gray-900'}`}>{evLabel(ev)}</p>
                  {ev.location && (
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                      <MapPin size={10} />{ev.location}
                    </p>
                  )}
                  {ev.calendar_event_link && (
                    <a href={ev.calendar_event_link} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline flex items-center gap-1 mt-1"
                      onClick={(e) => e.stopPropagation()}>
                      <ExternalLink size={10} /> Ver en Google Calendar
                    </a>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="card py-12 text-center">
            <Calendar size={32} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm text-gray-400">Sin citas este día</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Event Card (month side panel) ────────────────────────
function EventCard({ ev, navigate, onCancel, cancelling }) {
  const isGoogle = ev.source === 'google'
  const isCancelled = ev.visit_status === 'cancelled'
  return (
    <div className={`card p-3 hover:shadow-md transition-shadow cursor-pointer ${isCancelled ? 'opacity-60 bg-red-50 border-red-100' : ''}`}
      onClick={() => evClick(ev, navigate)}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          {!isGoogle && <p className="text-xs text-gray-400 font-mono">#{ev.ticket_id}</p>}
          <p className={`font-semibold text-sm leading-tight truncate ${isCancelled ? 'text-red-400 line-through' : 'text-gray-900'}`}>{ev.title}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
          {ev.is_remote && !isCancelled && (
            <span className="inline-flex items-center gap-0.5 text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded px-1.5 py-0.5 font-medium">
              <Wifi size={10} /> Remoto
            </span>
          )}
          {isGoogle ? (
            <span className="badge text-white text-xs" style={{ backgroundColor: GOOGLE_COLOR }}>Google</span>
          ) : isCancelled ? (
            <span className="badge bg-red-100 text-red-600 text-xs">Cancelada</span>
          ) : (
            <span className="badge text-white text-xs" style={{ backgroundColor: ev.status?.color || '#6B7280' }}>
              {ev.status?.name}
            </span>
          )}
          {!isGoogle && ev.visit_id && !isCancelled && onCancel && (
            <button onClick={(e) => onCancel(ev.visit_id, e)} disabled={cancelling === ev.visit_id}
              className="p-1 rounded text-gray-300 hover:text-red-500 disabled:opacity-50" title="Cancelar visita">
              <XCircle size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="space-y-1 mb-2">
        <p className="text-xs font-medium" style={{ color: evColor(ev) }}>{fmtTime(ev.scheduled_at)}</p>
        {ev.location && (
          <p className="flex items-center gap-1 text-xs text-gray-500"><MapPin size={10} />{ev.location}</p>
        )}
        {ev.subject && (
          <p className="flex items-center gap-1 text-xs text-gray-500"><Tag size={10} />{ev.subject}</p>
        )}
      </div>
      {ev.calendar_event_link && (
        <a href={ev.calendar_event_link} target="_blank" rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:underline flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}>
          <ExternalLink size={10} /> Ver en Google Calendar
        </a>
      )}
    </div>
  )
}

// ── List View ─────────────────────────────────────────────
function ListView({ events, navigate, onCancel, cancelling }) {
  if (events.length === 0) {
    return (
      <div className="card py-16 text-center">
        <Calendar size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="text-gray-400">No hay citas agendadas este mes</p>
      </div>
    )
  }

  const groups = {}
  events.forEach((ev) => {
    const key = ev.scheduled_at.slice(0, 10)
    if (!groups[key]) groups[key] = []
    groups[key].push(ev)
  })

  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([dateKey, dayEvs]) => (
        <div key={dateKey}>
          <h3 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full" />
            {format(new Date(dateKey + 'T12:00:00'), "EEEE d 'de' MMMM yyyy", { locale: es }).replace(/^\w/, c => c.toUpperCase())}
          </h3>
          <div className="space-y-2">
            {dayEvs.map((ev) => {
              const isGoogle = ev.source === 'google'
              const isCancelled = ev.visit_status === 'cancelled'
              return (
                <div key={evKey(ev)}
                  className={`bg-white rounded-xl border p-4 flex gap-4 hover:shadow-sm transition-shadow cursor-pointer ${isCancelled ? 'border-red-100 bg-red-50 opacity-70' : 'border-gray-200'}`}
                  onClick={() => evClick(ev, navigate)}>
                  <div className="text-center flex-shrink-0 w-14">
                    <p className="text-sm font-bold" style={{ color: evColor(ev) }}>{fmtTime(ev.scheduled_at)}</p>
                    {ev.duration_minutes && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {ev.duration_minutes < 60 ? `${ev.duration_minutes}m` : `${ev.duration_minutes / 60}h`}
                      </p>
                    )}
                  </div>
                  <div className="w-1 rounded-full flex-shrink-0" style={{ backgroundColor: evColor(ev) }} />
                  <div className="flex-1 min-w-0">
                    {!isGoogle && <p className="text-xs text-gray-400 font-mono">#{ev.ticket_id}</p>}
                    <p className={`font-semibold text-sm ${isCancelled ? 'text-red-400 line-through' : 'text-gray-900'}`}>{ev.title}</p>
                    <div className="flex flex-wrap gap-3 mt-1">
                      {ev.location && <span className="flex items-center gap-1 text-xs text-gray-500"><MapPin size={10} />{ev.location}</span>}
                      {ev.subject && <span className="flex items-center gap-1 text-xs text-gray-500"><Tag size={10} />{ev.subject}</span>}
                      {ev.assigned_agent && <span className="text-xs text-gray-400">Agente: {ev.assigned_agent}</span>}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 flex-shrink-0 flex-wrap justify-end">
                    {ev.is_remote && !isCancelled && (
                      <span className="inline-flex items-center gap-0.5 text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded px-1.5 py-0.5 font-medium">
                        <Wifi size={10} /> Remoto
                      </span>
                    )}
                    {isGoogle ? (
                      <span className="badge text-white text-xs" style={{ backgroundColor: GOOGLE_COLOR }}>Google</span>
                    ) : isCancelled ? (
                      <span className="badge bg-red-100 text-red-600 text-xs">Cancelada</span>
                    ) : (
                      <span className="badge text-white text-xs" style={{ backgroundColor: ev.status?.color || '#6B7280' }}>
                        {ev.status?.name}
                      </span>
                    )}
                    {ev.calendar_event_link && (
                      <a href={ev.calendar_event_link} target="_blank" rel="noopener noreferrer"
                        className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-blue-500"
                        onClick={(e) => e.stopPropagation()}>
                        <ExternalLink size={13} />
                      </a>
                    )}
                    {!isGoogle && ev.visit_id && !isCancelled && onCancel && (
                      <button onClick={(e) => onCancel(ev.visit_id, e)} disabled={cancelling === ev.visit_id}
                        className="p-1 hover:bg-red-50 rounded text-gray-300 hover:text-red-500 disabled:opacity-50" title="Cancelar visita">
                        <XCircle size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
