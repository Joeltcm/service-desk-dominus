import { useEffect } from 'react'

/**
 * Warns before tab close / page refresh when isDirty=true.
 * Returns { skip } for API compatibility — no-op since useBlocker was removed.
 *
 * NOTE: useBlocker (react-router-dom) requires data-router (RouterProvider).
 * This project uses BrowserRouter, so useBlocker throws at runtime.
 * In-app navigation guards are handled manually in each page component
 * via window.confirm() before calling navigate().
 */
export function useUnsavedWarning(isDirty) {
  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  return { skip: () => {} }
}
