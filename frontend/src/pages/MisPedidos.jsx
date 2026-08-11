import React, { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { getMyDispatches, createClientDispatch } from '../services/api'
import { Package, Plus, X, ArrowLeft, Clock, CheckCircle2, XCircle, PackageCheck, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { fmtD } from '../utils/fmt'

// El cliente ve etiquetas amigables; internamente el pedido nace en "Borrador".
const STATUS_LABEL = {
  'Borrador': 'En revisión',
  'Emitido': 'Aprobado',
  'Despacho Programado': 'Programado',
  'Entregado': 'Entregado',
  'Cancelado': 'Cancelado',
}
const STATUS_STYLE = {
  'Borrador': 'bg-amber-100 text-amber-700',
  'Emitido': 'bg-blue-100 text-blue-700',
  'Despacho Programado': 'bg-indigo-100 text-indigo-700',
  'Entregado': 'bg-green-100 text-green-700',
  'Cancelado': 'bg-red-100 text-red-600',
}
const STATUS_ICON = {
  'Borrador': <Clock size={12} />,
  'Emitido': <Send size={12} />,
  'Despacho Programado': <PackageCheck size={12} />,
  'Entregado': <CheckCircle2 size={12} />,
  'Cancelado': <XCircle size={12} />,
}

const EMPTY_FORM = { title: '', notes: '', lines: [{ description: '', qty: 1 }] }

function parseLines(itemsJson) {
  try {
    const arr = JSON.parse(itemsJson || '[]')
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

export default function MisPedidos() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(params.get('new') === '1')
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    getMyDispatches().then((r) => setItems(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const openForm = () => { setForm(EMPTY_FORM); setShowForm(true) }
  const closeForm = () => { setShowForm(false); if (params.get('new')) setParams({}) }

  const setLine = (i, field, value) => setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, [field]: value } : l) }))
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, { description: '', qty: 1 }] }))
  const removeLine = (i) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))

  const submit = async () => {
    if (!form.title.trim()) return toast.error('Escribe el asunto del pedido')
    const lines = form.lines
      .filter((l) => (l.description || '').trim())
      .map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1 }))
    setSaving(true)
    try {
      await createClientDispatch({
        title: form.title.trim(),
        notes: form.notes.trim() || null,
        items: lines.length ? JSON.stringify(lines) : null,
      })
      toast.success('Pedido enviado. Un agente lo revisará pronto.')
      closeForm(); setForm(EMPTY_FORM); load()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al enviar el pedido')
    } finally { setSaving(false) }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/inicio')} className="text-gray-400 hover:text-gray-700"><ArrowLeft size={18} /></button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Package size={20} className="text-blue-600" /> Mis pedidos</h1>
              <p className="text-xs text-gray-400 mt-0.5">Solicitudes de equipos o artículos</p>
            </div>
          </div>
          {!showForm && (
            <button onClick={openForm} className="btn-primary flex items-center gap-1.5 text-sm px-3.5 py-2">
              <Plus size={15} /> Nuevo pedido
            </button>
          )}
        </div>

        {/* Formulario de nuevo pedido */}
        {showForm && (
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Nuevo pedido</h2>
              <button onClick={closeForm}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Asunto *</label>
                <input className="input w-full" placeholder="Ej.: Necesito 3 laptops para el equipo de ventas"
                  value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descripción</label>
                <textarea className="input w-full h-24 resize-none" placeholder="Cuéntanos qué necesitas, para qué lo usarás, presupuesto aproximado, etc. No te preocupes si no sabes el modelo exacto."
                  value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Artículos (opcional)</label>
                <div className="space-y-2">
                  {form.lines.map((l, i) => (
                    <div key={i} className="flex gap-2">
                      <input className="input flex-1 text-sm" placeholder="Descripción del artículo"
                        value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} style={{ fontSize: '16px' }} />
                      <input type="number" min="1" className="input w-20 text-sm text-right" placeholder="Cant."
                        value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} style={{ fontSize: '16px' }} />
                      {form.lines.length > 1 && (
                        <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500 px-1"><X size={16} /></button>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={addLine} className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 mt-2">
                  <Plus size={12} /> Agregar artículo
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5 pt-4 border-t border-gray-100">
              <button onClick={closeForm} className="btn-secondary">Cancelar</button>
              <button onClick={submit} disabled={saving || !form.title.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors text-sm">
                <Send size={15} /> {saving ? 'Enviando…' : 'Enviar pedido'}
              </button>
            </div>
          </div>
        )}

        {/* Lista de pedidos del cliente */}
        {loading ? (
          <div className="py-16 text-center text-gray-400">Cargando…</div>
        ) : items.length === 0 && !showForm ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <Package size={24} className="text-blue-200" />
            </div>
            <p className="text-sm font-medium text-gray-400">Aún no tienes pedidos</p>
            <button onClick={openForm} className="btn-primary mt-4">Crear mi primer pedido</button>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((d) => {
              const lines = parseLines(d.items)
              return (
                <div key={d.id} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{d.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {d.dispatch_number && <span className="font-mono">{d.dispatch_number} · </span>}
                        {fmtD(d.created_at)}
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${STATUS_STYLE[d.status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_ICON[d.status]} {STATUS_LABEL[d.status] || d.status}
                    </span>
                  </div>
                  {d.notes && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap break-words">{d.notes}</p>}
                  {lines.length > 0 && (
                    <ul className="mt-2 text-sm text-gray-600 list-disc list-inside space-y-0.5">
                      {lines.map((l, i) => <li key={i}>{l.description}{l.qty ? ` · ${l.qty}` : ''}</li>)}
                    </ul>
                  )}
                  {d.assigned_to_name && (
                    <p className="text-xs text-gray-400 mt-2">Atendido por {d.assigned_to_name}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
