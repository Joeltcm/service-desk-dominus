import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  getNotifications,
  getNotificationsUnread,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/api'
import { useAuth } from '../context/AuthContext'
import { Bell, CheckCheck, PackageCheck, Boxes } from 'lucide-react'

function iconFor(kind) {
  if (kind === 'part_request') return <Boxes size={15} className="text-teal-600" />
  if (kind === 'part_decision') return <PackageCheck size={15} className="text-emerald-600" />
  return <Bell size={15} className="text-blue-600" />
}

function timeAgo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return 'ahora'
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`
  return `hace ${Math.floor(s / 86400)} d`
}

export default function NotificationBell({ align = 'right', className = '' }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const panelRef = useRef(null)

  const loadCount = () =>
    getNotificationsUnread().then(r => setCount(r.data?.unread || 0)).catch(() => {})

  const loadItems = () =>
    getNotifications().then(r => {
      setItems(r.data?.items || [])
      setCount(r.data?.unread || 0)
    }).catch(() => {})

  useEffect(() => {
    if (!user) return
    loadCount()
    const t = setInterval(loadCount, 45000)
    const vis = () => { if (document.visibilityState === 'visible') loadCount() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [user?.id])

  // Posiciona el panel con coordenadas fijas (portal) para que no lo recorte el sidebar.
  const place = () => {
    const b = btnRef.current
    if (!b) return
    const r = b.getBoundingClientRect()
    const width = 320
    const vw = window.innerWidth
    let left
    if (align === 'left') left = r.left
    else left = r.right - width
    left = Math.max(8, Math.min(left, vw - width - 8))
    setPos({ top: r.bottom + 8, left, width: Math.min(width, vw - 16) })
  }

  useLayoutEffect(() => { if (open) place() }, [open])

  useEffect(() => {
    if (!open) return
    const onScroll = () => place()
    const onResize = () => place()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  if (!user) return null

  const toggle = () => {
    const nx = !open
    setOpen(nx)
    if (nx) loadItems()
  }

  const onClickItem = (n) => {
    setOpen(false)
    if (!n.read) {
      markNotificationRead(n.id).catch(() => {})
      setCount(c => Math.max(0, c - 1))
    }
    if (n.url && n.url !== '/') navigate(n.url)
  }

  const onReadAll = () => {
    markAllNotificationsRead().catch(() => {})
    setItems(its => its.map(n => ({ ...n, read: true })))
    setCount(0)
  }

  const panel = open && pos ? createPortal(
    <div
      ref={panelRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
      className="z-[100] bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <Bell size={14} className="text-blue-600" /> Notificaciones
        </span>
        {count > 0 && (
          <button onClick={onReadAll} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
            <CheckCheck size={13} /> Marcar leídas
          </button>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-10">Sin notificaciones.</p>
        ) : items.map(n => (
          <button
            key={n.id}
            onClick={() => onClickItem(n)}
            className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex gap-3 ${n.read ? '' : 'bg-blue-50/50'}`}
          >
            <span className="mt-0.5 flex-shrink-0">{iconFor(n.kind)}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={`text-sm truncate ${n.read ? 'text-gray-700' : 'text-gray-900 font-semibold'}`}>{n.title}</span>
                {!n.read && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
              </span>
              {n.body && <span className="block text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</span>}
              <span className="block text-[11px] text-gray-400 mt-1">{timeAgo(n.created_at)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        onClick={toggle}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-200 transition-colors"
        title="Notificaciones"
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {panel}
    </div>
  )
}
