import React, { createContext, useContext, useEffect, useState } from 'react'
import { getSystemModules } from '../services/api'
import { useAuth } from './AuthContext'

const ModulesContext = createContext({ modules: null, setModules: () => {} })

export function ModulesProvider({ children }) {
  const [modules, setModules] = useState(null)
  const { user } = useAuth()

  useEffect(() => {
    if (!user) {
      setModules(null)
      return
    }
    getSystemModules()
      .then(r => setModules(r.data))
      .catch(() => setModules(null))
  }, [user?.id]) // re-fetch al cambiar de cuenta o iniciar sesión

  return (
    <ModulesContext.Provider value={{ modules, setModules }}>
      {children}
    </ModulesContext.Provider>
  )
}

export function useModules() {
  return useContext(ModulesContext)
}
