import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPartRequests, approvePartRequest, rejectPartRequest } from '../services/api'
import { Boxes, Check, X, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { fmtDT } from '../utils/fmt'

const STATUS = {
  pendiente: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700' },
  aprobado:  { label: 'Aprobado',  cls: 'bg-emerald-100 text-emerald-700' },
  rechazado: { label: 'Rechazado', cls: 'bg-red-100 text-red-700' },
  cancelado: { label: 'Cancelado', cls: 'bg-gray-100 text-gray-500' },
}
const FILTERS = [['pendiente', 'Pendientes'], ['aprobado', 'Aprobadas'], ['rechazado', 'Rechazadas'], ['', 'Todas']]

export default function PartApprovals() {
  const navigate = useNavigate()
  const [reqs, setReqs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pendiente')
  const [acting, setActing] = useState(null)

  const load = () => {
    setLoading(true)
    getPartRequests(filter ? { status: filter } : {})
      .then(r => setReqs(r.data))
      .catch(() => toast.error('Error cargando solicitudes'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [filter])

  const decide = async (id, action) => {
    setActing(id)
    try {
      if (action === 'approve') { await approvePartRequest(id); toast.success('Aprobado · descontado del inventario') }
      else { await rejectPartRequest(id); toast.success('Solicitud rechazada') }
      load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Error') }
    finally { setActing(null) }
  }

  return (
    <div className="p-4 sm:p-6 w-full max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Boxes size={22} className="text-teal-600" />
        <h1 className="text-xl font-bold text-gray-900">Solicitudes de Partes</h1>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTERS.map(([val, label]) => (
          <button key={val || 'all'} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === val ? 'bg-teal-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-400 text-sm">Cargando...</div>
        ) : reqs.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">Sin solicitudes {filter ? (STATUS[filter]?.label || '').toLowerCase() : ''}.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {reqs.map(r => {
              const st = STATUS[r.status] || { label: r.status, cls: 'bg-gray-100 text-gray-600' }
              return (
                <div key={r.id} className="flex items-start gap-3 p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-blue-700">{r.item_code}</span>
                      <span className="text-sm text-gray-900 font-medium">{r.item_name}</span>
                      <span className="text-xs text-gray-500">× {r.quantity}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                      <button onClick={() => navigate(`/tickets/${r.ticket_id}`)} className="text-blue-600 hover:underline flex items-center gap-1">
                        <ExternalLink size={11} /> Ticket #{r.ticket_id}{r.ticket_title ? ` · ${r.ticket_title}` : ''}
                      </button>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Solicitó: {r.requested_by_name || '—'} · {r.created_at ? fmtDT(r.created_at) : ''}
                      {r.approved_by_name && ` · ${r.status === 'aprobado' ? 'Aprobó' : 'Decidió'}: ${r.approved_by_name}`}
                    </div>
                    {r.notes && <div className="text-xs text-gray-500 mt-0.5 italic">“{r.notes}”</div>}
                  </div>
                  {r.status === 'pendiente' && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => decide(r.id, 'approve')} disabled={acting === r.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50" title="Aprobar y despachar">
                        <Check size={14} /> <span className="hidden sm:inline">Aprobar</span>
                      </button>
                      <button onClick={() => decide(r.id, 'reject')} disabled={acting === r.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-red-500 text-sm hover:bg-red-50 disabled:opacity-50" title="Rechazar">
                        <X size={14} /> <span className="hidden sm:inline">Rechazar</span>
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
