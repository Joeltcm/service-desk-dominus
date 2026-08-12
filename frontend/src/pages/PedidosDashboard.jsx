import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from 'recharts'
import {
  ShoppingCart, PackageCheck, Clock, DollarSign,
  BarChart2, ArrowLeft, RefreshCw, XCircle, Wrench,
} from 'lucide-react'
import { getDespachoDashboard } from '../services/api'
import { useCompany } from '../context/CompanyContext'

// ── Constants ────────────────────────────────────────────
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const QUARTERS = [
  { label: 'Q1 — Ene a Mar', months: [1, 2, 3] },
  { label: 'Q2 — Abr a Jun', months: [4, 5, 6] },
  { label: 'Q3 — Jul a Sep', months: [7, 8, 9] },
  { label: 'Q4 — Oct a Dic', months: [10, 11, 12] },
]

const STATUS_COLORS = {
  'Borrador':            '#94a3b8',
  'Emitido':             '#60a5fa',
  'En proceso':          '#f59e0b',
  'Despacho Programado': '#22d3ee',
  'Pedido Programado':   '#a78bfa',
  'Entregado':           '#34d399',
  'Cancelado':           '#f87171',
}

const CLIENT_COLORS = [
  '#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#14b8a6', '#a855f7', '#f97316',
]

