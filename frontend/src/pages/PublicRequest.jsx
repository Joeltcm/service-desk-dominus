import React, { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { createClientDispatch, createTicket, getStatuses, companyLogoUrl } from '../services/api'
import { ArrowLeft, Plus, X, Send, LogIn, UserPlus, LifeBuoy, ShoppingCart } from 'lucide-react'
import toast from 'react-hot-toast'

export default function PublicRequest() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const tipo = params.get('tipo') === 'pedido' ? 'pedido' : 'ticket'
  const isPedido = tipo === 'pedido'

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([{ description: '', qty: 1 }])
  const [saving, setSaving] = useState(false)

  const setLine = (i, field, value) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
  const addLine = () => setLines((ls) => [...ls, { description: '', qty: 1 }])
  const removeLine = (i) => setLines((ls) => ls.filter((_, idx) => idx !== i))

  const buildDraft = () => {
    const cleanLines = lines.filter((l) => (l.description || '').trim()).map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1 }))
    return {
      type: tipo,
      title: title.trim(),
      notes: notes.trim(),
      items: (isPedido && cleanLines.length) ? JSON.stringify(cleanLines) : null,
    }
  }

  const saveDraftAndGo = (to) => {
    if (!title.trim()) return toast.error('Escribe primero el asunto de tu solicitud')
    try { localStorage.setItem('pendingRequest', JSON.stringify(buildDraft())) } catch {}
    navigate(to)
  }

  const submit = async () => {
    if (!title.trim()) return toast.error('Escribe el asunto de tu solicitud')
    const draft = buildDraft()
    if (!user) {
      try { localStorage.setItem('pendingRequest', JSON.stringify(draft)) } catch {}
      toast('Inicia sesión o crea una cuenta para enviar tu solicitud 🔐')
      navigate('/login')
      return
    }
    setSaving(true)
    try {
      if (isPedido) {
        await createClientDispatch({ title: draft.title, notes: draft.notes || null, items: draft.items })
        toast.success('Pedido enviado. Un agente lo revisará.')
        navigate('/mis-pedidos')
      } else {
        const r = await getStatuses().catch(() => ({ data: [] }))
        const st = r.data || []
        const statusId = (st.find((s) => /abierto|nuevo|open/i.test(s.name)) || st[0])?.id
        await createTicket({ title: draft.title, description: draft.notes || '', priority: 'medium', status_id: statusId, client_id: user.id, category: 'Solicitud web', charger: 'Sin cargador' })
        toast.success('Ticket creado.')
        navigate('/tickets')
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al enviar la solicitud')
    } finally { setSaving(false) }
  }

  const accent = isPedido ? 'blue' : 'orange'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-8 py-4">
        <img src={companyLogoUrl()} alt="Logo" className="h-9 w-auto object-contain" onError={(e) => { e.currentTarget.style.display = 'none' }} />
        <button onClick={() => navigate('/login')} className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900">
          <LogIn size={16} /> Iniciar sesión
        </button>
      </header>

      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 sm:py-8 w-full">
          <button onClick={() => navigate('/bienvenido')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
            <ArrowLeft size={16} /> Volver
          </button>

          <div className="flex items-center gap-3 mb-5">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white ${isPedido ? 'bg-blue-600' : 'bg-orange-500'}`}>
              {isPedido ? <ShoppingCart size={22} /> : <LifeBuoy size={22} />}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{isPedido ? 'Solicitar un pedido' : 'Levantar un ticket'}</h1>
              <p className="text-xs text-gray-400">{isPedido ? 'Pide equipos o artículos' : 'Reporta una falla o solicita soporte'}</p>
            </div>
          </div>

          <div className="card space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Asunto *</label>
              <input className="input w-full" placeholder={isPedido ? 'Ej.: Necesito 3 laptops para ventas' : 'Ej.: Mi computadora no enciende'}
                value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Descripción</label>
              <textarea className="input w-full h-28 resize-none"
                placeholder={isPedido ? 'Cuéntanos qué necesitas, para qué lo usarás, presupuesto aproximado… No te preocupes si no sabes el modelo exacto.' : 'Describe el problema con el mayor detalle posible.'}
                value={notes} onChange={(e) => setNotes(e.target.value)} style={{ fontSize: '16px' }} />
            </div>
            {isPedido && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Artículos (opcional)</label>
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="flex gap-2">
                      <input className="input flex-1 text-sm" placeholder="Descripción del artículo" value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} style={{ fontSize: '16px' }} />
                      <input type="number" min="1" className="input w-20 text-sm text-right" placeholder="Cant." value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} style={{ fontSize: '16px' }} />
                      {lines.length > 1 && <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500 px-1"><X size={16} /></button>}
                    </div>
                  ))}
                </div>
                <button onClick={addLine} className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 mt-2"><Plus size={12} /> Agregar artículo</button>
              </div>
            )}
          </div>

          {/* Aviso: se necesita cuenta para enviar */}
          {!user && (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-600">Para <b>enviar</b> tu solicitud necesitas una cuenta (gratis). Guardaremos lo que escribiste y lo enviaremos apenas ingreses.</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button onClick={() => saveDraftAndGo('/login')} className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-900"><LogIn size={15} /> Iniciar sesión</button>
                <button onClick={() => saveDraftAndGo('/login?registro=1')} className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white rounded-lg ${isPedido ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-500 hover:bg-orange-600'}`}><UserPlus size={15} /> Crear una cuenta</button>
              </div>
            </div>
          )}

          <div className="flex justify-end mt-4">
            <button onClick={submit} disabled={saving || !title.trim()}
              className={`flex items-center gap-2 px-5 py-2.5 text-white rounded-lg font-medium disabled:opacity-60 transition-colors ${isPedido ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-500 hover:bg-orange-600'}`}>
              <Send size={16} /> {saving ? 'Enviando…' : (user ? 'Enviar solicitud' : 'Continuar')}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
