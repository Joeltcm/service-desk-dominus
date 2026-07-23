import React, { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { isPushSupported, subscribeToPush } from '../utils/pushNotifications'

const DISMISSED_KEY = 'push_prompt_dismissed_at'
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 días

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function wasDismissedRecently() {
  const ts = localStorage.getItem(DISMISSED_KEY)
  if (!ts) return false
  return Date.now() - parseInt(ts, 10) < DISMISS_TTL_MS
}

export default function PushPromptBanner() {
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState('idle') // idle | loading | granted | denied

  useEffect(() => {
    if (!isPushSupported()) return
    if (wasDismissedRecently()) return

    // Esperar 3.5s para dar prioridad al auto-request del login (dispara a los 2s).
    // Si ese request fue exitoso, Notification.permission ya no será 'default'
    // y el banner no se mostrará. Este banner actúa como fallback (ej. iOS Safari).
    const timer = setTimeout(() => {
      if (Notification.permission !== 'default') return
      if (isStandalone()) {
        setVisible(true)
      }
    }, 3500)

    // También mostrar si se acaba de instalar en esta sesión (sin estar logueado aún)
    const handler = () => {
      setTimeout(() => {
        if (Notification.permission !== 'default') return
        setVisible(true)
      }, 3500)
    }
    window.addEventListener('appinstalled', handler)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('appinstalled', handler)
    }
  }, [])

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()))
    setVisible(false)
  }

  const activate = async () => {
    setStatus('loading')
    try {
      const perm = await Notification.requestPermission()
      if (perm === 'granted') {
        await subscribeToPush()
        setStatus('granted')
        setTimeout(() => setVisible(false), 2000)
      } else {
        setStatus('denied')
        setTimeout(() => setVisible(false), 2000)
      }
    } catch {
      setStatus('denied')
      setTimeout(() => setVisible(false), 2000)
    }
  }

  if (!visible) return null

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-indigo-600 text-white text-sm flex-shrink-0">
      <Bell size={15} className="flex-shrink-0" />
      {status === 'granted' && <span className="flex-1 font-medium">¡Notificaciones activadas!</span>}
      {status === 'denied'  && <span className="flex-1">No se pudo activar. Puedes hacerlo desde tu perfil.</span>}
      {(status === 'idle' || status === 'loading') && (
        <>
          <span className="flex-1">Activa las notificaciones para recibir alertas de tickets y pedidos.</span>
          <button
            onClick={activate}
            disabled={status === 'loading'}
            className="flex-shrink-0 bg-white text-indigo-700 font-semibold px-3 py-1 rounded-lg text-xs hover:bg-indigo-50 transition-colors disabled:opacity-60"
          >
            {status === 'loading' ? 'Activando…' : 'Activar'}
          </button>
        </>
      )}
      <button onClick={dismiss} className="flex-shrink-0 p-1 rounded hover:bg-white/20 transition-colors">
        <X size={14} />
      </button>
    </div>
  )
}
