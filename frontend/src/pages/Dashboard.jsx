import React, { useEffect, useState } from 'react'
import { getDashboard } from '../services/api'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import {
  Ticket, CheckCircle, Clock, AlertCircle,
  TrendingUp, TrendingDown, Minus, ArrowRight, Users, Timer,
  ShieldAlert, ShieldCheck, ShieldOff, Pause, RefreshCw
} from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import PriorityBadge from '../components/PriorityBadge'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'

// Color de cada barra en el gráfico de prioridad
const PRIORITY_COLORS = { Baja: '#6B7280', Media: '#3B82F6', Alta: '#F97316', Crítica: '#EF4444' }

// Tooltip personalizado para el gráfico de donut (estado)
const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="font-semibold text-gray-800">{payload[0].name}</p>
      <p className="text-gray-600">{payload[0].value} ticket{payload[0].value !== 1 ? 's' : ''}</p>
    </div>
  )
}

// Tooltip personalizado para el gráfico de barras de prioridad (muestra el label del eje X)
const PriorityTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="font-semibold text-gray-800">{label}</p>
      <p className="text-gray-600">{payload[0].value} ticket{payload[0].value !== 1 ? 's' : ''}</p>
    </div>
  )
}

// Tarjeta de métrica reutilizable: muestra un número grande con icono, subtítulo y tendencia opcional
function MetricCard({ label, value, icon: Icon, colorClass, bgClass, accentClass, sub, trend }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200/80 shadow-sm hover:shadow-md transition-shadow overflow-hidden`}>
      {/* Franja de color superior que identifica la categoría */}
      <div className={`h-1 ${accentClass || 'bg-gray-200'}`} />
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
            <p className="text-4xl font-bold text-gray-900 mt-2 leading-none tabular-nums">{value ?? '—'}</p>
            {sub && <p className="text-xs text-gray-400 mt-2">{sub}</p>}
          </div>
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${bgClass}`}>
            <Icon size={22} className={colorClass} />
          </div>
        </div>
        {/* Fila de tendencia vs mes anterior, solo cuando se pasa el prop trend */}
        {trend !== undefined && (
          <div className={`flex items-center gap-1 mt-4 pt-3 border-t border-gray-100 text-xs font-semibold ${trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-red-500' : 'text-gray-400'}`}>
            {trend > 0 ? <TrendingUp size={13} /> : trend < 0 ? <TrendingDown size={13} /> : <Minus size={13} />}
            {trend > 0 ? `+${trend}` : trend} vs mes anterior
          </div>
        )}
      </div>
    </div>
  )
}

// Leyenda personalizada del donut: puntos de color + nombre de estado en fila envolvente
const renderLegend = (props) => {
  const { payload } = props
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-2">
      {payload.map((entry, i) => (
        <li key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
          {entry.value}
        </li>
      ))}
    </ul>
  )
}

// Convierte una fecha de vencimiento SLA a texto relativo legible ("Venció hace 3h", "2d restantes", etc.)
function fmtDeadline(dt) {
  if (!dt) return '—'
  const d = new Date(dt)
  const now = new Date()
  const diffMs = d - now
  const diffH = diffMs / 3600000
  if (diffH < 0) {
    // SLA ya venció — mostrar cuánto tiempo hace
    const absH = Math.abs(diffH)
    if (absH < 1) return `Venció hace ${Math.round(absH * 60)}min`
    if (absH < 24) return `Venció hace ${Math.round(absH)}h`
    return `Venció hace ${Math.round(absH / 24)}d`
  }
  // SLA aún vigente — mostrar tiempo restante
  if (diffH < 1) return `${Math.round(diffH * 60)}min restantes`
  if (diffH < 24) return `${Math.round(diffH)}h restantes`
  return `${Math.round(diffH / 24)}d restantes`
}

