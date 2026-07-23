import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend, CartesianGrid, LineChart, Line,
} from 'recharts'
import {
  TrendingDown, AlertCircle, BarChart2, ArrowLeft, RefreshCw, Receipt,
  ShoppingCart, Truck, DollarSign,
} from 'lucide-react'
import { getExpenseDashboard, getOrders } from '../services/api'

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

const CAT_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#a855f7',
]

// ── Helpers ──────────────────────────────────────────────
function fmtMoney(n) {
  if (!n && n !== 0) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtMonthKey(key) {
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
  if (!year) return {}                              // Todo el tiempo

  if (month) {                                      // Mes específico
    const lastDay = new Date(year, month, 0).getDate()
    return {
      date_from: `${year}-${String(month).padStart(2, '0')}-01`,
      date_to:   `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    }
  }

  if (periodKey?.startsWith('q')) {                 // Trimestre
    const q = QUARTERS[parseInt(periodKey[1]) - 1]
    const firstM = q.months[0]
    const lastM  = q.months[2]
    const lastDay = new Date(year, lastM, 0).getDate()
    return {
      date_from: `${year}-${String(firstM).padStart(2, '0')}-01`,
      date_to:   `${year}-${String(lastM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    }
  }

  // Todo el año
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
      <p className="font-bold text-red-600">{fmtMoney(payload[0].value)}</p>
    </div>
  )
}

const selectCls = 'text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 outline-none focus:border-red-400 focus:ring-1 focus:ring-red-200 transition-colors cursor-pointer min-h-[40px]'

// ── Supplier tooltip ──────────────────────────────────────
function SupplierTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="font-medium text-gray-700 truncate max-w-[200px]">{label}</p>
      <p className="font-bold text-blue-600">{fmtMoney(payload[0].value)}</p>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────
export default function GastosDashboard() {
  const navigate = useNavigate()
  const now = new Date()

  const [activeTab, setActiveTab]   = useState('gastos')
  const [data, setData]             = useState(null)
  const [loading, setLoading]       = useState(true)
  const [orders, setOrders]         = useState(null)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [year, setYear]             = useState(String(now.getFullYear()))
  const [periodKey, setPeriodKey]   = useState('')
  const [month, setMonth]           = useState('')

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
      const res = await getExpenseDashboard(params)
      if (reqRef.current === reqId) setData(res.data)
    } catch { /* silent */ } finally {
      if (reqRef.current === reqId) setLoading(false)
    }
  }, [params])

  const ordersReqRef = useRef(0)
  const loadOrders = useCallback(async () => {
    const reqId = ++ordersReqRef.current
    setOrdersLoading(true)
    try {
      const res = await getOrders(params)
      if (ordersReqRef.current === reqId) setOrders(res.data)
    } catch { /* silent */ } finally {
      if (ordersReqRef.current === reqId) setOrdersLoading(false)
    }
  }, [params])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (activeTab === 'proveedores') loadOrders() }, [loadOrders, activeTab])

  // Process orders into supplier aggregations
  const supplierStats = useMemo(() => {
    if (!orders) return { bySupplier: [], byMonth: [], total: 0, orderCount: 0, topSupplier: '—' }

    const bySupplier = {}
    const byMonth = {}
    let total = 0

    for (const order of orders) {
      let items = []
      try { if (order.purchase_items) items = JSON.parse(order.purchase_items) } catch {}

      const orderMonth = order.created_at?.slice(0, 7)

      if (!items.length) {
        // Legacy: attribute purchase_total to single supplier if present
        const amt = parseFloat(order.purchase_total) || 0
        if (amt > 0) {
          const key = (!order.supplier2_id && !order.supplier3_id && order.supplier1?.name)
            ? order.supplier1.name : 'Sin asignar'
          bySupplier[key] = (bySupplier[key] || 0) + amt
          if (orderMonth) byMonth[orderMonth] = (byMonth[orderMonth] || 0) + amt
          total += amt
        }
        continue
      }

      for (const item of items) {
        const lineAmt = (parseFloat(item.qty) || 0) * (parseFloat(item.unit_price) || 0)
        if (lineAmt <= 0) continue
        let supplierName = 'Sin asignar'
        if (item.supplier_id) {
          const sup = [order.supplier1, order.supplier2, order.supplier3]
            .find(s => s && Number(s.id) === Number(item.supplier_id))
          supplierName = sup?.name || `Proveedor #${item.supplier_id}`
        }
        bySupplier[supplierName] = (bySupplier[supplierName] || 0) + lineAmt
        if (orderMonth) byMonth[orderMonth] = (byMonth[orderMonth] || 0) + lineAmt
        total += lineAmt
      }
    }

    const bySupplierArr = Object.entries(bySupplier)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    const byMonthArr = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ name: fmtMonthKey(k), total: v }))

    const topSupplier = bySupplierArr.find(s => s.name !== 'Sin asignar')?.name || bySupplierArr[0]?.name || '—'

    return { bySupplier: bySupplierArr, byMonth: byMonthArr, total, orderCount: orders.length, topSupplier }
  }, [orders])

  const monthData    = data ? Object.entries(data.by_month_paid ?? data.by_month).map(([k, v]) => ({ name: fmtMonthKey(k), total: v })) : []
  const catData      = data ? Object.entries(data.by_category).slice(0, 8).map(([name, value]) => ({ name, value })) : []
  const supplierData = data ? Object.entries(data.by_supplier).map(([name, value]) => ({ name, value })) : []
  const maxSupplier  = supplierData[0]?.value || 1

  // Filter label for display
  const filterLabel = useMemo(() => {
    if (!year) return 'Todo el tiempo'
    const yLabel = year
    if (month) return `${MONTH_NAMES[parseInt(month) - 1]} ${yLabel}`
    if (periodKey?.startsWith('q')) return `${QUARTERS[parseInt(periodKey[1]) - 1].label} — ${yLabel}`
    return `Año ${yLabel}`
  }, [year, periodKey, month])

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto">

      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-5 py-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2 flex-1">
          <BarChart2 size={18} className="text-red-500" />
          <h1 className="font-semibold text-gray-900">Dashboard de Gastos</h1>
        </div>
        <button
          onClick={activeTab === 'gastos' ? load : loadOrders}
          disabled={activeTab === 'gastos' ? loading : ordersLoading}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-40"
        >
          <RefreshCw size={16} className={(activeTab === 'gastos' ? loading : ordersLoading) ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 px-4 pt-3 flex-shrink-0">
        <div className="flex gap-1">
          {[
            { key: 'gastos',      label: 'Gastos',      icon: TrendingDown },
            { key: 'proveedores', label: 'Proveedores',  icon: Truck },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-blue-500 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex-shrink-0">
        <div className="flex flex-wrap gap-2">
          <select value={year} onChange={(e) => { setYear(e.target.value); setPeriodKey(''); setMonth('') }} className={selectCls}>
            <option value="">Todo el tiempo</option>
            {availableYears().map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          {year && (
            <select value={periodKey} onChange={(e) => handlePeriod(e.target.value)} className={selectCls}>
              <option value="">Todo el año</option>
              {QUARTERS.map((q, i) => (
                <option key={i} value={`q${i + 1}`}>{q.label}</option>
              ))}
            </select>
          )}

          {year && !periodKey && (
            <select value={month} onChange={(e) => handleMonth(e.target.value)} className={selectCls}>
              <option value="">Todos los meses</option>
              {MONTH_NAMES.map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
          )}
        </div>
        <p className="text-xs text-gray-400 italic mt-2">{filterLabel}</p>
      </div>

      <div className="flex-1 px-4 py-5 space-y-5 max-w-5xl mx-auto w-full">

        {/* ── Proveedores tab ── */}
        {activeTab === 'proveedores' && (
          ordersLoading && !orders ? (
            <div className="py-20 text-center text-sm text-gray-400">Cargando pedidos...</div>
          ) : orders ? (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <KpiCard
                  label="Total en pedidos"
                  value={fmtMoney(supplierStats.total)}
                  icon={DollarSign}
                  bg="bg-blue-100" color="text-blue-500"
                  sub={`${supplierStats.orderCount} pedido${supplierStats.orderCount !== 1 ? 's' : ''}`}
                />
                <KpiCard
                  label="Proveedores activos"
                  value={supplierStats.bySupplier.filter(s => s.name !== 'Sin asignar').length || '—'}
                  icon={Truck}
                  bg="bg-indigo-100" color="text-indigo-500"
                />
                <KpiCard
                  label="Proveedor principal"
                  value={supplierStats.topSupplier}
                  icon={ShoppingCart}
                  bg="bg-teal-100" color="text-teal-500"
                  sub={supplierStats.bySupplier.find(s => s.name !== 'Sin asignar') ?
                    fmtMoney(supplierStats.bySupplier.find(s => s.name !== 'Sin asignar').value) : null}
                />
              </div>

              {/* Gasto por mes */}
              {supplierStats.byMonth.length > 1 && (
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-700 mb-4">Gasto en pedidos por mes</h2>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={supplierStats.byMonth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                        tickFormatter={(v) => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
                      <Tooltip content={<SupplierTooltip />} />
                      <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2}
                        dot={{ fill: '#3b82f6', r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Top proveedores */}
              {supplierStats.bySupplier.length > 0 && (
                <div className="card">
                  <h2 className="text-sm font-semibold text-gray-700 mb-4">Top proveedores</h2>
                  <ResponsiveContainer width="100%" height={Math.max(180, supplierStats.bySupplier.length * 36)}>
                    <BarChart
                      data={supplierStats.bySupplier.slice(0, 10)}
                      layout="vertical"
                      margin={{ top: 0, right: 60, left: 0, bottom: 0 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                        tickFormatter={(v) => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} axisLine={false}
                        tickLine={false} width={130} />
                      <Tooltip content={<SupplierTooltip />} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {supplierStats.bySupplier.slice(0, 10).map((entry, i) => (
                          <Cell key={i} fill={entry.name === 'Sin asignar' ? '#d1d5db' : CAT_COLORS[i % CAT_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Detail table */}
              <div className="card overflow-hidden">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Detalle por proveedor</h2>
                {supplierStats.bySupplier.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Proveedor</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Total</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">% del total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierStats.bySupplier.map(({ name, value }, i) => (
                          <tr key={name} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                            <td className="py-2.5 px-3 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: name === 'Sin asignar' ? '#d1d5db' : CAT_COLORS[i % CAT_COLORS.length] }} />
                              <span className={name === 'Sin asignar' ? 'text-gray-400 italic' : 'text-gray-800'}>{name}</span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-gray-900">{fmtMoney(value)}</td>
                            <td className="py-2.5 px-3 text-right text-gray-500">
                              {supplierStats.total > 0 ? ((value / supplierStats.total) * 100).toFixed(1) + '%' : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-200">
                          <td className="py-2.5 px-3 font-semibold text-gray-700">Total</td>
                          <td className="py-2.5 px-3 text-right font-bold text-gray-900">{fmtMoney(supplierStats.total)}</td>
                          <td className="py-2.5 px-3 text-right text-gray-500">100%</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-8">Sin datos en este período</p>
                )}
              </div>
            </>
          ) : null
        )}

        {/* ── Gastos tab ── */}
        {activeTab === 'gastos' && (loading && !data ? (
          <div className="py-20 text-center text-sm text-gray-400">Cargando...</div>
        ) : data ? (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                label="Total pagado"
                value={fmtMoney(data.paid_total ?? data.total)}
                icon={TrendingDown}
                bg="bg-red-100" color="text-red-500"
                sub={`Comprometido: ${fmtMoney(data.total)}`}
              />
              <KpiCard
                label="Promedio por pago"
                value={fmtMoney(data.average)}
                icon={BarChart2}
                bg="bg-orange-100" color="text-orange-500"
                sub={`${data.paid_count ?? data.count} pago${(data.paid_count ?? data.count) !== 1 ? 's' : ''} efectuado${(data.paid_count ?? data.count) !== 1 ? 's' : ''}`}
              />
              <KpiCard
                label="Por pagar"
                value={fmtMoney(data.payable_total)}
                icon={AlertCircle}
                bg="bg-yellow-100" color="text-yellow-600"
                sub={`${data.payable_count} cuenta${data.payable_count !== 1 ? 's' : ''} pendiente${data.payable_count !== 1 ? 's' : ''}`}
              />
              <KpiCard
                label="Pedidos vs Manual"
                value={fmtMoney(data.by_type['Pedido'] || 0)}
                icon={Receipt}
                bg="bg-purple-100" color="text-purple-500"
                sub={`Manual: ${fmtMoney(data.by_type['Manual'] || 0)}`}
              />
            </div>

            {/* Monthly trend */}
            {monthData.length > 1 && (
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Tendencia mensual</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
                    <Tooltip content={<MoneyTooltip />} />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                      {monthData.map((_, i) => (
                        <Cell key={i} fill={i === monthData.length - 1 ? '#ef4444' : '#fca5a5'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* By category */}
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Por categoría</h2>
                {catData.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {catData.map(({ name, value }, i) => {
                      const pct = data.total > 0 ? (value / data.total) * 100 : 0
                      return (
                        <div key={name}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-gray-700 truncate max-w-[60%]">{name}</span>
                            <span className="font-semibold text-gray-900 flex-shrink-0">
                              {fmtMoney(value)}
                              <span className="text-gray-400 font-normal ml-1">({pct.toFixed(0)}%)</span>
                            </span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-8">Sin datos</p>
                )}
              </div>

              {/* By supplier */}
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Top proveedores</h2>
                {supplierData.length > 0 ? (
                  <div className="flex flex-col gap-2.5">
                    {supplierData.map(({ name, value }, i) => {
                      const pct = (value / maxSupplier) * 100
                      return (
                        <div key={name}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-gray-700 truncate max-w-[60%]">{name}</span>
                            <span className="font-semibold text-gray-900 flex-shrink-0">{fmtMoney(value)}</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-blue-400 transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-8">Sin datos</p>
                )}
              </div>
            </div>

            {/* Category donut */}
            {catData.length > 0 && (
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Distribución por categoría</h2>
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <ResponsiveContainer width="100%" height={220} className="flex-shrink-0" style={{ maxWidth: 260 }}>
                    <PieChart>
                      <Pie data={catData} cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                        paddingAngle={2} dataKey="value">
                        {catData.map((_, i) => (
                          <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => fmtMoney(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-1.5 w-full min-w-0">
                    {catData.map(({ name }, i) => (
                      <div key={name} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />
                        <span className="text-gray-600 truncate">{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : null)}

      </div>
    </div>
  )
}
