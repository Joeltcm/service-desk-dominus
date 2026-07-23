import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const Ctx = createContext({ isDirty: false, setDirty: () => {} })

export function UnsavedChangesProvider({ children }) {
  const [isDirty, setIsDirty] = useState(false)
  const setDirty = useCallback((v) => setIsDirty(v), [])
  return <Ctx.Provider value={{ isDirty, setDirty }}>{children}</Ctx.Provider>
}

export function useUnsavedChanges() {
  return useContext(Ctx)
}

// Drop into any form component: syncs local isDirty to the global context
// and adds a beforeunload guard while dirty.
export function useFormGuard(isDirty) {
  const { setDirty } = useUnsavedChanges()

  useEffect(() => {
    setDirty(isDirty)
    return () => setDirty(false)
  }, [isDirty, setDirty])

  useEffect(() => {
    if (!isDirty) return
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [isDirty])
}
