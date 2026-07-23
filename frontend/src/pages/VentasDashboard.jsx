import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend, CartesianGrid,
} from 'recharts'
import {
  ClipboardList, ShoppingCart, PackageCheck, Receipt,
  TrendingUp, TrendingDown, Minus, DollarSign, ArrowRight,
  RefreshCw, ChevronRight, Banknote,
} from 'lucide-react'
import { getVentasDashboard } from '../services/api'
import toast from 'react-hot-toast'

// ── Helpers ────────────────────────────────────────────
function fmtMoney(n) {
  if (!n && n !== 0) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtMonth(key) {
  const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const [y, m] = key.split('-')
  return `${MONTHS[parseInt(m) - 1]} '${y.slice(2)}`
}

function pct(a, b) {
  if (!b) return 0
  return Math.round((a / b) * 100)
}

// ── Status colors ──────────────────────────────────────
const QUOTE_COLORS   = { Borrador: '#94a3b8', Enviada: '#60a5fa', Aprobada: '#34d399', Rechazada: '#f87171', Vencida: '#fb923c', 'En Pedido': '#a78bfa' }
const ORDER_COLORS   = { Pendiente: '#94a3b8', 'En proceso': '#60a5fa', 'En despacho': '#a78bfa', 'Entregado al cliente': '#34d399', Cancelado: '#f87171' }
const INVOICE_COLORS = { Borrador: '#94a3b8', Emitida: '#60a5fa', Pagada: '#34d399', Vencida: '#fb923c', Anulada: '#f87171' }

// ── Sub-components ─────────────────────────────────────

function KpiCard({ label, value, icon: Icon, bg, color, sub, trend, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`card text-left hover:shadow-md transition-all hover:-translate-y-0.5 ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1 leading-none">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1.5">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${bg}`}>
          <Icon size={18} className={color} />
        </div>
      </div>
      {trend !== undefined && (
        <div className={`flex items-center gap-1 mt-3 pt-3 border-t border-gray-100 text-xs font-medium
          ${trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-red-500' : 'text-gray-400'}`}>
          {trend > 0 ? <TrendingUp size={12} /> : trend < 0 ? <TrendingDown size={12} /> : <Minus size={12} />}
          {trend > 0 ? `+${fmtMoney(Math.abs(trend))}` : fmtMoney(Math.abs(trend))} vs mes anterior
        </div>
      )}
    </button>
  )
}

function SectionTitle({ children }) {
  return <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{children}</h2>
}

function FunnelStep({ label, icon: Icon, count, total, conv, pctVal, color, href, navigate }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color.bg}`}>
        <Icon size={16} className={color.text} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-gray-800">{label}</span>
          <button
            onClick={() => navigate(href)}
            className="text-xs text-blue-500 hover:text-blue-700 active:text-blue-900 flex items-center gap-0.5 px-2 py-1.5 -mr-2 min-h-[36px]"
          >
            ver <ChevronRight size={11} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${color.bar}`}
              style={{ width: `${total ? Math.max(4, (count / total) * 100) : 0}%` }}
            />
          </div>
          <span className="text-sm font-bold text-gray-900 w-6 text-right">{count}</span>
        </div>
        {conv !== undefined && (
          <p className="text-xs text-gray-400 mt-0.5">
            {pctVal}% convertido{conv !== count ? ` · ${conv} generado${conv !== 1 ? 's' : ''}` : ''}
          </p>
        )}
      </div>
    </div>
  )
}

