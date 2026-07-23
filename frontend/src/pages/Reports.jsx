import React, { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getReportSummary, getReportTickets, downloadReportCSV, downloadReportExcel, getStatuses, getAgents, getInvoices, getExpenses, getClients, getReportAgents } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { useModules } from '../context/ModulesContext'
import { companyLogoSrc } from '../utils/branding'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { Download, FileSpreadsheet, FileText, Filter, Banknote, HandCoins, ChevronDown, ChevronRight, ClipboardList, Users, ChevronUp, Star, Clock, CheckCircle, AlertTriangle } from 'lucide-react'
import { fmtD } from '../utils/fmt'
import toast from 'react-hot-toast'

const PIE_COLORS = ['#3B82F6', '#F59E0B', '#8B5CF6', '#EF4444', '#F97316', '#06B6D4', '#10B981']
const PRIORITY_LABELS = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' }

function today()    { return new Date().toISOString().split('T')[0] }
function monthAgo() { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0] }

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function fmtMoney(n) {
  const num = parseFloat(String(n || '').replace(/[^\d.]/g, '') || '0')
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function parseAmt(n) {
  return parseFloat(String(n || '').replace(/[^\d.]/g, '') || '0')
}
function invBalance(inv) {
  const total = parseAmt(inv.total)
  const paid = (inv.payments || []).reduce((s, p) => s + parseAmt(p.amount), 0)
  return Math.max(0, total - paid)
}

// ── Cuentas por Cobrar ────────────────────────────────────────────────────────
function CobrarReport() {
  const { company_name } = useCompany()
  const coName = company_name || 'Service Desk'
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState({})
  const [filters, setFilters] = useState({ client: '', status: '', date_from: '', date_to: '' })
  const setF = (k, v) => setFilters(f => ({ ...f, [k]: v }))

  useEffect(() => {
    setLoading(true)
    Promise.all([getInvoices({ status: 'Emitida' }), getInvoices({ status: 'Vencida' })])
      .then(([r1, r2]) => {
        const all = [...(r1.data || []), ...(r2.data || [])]
        all.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        setInvoices(all)
      })
      .catch(() => toast.error('Error cargando cuentas por cobrar'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = React.useMemo(() => {
    return invoices.filter(inv => {
      if (filters.client && !(inv.client_name || '').toLowerCase().includes(filters.client.toLowerCase())) return false
      if (filters.status && inv.status !== filters.status) return false
      if (filters.date_from && inv.date && inv.date < filters.date_from) return false
      if (filters.date_to   && inv.date && inv.date > filters.date_to)   return false
      return true
    })
  }, [invoices, filters])

  const groups = React.useMemo(() => {
    const map = {}
    for (const inv of filtered) {
      const key = inv.client_name || '—'
      if (!map[key]) map[key] = { name: key, invoices: [] }
      map[key].invoices.push(inv)
    }
    return Object.values(map).sort((a, b) =>
      b.invoices.reduce((s, i) => s + invBalance(i), 0) - a.invoices.reduce((s, i) => s + invBalance(i), 0)
    )
  }, [filtered])

  const emitidas = filtered.filter(i => i.status === 'Emitida')
  const vencidas = filtered.filter(i => i.status === 'Vencida')
  const totalEmitidas = emitidas.reduce((s, i) => s + invBalance(i), 0)
  const totalVencidas = vencidas.reduce((s, i) => s + invBalance(i), 0)
  const totalGeneral = totalEmitidas + totalVencidas

  const toggle = (name) => setCollapsed(p => ({ ...p, [name]: !p[name] }))

  const handlePDF = () => {
    const dateStr = new Date().toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const clientRows = groups.map(g => {
      const gTotal = g.invoices.reduce((s, i) => s + invBalance(i), 0)
      const invRows = g.invoices.map(inv => {
        const paid = parseAmt(inv.total) - invBalance(inv)
        const isVenc = inv.status === 'Vencida'
        return `<tr>
          <td style="padding-left:24px;color:#6b7280;font-size:10px">${inv.invoice_number || `FAC-${inv.id}`}</td>
          <td>${inv.date ? fmtD(inv.date) : '—'}</td>
          <td style="color:${isVenc ? '#dc2626' : '#374151'};font-weight:${isVenc ? '600' : '400'}">${inv.due_date ? fmtD(inv.due_date) : '—'}</td>
          <td style="text-align:right">${fmtMoney(inv.total)}</td>
          <td style="text-align:right;color:#16a34a">${fmtMoney(paid)}</td>
          <td style="text-align:right;font-weight:600">${fmtMoney(invBalance(inv))}</td>
          <td style="text-align:center"><span style="background:${isVenc ? '#fee2e2' : '#dbeafe'};color:${isVenc ? '#dc2626' : '#1d4ed8'};padding:2px 6px;border-radius:10px;font-size:10px">${inv.status}</span></td>
        </tr>`
      }).join('')
      return `
        <tr style="background:#f8fafc">
          <td colspan="6" style="padding:7px 10px;font-weight:700;color:#1a3353;font-size:11px">${g.name} <span style="font-weight:400;color:#6b7280">(${g.invoices.length} factura${g.invoices.length !== 1 ? 's' : ''})</span></td>
          <td style="text-align:right;font-weight:700;color:#1a3353">${fmtMoney(gTotal)}</td>
        </tr>
        ${invRows}`
    }).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cuentas por Cobrar</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#333;background:#f3f4f6}
    #toolbar{position:sticky;top:0;z-index:100;background:#1a3353;display:flex;align-items:center;justify-content:space-between;padding:10px 24px}
    #toolbar span{color:#fff;font-size:13px;font-weight:600}#toolbar button{background:#fff;color:#1a3353;border:none;border-radius:6px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer}
    #report{background:#fff;max-width:960px;margin:24px auto;padding:32px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:3px solid #1a3353;padding-bottom:12px}
    .header h1{font-size:20px;color:#1a3353}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px}
    .kpi{border:1px solid #e5e7eb;border-radius:8px;padding:12px;text-align:center}.kpi-val{font-size:22px;font-weight:700}.kpi-lbl{font-size:10px;color:#888;margin-top:4px}
    table{width:100%;border-collapse:collapse}th{background:#1a3353;color:#fff;padding:7px 10px;text-align:left;font-size:10px;font-weight:600}
    td{padding:5px 10px;border-bottom:1px solid #f0f0f0;font-size:10px}tr:nth-child(even) td{background:#fafafa}
    @media print{#toolbar{display:none!important}body{background:#fff}#report{box-shadow:none;margin:0;border-radius:0}}
    @page{size:A4 portrait;margin:1.5cm}</style>
    </head><body>
    <div id="toolbar"><span>Estado de Cuentas por Cobrar</span><button onclick="window.print()">⬇ Descargar PDF</button></div>
    <div id="report">
    <div class="header">
      <div><h1>Estado de Cuentas por Cobrar</h1><p style="color:#666;font-size:11px;margin-top:4px">${filtered.length} facturas${filters.client || filters.status || filters.date_from ? ' (filtrado)' : ' pendientes'}</p></div>
      <div style="text-align:right;font-size:11px;color:#666"><strong style="color:#1a3353;font-size:14px">${coName}</strong><br>Generado: ${dateStr}</div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-val" style="color:#2563eb">${fmtMoney(totalEmitidas)}</div><div class="kpi-lbl">Emitidas (${emitidas.length})</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#ea580c">${fmtMoney(totalVencidas)}</div><div class="kpi-lbl">Vencidas (${vencidas.length})</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#059669">${fmtMoney(totalGeneral)}</div><div class="kpi-lbl">Total por cobrar</div></div>
    </div>
    <table>
      <thead><tr><th>Factura</th><th>Emitida</th><th>Vence</th><th style="text-align:right">Total</th><th style="text-align:right">Pagado</th><th style="text-align:right">Saldo</th><th style="text-align:center">Estado</th></tr></thead>
      <tbody>${clientRows}</tbody>
    </table></div></body></html>`
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), '_blank')
  }

  if (loading) return <div className="py-20 text-center text-gray-400">Cargando...</div>

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="card">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Cliente</label>
            <input className="input w-44" style={{fontSize:'16px'}} placeholder="Buscar cliente..." value={filters.client} onChange={e => setF('client', e.target.value)} />
          </div>
          <div>
            <label className="label">Estado</label>
            <select className="input w-36" style={{fontSize:'16px'}} value={filters.status} onChange={e => setF('status', e.target.value)}>
              <option value="">Todos</option>
              <option value="Emitida">Emitida</option>
              <option value="Vencida">Vencida</option>
            </select>
          </div>
          <div>
            <label className="label">Desde</label>
            <input type="date" className="input w-auto" style={{fontSize:'16px'}} value={filters.date_from} onChange={e => setF('date_from', e.target.value)} />
          </div>
          <div>
            <label className="label">Hasta</label>
            <input type="date" className="input w-auto" style={{fontSize:'16px'}} value={filters.date_to} onChange={e => setF('date_to', e.target.value)} />
          </div>
          {(filters.client || filters.status || filters.date_from || filters.date_to) && (
            <button onClick={() => setFilters({ client: '', status: '', date_from: '', date_to: '' })}
              className="text-xs text-gray-500 hover:text-gray-700 underline self-end pb-2">
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center">
          <p className="text-lg sm:text-2xl font-bold text-blue-600">{fmtMoney(totalEmitidas)}</p>
          <p className="text-xs text-gray-500 mt-1">Emitidas · {emitidas.length}</p>
        </div>
        <div className="card text-center">
          <p className="text-lg sm:text-2xl font-bold text-orange-600">{fmtMoney(totalVencidas)}</p>
          <p className="text-xs text-gray-500 mt-1">Vencidas · {vencidas.length}</p>
        </div>
        <div className="card text-center bg-emerald-50 border-emerald-100">
          <p className="text-lg sm:text-2xl font-bold text-emerald-700">{fmtMoney(totalGeneral)}</p>
          <p className="text-xs text-emerald-600 mt-1">Por cobrar · {filtered.length}</p>
        </div>
      </div>

      {/* Tabla agrupada */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">Por cliente</h3>
          <button onClick={handlePDF} className="flex items-center gap-1.5 text-xs text-red-700 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
            <FileText size={13} /> Exportar PDF
          </button>
        </div>
        {filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-10 text-sm">{invoices.length === 0 ? 'No hay facturas pendientes de cobro' : 'Sin resultados para los filtros aplicados'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Factura</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 hidden sm:table-cell">Emitida</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 hidden md:table-cell">Vence</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-400">Total</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-400 hidden sm:table-cell">Pagado</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-400">Saldo</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-400">Estado</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const gTotal = g.invoices.reduce((s, i) => s + invBalance(i), 0)
                  const isOpen = !collapsed[g.name]
                  const hasVenc = g.invoices.some(i => i.status === 'Vencida')
                  return (
                    <React.Fragment key={g.name}>
                      <tr className="bg-gray-50 border-y border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                          onClick={() => toggle(g.name)}>
                        <td className="px-4 py-2.5" colSpan={4}>
                          <div className="flex items-center gap-2">
                            {isOpen ? <ChevronDown size={13} className="text-gray-400 shrink-0" /> : <ChevronRight size={13} className="text-gray-400 shrink-0" />}
                            <span className="font-semibold text-sm text-gray-800">{g.name}</span>
                            <span className="text-xs text-gray-400">{g.invoices.length} factura{g.invoices.length !== 1 ? 's' : ''}</span>
                            {hasVenc && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-medium">Vencida</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell" />
                        <td className="px-3 py-2.5 text-right font-bold text-sm text-gray-900">{fmtMoney(gTotal)}</td>
                        <td className="px-3 py-2.5" />
                      </tr>
                      {isOpen && g.invoices.map(inv => {
                        const paid = parseAmt(inv.total) - invBalance(inv)
                        const isVenc = inv.status === 'Vencida'
                        return (
                          <tr key={inv.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                            <td className="pl-10 pr-3 py-2.5 font-mono text-xs font-semibold text-gray-700">{inv.invoice_number || `FAC-${inv.id}`}</td>
                            <td className="px-3 py-2.5 text-xs text-gray-500 hidden sm:table-cell">{inv.date ? fmtD(inv.date) : '—'}</td>
                            <td className="px-3 py-2.5 text-xs hidden md:table-cell">
                              {inv.due_date ? <span className={isVenc ? 'text-orange-600 font-medium' : 'text-gray-500'}>{fmtD(inv.due_date)}</span> : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right text-sm text-gray-700">{fmtMoney(inv.total)}</td>
                            <td className="px-3 py-2.5 text-right text-xs text-emerald-600 hidden sm:table-cell">{fmtMoney(paid)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold text-sm text-gray-900">{fmtMoney(invBalance(inv))}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isVenc ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{inv.status}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Cuentas por Pagar ─────────────────────────────────────────────────────────
function PagarReport() {
  const { company_name } = useCompany()
  const coName = company_name || 'Service Desk'
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ supplier: '', status: '', category: '', date_from: '', date_to: '' })
  const setF = (k, v) => setFilters(f => ({ ...f, [k]: v }))

  useEffect(() => {
    setLoading(true)
    getExpenses()
      .then(r => {
        const pending = (r.data || []).filter(e => e.is_payable && !e.paid_at)
        pending.sort((a, b) => {
          if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date)
          if (a.due_date) return -1
          if (b.due_date) return 1
          return new Date(b.date || 0) - new Date(a.date || 0)
        })
        setExpenses(pending)
      })
      .catch(() => toast.error('Error cargando cuentas por pagar'))
      .finally(() => setLoading(false))
  }, [])

  const now = new Date()
  const in30 = new Date(); in30.setDate(in30.getDate() + 30)
  const categories = [...new Set(expenses.map(e => e.category).filter(Boolean))].sort()

  const filtered = React.useMemo(() => {
    return expenses.filter(e => {
      if (filters.supplier && !(e.supplier || '').toLowerCase().includes(filters.supplier.toLowerCase())) return false
      if (filters.category && e.category !== filters.category) return false
      if (filters.status === 'vencido'  && !(e.due_date && new Date(e.due_date) < now)) return false
      if (filters.status === 'prox30'   && !(e.due_date && new Date(e.due_date) >= now && new Date(e.due_date) <= in30)) return false
      if (filters.status === 'pendiente' && e.due_date && new Date(e.due_date) < now) return false
      if (filters.date_from && e.due_date && e.due_date < filters.date_from) return false
      if (filters.date_to   && e.due_date && e.due_date > filters.date_to)   return false
      return true
    })
  }, [expenses, filters])

  const vencidos = filtered.filter(e => e.due_date && new Date(e.due_date) < now)
  const prox30   = filtered.filter(e => e.due_date && new Date(e.due_date) >= now && new Date(e.due_date) <= in30)
  const totalPendiente = filtered.reduce((s, e) => s + parseAmt(e.amount), 0)
  const totalVencido   = vencidos.reduce((s, e) => s + parseAmt(e.amount), 0)
  const totalProx      = prox30.reduce((s, e) => s + parseAmt(e.amount), 0)

  const groups = React.useMemo(() => {
    const map = {}
    for (const e of filtered) {
      const key = e.supplier || '— Sin proveedor —'
      if (!map[key]) map[key] = { name: key, items: [] }
      map[key].items.push(e)
    }
    return Object.values(map).sort((a, b) =>
      b.items.reduce((s, e) => s + parseAmt(e.amount), 0) - a.items.reduce((s, e) => s + parseAmt(e.amount), 0)
    )
  }, [filtered])

  const [collapsed, setCollapsed] = useState({})
  const toggle = (name) => setCollapsed(p => ({ ...p, [name]: !p[name] }))

  const handlePDF = () => {
    const dateStr = new Date().toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const rows = expenses.map(e => {
      const isVenc = e.due_date && new Date(e.due_date) < now
      return `<tr>
        <td>${e.concept || '—'}</td>
        <td>${e.supplier || '—'}</td>
        <td>${e.category || '—'}</td>
        <td>${e.date ? fmtD(e.date) : '—'}</td>
        <td style="color:${isVenc ? '#dc2626' : '#374151'};font-weight:${isVenc ? '600' : '400'}">${e.due_date ? fmtD(e.due_date) : '—'}</td>
        <td style="text-align:right;font-weight:600">${fmtMoney(e.amount)}</td>
        <td style="text-align:center"><span style="background:${isVenc ? '#fee2e2' : '#fef3c7'};color:${isVenc ? '#dc2626' : '#92400e'};padding:2px 6px;border-radius:10px;font-size:10px">${isVenc ? 'Vencido' : 'Pendiente'}</span></td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cuentas por Pagar</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#333;background:#f3f4f6}
    #toolbar{position:sticky;top:0;z-index:100;background:#1a3353;display:flex;align-items:center;justify-content:space-between;padding:10px 24px}
    #toolbar span{color:#fff;font-size:13px;font-weight:600}#toolbar button{background:#fff;color:#1a3353;border:none;border-radius:6px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer}
    #report{background:#fff;max-width:960px;margin:24px auto;padding:32px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:3px solid #1a3353;padding-bottom:12px}
    .header h1{font-size:20px;color:#1a3353}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px}
    .kpi{border:1px solid #e5e7eb;border-radius:8px;padding:12px;text-align:center}.kpi-val{font-size:22px;font-weight:700}.kpi-lbl{font-size:10px;color:#888;margin-top:4px}
    table{width:100%;border-collapse:collapse}th{background:#1a3353;color:#fff;padding:7px 10px;text-align:left;font-size:10px;font-weight:600}
    td{padding:5px 10px;border-bottom:1px solid #f0f0f0;font-size:10px}tr:nth-child(even) td{background:#fafafa}
    @media print{#toolbar{display:none!important}body{background:#fff}#report{box-shadow:none;margin:0;border-radius:0}}
    @page{size:A4 portrait;margin:1.5cm}</style>
    </head><body>
    <div id="toolbar"><span>Estado de Cuentas por Pagar</span><button onclick="window.print()">⬇ Descargar PDF</button></div>
    <div id="report">
    <div class="header">
      <div><h1>Estado de Cuentas por Pagar</h1><p style="color:#666;font-size:11px;margin-top:4px">${filtered.length} gastos${filters.supplier || filters.status || filters.category || filters.date_from ? ' (filtrado)' : ' pendientes'}</p></div>
      <div style="text-align:right;font-size:11px;color:#666"><strong style="color:#1a3353;font-size:14px">${coName}</strong><br>Generado: ${dateStr}</div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-val" style="color:#7c3aed">${fmtMoney(totalPendiente)}</div><div class="kpi-lbl">Total pendiente (${expenses.length})</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#dc2626">${fmtMoney(totalVencido)}</div><div class="kpi-lbl">Vencido (${vencidos.length})</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#ea580c">${fmtMoney(totalProx)}</div><div class="kpi-lbl">Próx. 30 días (${prox30.length})</div></div>
    </div>
    <table>
      <thead><tr><th>Concepto</th><th>Proveedor</th><th>Categoría</th><th>Fecha</th><th>Vence</th><th style="text-align:right">Monto</th><th style="text-align:center">Estado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></body></html>`
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), '_blank')
  }

  if (loading) return <div className="py-20 text-center text-gray-400">Cargando...</div>

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="card">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Proveedor</label>
            <input className="input w-44" style={{fontSize:'16px'}} placeholder="Buscar proveedor..." value={filters.supplier} onChange={e => setF('supplier', e.target.value)} />
          </div>
          <div>
            <label className="label">Estado</label>
            <select className="input w-40" style={{fontSize:'16px'}} value={filters.status} onChange={e => setF('status', e.target.value)}>
              <option value="">Todos</option>
              <option value="vencido">Vencido</option>
              <option value="prox30">Próximos 30 días</option>
              <option value="pendiente">Pendiente</option>
            </select>
          </div>
          {categories.length > 0 && (
            <div>
              <label className="label">Categoría</label>
              <select className="input w-40" style={{fontSize:'16px'}} value={filters.category} onChange={e => setF('category', e.target.value)}>
                <option value="">Todas</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Vence desde</label>
            <input type="date" className="input w-auto" style={{fontSize:'16px'}} value={filters.date_from} onChange={e => setF('date_from', e.target.value)} />
          </div>
          <div>
            <label className="label">Vence hasta</label>
            <input type="date" className="input w-auto" style={{fontSize:'16px'}} value={filters.date_to} onChange={e => setF('date_to', e.target.value)} />
          </div>
          {(filters.supplier || filters.status || filters.category || filters.date_from || filters.date_to) && (
            <button onClick={() => setFilters({ supplier: '', status: '', category: '', date_from: '', date_to: '' })}
              className="text-xs text-gray-500 hover:text-gray-700 underline self-end pb-2">
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center bg-violet-50 border-violet-100">
          <p className="text-lg sm:text-2xl font-bold text-violet-700">{fmtMoney(totalPendiente)}</p>
          <p className="text-xs text-violet-500 mt-1">Pendiente · {filtered.length}</p>
        </div>
        <div className="card text-center">
          <p className="text-lg sm:text-2xl font-bold text-red-600">{fmtMoney(totalVencido)}</p>
          <p className="text-xs text-gray-500 mt-1">Vencido · {vencidos.length}</p>
        </div>
        <div className="card text-center">
          <p className="text-lg sm:text-2xl font-bold text-orange-600">{fmtMoney(totalProx)}</p>
          <p className="text-xs text-gray-500 mt-1">Próx. 30d · {prox30.length}</p>
        </div>
      </div>

      {/* Tabla agrupada por proveedor */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">Por proveedor</h3>
          <button onClick={handlePDF} className="flex items-center gap-1.5 text-xs text-red-700 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
            <FileText size={13} /> Exportar PDF
          </button>
        </div>
        {filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-10 text-sm">{expenses.length === 0 ? 'No hay gastos pendientes de pago' : 'Sin resultados para los filtros aplicados'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Concepto</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 hidden sm:table-cell">Categoría</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 hidden md:table-cell">Vence</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-400">Monto</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-400">Estado</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const gTotal = g.items.reduce((s, e) => s + parseAmt(e.amount), 0)
                  const isOpen = !collapsed[g.name]
                  const hasVenc = g.items.some(e => e.due_date && new Date(e.due_date) < now)
                  return (
                    <React.Fragment key={g.name}>
                      <tr className="bg-gray-50 border-y border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                          onClick={() => toggle(g.name)}>
                        <td className="px-4 py-2.5" colSpan={3}>
                          <div className="flex items-center gap-2">
                            {isOpen ? <ChevronDown size={13} className="text-gray-400 shrink-0" /> : <ChevronRight size={13} className="text-gray-400 shrink-0" />}
                            <span className="font-semibold text-sm text-gray-800">{g.name}</span>
                            <span className="text-xs text-gray-400">{g.items.length} gasto{g.items.length !== 1 ? 's' : ''}</span>
                            {hasVenc && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">Vencido</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-sm text-gray-900">{fmtMoney(gTotal)}</td>
                        <td className="px-3 py-2.5" />
                      </tr>
                      {isOpen && g.items.map(e => {
                        const isVenc = e.due_date && new Date(e.due_date) < now
                        return (
                          <tr key={e.id} className="border-b border-gray-50 hover:bg-violet-50/30 transition-colors">
                            <td className="pl-10 pr-3 py-2.5 text-gray-800 text-sm">{e.concept || '—'}</td>
                            <td className="px-3 py-2.5 text-xs text-gray-500 hidden sm:table-cell">{e.category || '—'}</td>
                            <td className="px-3 py-2.5 text-xs hidden md:table-cell">
                              {e.due_date ? <span className={isVenc ? 'text-red-600 font-semibold' : 'text-gray-500'}>{fmtD(e.due_date)}</span> : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold text-sm text-gray-900">{fmtMoney(e.amount)}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isVenc ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                {isVenc ? 'Vencido' : 'Pendiente'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Estado de Cuenta ──────────────────────────────────────────────────────────
const MONTH_NAMES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const METHOD_LABEL_EC = { efectivo:'Efectivo', transferencia:'Transferencia', tarjeta:'Tarjeta', cheque:'Cheque' }

function fmtDateEC(d) {
  if (!d) return '—'
  const parts = String(d).slice(0, 10).split('-')
  if (parts.length < 3) return d
  return `${parseInt(parts[2])} ${MONTH_NAMES[parseInt(parts[1])-1]} ${parts[0]}`
}

function EstadoCuentaReport() {
  const { company_name, company_address, company_ruc, company_phone } = useCompany()
  const coName    = company_name    || 'Service Desk'
  const coAddress = company_address || ''
  const coRuc     = company_ruc     || ''
  const coPhone   = company_phone   || ''
  const [allInvoices, setAllInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [client, setClient] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getInvoices({ status: 'Emitida' }),
      getInvoices({ status: 'Vencida' }),
      getInvoices({ status: 'Pagada' }),
    ]).then(([r1, r2, r3]) => {
      setAllInvoices([...(r1.data||[]), ...(r2.data||[]), ...(r3.data||[])])
    }).catch(() => toast.error('Error cargando facturas'))
    .finally(() => setLoading(false))
  }, [])

  const clients = React.useMemo(() => (
    [...new Set(allInvoices.map(i => i.client_name).filter(Boolean))].sort()
  ), [allInvoices])

  // All events (invoice + payments) for the selected client, sorted chronologically
  const allEvents = React.useMemo(() => {
    if (!client) return []
    const events = []
    for (const inv of allInvoices.filter(i => i.client_name === client)) {
      const invDate = inv.date || inv.created_at?.slice(0, 10) || ''
      events.push({ type: 'invoice', date: invDate, sort: 0,
        invoice_number: inv.invoice_number || `FAC-${inv.id}`,
        due_date: inv.due_date, amount: parseAmt(inv.total) })
      for (const p of (inv.payments || [])) {
        events.push({ type: 'payment', date: p.date || '', sort: 1,
          payment_id: p.id,
          invoice_number: inv.invoice_number || `FAC-${inv.id}`,
          amount: parseAmt(p.amount), method: p.method, notes: p.notes })
      }
    }
    return events.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      return a.sort - b.sort
    })
  }, [allInvoices, client])

  const { saldoInicio, visibleEvents } = React.useMemo(() => {
    let saldoInicio = 0
    const visible = []
    for (const e of allEvents) {
      const beforeRange = dateFrom && e.date < dateFrom
      if (beforeRange) {
        saldoInicio += e.type === 'invoice' ? e.amount : -e.amount
      } else if ((!dateTo || e.date <= dateTo)) {
        visible.push({ ...e })
      }
    }
    let balance = saldoInicio
    for (const e of visible) {
      balance += e.type === 'invoice' ? e.amount : -e.amount
      e.balance = balance
    }
    return { saldoInicio, visibleEvents: visible }
  }, [allEvents, dateFrom, dateTo])

  const totalFacturado = visibleEvents.filter(e => e.type === 'invoice').reduce((s, e) => s + e.amount, 0)
  const totalPagado    = visibleEvents.filter(e => e.type === 'payment').reduce((s, e) => s + e.amount, 0)
  const saldoAdeudado  = saldoInicio + totalFacturado - totalPagado

  const handlePDF = () => {
    if (!client) return
    const periodLabel = dateFrom || dateTo
      ? `${dateFrom ? fmtDateEC(dateFrom) : '—'} al ${dateTo ? fmtDateEC(dateTo) : '—'}`
      : 'Todos los períodos'
    const genDate = new Date().toLocaleDateString('es-PA', { day:'2-digit', month:'2-digit', year:'numeric' })

    const rows = []
    // Saldo inicio row
    rows.push(`<tr class="inicio-row">
      <td>${dateFrom ? fmtDateEC(dateFrom) : '—'}</td>
      <td><strong>Saldo de inicio</strong></td>
      <td></td>
      <td class="num">${fmtMoney(saldoInicio)}</td>
      <td class="num"></td>
      <td class="num">${fmtMoney(saldoInicio)}</td>
    </tr>`)
    for (const e of visibleEvents) {
      if (e.type === 'invoice') {
        rows.push(`<tr>
          <td>${fmtDateEC(e.date)}</td>
          <td>Factura</td>
          <td class="detail">${e.invoice_number}${e.due_date ? ` &ndash; vence el ${fmtDateEC(e.due_date)}` : ''}</td>
          <td class="num">${fmtMoney(e.amount)}</td>
          <td class="num"></td>
          <td class="num">${fmtMoney(e.balance)}</td>
        </tr>`)
      } else {
        const methodLabel = METHOD_LABEL_EC[e.method] || e.method || ''
        rows.push(`<tr class="pago-row">
          <td>${fmtDateEC(e.date)}</td>
          <td>Pago recibido</td>
          <td class="detail">${methodLabel}${e.notes ? ` &bull; ${e.notes}` : ''}<br><span class="sub">$${e.amount.toFixed(2)} para el pago de ${e.invoice_number}</span></td>
          <td class="num"></td>
          <td class="num pago-amt">${fmtMoney(e.amount)}</td>
          <td class="num">${fmtMoney(e.balance)}</td>
        </tr>`)
      }
    }
    rows.push(`<tr class="saldo-row">
      <td colspan="5" style="text-align:right;font-weight:700;padding-right:16px">Saldo adeudado</td>
      <td class="num" style="font-weight:700;font-size:13px">${fmtMoney(saldoAdeudado)}</td>
    </tr>`)

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Estado de Cuenta – ${client}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,sans-serif;font-size:11px;color:#222;background:#f3f4f6}
      #toolbar{position:sticky;top:0;z-index:100;background:#1a3353;display:flex;align-items:center;justify-content:space-between;padding:10px 24px}
      #toolbar span{color:#fff;font-size:13px;font-weight:600}
      #toolbar button{background:#fff;color:#1a3353;border:none;border-radius:6px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer}
      #report{background:#fff;max-width:860px;margin:24px auto;padding:36px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.09)}
      .letterhead{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}
      .company-name{font-size:16px;font-weight:700;color:#1a3353}
      .company-info{font-size:10px;color:#555;line-height:1.6;text-align:right}
      .client-block{margin-bottom:18px}
      .client-block .label{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em}
      .client-block .name{font-size:15px;font-weight:700;color:#1a3353;margin-top:2px}
      .title-block{text-align:right}
      .title-block h1{font-size:22px;font-weight:700;color:#1a3353}
      .title-block .period{font-size:11px;color:#666;margin-top:3px}
      .summary-box{border:1px solid #d1d5db;border-radius:8px;padding:16px 20px;margin-bottom:24px;background:#f9fafb;min-width:240px}
      .summary-box .title{font-size:11px;font-weight:700;color:#1a3353;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em}
      .summary-row{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;border-top:1px solid #e5e7eb}
      .summary-row:first-of-type{border-top:none}
      .summary-row .val{font-weight:600}
      .summary-row.adeudado{border-top:2px solid #1a3353;margin-top:4px;padding-top:6px;font-weight:700;font-size:12px}
      .top-row{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px}
      table{width:100%;border-collapse:collapse}
      th{background:#1a3353;color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
      th.num{text-align:right}
      td{padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:10px;vertical-align:top}
      td.num{text-align:right;white-space:nowrap}
      td.detail{color:#444;line-height:1.5}
      td.detail .sub{color:#888;font-size:9px}
      td.pago-amt{color:#16a34a;font-weight:600}
      tr.inicio-row td{background:#f8fafc;font-size:10px;color:#555}
      tr.pago-row td{background:#f0fdf4}
      tr.saldo-row td{background:#f8fafc;border-top:2px solid #1a3353;padding:8px 10px}
      .footer{margin-top:24px;text-align:center;font-size:9px;color:#aaa;border-top:1px solid #e5e7eb;padding-top:12px}
      @media print{#toolbar{display:none!important}body{background:#fff}#report{box-shadow:none;margin:0;border-radius:0;padding:20px}}
      @page{size:A4 portrait;margin:1.2cm}
    </style></head><body>
    <div id="toolbar"><span>Estado de Cuenta – ${client}</span><button onclick="window.print()">&#8659; Descargar PDF</button></div>
    <div id="report">
      <div class="top-row">
        <div>
          <div class="client-block"><div class="label">Para</div><div class="name">${client}</div></div>
        </div>
        <div>
          <div class="title-block">
            <h1>Estado de cuentas</h1>
            <div class="period">${periodLabel}</div>
          </div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:24px">
        <div>
          <div class="company-name">${coName}</div>
          ${coAddress ? `<div class="company-info">${coAddress}</div>` : ''}
          <div style="font-size:10px;color:#555">${[coRuc && `RUC: ${coRuc}`, coPhone && `Tel: ${coPhone}`].filter(Boolean).join(' &nbsp;·&nbsp; ')}</div>
          <div style="font-size:9px;color:#aaa;margin-top:8px">Generado: ${genDate}</div>
        </div>
        <div class="summary-box">
          <div class="title">Resumen de la cuenta</div>
          <div class="summary-row"><span>Saldo de inicio</span><span class="val">${fmtMoney(saldoInicio)}</span></div>
          <div class="summary-row"><span>Cantidad facturada</span><span class="val">${fmtMoney(totalFacturado)}</span></div>
          <div class="summary-row"><span>Importe recibido</span><span class="val">${fmtMoney(totalPagado)}</span></div>
          <div class="summary-row adeudado"><span>Saldo adeudado</span><span>${fmtMoney(saldoAdeudado)}</span></div>
        </div>
      </div>
      <table>
        <thead><tr>
          <th style="width:90px">Fecha</th>
          <th style="width:110px">Transacciones</th>
          <th>Detalles</th>
          <th class="num" style="width:90px">Cantidad</th>
          <th class="num" style="width:90px">Pagos</th>
          <th class="num" style="width:90px">Saldo</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <div class="footer">${coName}</div>
    </div></body></html>`
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), '_blank')
  }

  if (loading) return <div className="py-20 text-center text-gray-400">Cargando facturas...</div>

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="card">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="label">Cliente</label>
            <select className="input w-full" style={{fontSize:'16px'}} value={client} onChange={e => setClient(e.target.value)}>
              <option value="">— Seleccionar cliente —</option>
              {clients.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Desde</label>
            <input type="date" className="input w-auto" style={{fontSize:'16px'}} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">Hasta</label>
            <input type="date" className="input w-auto" style={{fontSize:'16px'}} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          {(client || dateFrom || dateTo) && (
            <button onClick={() => { setClient(''); setDateFrom(''); setDateTo('') }}
              className="text-xs text-gray-500 hover:text-gray-700 underline self-end pb-2">
              Limpiar
            </button>
          )}
        </div>
      </div>

      {!client ? (
        <div className="card py-16 text-center text-gray-400">
          <p className="text-sm">Selecciona un cliente para ver su estado de cuenta</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card text-center">
              <p className="text-xs text-gray-400 mb-1">Saldo de inicio</p>
              <p className="text-xl font-bold text-gray-700">{fmtMoney(saldoInicio)}</p>
            </div>
            <div className="card text-center">
              <p className="text-xs text-gray-400 mb-1">Facturado</p>
              <p className="text-xl font-bold text-blue-600">{fmtMoney(totalFacturado)}</p>
            </div>
            <div className="card text-center">
              <p className="text-xs text-gray-400 mb-1">Cobrado</p>
              <p className="text-xl font-bold text-emerald-600">{fmtMoney(totalPagado)}</p>
            </div>
            <div className={`card text-center ${saldoAdeudado > 0 ? 'bg-orange-50 border-orange-100' : 'bg-emerald-50 border-emerald-100'}`}>
              <p className="text-xs text-gray-400 mb-1">Saldo adeudado</p>
              <p className={`text-xl font-bold ${saldoAdeudado > 0 ? 'text-orange-600' : 'text-emerald-700'}`}>{fmtMoney(saldoAdeudado)}</p>
            </div>
          </div>

          {/* Tabla de movimientos */}
          <div className="card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm">
                {client} &mdash; {visibleEvents.length} movimiento{visibleEvents.length !== 1 ? 's' : ''}
              </h3>
              <button onClick={handlePDF}
                className="flex items-center gap-1.5 text-xs text-red-700 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
                <FileText size={13} /> Exportar PDF
              </button>
            </div>
            {visibleEvents.length === 0 ? (
              <p className="text-center text-gray-400 py-10 text-sm">Sin movimientos en el período seleccionado</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 w-24">Fecha</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 hidden sm:table-cell">Tipo</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400">Detalles</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-gray-400 w-20 hidden sm:table-cell">Cantidad</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-gray-400 w-20">Pagos</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-gray-400 w-20">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Saldo de inicio */}
                    <tr className="border-b border-gray-50 bg-gray-50/60 text-xs text-gray-500">
                      <td className="px-3 py-2">{dateFrom ? fmtDateEC(dateFrom) : '—'}</td>
                      <td className="px-3 py-2 font-medium text-gray-600 hidden sm:table-cell">Saldo inicio</td>
                      <td className="px-3 py-2 font-medium text-gray-600">
                        <span className="sm:hidden">Saldo de inicio</span>
                      </td>
                      <td className="px-3 py-2 text-right hidden sm:table-cell">{fmtMoney(saldoInicio)}</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right font-semibold text-gray-700">{fmtMoney(saldoInicio)}</td>
                    </tr>
                    {visibleEvents.map((e, idx) => (
                      e.type === 'invoice' ? (
                        <tr key={`inv-${e.invoice_number}-${idx}`} className="border-b border-gray-50 hover:bg-blue-50/20 transition-colors">
                          <td className="px-3 py-2.5 text-xs text-gray-500">{fmtDateEC(e.date)}</td>
                          <td className="px-3 py-2.5 text-xs text-blue-700 font-medium hidden sm:table-cell">Factura</td>
                          <td className="px-3 py-2.5">
                            <div className="font-mono text-xs font-semibold text-gray-700">{e.invoice_number}</div>
                            {e.due_date && <div className="text-xs text-gray-400">vence {fmtDateEC(e.due_date)}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-right text-sm text-gray-800 hidden sm:table-cell">{fmtMoney(e.amount)}</td>
                          <td className="px-3 py-2.5" />
                          <td className="px-3 py-2.5 text-right font-semibold text-sm text-gray-900">{fmtMoney(e.balance)}</td>
                        </tr>
                      ) : (
                        <tr key={`pay-${e.payment_id}-${idx}`} className="border-b border-emerald-50/60 bg-emerald-50/30 hover:bg-emerald-50/60 transition-colors">
                          <td className="px-3 py-2.5 text-xs text-gray-500">{fmtDateEC(e.date)}</td>
                          <td className="px-3 py-2.5 text-xs text-emerald-700 font-medium hidden sm:table-cell">Pago recibido</td>
                          <td className="px-3 py-2.5">
                            <div className="text-xs text-gray-600">
                              <span className="font-medium">{METHOD_LABEL_EC[e.method] || e.method}</span>
                              {e.notes && <span className="text-gray-400 italic ml-1.5">&bull; {e.notes}</span>}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">{e.invoice_number}</div>
                          </td>
                          <td className="px-3 py-2.5 hidden sm:table-cell" />
                          <td className="px-3 py-2.5 text-right text-sm font-semibold text-emerald-700">{fmtMoney(e.amount)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-sm text-gray-900">{fmtMoney(e.balance)}</td>
                        </tr>
                      )
                    ))}
                    {/* Saldo final */}
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td colSpan={4} className="px-3 py-3 text-right text-sm font-bold text-gray-700 hidden sm:table-cell">Saldo adeudado</td>
                      <td colSpan={2} className="px-3 py-3 text-right text-sm font-bold text-gray-700 sm:hidden">Saldo adeudado</td>
                      <td className={`px-3 py-3 text-right text-base font-bold ${saldoAdeudado > 0 ? 'text-orange-600' : 'text-emerald-700'} hidden sm:table-cell`}>
                        {fmtMoney(saldoAdeudado)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Reporte Mensual de Asistencias ────────────────────────────────────────────
const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const PRIORITY_COLORS = { low:'#22c55e', medium:'#f59e0b', high:'#f97316', critical:'#ef4444' }

function AsistenciaReport() {
  const { user } = useAuth()
  const isClient = user?.role === 'client'
  const { company_name, company_address, company_ruc, company_phone, company_email } = useCompany()
  const coName    = company_name    || 'Service Desk'
  const coAddress = company_address || ''
  const coRuc     = company_ruc     || ''
  const coPhone   = company_phone   || ''
  const coEmail   = company_email   || ''
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [company, setCompany] = useState(() => isClient ? (user?.company || '') : '')
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(false)
  const reqRef = useRef(0)

  useEffect(() => {
    if (!isClient) getClients().then(r => setClients(r.data || [])).catch(() => {})
  }, [isClient])

  useEffect(() => {
    if (!clientId && !company) { setTickets([]); return }
    const reqId = ++reqRef.current
    setLoading(true)
    const dateFrom = `${year}-${String(month).padStart(2,'0')}-01T00:00:00`
    const lastDay = new Date(year, month, 0).getDate()
    const dateTo = `${year}-${String(month).padStart(2,'0')}-${lastDay}T23:59:59`
    const params = { date_from: dateFrom, date_to: dateTo }
    if (company) params.company = company
    else params.client_id = clientId
    getReportTickets(params)
      .then(r => { if (reqRef.current === reqId) setTickets(r.data.tickets || []) })
      .catch(() => { if (reqRef.current === reqId) toast.error('Error cargando tickets') })
      .finally(() => { if (reqRef.current === reqId) setLoading(false) })
  }, [clientId, company, month, year])

  const selectedClient = clients.find(c => String(c.id) === String(clientId))
  const companies = React.useMemo(() => (
    [...new Set(clients.map(c => c.company).filter(Boolean))].sort()
  ), [clients])
  const displayLabel = company || selectedClient?.name || ''

  const RESOLVED_STATUSES = ['resuelto', 'resolved', 'cerrado', 'closed']
  const isResolved = t => t.closed_at || RESOLVED_STATUSES.includes((t.status || '').toLowerCase())
  const resolved = tickets.filter(isResolved)
  const years = []
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) years.push(y)

  const handlePDF = () => {
    if ((!selectedClient && !company) || tickets.length === 0) return
    const periodLabel = `${MONTHS_ES[month - 1]} ${year}`
    const genDate = new Date().toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const clientCompany = company || selectedClient?.company || ''
    const reportName = company ? company : selectedClient?.name

    const ticketRows = tickets.map((t, i) => {
      const created = t.created_at ? t.created_at.slice(0, 10) : ''
      const closed  = t.closed_at  ? t.closed_at.slice(0, 10)  : ''
      const hrs = t.horas_visitas != null ? `${t.horas_visitas}h` : '—'
      const pColor = PRIORITY_COLORS[t.priority] || '#6b7280'
      const desc = (t.description || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
      return `<tr>
        <td style="text-align:center;color:#9ca3af;font-size:10px">${i + 1}</td>
        <td style="font-weight:600;color:#1a3353">#${t.id}</td>
        <td>
          <div style="font-weight:600;color:#111827;margin-bottom:2px">${t.title}</div>
          ${desc ? `<div style="font-size:9px;color:#6b7280;line-height:1.4">${desc}</div>` : ''}
        </td>
        <td style="white-space:nowrap">${fmtD(created)}</td>
        <td style="white-space:nowrap;color:${isResolved(t) ? '#16a34a' : '#9ca3af'}">${closed ? fmtD(closed) : '—'}</td>
        <td style="text-align:center"><span style="background:${pColor}20;color:${pColor};padding:2px 7px;border-radius:10px;font-size:9px;font-weight:700">${t.priority_label}</span></td>
        <td style="color:#374151">${t.client || '—'}</td>
        <td style="color:#374151">${t.assigned_agent || '—'}</td>
        <td style="text-align:center;font-weight:600">${hrs}</td>
        <td style="text-align:center;font-weight:600;color:#e11d48">${t.costo_total_visitas != null ? '$' + Number(t.costo_total_visitas).toFixed(2) : '—'}</td>
        <td style="text-align:center"><span style="background:${t.closed_at ? '#dcfce7' : '#f3f4f6'};color:${t.closed_at ? '#15803d' : '#6b7280'};padding:2px 7px;border-radius:10px;font-size:9px;font-weight:700">${t.status || '—'}</span></td>
      </tr>`
    }).join('')

    const resRate = tickets.length > 0 ? Math.round((resolved.length / tickets.length) * 100) : 0
    const avgHrs = resolved.length > 0
      ? (resolved.reduce((s, t) => s + (t.resolution_hours || 0), 0) / resolved.length).toFixed(1)
      : '—'
    const totalCosto = '$' + tickets.reduce((s, t) => s + (t.costo_total_visitas || 0), 0).toFixed(2)

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Reporte de Asistencias – ${reportName} – ${periodLabel}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,sans-serif;font-size:11px;color:#222;background:#f3f4f6}
      #toolbar{position:sticky;top:0;z-index:100;background:#1a3353;display:flex;align-items:center;justify-content:space-between;padding:10px 24px}
      #toolbar span{color:#fff;font-size:13px;font-weight:600}
      #toolbar button{background:#fff;color:#1a3353;border:none;border-radius:6px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer}
      #report{background:#fff;max-width:1020px;margin:24px auto;padding:36px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.09)}
      .top-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;border-bottom:3px solid #1a3353;padding-bottom:16px}
      .client-block .label{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em}
      .client-block .name{font-size:18px;font-weight:700;color:#1a3353;margin-top:2px}
      .client-block .company{font-size:12px;color:#6b7280;margin-top:2px}
      .title-block{text-align:right}
      .title-block h1{font-size:22px;font-weight:700;color:#1a3353}
      .title-block .period{font-size:12px;color:#6b7280;margin-top:3px}
      .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
      .kpi{border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center}
      .kpi-val{font-size:28px;font-weight:700}.kpi-lbl{font-size:10px;color:#888;margin-top:4px}
      table{width:100%;border-collapse:collapse;margin-top:4px}
      th{background:#1a3353;color:#fff;padding:8px 10px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
      td{padding:7px 10px;border-bottom:1px solid #f0f0f0;font-size:10px;vertical-align:top}
      tr:nth-child(even) td{background:#fafafa}
      tr:hover td{background:#f0f4ff}
      .footer{margin-top:24px;text-align:center;font-size:9px;color:#aaa;border-top:1px solid #e5e7eb;padding-top:12px}
      @media print{#toolbar{display:none!important}body{background:#fff}#report{box-shadow:none;margin:0;border-radius:0;padding:20px}}
      @page{size:A4 landscape;margin:1.2cm}
    </style></head><body>
    <div id="toolbar">
      <span>Reporte de Asistencias – ${reportName} – ${periodLabel}</span>
      <button onclick="window.print()">&#8659; Descargar PDF</button>
    </div>
    <div id="report">
      <div class="top-row">
        <div class="client-block">
          <div class="label">Reporte de asistencias para</div>
          <div class="name">${reportName}</div>
          ${clientCompany && !company ? `<div class="company">${clientCompany}</div>` : ''}
        </div>
        <div class="title-block">
          <h1>Reporte Mensual</h1>
          <div class="period">${periodLabel}</div>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="kpi-val" style="color:#2563eb">${tickets.length}</div><div class="kpi-lbl">Tickets del mes</div></div>
        <div class="kpi"><div class="kpi-val" style="color:#16a34a">${resolved.length}</div><div class="kpi-lbl">Resueltos</div></div>
        <div class="kpi"><div class="kpi-val" style="color:#f97316">${resRate}%</div><div class="kpi-lbl">Tasa de resolución</div></div>
        <div class="kpi"><div class="kpi-val" style="color:#7c3aed">${avgHrs}</div><div class="kpi-lbl">Hrs prom. resolución</div></div>
        <div class="kpi"><div class="kpi-val" style="color:#e11d48">${totalCosto}</div><div class="kpi-lbl">Costo visitas</div></div>
      </div>
      <table>
        <thead><tr>
          <th style="width:28px">#</th>
          <th style="width:42px">ID</th>
          <th>Descripción del incidente</th>
          <th style="width:76px">Creado</th>
          <th style="width:76px">Resuelto</th>
          <th style="width:72px;text-align:center">Prioridad</th>
          <th style="width:100px">Solicitante</th>
          <th style="width:100px">Agente</th>
          <th style="width:44px;text-align:center">Hrs visitas</th>
          <th style="width:70px;text-align:center">Costo</th>
          <th style="width:80px;text-align:center">Estado</th>
        </tr></thead>
        <tbody>${ticketRows}</tbody>
      </table>
      <div class="footer" style="display:flex;align-items:center;justify-content:space-between">
        <span>${[coName, coAddress, coRuc && `RUC: ${coRuc}`, coPhone && `Tel: ${coPhone}`].filter(Boolean).join(' &bull; ')} &bull; Reporte generado el ${genDate}</span>
        <img src="${companyLogoSrc(window.location.origin)}" alt="Logo" style="height:36px;width:auto;opacity:0.7;border-radius:8px">
      </div>
    </div></body></html>`
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), '_blank')
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="card">
        <div className="flex flex-wrap gap-3 items-end">
          {!isClient && companies.length > 0 && (
            <div className="flex-1 min-w-[180px]">
              <label className="label">Empresa</label>
              <select className="input w-full" style={{fontSize:'16px'}} value={company} onChange={e => { setCompany(e.target.value); setClientId('') }}>
                <option value="">— Todas —</option>
                {companies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          {!isClient && (
          <div className="flex-1 min-w-[200px]">
            <label className="label">Cliente</label>
            <select className="input w-full" style={{fontSize:'16px'}} value={clientId} onChange={e => { setClientId(e.target.value); setCompany('') }}>
              <option value="">— Todos —</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>
              ))}
            </select>
          </div>
          )}
          <div>
            <label className="label">Mes</label>
            <select className="input w-36" style={{fontSize:'16px'}} value={month} onChange={e => setMonth(Number(e.target.value))}>
              {MONTHS_ES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Año</label>
            <select className="input w-28" style={{fontSize:'16px'}} value={year} onChange={e => setYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      {!isClient && !clientId && !company ? (
        <div className="card py-16 text-center text-gray-400">
          <p className="text-sm">Selecciona una empresa o un cliente para generar el reporte mensual</p>
        </div>
      ) : loading ? (
        <div className="card py-16 text-center text-gray-400">Cargando...</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="card text-center">
              <p className="text-2xl font-bold text-blue-600">{tickets.length}</p>
              <p className="text-xs text-gray-500 mt-1">Tickets del mes</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-emerald-600">{resolved.length}</p>
              <p className="text-xs text-gray-500 mt-1">Resueltos</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-orange-600">
                {tickets.length > 0 ? Math.round((resolved.length / tickets.length) * 100) : 0}%
              </p>
              <p className="text-xs text-gray-500 mt-1">Tasa resolución</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-violet-600">
                {resolved.length > 0
                  ? (resolved.reduce((s, t) => s + (t.resolution_hours || 0), 0) / resolved.length).toFixed(1) + 'h'
                  : '—'}
              </p>
              <p className="text-xs text-gray-500 mt-1">Hrs prom.</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-rose-600">
                {'$' + tickets.reduce((s, t) => s + (t.costo_total_visitas || 0), 0).toFixed(2)}
              </p>
              <p className="text-xs text-gray-500 mt-1">Costo visitas</p>
            </div>
          </div>

          {/* Tabla */}
          <div className="card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm">
                {displayLabel} &mdash; {MONTHS_ES[month - 1]} {year} &mdash; {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
              </h3>
              <button
                onClick={handlePDF}
                disabled={tickets.length === 0}
                className="flex items-center gap-1.5 text-xs text-red-700 border border-red-200 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors"
              >
                <FileText size={13} /> Exportar PDF
              </button>
            </div>
            {tickets.length === 0 ? (
              <p className="text-center text-gray-400 py-10 text-sm">
                Sin tickets para {displayLabel} en {MONTHS_ES[month - 1]} {year}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 hidden sm:table-cell">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Título</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 hidden md:table-cell">Categoría</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400">Estado</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 hidden sm:table-cell">Prioridad</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 hidden sm:table-cell">Solicitante</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 hidden md:table-cell">Agente</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 hidden sm:table-cell">Creado</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-gray-400 hidden md:table-cell">Visitas</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-gray-400 hidden md:table-cell">Costo Visitas</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-gray-400 hidden md:table-cell">Hrs Visitas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map(t => (
                      <tr key={t.id} className="border-b border-gray-50 hover:bg-blue-50/20 transition-colors">
                        <td className="px-3 py-2.5 text-gray-400 font-mono text-xs hidden sm:table-cell">#{t.id}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-900 truncate max-w-[200px] sm:max-w-xs">{t.title}</div>
                          {t.description && (
                            <div className="text-xs text-gray-400 truncate max-w-[200px] sm:max-w-xs mt-0.5">{t.description}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-500 hidden md:table-cell">{t.category || '—'}</td>
                        <td className="px-3 py-2.5 text-xs">
                          <span className={`px-2 py-0.5 rounded-full font-medium ${isResolved(t) ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-600 hidden sm:table-cell">{t.priority_label}</td>
                        <td className="px-3 py-2.5 text-xs text-gray-700 hidden sm:table-cell">{t.client || '—'}</td>
                        <td className="px-3 py-2.5 text-xs text-gray-600 hidden md:table-cell">{t.assigned_agent || '—'}</td>
                        <td className="px-3 py-2.5 text-xs text-gray-500 hidden sm:table-cell">
                          {t.created_at ? t.created_at.slice(0, 10) : ''}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-right text-gray-600 hidden md:table-cell">
                          {t.cantidad_visitas || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-right text-gray-700 hidden md:table-cell">
                          {t.costo_total_visitas != null ? `$${Number(t.costo_total_visitas).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-right text-gray-600 hidden md:table-cell">
                          {t.horas_visitas != null ? `${t.horas_visitas}h` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Reporte Por Agente ────────────────────────────────────────────────────────
const PRIO_COLOR = { low: 'bg-gray-100 text-gray-600', medium: 'bg-blue-100 text-blue-700', high: 'bg-orange-100 text-orange-700', critical: 'bg-red-100 text-red-700' }

function AgenteReport() {
  const { company_name } = useCompany()
  const coName = company_name || 'Service Desk'
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [dateFrom, setDateFrom] = useState(monthAgo())
  const [dateTo, setDateTo]     = useState(today())
  const [expanded, setExpanded] = useState({})
  const [expandedClients, setExpandedClients] = useState({})

  const load = () => {
    setLoading(true)
    const params = {}
    if (dateFrom) params.date_from = dateFrom + 'T00:00:00'
    if (dateTo)   params.date_to   = dateTo   + 'T23:59:59'
    getReportAgents(params)
      .then(r => setData(r.data))
      .catch(() => toast.error('Error cargando reporte por agente'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  const toggle = (name) => setExpanded(p => ({ ...p, [name]: !p[name] }))
  const toggleClients = (name) => setExpandedClients(p => ({ ...p, [name]: !p[name] }))

  const handlePDF = () => {
    if (!data) return
    const dateLabel = `${dateFrom || '—'} al ${dateTo || '—'}`
    const agentRows = (data.agents || []).map(a => {
      const ticketRows = a.tickets.map(t => `
        <tr>
          <td style="color:#6b7280;font-size:10px">#${t.id}</td>
          <td>${t.title}</td>
          <td>${t.client || '—'}${t.client_company ? `<br><span style="color:#9ca3af;font-size:9px">${t.client_company}</span>` : ''}</td>
          <td>${t.status || '—'}</td>
          <td><span style="padding:2px 6px;border-radius:8px;font-size:9px;background:${t.priority==='critical'?'#fee2e2':t.priority==='high'?'#ffedd5':t.priority==='medium'?'#dbeafe':'#f3f4f6'};color:${t.priority==='critical'?'#dc2626':t.priority==='high'?'#ea580c':t.priority==='medium'?'#2563eb':'#6b7280'}">${t.priority_label}</span></td>
          <td style="color:#6b7280;font-size:10px">${t.created_at ? t.created_at.slice(0,10) : ''}</td>
          <td style="text-align:right">${t.resolution_hours != null ? t.resolution_hours+'h' : '—'}</td>
        </tr>`).join('')
      const clientList = a.clients.slice(0,8).map(c => `${c.name}${c.company?` (${c.company})`:''}: <b>${c.count}</b>`).join(' &nbsp;·&nbsp; ')
      return `
        <div class="agent-block">
          <div class="agent-header">
            <span class="agent-name">${a.name}</span>
            <span class="kpi-inline"><b>${a.total}</b> tickets</span>
            <span class="kpi-inline" style="color:#16a34a"><b>${a.resolved}</b> resueltos</span>
            <span class="kpi-inline" style="color:#ea580c"><b>${a.open}</b> abiertos</span>
            <span class="kpi-inline"><b>${a.resolution_rate}%</b> tasa</span>
            ${a.avg_hours != null ? `<span class="kpi-inline" style="color:#7c3aed"><b>${a.avg_hours}h</b> prom.</span>` : ''}
          </div>
          ${clientList ? `<p style="font-size:10px;color:#6b7280;margin:6px 0 10px 0">Clientes: ${clientList}</p>` : ''}
          <table><thead><tr><th>#</th><th>Título</th><th>Cliente</th><th>Estado</th><th>Prioridad</th><th>Creado</th><th style="text-align:right">Hrs</th></tr></thead>
          <tbody>${ticketRows}</tbody></table>
        </div>`
    }).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte por Agente</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#333;background:#f3f4f6}
    #toolbar{position:sticky;top:0;z-index:100;background:#1a3353;display:flex;align-items:center;justify-content:space-between;padding:10px 24px}
    #toolbar span{color:#fff;font-size:13px;font-weight:600}#toolbar button{background:#fff;color:#1a3353;border:none;border-radius:6px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer}
    #report{background:#fff;max-width:1000px;margin:24px auto;padding:32px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:3px solid #1a3353;padding-bottom:12px}
    .header h1{font-size:20px;color:#1a3353}
    .agent-block{margin-bottom:28px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}
    .agent-header{background:#1a3353;color:#fff;padding:10px 14px;display:flex;flex-wrap:wrap;gap:14px;align-items:center}
    .agent-name{font-size:13px;font-weight:700;flex:1}
    .kpi-inline{font-size:11px;opacity:.9}
    table{width:100%;border-collapse:collapse}th{background:#f8fafc;color:#374151;padding:7px 10px;text-align:left;font-size:10px;font-weight:600;border-bottom:2px solid #e5e7eb}
    td{padding:5px 10px;border-bottom:1px solid #f0f0f0;font-size:10px}tr:nth-child(even) td{background:#fafafa}
    @media print{#toolbar{display:none!important}body{background:#fff}#report{box-shadow:none;margin:0;border-radius:0}}
    @page{size:A4 landscape;margin:1cm}</style>
    </head><body>
    <div id="toolbar"><span>Reporte de Tickets por Agente</span><button onclick="window.print()">⬇ Descargar PDF</button></div>
    <div id="report">
    <div class="header">
      <div><h1>Reporte por Agente</h1><p style="color:#666;font-size:11px;margin-top:4px">Período: ${dateLabel} · ${data.total_tickets} tickets en total</p></div>
      <div style="text-align:right;font-size:11px;color:#666"><strong style="color:#1a3353;font-size:14px">${coName}</strong><br>Generado: ${new Date().toLocaleDateString('es-PA',{day:'2-digit',month:'2-digit',year:'numeric'})}</div>
    </div>
    ${agentRows}
    </div></body></html>`
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), '_blank')
  }

  const agents = data?.agents || []
  const totalTickets = data?.total_tickets ?? 0

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="card">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Desde</label>
            <input type="date" className="input w-auto" style={{fontSize:'16px'}} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">Hasta</label>
            <input type="date" className="input w-auto" style={{fontSize:'16px'}} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <button onClick={load} className="btn-primary text-sm">Consultar</button>
          {data && (
            <button onClick={handlePDF} className="btn-secondary flex items-center gap-1.5 text-xs text-red-700 border-red-200 hover:bg-red-50 ml-auto">
              <FileText size={13} /> Exportar PDF
            </button>
          )}
        </div>
      </div>

      {loading && <div className="py-20 text-center text-gray-400">Cargando...</div>}

      {!loading && data && (
        <>
          {/* KPIs globales */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card text-center">
              <p className="text-2xl font-bold text-blue-600">{totalTickets}</p>
              <p className="text-xs text-gray-500 mt-1">Total tickets</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-emerald-600">{agents.length}</p>
              <p className="text-xs text-gray-500 mt-1">Agentes activos</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-violet-600">
                {totalTickets > 0 ? Math.round(agents.reduce((s,a) => s + a.resolved, 0) / totalTickets * 100) : 0}%
              </p>
              <p className="text-xs text-gray-500 mt-1">Tasa global resolución</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-amber-600">
                {(() => { const hrs = agents.filter(a => a.avg_hours).map(a => a.avg_hours); return hrs.length ? (hrs.reduce((s,h)=>s+h,0)/hrs.length).toFixed(1)+'h' : '—' })()}
              </p>
              <p className="text-xs text-gray-500 mt-1">Prom. hrs resolución</p>
            </div>
          </div>

          {/* Barra comparativa */}
          {agents.length > 1 && (
            <div className="card">
              <h3 className="font-semibold text-gray-900 text-sm mb-4">Comparativo de carga</h3>
              <div className="space-y-3">
                {agents.map(a => (
                  <div key={a.name} className="flex items-center gap-3">
                    <span className="text-xs text-gray-700 w-32 truncate flex-shrink-0">{a.name}</span>
                    <div className="flex-1 flex gap-0.5 h-5 rounded overflow-hidden bg-gray-100">
                      {a.resolved > 0 && (
                        <div
                          className="bg-emerald-500 flex items-center justify-center text-white text-xs font-medium"
                          style={{ width: `${totalTickets > 0 ? a.resolved/totalTickets*100 : 0}%`, minWidth: a.resolved > 0 ? 24 : 0 }}
                          title={`${a.resolved} resueltos`}
                        >{a.resolved}</div>
                      )}
                      {a.open > 0 && (
                        <div
                          className="bg-blue-400 flex items-center justify-center text-white text-xs font-medium"
                          style={{ width: `${totalTickets > 0 ? a.open/totalTickets*100 : 0}%`, minWidth: a.open > 0 ? 20 : 0 }}
                          title={`${a.open} abiertos`}
                        >{a.open}</div>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 w-10 text-right flex-shrink-0">{a.total}</span>
                  </div>
                ))}
                <div className="flex gap-4 mt-2 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block"/>Resueltos</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-400 inline-block"/>Abiertos</span>
                </div>
              </div>
            </div>
          )}

          {/* Tarjetas por agente */}
          <div className="space-y-4">
            {agents.length === 0 && (
              <div className="card py-16 text-center text-gray-400">Sin tickets en el período seleccionado</div>
            )}
            {agents.map(a => (
              <div key={a.name} className="card p-0 overflow-hidden">
                {/* Cabecera del agente */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-5 py-4 flex flex-wrap items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {a.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base leading-tight">{a.name}</p>
                    <p className="text-xs text-slate-300 mt-0.5">{a.total} ticket{a.total!==1?'s':''} asignados</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <div className="text-center px-3 py-1.5 bg-white/10 rounded-lg">
                      <p className="text-lg font-bold text-emerald-300">{a.resolved}</p>
                      <p className="text-xs text-slate-300">Resueltos</p>
                    </div>
                    <div className="text-center px-3 py-1.5 bg-white/10 rounded-lg">
                      <p className="text-lg font-bold text-blue-300">{a.open}</p>
                      <p className="text-xs text-slate-300">Abiertos</p>
                    </div>
                    <div className="text-center px-3 py-1.5 bg-white/10 rounded-lg">
                      <p className="text-lg font-bold text-amber-300">{a.resolution_rate}%</p>
                      <p className="text-xs text-slate-300">Tasa</p>
                    </div>
                    {a.avg_hours != null && (
                      <div className="text-center px-3 py-1.5 bg-white/10 rounded-lg">
                        <p className="text-lg font-bold text-violet-300">{a.avg_hours}h</p>
                        <p className="text-xs text-slate-300">Prom. resolución</p>
                      </div>
                    )}
                    {a.critical_high > 0 && (
                      <div className="text-center px-3 py-1.5 bg-red-500/30 rounded-lg border border-red-400/30">
                        <p className="text-lg font-bold text-red-300">{a.critical_high}</p>
                        <p className="text-xs text-red-300">Alta/Crítica</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* KPIs secundarios */}
                <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-x-5 gap-y-2">
                  <div className="flex items-center gap-4">
                    {Object.entries(a.by_priority).filter(([,v]) => v > 0).map(([k, v]) => (
                      <span key={k} className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIO_COLOR[k]}`}>
                        {PRIORITY_LABELS[k]}: {v}
                      </span>
                    ))}
                  </div>
                  <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
                    {Object.entries(a.by_status).map(([s, v]) => (
                      <span key={s}>{s}: <b className="text-gray-700">{v}</b></span>
                    ))}
                  </div>
                </div>

                {/* Clientes atendidos */}
                <div className="px-5 py-3 border-b border-gray-100">
                  <button
                    className="flex items-center gap-2 text-xs font-semibold text-gray-600 hover:text-gray-900 transition-colors"
                    onClick={() => toggleClients(a.name)}
                  >
                    <Users size={13} className="text-gray-400" />
                    {a.clients.length} cliente{a.clients.length!==1?'s':''} atendidos
                    {expandedClients[a.name] ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                  </button>
                  {expandedClients[a.name] && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {a.clients.map(c => (
                        <div key={c.name} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                          <div>
                            <p className="text-xs font-medium text-gray-900 leading-tight">{c.name}</p>
                            {c.company && <p className="text-xs text-gray-400 leading-tight">{c.company}</p>}
                          </div>
                          <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-semibold flex-shrink-0">{c.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Detalle de tickets expandible */}
                <div>
                  <button
                    className="w-full flex items-center justify-between px-5 py-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                    onClick={() => toggle(a.name)}
                  >
                    <span>Ver {a.tickets.length} ticket{a.tickets.length!==1?'s':''}</span>
                    {expanded[a.name] ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                  </button>
                  {expanded[a.name] && (
                    <div className="overflow-x-auto border-t border-gray-100">
                      <table className="w-full min-w-[600px] text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">#</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Título</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Cliente</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Estado</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Prioridad</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Creado</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Hrs resolución</th>
                          </tr>
                        </thead>
                        <tbody>
                          {a.tickets.map(t => (
                            <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="px-4 py-2 text-xs text-gray-400 font-mono">#{t.id}</td>
                              <td className="px-4 py-2 text-sm text-gray-900 max-w-xs">
                                <span className="truncate block">{t.title}</span>
                              </td>
                              <td className="px-4 py-2 text-xs text-gray-700">
                                <div>{t.client || '—'}</div>
                                {t.client_company && <div className="text-gray-400">{t.client_company}</div>}
                              </td>
                              <td className="px-4 py-2 text-xs text-gray-600">{t.status || '—'}</td>
                              <td className="px-4 py-2">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIO_COLOR[t.priority] || 'bg-gray-100 text-gray-600'}`}>
                                  {t.priority_label}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{t.created_at ? t.created_at.slice(0,10) : '—'}</td>
                              <td className="px-4 py-2 text-xs text-right font-medium">
                                {t.resolution_hours != null
                                  ? <span className="text-violet-600">{t.resolution_hours}h</span>
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Reports() {
  const { user } = useAuth()
  const { company_name } = useCompany()
  const { modules } = useModules()
  const coName = company_name || 'Service Desk'
  const isClient = user?.role === 'client'

  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'tickets')

  const changeTab = (id) => {
    setActiveTab(id)
    setSearchParams({ tab: id }, { replace: true })
  }
  const [summary, setSummary]   = useState(null)
  const [tickets, setTickets]   = useState([])
  const [statuses, setStatuses] = useState([])
  const [agents, setAgents]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [filters, setFilters]   = useState({
    date_from: monthAgo(),
    date_to:   today(),
    status_id: '',
    assigned_to_id: '',
    priority: '',
  })

  useEffect(() => {
    if (!isClient) {
      Promise.all([getStatuses(), getAgents()]).then(([sR, aR]) => {
        setStatuses(sR.data); setAgents(aR.data)
      })
    } else {
      getStatuses().then(r => setStatuses(r.data))
    }
  }, [isClient])

  const ticketsReqRef = useRef(0)
  useEffect(() => {
    if (activeTab !== 'tickets') return
    const params = {}
    if (filters.date_from)      params.date_from      = filters.date_from + 'T00:00:00'
    if (filters.date_to)        params.date_to        = filters.date_to   + 'T23:59:59'
    if (filters.status_id)      params.status_id      = filters.status_id
    if (filters.assigned_to_id) params.assigned_to_id = filters.assigned_to_id
    if (filters.priority)       params.priority       = filters.priority

    const reqId = ++ticketsReqRef.current
    setLoading(true)
    Promise.all([getReportSummary(params), getReportTickets(params)])
      .then(([sumR, tickR]) => {
        if (ticketsReqRef.current !== reqId) return
        setSummary(sumR.data); setTickets(tickR.data.tickets)
      })
      .catch(() => { if (ticketsReqRef.current === reqId) toast.error('Error cargando reportes') })
      .finally(() => { if (ticketsReqRef.current === reqId) setLoading(false) })
  }, [filters, activeTab])

  const buildParams = () => {
    const p = {}
    if (filters.date_from)      p.date_from      = filters.date_from + 'T00:00:00'
    if (filters.date_to)        p.date_to        = filters.date_to   + 'T23:59:59'
    if (filters.status_id)      p.status_id      = filters.status_id
    if (filters.assigned_to_id) p.assigned_to_id = filters.assigned_to_id
    if (filters.priority)       p.priority       = filters.priority
    return p
  }

  const handleCSV = async () => {
    try {
      const res = await downloadReportCSV(buildParams())
      downloadBlob(await res.blob(), 'reporte_tickets.csv')
    } catch { toast.error('Error descargando CSV') }
  }

  const handleExcel = async () => {
    try {
      const res = await downloadReportExcel(buildParams())
      if (!res.ok) throw new Error()
      downloadBlob(await res.blob(), 'reporte_tickets.xlsx')
    } catch { toast.error('Error descargando Excel') }
  }

  const handlePDF = () => {
    if (!summary) return
    const dateLabel = `${filters.date_from} al ${filters.date_to}`
    const companyLine = isClient && user?.company ? `<p style="margin:0;color:#1a3353;font-weight:600">${user.company}</p>` : ''
    const statusRows = Object.entries(summary.by_status).map(([n, c]) => `<tr><td>${n}</td><td style="text-align:center;font-weight:600">${c}</td></tr>`).join('')
    const prioRows = Object.entries(summary.by_priority).map(([k, c]) => `<tr><td>${PRIORITY_LABELS[k] || k}</td><td style="text-align:center;font-weight:600">${c}</td></tr>`).join('')
    const ticketRows = tickets.map(t => `
      <tr>
        <td style="color:#888">#${t.id}</td><td>${t.title}</td><td>${t.status || ''}</td>
        <td>${PRIORITY_LABELS[t.priority] || t.priority}</td><td>${t.client || ''}</td>
        <td>${t.assigned_agent || '—'}</td><td>${t.created_at ? t.created_at.slice(0,10) : ''}</td>
        <td style="text-align:center">${t.resolution_hours ? t.resolution_hours + 'h' : '—'}</td>
      </tr>`).join('')
    const resRate = summary.total > 0 ? Math.round((summary.resolved / summary.total) * 100) : 0

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte de Tickets</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;color:#333;background:#f3f4f6}
    #toolbar{position:sticky;top:0;z-index:100;background:#1a3353;display:flex;align-items:center;justify-content:space-between;padding:10px 24px}
    #toolbar span{color:#fff;font-size:13px;font-weight:600}#toolbar button{background:#fff;color:#1a3353;border:none;border-radius:6px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer}
    #report{background:#fff;max-width:960px;margin:24px auto;padding:32px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:3px solid #1a3353;padding-bottom:12px}
    .header h1{font-size:22px;color:#1a3353}.meta{text-align:right;font-size:11px;color:#666}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
    .kpi{border:1px solid #e5e7eb;border-radius:8px;padding:12px;text-align:center}.kpi-val{font-size:26px;font-weight:700;color:#1a3353}.kpi-lbl{font-size:10px;color:#888;margin-top:4px}
    .section{margin-bottom:20px}.section h2{font-size:13px;color:#1a3353;margin-bottom:8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
    .mini-tables{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    table{width:100%;border-collapse:collapse}th{background:#1a3353;color:#fff;padding:7px 10px;text-align:left;font-size:10px;font-weight:600}
    td{padding:5px 10px;border-bottom:1px solid #f0f0f0;font-size:11px}tr:nth-child(even) td{background:#f9f9f9}
    @media print{#toolbar{display:none!important}body{background:#fff}#report{box-shadow:none;margin:0;border-radius:0;max-width:100%;width:100%}}@page{size:A4 portrait;margin:1.5cm}</style>
    </head><body>
    <div id="toolbar"><span>📄 Reporte de Tickets — ${dateLabel}</span><button onclick="window.print()">⬇ Descargar PDF</button></div>
    <div id="report">
    <div class="header"><div><h1>Reporte de Tickets</h1>${companyLine}<p style="color:#666;font-size:11px;margin-top:4px">Período: ${dateLabel}</p></div>
    <div class="meta"><strong style="color:#1a3353;font-size:14px">${coName}</strong><br>Generado: ${new Date().toLocaleDateString('es-PA',{day:'2-digit',month:'2-digit',year:'numeric'})}</div></div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-val" style="color:#3b82f6">${summary.total}</div><div class="kpi-lbl">Total Tickets</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#10b981">${summary.resolved}</div><div class="kpi-lbl">Resueltos</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#f97316">${resRate}%</div><div class="kpi-lbl">Tasa de Resolución</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#8b5cf6">${summary.avg_resolution_hours ?? '—'}</div><div class="kpi-lbl">Horas Prom. Resolución</div></div>
    </div>
    <div class="mini-tables section">
      <div class="section"><h2>Por Estado</h2><table><thead><tr><th>Estado</th><th style="text-align:center">Tickets</th></tr></thead><tbody>${statusRows}</tbody></table></div>
      <div class="section"><h2>Por Prioridad</h2><table><thead><tr><th>Prioridad</th><th style="text-align:center">Tickets</th></tr></thead><tbody>${prioRows}</tbody></table></div>
    </div>
    <div class="section"><h2>Detalle de Tickets (${tickets.length})</h2>
    <table><thead><tr><th>#</th><th>Título</th><th>Estado</th><th>Prioridad</th><th>Usuario Afectado</th><th>Agente</th><th>Creado</th><th style="text-align:center">Hrs</th></tr></thead>
    <tbody>${ticketRows}</tbody></table></div></div></body></html>`

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    window.open(URL.createObjectURL(blob), '_blank')
  }

  const statusChartData   = summary ? Object.entries(summary.by_status).map(([name, count]) => ({ name, count })) : []
  const priorityChartData = summary ? Object.entries(summary.by_priority).map(([k, count]) => ({ name: PRIORITY_LABELS[k] || k, count })) : []

  const ALL_TABS = [
    { id: 'tickets',    label: 'Tickets',            short: 'Tickets',  icon: <FileText size={14} /> },
    { id: 'agentes',    label: 'Por Agente',         short: 'Agentes',  icon: <Users size={14} /> },
    { id: 'cobrar',     label: 'Cuentas por Cobrar', short: 'Cobrar',   icon: <Banknote size={14} />,    moduleKey: 'facturas' },
    { id: 'pagar',      label: 'Cuentas por Pagar',  short: 'Pagar',    icon: <HandCoins size={14} />,   moduleKey: 'gastos' },
    { id: 'estado',     label: 'Estado de Cuenta',   short: 'Estado',   icon: <Filter size={14} />,      moduleKey: 'facturas' },
    { id: 'asistencia', label: 'Reporte Mensual',    short: 'Mensual',  icon: <ClipboardList size={14} /> },
  ]
  const TABS = ALL_TABS.filter(t => !t.moduleKey || modules?.[t.moduleKey] !== false)

  // Si el tab activo queda oculto (módulo deshabilitado), volver al primero visible
  React.useEffect(() => {
    if (TABS.length && !TABS.find(t => t.id === activeTab)) changeTab(TABS[0].id)
  }, [modules]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reportes</h1>
          <p className="text-sm text-gray-500 mt-1">
            {isClient ? (user?.company ? `Tickets de ${user.company}` : 'Mis tickets') : 'Análisis y estado financiero'}
          </p>
        </div>
        {activeTab === 'tickets' && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={handleCSV}   className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={13} /> CSV</button>
            <button onClick={handleExcel} className="btn-secondary flex items-center gap-1.5 text-xs text-green-700 border-green-200 hover:bg-green-50"><FileSpreadsheet size={13} /> Excel</button>
            <button onClick={handlePDF}   className="btn-secondary flex items-center gap-1.5 text-xs text-red-700 border-red-200 hover:bg-red-50"><FileText size={13} /> PDF</button>
          </div>
        )}
      </div>

      {/* Tabs */}
      {(!isClient || user?.company) && (
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl overflow-x-auto">
          {TABS.filter(t => !isClient || t.id === 'tickets' || t.id === 'asistencia').map(t => (
            <button
              key={t.id}
              onClick={() => changeTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                activeTab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.icon}
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Contenido por pestaña */}
      {activeTab === 'agentes'    && <AgenteReport />}
      {activeTab === 'cobrar'     && <CobrarReport />}
      {activeTab === 'pagar'      && <PagarReport />}
      {activeTab === 'estado'     && <EstadoCuentaReport />}
      {activeTab === 'asistencia' && <AsistenciaReport />}

      {activeTab === 'tickets' && (
        <>
          {/* Filtros */}
          <div className="card">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="label">Desde</label>
                <input type="date" className="input w-auto" style={{fontSize:'16px'}} value={filters.date_from} onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))} />
              </div>
              <div>
                <label className="label">Hasta</label>
                <input type="date" className="input w-auto" style={{fontSize:'16px'}} value={filters.date_to} onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))} />
              </div>
              <div>
                <label className="label">Estado</label>
                <select className="input w-auto" style={{fontSize:'16px'}} value={filters.status_id} onChange={e => setFilters(f => ({ ...f, status_id: e.target.value }))}>
                  <option value="">Todos</option>
                  {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {!isClient && (
                <div>
                  <label className="label">Agente</label>
                  <select className="input w-auto" style={{fontSize:'16px'}} value={filters.assigned_to_id} onChange={e => setFilters(f => ({ ...f, assigned_to_id: e.target.value }))}>
                    <option value="">Todos</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label">Prioridad</label>
                <select className="input w-auto" style={{fontSize:'16px'}} value={filters.priority} onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}>
                  <option value="">Todas</option>
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                  <option value="critical">Crítica</option>
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-20 text-gray-500">Cargando...</div>
          ) : summary ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { val: summary.total, label: 'Total Tickets', color: 'text-blue-600' },
                  { val: summary.resolved, label: 'Resueltos', color: 'text-green-600' },
                  { val: `${summary.total > 0 ? Math.round((summary.resolved/summary.total)*100) : 0}%`, label: 'Tasa de Resolución', color: 'text-orange-600' },
                  { val: summary.avg_resolution_hours ?? '—', label: 'Horas Prom. Resolución', color: 'text-purple-600' },
                ].map(k => (
                  <div key={k.label} className="card text-center">
                    <p className={`text-3xl font-bold ${k.color}`}>{k.val}</p>
                    <p className="text-sm text-gray-500 mt-1">{k.label}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Por Estado</h3>
                  {statusChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={statusChartData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                          label={({ name, count }) => `${name}: ${count}`}>
                          {statusChartData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="text-center text-gray-400 py-10">Sin datos</p>}
                </div>
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Por Prioridad</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={priorityChartData}>
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">Detalle de Tickets ({tickets.length})</h3>
                </div>
                {tickets.length === 0 ? (
                  <p className="text-center text-gray-400 py-8">No hay tickets para el período seleccionado</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 hidden sm:table-cell">#</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">TÍTULO</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">ESTADO</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 hidden sm:table-cell">PRIORIDAD</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 hidden md:table-cell">USUARIO</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 hidden md:table-cell">AGENTE</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 hidden sm:table-cell">CREADO</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 hidden md:table-cell">HRS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tickets.map(t => (
                          <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-3 py-2.5 text-gray-400 font-mono text-xs hidden sm:table-cell">#{t.id}</td>
                            <td className="px-4 py-2.5 font-medium text-gray-900">
                              <div className="truncate max-w-[180px] sm:max-w-xs">{t.title}</div>
                              <div className="sm:hidden flex items-center gap-1.5 mt-0.5">
                                <span className="text-xs text-gray-400">#{t.id}</span>
                                <span className="text-xs text-gray-500">{PRIORITY_LABELS[t.priority] || t.priority}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-xs text-gray-600">{t.status}</td>
                            <td className="px-3 py-2.5 text-xs text-gray-600 hidden sm:table-cell">{PRIORITY_LABELS[t.priority] || t.priority}</td>
                            <td className="px-3 py-2.5 text-xs text-gray-600 hidden md:table-cell">{t.client}</td>
                            <td className="px-3 py-2.5 text-xs text-gray-600 hidden md:table-cell">{t.assigned_agent || '—'}</td>
                            <td className="px-3 py-2.5 text-xs text-gray-500 hidden sm:table-cell">{t.created_at ? t.created_at.slice(0,10) : ''}</td>
                            <td className="px-3 py-2.5 text-xs text-gray-600 text-right hidden md:table-cell">{t.resolution_hours ? `${t.resolution_hours}h` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
