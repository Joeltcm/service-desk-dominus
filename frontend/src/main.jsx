import React from 'react'
import ReactDOM from 'react-dom/client'
import toast from 'react-hot-toast'
import { RefreshCw } from 'lucide-react'
import App from './App.jsx'
import './index.css'
import { registerServiceWorker, ensurePushSubscribed } from './utils/pushNotifications'
import { watchForUpdates, applyUpdate } from './utils/pwaUpdate'

registerServiceWorker().then((registration) => {
  ensurePushSubscribed()
  watchForUpdates(registration, (worker) => {
    toast.custom(
      (t) => (
        <div
          className={`max-w-sm w-full bg-[#0f172a] text-white rounded-xl shadow-2xl border border-white/10 p-4 flex flex-col gap-3 transition-opacity ${
            t.visible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-center gap-2">
            <RefreshCw size={18} className="text-brand-500 shrink-0" />
            <p className="text-sm font-medium">Hay una nueva versión disponible</p>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => toast.dismiss(t.id)}
              className="px-3 py-2.5 text-sm rounded-lg text-white/70 hover:text-white hover:bg-white/10"
            >
              Más tarde
            </button>
            <button
              onClick={async () => {
                toast.dismiss(t.id)
                await applyUpdate(worker)
                window.location.reload()
              }}
              className="px-4 py-2.5 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 font-medium"
            >
              Actualizar ahora
            </button>
          </div>
        </div>
      ),
      { id: 'pwa-update', duration: Infinity }
    )
  })
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