export default function Dashboard() {
  const [data, setData] = useState(null)       // datos del backend (métricas, gráficas, SLA)
  const [loading, setLoading] = useState(true)  // carga inicial: muestra spinner
  const [refreshing, setRefreshing] = useState(false) // recarga manual: muestra icono girando
  const navigate = useNavigate()

  // isMobile reactivo: se actualiza al rotar o redimensionar la pantalla
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Llama al endpoint /dashboard y guarda la respuesta en `data`
  const loadData = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    getDashboard()
      .then((res) => setData(res.data))
      .catch(() => toast.error('Error cargando dashboard'))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }

  // Carga inicial al montar el componente
  useEffect(() => { loadData() }, [])

  if (loading) return (
    <div className="p-8 flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Cargando dashboard...</p>
      </div>
    </div>
  )
  if (!data) return null

  // Filtra estados con 0 tickets para no mostrar sectores vacíos en el donut
  const statusChartData = Object.entries(data.tickets_by_status)
    .filter(([, info]) => info.count > 0)
    .map(([name, info]) => ({ name, value: info.count, color: info.color }))

  // Arreglo fijo de 4 prioridades para el gráfico de barras (siempre muestra las 4 categorías)
  const priorityChartData = [
    { name: 'Baja',    cantidad: data.tickets_by_priority.low      || 0 },
    { name: 'Media',   cantidad: data.tickets_by_priority.medium   || 0 },
    { name: 'Alta',    cantidad: data.tickets_by_priority.high     || 0 },
    { name: 'Crítica', cantidad: data.tickets_by_priority.critical || 0 },
  ]

  // Top 8 agentes con más tickets; solo el primer nombre para que quepa en el eje Y
  const agentChartData = data.tickets_by_agent.slice(0, 8).map((a) => ({
    name: a.agent.split(' ')[0],
    tickets: a.count,
  }))

  // Diferencia de tickets entre el mes actual y el anterior (positivo = subió, negativo = bajó)
  const trend = data.tickets_this_month - data.tickets_last_month

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto">

      {/* ── Encabezado: título, fecha y botones de acción ── */}
      <div className="flex items-center justify-between gap-3 md:pr-14 lg:pr-28">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5 truncate">
            {format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Botón para recargar datos sin recargar la página */}
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            title="Actualizar dashboard"
            className="p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => navigate('/tickets/new')} className="btn-primary flex items-center gap-2 min-h-[44px]">
            <Ticket size={15} /> <span className="hidden sm:inline">Nuevo</span> Ticket
          </button>
        </div>
      </div>

      {/* ── Tarjetas de métricas principales (Total, Abiertos, Pendientes, Resueltos) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard
          label="Total Tickets"
          value={data.total_tickets}
          icon={Ticket}
          bgClass="bg-blue-50"
          colorClass="text-blue-600"
          accentClass="bg-blue-500"
          sub={`Este mes: ${data.tickets_this_month}`}
          trend={trend}
        />
        <MetricCard
          label="Abiertos"
          value={data.open_tickets}
          icon={AlertCircle}
          bgClass="bg-orange-50"
          colorClass="text-orange-500"
          accentClass="bg-orange-400"
          sub="Requieren atención"
        />
        <MetricCard
          label="Pendientes"
          value={data.pending_tickets}
          icon={Clock}
          bgClass="bg-amber-50"
          colorClass="text-amber-600"
          accentClass="bg-amber-400"
          sub="En espera"
        />
        <MetricCard
          label="Resueltos"
          value={data.resolved_tickets}
          icon={CheckCircle}
          bgClass="bg-emerald-50"
          colorClass="text-emerald-600"
          accentClass="bg-emerald-500"
          sub={data.avg_resolution_hours ? `Tiempo promedio: ${data.avg_resolution_hours}h` : 'Sin resoluciones aún'}
        />
      </div>

      {/* ── Gráficas fila 1: donut de estado + barras de prioridad ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Donut: distribución de tickets por estado con colores definidos en el backend */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-1">Tickets por Estado</h3>
          <p className="text-xs text-gray-400 mb-4">{data.total_tickets} tickets en total</p>
          {statusChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={isMobile ? 220 : 240}>
              <PieChart>
                <Pie
                  data={statusChartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy={isMobile ? '42%' : '45%'}
                  innerRadius={isMobile ? 50 : 55}
                  outerRadius={isMobile ? 78 : 85}
                  paddingAngle={2}
                >
                  {statusChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend content={renderLegend} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-52 text-gray-400 text-sm">Sin datos</div>
          )}
        </div>

        {/* Barras verticales: cantidad de tickets por nivel de prioridad con color propio */}
        {/* margin left negativo compensa el ancho fijo del YAxis para no recortar la barra "Crítica" en móvil */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-1">Tickets por Prioridad</h3>
          <p className="text-xs text-gray-400 mb-4">Distribución por nivel de urgencia</p>
          <ResponsiveContainer width="100%" height={isMobile ? 200 : 240}>
            <BarChart
              data={priorityChartData}
              barSize={isMobile ? 36 : 44}
              margin={{ top: 5, right: 10, left: isMobile ? -18 : 0, bottom: 0 }}
            >
              <XAxis
                dataKey="name"
                tick={{ fontSize: isMobile ? 11 : 12, fill: '#6B7280' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#6B7280' }}
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                width={28}
              />
              <Tooltip content={<PriorityTooltip />} cursor={{ fill: '#F3F4F6' }} />
              <Bar dataKey="cantidad" radius={[6, 6, 0, 0]}>
                {priorityChartData.map((entry) => (
                  <Cell key={entry.name} fill={PRIORITY_COLORS[entry.name]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Gráficas fila 2: barras horizontales por agente + lista de tickets recientes ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Barras horizontales: carga de trabajo de cada agente (top 8) */}
        <div className="card">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-gray-900">Tickets por Técnico</h3>
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Users size={12} /> {agentChartData.length} agente{agentChartData.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="text-xs text-gray-400 mb-4">Carga de trabajo por agente</p>
          {agentChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={isMobile ? 180 : 220}>
              <BarChart
                data={agentChartData}
                layout="vertical"
                barSize={isMobile ? 16 : 18}
                margin={{ top: 0, right: 15, left: 0, bottom: 0 }}
              >
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#6B7280' }}
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fontSize: isMobile ? 11 : 12, fill: '#6B7280' }}
                  width={isMobile ? 60 : 70}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F3F4F6' }} />
                <Bar dataKey="tickets" fill="#8B5CF6" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Sin agentes asignados</div>
          )}
        </div>

        {/* Lista de los 6 tickets más recientes con navegación al detalle */}
        {/* En móvil se oculta el badge de prioridad para evitar desbordamiento */}
        <div className="card flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Tickets Recientes</h3>
            <button
              onClick={() => navigate('/tickets')}
              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
            >
              Ver todos <ArrowRight size={12} />
            </button>
          </div>
          <div className="space-y-1 flex-1">
            {data.recent_tickets.slice(0, 6).map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group"
                onClick={() => navigate(`/tickets/${t.id}`)}
              >
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                  #{t.id}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {t.client?.name}{t.client?.company ? ` · ${t.client.company}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="hidden sm:flex"><PriorityBadge priority={t.priority} /></span>
                  <StatusBadge status={t.status_rel} />
                </div>
              </div>
            ))}
            {data.recent_tickets.length === 0 && (
              <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Sin tickets recientes</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Comparativo mensual + tiempo promedio de resolución ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card flex items-center gap-4">
          {trend >= 0 ? <TrendingUp size={26} className="text-green-500 flex-shrink-0" /> : <TrendingDown size={26} className="text-red-500 flex-shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Comparativo mensual</p>
            <p className="text-sm font-semibold text-gray-800 mt-0.5 flex flex-wrap items-center gap-x-2">
              <span>Este mes: <span className="text-blue-600">{data.tickets_this_month}</span></span>
              <span className="text-gray-300">·</span>
              <span>Anterior: <span className="text-gray-600">{data.tickets_last_month}</span></span>
            </p>
            <p className={`text-xs mt-0.5 font-medium ${trend > 0 ? 'text-green-600' : trend < 0 ? 'text-red-500' : 'text-gray-400'}`}>
              {trend === 0 ? 'Sin cambios' : `${trend > 0 ? '+' : ''}${trend} vs mes anterior`}
            </p>
          </div>
        </div>

        <div className="card flex items-center gap-4">
          <Timer size={26} className="text-blue-500 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Tiempo promedio de resolución</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">
              {data.avg_resolution_hours ? `${data.avg_resolution_hours}h` : '—'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {data.resolved_tickets} ticket{data.resolved_tickets !== 1 ? 's' : ''} resuelto{data.resolved_tickets !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* ── Sección SLA ── */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <ShieldAlert size={16} className="text-gray-500 flex-shrink-0" />
          <h2 className="text-base font-semibold text-gray-800">SLA</h2>
          <span className="hidden sm:inline text-base font-semibold text-gray-400">· Acuerdos de Nivel de Servicio</span>
          {/* Badge de cumplimiento global: verde ≥90%, amarillo ≥70%, rojo <70% */}
          {data.sla_compliance_rate !== null && data.sla_compliance_rate !== undefined && (
            <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${
              data.sla_compliance_rate >= 90 ? 'bg-green-100 text-green-700'
              : data.sla_compliance_rate >= 70 ? 'bg-yellow-100 text-yellow-700'
              : 'bg-red-100 text-red-700'
            }`}>
              {data.sla_compliance_rate}% cumplimiento
            </span>
          )}
        </div>

        {/* KPI cards de SLA: Vencidos (clickable → filtro), Por vencer, En plazo, Pausados */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
          <div
            className="card cursor-pointer active:bg-red-50 hover:shadow-md transition-shadow border-l-4 border-red-400"
            onClick={() => navigate('/tickets?sla=breached')}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Vencidos</p>
                <p className="text-3xl font-bold text-red-600 mt-1 leading-none">{data.sla_overdue}</p>
                <p className="text-xs text-gray-400 mt-2">SLA expirado</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                <ShieldOff size={18} className="text-red-500" />
              </div>
            </div>
          </div>

          <div
            className="card cursor-pointer active:bg-orange-50 hover:shadow-md transition-shadow border-l-4 border-orange-400"
            onClick={() => navigate('/tickets?sla=warning')}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Por vencer</p>
                <p className="text-3xl font-bold text-orange-500 mt-1 leading-none">{data.sla_at_risk}</p>
                <p className="text-xs text-gray-400 mt-2">Menos de 24h</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                <AlertCircle size={18} className="text-orange-400" />
              </div>
            </div>
          </div>

          <div className="card border-l-4 border-green-400">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">En plazo</p>
                <p className="text-3xl font-bold text-green-600 mt-1 leading-none">{data.sla_ok}</p>
                <p className="text-xs text-gray-400 mt-2">Dentro del SLA</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                <ShieldCheck size={18} className="text-green-500" />
              </div>
            </div>
          </div>

          <div className="card border-l-4 border-gray-300">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Pausados</p>
                <p className="text-3xl font-bold text-gray-500 mt-1 leading-none">{data.sla_paused}</p>
                <p className="text-xs text-gray-400 mt-2">SLA en espera</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                <Pause size={18} className="text-gray-400" />
              </div>
            </div>
          </div>
        </div>

        {/* Barra de cumplimiento + lista de tickets con SLA vencido */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Barra de progreso de cumplimiento de SLA con leyenda de rangos */}
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-1">Cumplimiento de SLA</h3>
            <p className="text-xs text-gray-400 mb-4">Tickets resueltos dentro del plazo acordado</p>
            {data.sla_compliance_rate !== null && data.sla_compliance_rate !== undefined ? (
              <>
                <div className="flex items-end justify-between mb-2">
                  <span className={`text-4xl font-bold ${
                    data.sla_compliance_rate >= 90 ? 'text-green-600'
                    : data.sla_compliance_rate >= 70 ? 'text-yellow-600'
                    : 'text-red-500'
                  }`}>{data.sla_compliance_rate}%</span>
                  <span className="text-sm text-gray-400 mb-1">meta: 90%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-3 rounded-full transition-all duration-700 ${
                      data.sla_compliance_rate >= 90 ? 'bg-green-500'
                      : data.sla_compliance_rate >= 70 ? 'bg-yellow-400'
                      : 'bg-red-400'
                    }`}
                    style={{ width: `${Math.min(data.sla_compliance_rate, 100)}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block flex-shrink-0" /> ≥90% Óptimo</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block flex-shrink-0" /> 70-89% Aceptable</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block flex-shrink-0" /> &lt;70% Crítico</span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-28 text-gray-400 text-sm">
                Sin tickets resueltos con SLA aún
              </div>
            )}
          </div>

          {/* Lista de tickets con SLA ya vencido ordenados por urgencia */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Tickets con SLA Vencido</h3>
              {data.sla_overdue > 0 && (
                <button onClick={() => navigate('/tickets')} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                  Ver todos <ArrowRight size={12} />
                </button>
              )}
            </div>
            {data.sla_overdue_tickets.length > 0 ? (
              <div className="space-y-1">
                {data.sla_overdue_tickets.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-red-50 cursor-pointer transition-colors group"
                    onClick={() => navigate(`/tickets/${t.id}`)}
                  >
                    <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center text-xs font-bold text-red-600 flex-shrink-0">
                      #{t.id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                      {/* Texto relativo de cuánto hace que venció el SLA */}
                      <p className="text-xs text-red-500 font-medium">{fmtDeadline(t.sla_deadline)}</p>
                    </div>
                    <PriorityBadge priority={t.priority} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-28 text-green-600 text-sm font-medium gap-2">
                <ShieldCheck size={18} /> Sin tickets vencidos
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
