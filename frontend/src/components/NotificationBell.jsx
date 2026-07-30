import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPartRequestsPending, getPartRequests } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { Bell, Boxes } from 'lucide-react'

const APPROVER_ROLES = ['admin', 'superadmin', 'supervisor', 'supplies']

export default function NotificationBell({ align = 'right', className = '' }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const ref = useRef(null)
  const isApprover = APPROVER_ROLES.includes(user?.role)

  const loadCount = () => getPartRequestsPending().then(r => setCount(r.data?.pending || 0)).catch(() => {})

  useEffect(() => {
    if (!isApprover) return
    loadCount()
    const t = setInterval(loadCount, 45000)
    const vis = () => { if (document.visibilityState === 'visible') loadCount() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [isApprover])

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!isApprover) return null

  const toggle = () => {
    const nx = !open
    setOpen(nx)
    if (nx) getPartRequests({ status: 'pendiente' }).then(r => setItems(r.data)).catch(() => {})
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button onClick={toggle} className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-200 transition-colors" title="Notificaciones">
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-11 z-50 w-80 max-w-[85vw] bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden`}>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800 flex items-center gap-2"><Boxes size={14} className="text-teal-600" /> Solicitudes de partes</span>
            {count > 0 && <span className="text-xs text-gray-400">{count} pendiente(s)</span>}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {items.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">Sin solicitudes pendientes.</p>
            ) : items.map(r => (
              <button key={r.id} onClick={() => { setOpen(false); navigate('/partes') }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-blue-700">{r.item_code}</span>
                  <span className="text-sm text-gray-800 truncate">{r.item_name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">× {r.quantity}</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">Ticket #{r.ticket_id} · {r.requested_by_name || '—'}</div>
              </button>
            ))}
          </div>
          <button onClick={() => { setOpen(false); navigate('/partes') }} className="w-full py-2.5 text-sm text-teal-700 font-medium hover:bg-teal-50 border-t border-gray-100">
            Ver todas
          </button>
        </div>
      )}
    </div>
  )
}