function StatusBar({ label, data, colors }) {
  const total = Object.values(data).reduce((s, v) => s + v, 0)
  if (!total) return null
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1])
  return (
    <div className="space-y-2">
      <div className="flex gap-0.5 h-3 rounded-full overflow-hidden">
        {entries.map(([status, count]) => (
          <div
            key={status}
            title={`${status}: ${count}`}
            style={{ width: `${(count / total) * 100}%`, background: colors[status] || '#94a3b8' }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {entries.map(([status, count]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colors[status] || '#94a3b8' }} />
            <span className="text-xs text-gray-600">{status}</span>
            <span className="text-xs font-semibold text-gray-800">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const RevenueTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-gray-900">{fmtMoney(payload[0].value)}</p>
    </div>
  )
}

const ClientTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2">
      <p className="text-xs text-gray-500 mb-0.5">{payload[0].payload.client}</p>
      <p className="text-sm font-bold text-gray-900">{fmtMoney(payload[0].value)}</p>
    </div>
  )
}

const ComparisonTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2.5 space-y-1">
      <p className="text-xs font-semibold text-gray-600 mb-1.5">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.fill }} />
          <span className="text-xs text-gray-500 flex-1">{p.name}</span>
          <span className="text-xs font-bold text-gray-900">{fmtMoney(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

const STATUS_INV_STYLE = {
  Borrador: 'bg-gray-100 text-gray-600',
  Emitida:  'bg-blue-100 text-blue-700',
  Pagada:   'bg-green-100 text-green-700',
  Vencida:  'bg-orange-100 text-orange-700',
  Anulada:  'bg-red-100 text-red-600',
}
const STATUS_COT_STYLE = {
  Borrador: 'bg-gray-100 text-gray-600',
  Enviada:  'bg-blue-100 text-blue-700',
  Aprobada: 'bg-green-100 text-green-700',
  Rechazada:'bg-red-100 text-red-600',
  Vencida:  'bg-orange-100 text-orange-700',
  'En Pedido': 'bg-violet-100 text-violet-700',
}

// ── Main ───────────────────────────────────────────────
export default function VentasDashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const isMobile = window.innerWidth < 640

  const load = () => {
    setLoading(true)
    getVentasDashboard()
      .then((r) => setData(r.data))
      .catch(() => toast.error('Error cargando dashboard de ventas'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Cargando analytics...</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const d = data
  const trendMes = d.revenue_this_month - d.revenue_last_month
  const maxFunnel = Math.max(d.total_cotizaciones, 1)

  const monthlyData = (d.monthly_revenue || []).map((row) => ({
    ...row,
    label: fmtMonth(row.month),
  }))

  const topClients = (d.top_clients || []).map((c) => ({
    ...c,
    label: c.client.length > 20 ? c.client.slice(0, 18) + '…' : c.client,
  }))

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900">Dashboard de Ventas</h1>
            <p className="text-sm text-gray-500 mt-0.5 hidden sm:block">Cotizaciones · Pedidos · Despachos · Facturas</p>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 active:bg-gray-100 px-3 py-2.5 rounded-lg hover:bg-white border border-transparent hover:border-gray-200 transition-all flex-shrink-0 min-h-[44px]">
            <RefreshCw size={14} /> <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <KpiCard
            label="Facturado total"
            value={fmtMoney(d.total_revenue)}
            icon={DollarSign}
            bg="bg-emerald-50" color="text-emerald-600"
            sub={`${d.total_facturas} factura${d.total_facturas !== 1 ? 's' : ''} emitida${d.total_facturas !== 1 ? 's' : ''}`}
            onClick={() => navigate('/facturas')}
          />
          <KpiCard
            label="Pagos recibidos"
            value={fmtMoney(d.total_pagado ?? 0)}
            icon={Banknote}
            bg="bg-teal-50" color="text-teal-600"
            sub={`Este mes: ${fmtMoney(d.pagado_this_month ?? 0)} · Ant: ${fmtMoney(d.pagado_last_month ?? 0)}`}
            trend={(d.pagado_this_month ?? 0) - (d.pagado_last_month ?? 0)}
            onClick={() => navigate('/facturas')}
          />
          <KpiCard
            label="Cotizaciones activas"
            value={d.active_cotizaciones}
            icon={ClipboardList}
            bg="bg-violet-50" color="text-violet-600"
            sub={`${d.total_cotizaciones} total`}
            onClick={() => navigate('/quotes')}
          />
          <KpiCard
            label="Pedidos en proceso"
            value={d.pending_pedidos}
            icon={ShoppingCart}
            bg="bg-amber-50" color="text-amber-600"
            sub={`${d.total_pedidos} total`}
            onClick={() => navigate('/orders')}
          />
        </div>

        {/* ── Row 2: Funnel + Monthly Revenue ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Embudo */}
          <div className="card lg:col-span-2 space-y-5">
            <SectionTitle>Embudo de ventas</SectionTitle>
            <div className="space-y-4">
              <FunnelStep
                label="Cotizaciones" icon={ClipboardList}
                count={d.total_cotizaciones} total={maxFunnel}
                color={{ bg: 'bg-violet-50', text: 'text-violet-600', bar: 'bg-violet-400' }}
                href="/quotes" navigate={navigate}
              />
              <div className="flex items-center gap-2 pl-5">
                <ArrowRight size={12} className="text-gray-300" />
                <span className="text-xs text-gray-400">
                  {pct(d.quotes_converted, d.total_cotizaciones)}% convertidas a pedido
                </span>
              </div>
              <FunnelStep
                label="Pedidos" icon={ShoppingCart}
                count={d.total_pedidos} total={maxFunnel}
                conv={d.quotes_converted} pctVal={pct(d.total_pedidos, d.total_cotizaciones)}
                color={{ bg: 'bg-amber-50', text: 'text-amber-600', bar: 'bg-amber-400' }}
                href="/orders" navigate={navigate}
              />
              <div className="flex items-center gap-2 pl-5">
                <ArrowRight size={12} className="text-gray-300" />
                <span className="text-xs text-gray-400">
                  {pct(d.orders_dispatched, d.total_pedidos)}% enviados a despacho
                </span>
              </div>
              <FunnelStep
                label="Despachos" icon={PackageCheck}
                count={d.total_despachos} total={maxFunnel}
                conv={d.orders_dispatched} pctVal={pct(d.total_despachos, d.total_pedidos)}
                color={{ bg: 'bg-blue-50', text: 'text-blue-600', bar: 'bg-blue-400' }}
                href="/pedidos" navigate={navigate}
              />
              <div className="flex items-center gap-2 pl-5">
                <ArrowRight size={12} className="text-gray-300" />
                <span className="text-xs text-gray-400">
                  {pct(d.total_facturas, d.total_despachos)}% facturado
                </span>
              </div>
              <FunnelStep
                label="Facturas" icon={Receipt}
                count={d.total_facturas} total={maxFunnel}
                conv={d.invoices_paid} pctVal={pct(d.invoices_paid, d.total_facturas)}
                color={{ bg: 'bg-emerald-50', text: 'text-emerald-600', bar: 'bg-emerald-400' }}
                href="/facturas" navigate={navigate}
              />
            </div>
          </div>

          {/* Ingresos vs Pagos vs Cotizado vs Gastos */}
          <div className="card lg:col-span-3">
            <SectionTitle>Facturado · Pagos · Cotizado · Gastos (últimos 6 meses)</SectionTitle>
            {monthlyData.every((r) => r.revenue === 0 && r.quoted === 0 && r.gastos === 0 && r.pagado === 0) ? (
              <div className="flex items-center justify-center h-40 text-sm text-gray-300">Sin datos disponibles</div>
            ) : (
              <ResponsiveContainer width="100%" height={isMobile ? 180 : 220}>
                <BarChart data={monthlyData} barSize={isMobile ? 8 : 12} barGap={2} barCategoryGap="25%">
                  <XAxis dataKey="label" tick={{ fontSize: isMobile ? 9 : 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval={isMobile ? 1 : 0} />
                  <YAxis tick={{ fontSize: isMobile ? 9 : 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)}`} width={isMobile ? 36 : 44} />
                  <Tooltip content={<ComparisonTooltip />} cursor={{ fill: '#f8fafc' }} />
                  <Legend
                    iconType="circle" iconSize={7}
                    wrapperStyle={{ fontSize: '11px', paddingTop: '10px', color: '#6b7280' }}
                  />
                  <Bar dataKey="quoted" name="Cotizado" radius={[4, 4, 0, 0]} fill="#a78bfa" />
                  <Bar dataKey="revenue" name="Facturado" radius={[4, 4, 0, 0]} fill="#34d399" />
                  <Bar dataKey="pagado" name="Pagos recibidos" radius={[4, 4, 0, 0]} fill="#0d9488" />
                  <Bar dataKey="gastos" name="Gastos" radius={[4, 4, 0, 0]} fill="#f87171" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Row 3: Status breakdowns ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card space-y-3">
            <SectionTitle>Cotizaciones por estado</SectionTitle>
            <StatusBar data={d.quotes_by_status || {}} colors={QUOTE_COLORS} />
          </div>
          <div className="card space-y-3">
            <SectionTitle>Pedidos por estado</SectionTitle>
            <StatusBar data={d.orders_by_status || {}} colors={ORDER_COLORS} />
          </div>
          <div className="card space-y-3">
            <SectionTitle>Facturas por estado</SectionTitle>
            <StatusBar data={d.invoices_by_status || {}} colors={INVOICE_COLORS} />
          </div>
        </div>

        {/* ── Row 4: Top clients + Recent ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Top clientes */}
          <div className="card lg:col-span-2">
            <SectionTitle>Top clientes (por facturación)</SectionTitle>
            {topClients.length === 0 ? (
              <p className="text-sm text-gray-300 text-center py-8">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height={isMobile ? 140 : 180}>
                <BarChart data={topClients} layout="vertical" barSize={isMobile ? 10 : 14}>
                  <XAxis type="number" tick={{ fontSize: isMobile ? 9 : 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: isMobile ? 9 : 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={isMobile ? 70 : 90} />
                  <Tooltip content={<ClientTooltip />} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} fill="#6366f1" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Actividad reciente */}
          <div className="card lg:col-span-3 space-y-4">
            <SectionTitle>Actividad reciente</SectionTitle>

            {/* Últimas facturas */}
            <div>
              <p className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-1.5"><Receipt size={11} /> Facturas recientes</p>
              {(d.recent_facturas || []).length === 0 ? (
                <p className="text-xs text-gray-300 italic">Sin facturas</p>
              ) : (
                <div className="space-y-1.5">
                  {(d.recent_facturas || []).slice(0, 4).map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => navigate('/facturas')}
                      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 active:bg-gray-100 text-left transition-colors min-h-[44px]"
                    >
                      <span className="hidden sm:block text-xs font-mono text-gray-400 flex-shrink-0 w-28 truncate">{inv.invoice_number || `FAC-${inv.id}`}</span>
                      <span className="flex-1 text-sm text-gray-700 truncate min-w-0">{inv.client_name || inv.invoice_number || `FAC-${inv.id}`}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_INV_STYLE[inv.status] || 'bg-gray-100 text-gray-600'}`}>{inv.status}</span>
                      <span className="text-sm font-semibold text-gray-900 flex-shrink-0 text-right">{inv.total ? `$${inv.total}` : '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-gray-100" />

            {/* Últimas cotizaciones */}
            <div>
              <p className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-1.5"><ClipboardList size={11} /> Cotizaciones recientes</p>
              {(d.recent_quotes || []).length === 0 ? (
                <p className="text-xs text-gray-300 italic">Sin cotizaciones</p>
              ) : (
                <div className="space-y-1.5">
                  {(d.recent_quotes || []).slice(0, 4).map((q) => (
                    <button
                      key={q.id}
                      onClick={() => navigate('/quotes')}
                      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 active:bg-gray-100 text-left transition-colors min-h-[44px]"
                    >
                      <span className="hidden sm:block text-xs font-mono text-gray-400 flex-shrink-0 w-28 truncate">{q.quote_number || `COT-${q.id}`}</span>
                      <span className="flex-1 text-sm text-gray-700 truncate min-w-0">{q.client_name || q.title || '—'}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_COT_STYLE[q.status] || 'bg-gray-100 text-gray-600'}`}>{q.status}</span>
                      <span className="text-sm font-semibold text-gray-900 flex-shrink-0 text-right">{q.total ? `$${q.total}` : '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Despachos pendientes footer strip ── */}
        {d.pending_despachos > 0 && (
          <button
            onClick={() => navigate('/pedidos')}
            className="w-full flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <PackageCheck size={16} className="text-amber-600" />
              <span className="text-sm font-medium text-amber-800">
                {d.pending_despachos} despacho{d.pending_despachos !== 1 ? 's' : ''} pendiente{d.pending_despachos !== 1 ? 's' : ''} de entrega
              </span>
            </div>
            <ChevronRight size={14} className="text-amber-500" />
          </button>
        )}

    </div>
  )
}
