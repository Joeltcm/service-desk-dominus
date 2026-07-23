import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getInvoices } from '../services/api'
import { Banknote, AlertCircle, Clock, RefreshCw, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { fmtD } from '../utils/fmt'

function fmtMoney(n) {
  const num = parseFloat(String(n || '').replace(/[^\d.]/g, '') || '0')
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function parseAmt(n) {
  return parseFloat(String(n || '').replace(/[^\d.]/g, '') || '0')
}

function balance(inv) {
  const total = parseAmt(inv.total)
  const paid = (inv.payments || []).reduce((s, p) => s + parseAmt(p.amount), 0)
  return Math.max(0, total - paid)
}

const STATUS_STYLE = {
  Emitida: 'bg-blue-100 text-blue-700',
  Vencida: 'bg-orange-100 text-orange-700',
}

function groupByClient(invoices) {
  const map = {}
  for (const inv of invoices) {
    const key = inv.client_name || '—'
    if (!map[key]) map[key] = { name: key, invoices: [] }
    map[key].invoices.push(inv)
  }
  return Object.values(map).sort((a, b) => {
    const totA = a.invoices.reduce((s, i) => s + balance(i), 0)
    const totB = b.invoices.reduce((s, i) => s + balance(i), 0)
    return totB - totA
  })
}

export default function CuentasPorCobrar() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState({})
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const [r1, r2] = await Promise.all([
        getInvoices({ status: 'Emitida' }),
        getInvoices({ status: 'Vencida' }),
      ])
      const all = [...(r1.data || []), ...(r2.data || [])]
      all.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      setInvoices(all)
    } catch {
      setInvoices([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const emitidas = invoices.filter(i => i.status === 'Emitida')
  const vencidas = invoices.filter(i => i.status === 'Vencida')
  const totalEmitidas = emitidas.reduce((s, i) => s + balance(i), 0)
  const totalVencidas = vencidas.reduce((s, i) => s + balance(i), 0)
  const totalGeneral = totalEmitidas + totalVencidas
  const groups = groupByClient(invoices)

  const toggleCollapse = (name) =>
    setCollapsed(prev => ({ ...prev, [name]: !prev[name] }))

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <Banknote size={18} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Cuentas por Cobrar</h1>
            <p className="text-xs text-gray-400">Facturas emitidas pendientes de pago</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => navigate('/facturas')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
          >
            <ExternalLink size={13} /> Ver Facturas
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-blue-500" />
            <span className="text-xs font-medium text-gray-500">Emitidas</span>
          </div>
          <p className="text-xl font-bold text-blue-600">{fmtMoney(totalEmitidas)}</p>
          <p className="text-xs text-gray-400">{emitidas.length} factura{emitidas.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={14} className="text-orange-500" />
            <span className="text-xs font-medium text-gray-500">Vencidas</span>
          </div>
          <p className="text-xl font-bold text-orange-600">{fmtMoney(totalVencidas)}</p>
          <p className="text-xs text-gray-400">{vencidas.length} factura{vencidas.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Banknote size={14} className="text-emerald-600" />
            <span className="text-xs font-medium text-emerald-700">Total por cobrar</span>
          </div>
          <p className="text-xl font-bold text-emerald-700">{fmtMoney(totalGeneral)}</p>
          <p className="text-xs text-emerald-500">{invoices.length} factura{invoices.length !== 1 ? 's' : ''} en total</p>
        </div>
      </div>

      {/* Grouped table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Cargando...</div>
        ) : invoices.length === 0 ? (
          <div className="py-16 text-center">
            <Banknote size={32} className="mx-auto text-gray-200 mb-2" />
            <p className="text-gray-400 text-sm">No hay facturas pendientes de cobro</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Factura</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-3 py-3 hidden sm:table-cell">Emitida</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-3 py-3 hidden md:table-cell">Vence</th>
                  <th className="text-right text-xs font-medium text-gray-400 px-3 py-3">Saldo</th>
                  <th className="text-center text-xs font-medium text-gray-400 px-3 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(group => {
                  const groupTotal = group.invoices.reduce((s, i) => s + balance(i), 0)
                  const isOpen = !collapsed[group.name]
                  const hasVencida = group.invoices.some(i => i.status === 'Vencida')

                  return (
                    <React.Fragment key={group.name}>
                      {/* Client header row */}
                      <tr
                        className="bg-gray-50 border-y border-gray-100 cursor-pointer select-none hover:bg-gray-100 transition-colors"
                        onClick={() => toggleCollapse(group.name)}
                      >
                        <td className="px-4 py-2.5" colSpan={2}>
                          <div className="flex items-center gap-2">
                            {isOpen
                              ? <ChevronDown size={14} className="text-gray-400 shrink-0" />
                              : <ChevronRight size={14} className="text-gray-400 shrink-0" />
                            }
                            <span className="text-sm font-semibold text-gray-800">{group.name}</span>
                            <span className="text-xs text-gray-400 font-normal">
                              {group.invoices.length} factura{group.invoices.length !== 1 ? 's' : ''}
                            </span>
                            {hasVencida && (
                              <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-medium">
                                Vencida
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell" />
                        <td className="px-3 py-2.5 text-right font-bold text-sm text-gray-900">
                          {fmtMoney(groupTotal)}
                        </td>
                        <td className="px-3 py-2.5" />
                      </tr>

                      {/* Invoice rows */}
                      {isOpen && group.invoices.map(inv => (
                        <tr
                          key={inv.id}
                          className="border-b border-gray-50 last:border-0 hover:bg-blue-50/40 cursor-pointer transition-colors"
                          onClick={() => navigate('/facturas', { state: { selectInvoiceId: inv.id } })}
                        >
                          <td className="pl-10 pr-3 py-3 font-mono text-xs font-semibold text-gray-700">
                            {inv.invoice_number || `FAC-${inv.id}`}
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-500 hidden sm:table-cell whitespace-nowrap">
                            {inv.date ? fmtD(inv.date) : '—'}
                          </td>
                          <td className="px-3 py-3 text-xs hidden md:table-cell whitespace-nowrap">
                            {inv.due_date
                              ? <span className={new Date(inv.due_date) < new Date() ? 'text-orange-600 font-medium' : 'text-gray-500'}>
                                  {fmtD(inv.due_date)}
                                </span>
                              : <span className="text-gray-300">—</span>
                            }
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-sm text-gray-900">
                            {fmtMoney(balance(inv))}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[inv.status] || 'bg-gray-100 text-gray-600'}`}>
                              {inv.status}
                            </span>
                          </td>
                        </tr>
                      ))}
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
