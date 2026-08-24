import React, { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { Trash2, RotateCcw, AlertTriangle, RefreshCw } from 'lucide-react'
import { getPapelera, restoreItem, permanentDelete } from '../services/api'

const ENTITY_LABELS = {
  ticket:     'Ticket',
  factura:    'Factura',
  cotizacion: 'Cotización',
  gasto:      'Gasto',
  contacto:   'Contacto',
  empresa:    'Empresa',
  pedido:     'Pedido',
  despacho:   'Pedido',
  contrato:   'Contrato',
}

const ENTITY_COLORS = {
  ticket:     'bg-blue-100 text-blue-700',
  factura:    'bg-green-100 text-green-700',
  cotizacion: 'bg-emerald-100 text-emerald-700',
  gasto:      'bg-orange-100 text-orange-700',
  contacto:   'bg-purple-100 text-purple-700',
  empresa:    'bg-teal-100 text-teal-700',
  pedido:     'bg-indigo-100 text-indigo-700',
  despacho:   'bg-indigo-100 text-indigo-700',
  contrato:   'bg-slate-100 text-slate-700',
}

export default function Papelera() {
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [confirming, setConfirming] = useState(null)
  const [processing, setProcessing] = useState({})  // { 'ticket-5': true } mientras hay una operación en curso

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await getPapelera()
      setItems(data)
    } catch { toast.error('Error al cargar la papelera') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleRestore = async (item) => {
    const key = `${item.entity_type}-${item.id}`
    if (processing[key]) return
    setProcessing(p => ({ ...p, [key]: true }))
    try {
      await restoreItem(item.entity_type, item.id)
      toast.success(`${item.display_name} restaurado`)
      load()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error al restaurar')
    } finally {
      setProcessing(p => { const n = { ...p }; delete n[key]; return n })
    }
  }

  const handlePermanentDelete = async (item) => {
    const key = `${item.entity_type}-${item.id}`
    if (processing[key]) return
    setProcessing(p => ({ ...p, [key]: true }))
    try {
      await permanentDelete(item.entity_type, item.id)
      toast.success(`${item.display_name} eliminado permanentemente`)
      setConfirming(null)
      load()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error al eliminar')
    } finally {
      setProcessing(p => { const n = { ...p }; delete n[key]; return n })
    }
  }

  const fmt = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' })
  }

  const grouped = items.reduce((acc, item) => {
    const key = item.entity_type
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Trash2 size={22} className="text-gray-500" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Papelera</h1>
          <p className="text-sm text-gray-500">Elementos eliminados que pueden ser restaurados</p>
        </div>
        <button onClick={load} className="ml-auto p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-16">Cargando...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 size={28} className="text-gray-300" />
          </div>
          <p className="text-gray-500 font-medium">La papelera está vacía</p>
          <p className="text-gray-400 text-sm mt-1">Los elementos eliminados aparecerán aquí</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([entityType, groupItems]) => (
            <div key={entityType} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 bg-gray-50 border-b border-gray-100">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${ENTITY_COLORS[entityType] || 'bg-gray-100 text-gray-600'}`}>
                  {ENTITY_LABELS[entityType] || entityType}
                </span>
                <span className="text-sm text-gray-500">{groupItems.length} elemento{groupItems.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-gray-50">
                {groupItems.map(item => {
                  const key = `${item.entity_type}-${item.id}`
                  const isProcessing = !!processing[key]
                  return (
                  <div key={key} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{item.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Eliminado: {fmt(item.deleted_at)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleRestore(item)}
                        disabled={isProcessing}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <RotateCcw size={13} /> Restaurar
                      </button>
                      {confirming === key ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handlePermanentDelete(item)}
                            disabled={isProcessing}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <AlertTriangle size={12} /> Confirmar
                          </button>
                          <button
                            onClick={() => setConfirming(null)}
                            disabled={isProcessing}
                            className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirming(key)}
                          disabled={isProcessing}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Trash2 size={13} /> Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