// ── Helpers ──────────────────────────────────────────────
function fmtMoney(n) {
  if (!n && n !== 0) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtMonthKey(key) {
  if (!key || key === '?') return '?'
  const [y, m] = key.split('-')
  return `${MONTH_SHORT[parseInt(m) - 1]} '${y.slice(2)}`
}

function availableYears() {
  const current = new Date().getFullYear()
  const years = []
  for (let y = current; y >= current - 4; y--) years.push(y)
  return years
}

function buildParams(year, periodKey, month) {
  if (!year) return {}
  if (month) {
    const lastDay = new Date(year, month, 0).getDate()
    return {
      date_from: `${year}-${String(month).padStart(2, '0')}-01`,
      date_to:   `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    }
  }
  if (periodKey?.startsWith('q')) {
    const q = QUARTERS[parseInt(periodKey[1]) - 1]
    const firstM = q.months[0], lastM = q.months[2]
    const lastDay = new Date(year, lastM, 0).getDate()
    return {
      date_from: `${year}-${String(firstM).padStart(2, '0')}-01`,
      date_to:   `${year}-${String(lastM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    }
  }
  return { date_from: `${year}-01-01`, date_to: `${year}-12-31` }
}

// ── Sub-components ───────────────────────────────────────
function KpiCard({ label, value, icon: Icon, bg, color, sub }) {
  return (
    <div className="card p-3 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">{label}</p>
          <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-1 leading-none break-all">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1.5 leading-tight">{sub}</p>}
        </div>
        <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${bg}`}>
          <Icon size={15} className={color} />
        </div>
      </div>
    </div>
  )
}

function MoneyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="font-medium text-gray-700">{label}</p>
      <p className="text-xs text-gray-500">{payload[0].payload.count} pedido{payload[0].payload.count !== 1 ? 's' : ''}</p>
      <p className="font-bold text-sky-600">{fmtMoney(payload[0].value)}</p>
    </div>
  )
}

const selectCls = 'text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-200 transition-colors cursor-pointer min-h-[40px]'

// ── Main ─────────────────────────────────────────────────
export default function PedidosDashboard() {
  const navigate = useNavigate()
  const { vertical } = useCompany()
  const itMode = vertical === 'it_support'
  const nounPl = itMode ? 'pedidos' : 'despachos'
  const now = new Date()

  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [year, setYear]           = useState(String(now.getFullYear()))
  const [periodKey, setPeriodKey] = useState('')
  const [month, setMonth]         = useState('')

  const handlePeriod = (val) => { setPeriodKey(val); setMonth('') }
  const handleMonth  = (val) => { setMonth(val);     setPeriodKey('') }

  const params = useMemo(
    () => buildParams(year ? parseInt(year) : null, periodKey, month ? parseInt(month) : null),
    [year, periodKey, month]
  )

  const reqRef = useRef(0)
  const load = useCallback(async () => {
    const reqId = ++reqRef.current
    setLoading(true)
    try {
      const res = await getDespachoDashboard(params)
      if (reqRef.current === reqId) setData(res.data)
    } catch { /* silent */ } finally {
      if (reqRef.current === reqId) setLoading(false)
    }
  }, [params])

  useEffect(() => { load() }, [load])

  const filterLabel = useMemo(() => {
    if (!year) return 'Todo el tiempo'
    if (month) return `${MONTH_NAMES[parseInt(month) - 1]} ${year}`
    if (periodKey?.startsWith('q')) return `${QUARTERS[parseInt(periodKey[1]) - 1].label} — ${year}`
    return `Año ${year}`
  }, [year, periodKey, month])

  const monthData   = data ? Object.entries(data.by_month).map(([k, v]) => ({ name: fmtMonthKey(k), ...v })) : []
  const statusData  = data ? Object.entries(data.by_status).map(([name, v]) => ({ name, ...v })) : []
  const clientData  = data?.by_client || []
  const maxClient   = clientData[0]?.total || 1

  const entregados  = data?.by_status?.['Entregado']?.count  || 0
  const cancelados  = data?.by_status?.['Cancelado']?.count  || 0
  const borrador    = data?.by_status?.['Borrador']?.count   || 0
  // Pedidos con el estado "En proceso" (el técnico los está preparando).
  const enProceso   = data?.by_status?.['En proceso']?.count || 0
  // Pendientes: agrupa Borrador + Emitido + Despacho Programado (lo que estaba antes).
  const pendientes  = ['Borrador', 'Emitido', 'Despacho Programado'].reduce((s, n) => s + (data?.by_status?.[n]?.count || 0), 0)

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto">

      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-5 py-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate('/pedidos')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2 flex-1">
          <BarChart2 size={18} className="text-sky-500" />
          <h1 className="font-semibold text-gray-900">Dashboard de Pedidos</h1>
        </div>
        <button onClick={load} disabled={loading} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-40">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex-shrink-0">
        <div className="flex flex-wrap gap-2">
          <select value={year} onChange={(e) => { setYear(e.target.value); setPeriodKey(''); setMonth('') }} className={selectCls}>
            <option value="">Todo el tiempo</option>
            {availableYears().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          {year && (
            <select value={periodKey} onChange={(e) => handlePeriod(e.target.value)} className={selectCls}>
              <option value="">Todo el año</option>
              {QUARTERS.map((q, i) => <option key={i} value={`q${i + 1}`}>{q.label}</option>)}
            </select>
          )}
          {year && !periodKey && (
            <select value={month} onChange={(e) => handleMonth(e.target.value)} className={selectCls}>
              <option value="">Todos los meses</option>
              {MONTH_NAMES.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
            </select>
          )}
        </div>
        <p className="text-xs text-gray-400 italic mt-2">{filterLabel}</p>
      </div>

      <div className="flex-1 px-4 py-5 space-y-5 max-w-5xl mx-auto w-full">
        {loading && !data ? (
          <div className="py-20 text-center text-sm text-gray-400">Cargando...</div>
        ) : data ? (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard
                label={`Total ${nounPl}`}
                value={data.total_orders}
                icon={ShoppingCart}
                bg="bg-sky-100" color="text-sky-500"
              />
              <KpiCard
                label={itMode ? 'Total en pedidos' : 'Total facturado'}
                value={fmtMoney(data.total_cost)}
                icon={DollarSign}
                bg="bg-emerald-100" color="text-emerald-500"
                sub={data.total_orders > 0 ? `Prom. ${fmtMoney(data.total_cost / data.total_orders)}` : undefined}
              />
              <KpiCard
                label="Pedidos pendientes"
                value={pendientes}
                icon={Clock}
                bg="bg-slate-100" color="text-slate-500"
                sub={`${borrador} borrador · ${pendientes - borrador} activos`}
              />
              <KpiCard
                label="Pedidos en proceso"
                value={enProceso}
                icon={Wrench}
                bg="bg-amber-100" color="text-amber-500"
              />
              <KpiCard
                label="Entregados"
                value={entregados}
                icon={PackageCheck}
                bg="bg-violet-100" color="text-violet-500"
              />
              <KpiCard
                label="Cancelados"
                value={cancelados}
                icon={XCircle}
                bg="bg-rose-100" color="text-rose-500"
              />
            </div>

            {/* Monthly trend */}
            {monthData.length > 0 && (
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">{itMode ? 'Monto de pedidos por mes' : 'Facturación por mes'}</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
                    <Tooltip content={<MoneyTooltip />} />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                      {monthData.map((_, i) => (
                        <Cell key={i} fill={i === monthData.length - 1 ? '#0ea5e9' : '#bae6fd'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top clientes */}
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Top clientes por facturación</h2>
                {clientData.length > 0 ? (
                  <div className="flex flex-col gap-2.5">
                    {clientData.map(({ name, count, total }, i) => {
                      const pct = maxClient > 0 ? (total / maxClient) * 100 : 0
                      return (
                        <div key={name}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-gray-700 truncate max-w-[55%]">{name}</span>
                            <span className="font-semibold text-gray-900 flex-shrink-0">
                              {fmtMoney(total)}
                              <span className="text-gray-400 font-normal ml-1">({count} ped.)</span>
                            </span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, backgroundColor: CLIENT_COLORS[i % CLIENT_COLORS.length] }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-8">Sin datos</p>
                )}
              </div>

              {/* Por estado */}
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Distribución por estado</h2>
                {statusData.length > 0 ? (
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <ResponsiveContainer width="100%" height={180} style={{ maxWidth: 200 }}>
                      <PieChart>
                        <Pie data={statusData} cx="50%" cy="50%" innerRadius={45} outerRadius={75}
                          paddingAngle={2} dataKey="count">
                          {statusData.map(({ name }, i) => (
                            <Cell key={i} fill={STATUS_COLORS[name] || '#cbd5e1'} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v, _n, p) => [`${v} pedido${v !== 1 ? 's' : ''}`, p.payload.name]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-col gap-2 w-full min-w-0">
                      {statusData.map(({ name, count, total }) => (
                        <div key={name} className="flex items-center justify-between text-xs gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: STATUS_COLORS[name] || '#cbd5e1' }} />
                            <span className="text-gray-600 truncate">{name}</span>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="font-semibold text-gray-800">{count}</span>
                            <span className="text-gray-400 ml-1">· {fmtMoney(total)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-8">Sin datos</p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
