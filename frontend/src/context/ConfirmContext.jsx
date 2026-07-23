import React, { createContext, useCallback, useContext, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)
  const resolveRef = useRef(null)

  const showConfirm = useCallback((opts) =>
    new Promise((resolve) => {
      resolveRef.current = resolve
      setState(typeof opts === 'string' ? { message: opts } : opts)
    }), [])

  const handleConfirm = () => { setState(null); resolveRef.current?.(true) }
  const handleCancel  = () => { setState(null); resolveRef.current?.(false) }

  return (
    <ConfirmContext.Provider value={showConfirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={handleCancel} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto ${state.danger === false ? 'bg-amber-100' : 'bg-red-100'}`}>
              <AlertTriangle size={22} className={state.danger === false ? 'text-amber-600' : 'text-red-600'} />
            </div>
            {state.title && <h3 className="text-base font-semibold text-gray-900 text-center">{state.title}</h3>}
            {state.message && <p className="text-sm text-gray-500 text-center leading-relaxed">{state.message}</p>}
            <div className="flex gap-3 mt-2">
              <button
                onClick={handleCancel}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {state.cancelLabel || 'Cancelar'}
              </button>
              <button
                onClick={handleConfirm}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors ${state.danger === false ? 'bg-amber-500 hover:bg-amber-600' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {state.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export const useConfirm = () => useContext(ConfirmContext)
