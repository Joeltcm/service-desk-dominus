import React, { createContext, useContext, useState, useEffect } from 'react'
import { getMe } from '../services/api'

const AuthContext = createContext(null)

async function _tryAutoRegisterPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return
  if (Notification.permission === 'denied') return
  try {
    if (Notification.permission === 'default') {
      // En modo navegador (no PWA), Android Chrome bloquea requestPermission()
      // llamado desde setTimeout. El PushPromptBanner actúa como fallback.
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
      if (!isStandalone) return
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return
    }
    const { subscribeToPush, getPushSubscription } = await import('../utils/pushNotifications')
    const existing = await getPushSubscription()
    if (!existing) await subscribeToPush()
  } catch (e) {
    console.debug('[push] auto-register failed:', e?.message)
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token')
    if (token) {
      getMe()
        .then((res) => setUser(res.data))
        .catch(() => {
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          sessionStorage.removeItem('token')
          sessionStorage.removeItem('user')
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = (token, userData, persist = true) => {
    const store = persist ? localStorage : sessionStorage
    store.setItem('token', token)
    store.setItem('user', JSON.stringify(userData))
    setUser(userData)
    setTimeout(_tryAutoRegisterPush, 2000)
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    sessionStorage.removeItem('token')
    sessionStorage.removeItem('user')
    setUser(null)
  }

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const isAgent = user?.role === 'agent'
  const isVentas = user?.role === 'ventas'
  const isAgentOrAdmin = isAdmin || isAgent
  const isAdminOrVentas = isAdmin || isVentas
  const isStaff = isAdmin || isAgent || isVentas
  // Cualquier rol interno (todos menos el cliente): comparte utilidades operativas como imprimir 80mm.
  const isInternalStaff = !!user && user.role !== 'client'

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isAgent, isVentas, isAgentOrAdmin, isAdminOrVentas, isStaff, isInternalStaff }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
