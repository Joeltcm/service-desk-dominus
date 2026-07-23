import React, { createContext, useContext, useEffect, useState } from 'react'
import { getCompanySettings } from '../services/api'
import { useAuth } from './AuthContext'

const DEFAULTS = {
  company_name:          '',
  company_address:       '',
  company_ruc:           '',
  company_phone:         '',
  company_email:         '',
  company_sidebar_color: '#1a3353',
  company_accent_color:  '#3b82f6',
  company_app_name:      '',
  has_logo:              false,
  has_favicon:           false,
  has_pwa_icon:          false,
}

function fromCache() {
  try {
    const raw = localStorage.getItem('company_settings')
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

const CompanyContext = createContext(DEFAULTS)

export function CompanyProvider({ children }) {
  const { user } = useAuth()
  const [company, setCompany] = useState(() => ({ ...DEFAULTS, ...fromCache() }))

  useEffect(() => {
    if (!user) return
    getCompanySettings()
      .then(r => {
        const data = { ...DEFAULTS, ...r.data }
        setCompany(data)
        try { localStorage.setItem('company_settings', JSON.stringify(r.data)) } catch {}
      })
      .catch(() => {})
  }, [user?.id])

  return <CompanyContext.Provider value={company}>{children}</CompanyContext.Provider>
}

export function useCompany() {
  return useContext(CompanyContext)
}

// Singleton for use outside React (PDF builders, etc.)
let _company = { ...DEFAULTS }
export function setCompanyCache(data) { _company = { ...DEFAULTS, ...data } }
export function getCompanyCache() { return _company }
