import React from 'react'
import ReactDOM from 'react-dom/client'
import { AlertTriangle } from 'lucide-react'

function ConfirmDialog({ message, title, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = true, onResolve }) {
  const iconBg = danger ? 'bg-red-100' : 'bg-amber-100'
  const iconColor = danger ? 'text-red-600' : 'text-amber-600'
  const btnColor = danger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'

  return React.createElement(
    'div',
    { className: 'fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4' },
    React.createElement('div', { className: 'absolute inset-0 bg-black/50', onClick: () => onResolve(false) }),
    React.createElement(
      'div',
      { className: 'relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4' },
      React.createElement(
        'div',
        { className: `w-12 h-12 rounded-full flex items-center justify-center mx-auto ${iconBg}` },
        React.createElement(AlertTriangle, { size: 22, className: iconColor })
      ),
      title && React.createElement('h3', { className: 'text-base font-semibold text-gray-900 text-center' }, title),
      message && React.createElement('p', { className: 'text-sm text-gray-500 text-center leading-relaxed' }, message),
      React.createElement(
        'div',
        { className: 'flex gap-3 mt-2' },
        React.createElement(
          'button',
          {
            onClick: () => onResolve(false),
            className: 'flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors',
          },
          cancelLabel
        ),
        React.createElement(
          'button',
          {
            onClick: () => onResolve(true),
            className: `flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors ${btnColor}`,
          },
          confirmLabel
        )
      )
    )
  )
}

export function showConfirm(opts) {
  const options = typeof opts === 'string' ? { message: opts } : opts
  return new Promise((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = ReactDOM.createRoot(container)

    const cleanup = (result) => {
      root.unmount()
      document.body.removeChild(container)
      resolve(result)
    }

    root.render(React.createElement(ConfirmDialog, { ...options, onResolve: cleanup }))
  })
}
