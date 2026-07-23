import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getExpenses, updateExpense } from '../services/api'
import { HandCoins, AlertCircle, Calendar, RefreshCw, ExternalLink, CheckCircle2, X, Banknote } from 'lucide-react'
import { fmtD } from '../utils/fmt'
import toast from 'react-hot-toast'

const PAY_METHODS = ['Efectivo', 'Tarjeta', 'Transferencia', 'Cheque', 'Yappy']

function fmtMoney(n) {
  const num = parseFloat(String(n || '').replace(/[^\d.]/g, '') || '0')
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function parseAmt(n) {
  return parseFloat(String(n || '').replace(/[^\d.]/g, '') || '0')
}

function PayModal({ expense, onClose, onPaid }) {
  const [method, setMethod] = useState('Efectivo')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const handleConfirm = async () => {
    setSaving(true)
    try {
      await updateExpense(expense.id, {
        concept: expense.concept,
        amount: expense.amount,
        category: expense.category || null,
        date: expense.date || null,
        supplier: expense.supplier || null,
        is_payable: true,
        due_date: expense.due_date || null,
        paid_at: date,
        payment_method: method,
        notes: note.trim() || expense.notes || null,
      })
      toast.success('Gasto marcado como pagado')
      onPaid()
    } catch {
      toast.error('Error al actualizar el gasto')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Registrar pago</h3>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[220px]">{expense.concept}</p>
            <p className="text-lg font-bold text-gray-800 mt-1">{fmtMoney(expense.amount)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors flex-shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Fecha */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Fecha de pago</label>
          <input
            type="date"
            className="input text-sm py-1.5"
            style={{ fontSize: '15px' }}
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        {/* Método de pago */}
        <div>
          <label className="text-xs text-gray-500 mb-1.5 block">Método de pago</label>
          <div className="grid grid-cols-3 gap-1.5">
            {PAY_METHODS.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`py-2 rounded-lg text-xs font-medium border transition-colors ${
                  method === m
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Nota */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Nota (opcional)</label>
          <input
            type="text"
            className="input text-sm py-1.5"
            style={{ fontSize: '15px' }}
            placeholder="Detalle de la transacción..."
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1 text-sm py-2">Cancelar</button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-60"
          >
            <CheckCircle2 size={13} />
            {saving ? 'Guardando...' : 'Confirmar pago'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CuentasPorPagar() {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [payModal, setPayModal] = useState(null)
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const r = await getExpenses()
      const pending = (r.data || []).filter(e => e.is_payable && !e.paid_at)
      pending.sort((a, b) => {
        if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date)
        if (a.due_date) return -1
        if (b.due_date) return 1
        return new Date(b.date || 0) - new Date(a.date || 0)
      })
      setExpenses(pending)
    } catch {
      setExpenses([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const vencidos = expenses.filter(e => e.due_date && new Date(e.due_date) < today)
  const porVencer = expenses.filter(e => !e.due_date || new Date(e.due_date) >= today)
  const totalVencidos = vencidos.reduce((s, e) => s + parseAmt(e.amount), 0)
  const totalPorVencer = porVencer.reduce((s, e) => s + parseAmt(e.amount), 0)
  const totalGeneral = totalVencidos + totalPorVencer

  const isOverdue = (e) => e.due_date && new Date(e.due_date) < today

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {payModal && (
        <PayModal
          expense={payModal}
          onClose={() => setPayModal(null)}
          onPaid={() => { setPayModal(null); load() }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center">
            <HandCoins size={18} className="text-red-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Cuentas por Pagar</h1>
            <p className="text-xs text-gray-400">Gastos y compras pendientes de pago</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => navigate('/gastos')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
          >
            <ExternalLink size={13} /> Ver Gastos
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Calendar size={14} className="text-blue-500" />
            <span className="text-xs font-medium text-gray-500">Por vencer</span>
          </div>
          <p className="text-xl font-bold text-blue-600">{fmtMoney(totalPorVencer)}</p>
          <p className="text-xs text-gray-400">{porVencer.length} gasto{porVencer.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={14} className="text-red-500" />
            <span className="text-xs font-medium text-gray-500">Vencidos</span>
          </div>
          <p className="text-xl font-bold text-red-600">{fmtMoney(totalVencidos)}</p>
          <p className="text-xs text-gray-400">{vencidos.length} gasto{vencidos.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <HandCoins size={14} className="text-red-600" />
            <span className="text-xs font-medium text-red-700">Total por pagar</span>
          </div>
          <p className="text-xl font-bold text-red-700">{fmtMoney(totalGeneral)}</p>
          <p className="text-xs text-red-400">{expenses.length} gasto{expenses.length !== 1 ? 's' : ''} en total</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Cargando...</div>
        ) : expenses.length === 0 ? (
          <div className="py-16 text-center">
            <HandCoins size={32} className="mx-auto text-gray-200 mb-2" />
            <p className="text-gray-400 text-sm">No hay gastos pendientes de pago</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Concepto</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-3 py-3 hidden sm:table-cell">Proveedor</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-3 py-3 hidden md:table-cell">Categoría</th>
                  <th className="text-center text-xs font-medium text-gray-400 px-3 py-3">Vence</th>
                  <th className="text-right text-xs font-medium text-gray-400 px-3 py-3">Monto</th>
                  <th className="w-12 pr-3" />
                </tr>
              </thead>
              <tbody>
                {expenses.map(exp => (
                  <tr
                    key={exp.id}
                    className={`border-b border-gray-50 last:border-0 transition-colors ${isOverdue(exp) ? 'bg-red-50/40' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-800 font-medium truncate max-w-[180px]">{exp.concept}</p>
                      {exp.type === 'pedido' && (
                        <span className="text-xs text-purple-600">Pedido vinculado</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500 hidden sm:table-cell truncate max-w-[120px]">
                      {exp.supplier || '—'}
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      {exp.category && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{exp.category}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      {exp.due_date ? (
                        <span className={`text-xs font-medium ${isOverdue(exp) ? 'text-red-600' : 'text-gray-600'}`}>
                          {isOverdue(exp) && <AlertCircle size={10} className="inline mr-0.5" />}
                          {fmtD(exp.due_date)}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-sm text-gray-900 whitespace-nowrap">
                      {fmtMoney(exp.amount)}
                    </td>
                    <td className="pr-3 py-3 text-center">
                      <button
                        onClick={() => setPayModal(exp)}
                        title="Registrar pago"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                      >
                        <CheckCircle2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
