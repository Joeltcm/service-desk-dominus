import React, { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { createClientDispatch, createTicket, getStatuses, companyLogoUrl, getPublicCompanyInfo, uploadAttachment } from '../services/api'
import { useMaintFeatures, featureOn } from '../utils/maintFeatures'
import { loadSolicitudDraft, saveSolicitudDraft, clearSolicitudDraft } from '../utils/solicitudDraft'
import { MAINT_TYPES, missingMaintFields, buildMaintTicket } from '../utils/maintenance'
import defaultLogo from '../assets/default-logo.png'
import dgsLogo from '../assets/dgs-logo.png'
import { Plus, X, Send, LogIn, UserPlus, LifeBuoy, ShoppingCart, Wrench, ArrowLeft, Info } from 'lucide-react'
import toast from 'react-hot-toast'

const TIPOS = {
  ticket: { title: 'Levantar un ticket', sub: 'Reporta una falla o solicita soporte', accent: 'bg-orange-500 hover:bg-orange-600', icon: 'bg-orange-500' },
  pedido: { title: 'Solicitar un pedido', sub: 'Pide equipos o artículos', accent: 'bg-blue-500 hover:bg-blue-600', icon: 'bg-blue-500' },
  mantenimiento: { title: 'Solicitar mantenimiento', sub: 'Preventivo o correctivo para tu equipo o flota', accent: 'bg-teal-600 hover:bg-teal-700', icon: 'bg-teal-600' },
}

export default function PublicRequest() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const raw = params.get('tipo')
  const tipo = raw === 'pedido' ? 'pedido' : raw === 'mantenimiento' ? 'mantenimiento' : 'ticket'
  const isPedido = tipo === 'pedido'
  const isMant = tipo === 'mantenimiento'
  const T = TIPOS[tipo]

  const [info, setInfo] = useState({ company_name: '', company_sidebar_color: '' })
  useEffect(() => { getPublicCompanyInfo().then((r) => setInfo(r.data || {})).catch(() => {}) }, [])
  const brandName = info.company_name || info.company_app_name || 'Dominus Tech'
  const bg = info.company_sidebar_color || '#1a3353'
  const onLogoError = (e) => { e.currentTarget.onerror = null; e.currentTarget.src = defaultLogo }

  // Borrador guardado de una captura anterior (recarga, fallo de envío o inicio de sesión).
  const [restored] = useState(() => loadSolicitudDraft(tipo))
  const [title, setTitle] = useState(restored?.title ?? '')
  const [notes, setNotes] = useState(restored?.notes ?? '')
  const [lines, setLines] = useState(restored?.lines?.length ? restored.lines : [{ description: '', qty: 1 }])
  const [saving, setSaving] = useState(false)
  // Mantenimiento: tipo, fecha propuesta y datos de contacto (obligatorios).
  const [maintType, setMaintType] = useState(restored?.maintType || 'preventivo')
  const [requestedDate, setRequestedDate] = useState(restored?.requestedDate || '')
  const [contactName, setContactName] = useState(restored?.contactName || user?.name || '')
  const [contactEmail, setContactEmail] = useState(restored?.contactEmail || user?.email || '')
  const [contactPhone, setContactPhone] = useState(restored?.contactPhone || user?.phone || '')
  const [location, setLocation] = useState(restored?.location || user?.address || '')
  const [photos, setPhotos] = useState([])
  const [needAccount, setNeedAccount] = useState(false)

  // Autoguardado: solo cuando hay contenido real (no por el mero hecho de abrir el formulario),
  // y se conserva hasta que el envío sea exitoso. Sin contenido, se limpia cualquier borrador viejo.
  useEffect(() => {
    const draft = { title, notes, lines, maintType, requestedDate, contactName, contactEmail, contactPhone, location }
    // "Contenido real" = lo que el usuario escribió (no los campos de contacto que vienen prellenados).
    const hasContent = !!(title.trim() || notes.trim() || lines.some((l) => (l.description || '').trim()) || (isMant && requestedDate))
    if (hasContent) saveSolicitudDraft(tipo, draft)
    else clearSolicitudDraft(tipo)
  }, [tipo, isMant, title, notes, lines, maintType, requestedDate, contactName, contactEmail, contactPhone, location])
  const mf = useMaintFeatures({ publicOnly: true })
  const photosOn = featureOn(mf, 'client_photos')

  const setLine = (i, field, value) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
  const addLine = () => setLines((ls) => [...ls, { description: '', qty: 1 }])
  const removeLine = (i) => setLines((ls) => ls.filter((_, idx) => idx !== i))

  const buildDraft = () => {
    const cleanLines = lines.filter((l) => (l.description || '').trim()).map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1 }))
    if (isMant) {
      return {
        type: 'mantenimiento',
        title: title.trim(),
        notes: notes.trim(),
        maint_type: maintType,
        equipment: cleanLines,
        requested_date: requestedDate || null,
        contact_name: contactName.trim(),
        contact_email: contactEmail.trim(),
        contact_phone: contactPhone.trim(),
        location: location.trim(),
      }
    }
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
    if (isMant) {
      const missing = missingMaintFields(draft)
      if (missing.length) return toast.error(`Completa: ${missing.join(', ')}`)
    }
    if (!user) {
      // Sin sesión: se guarda el borrador y el usuario se queda aquí para elegir
      // iniciar sesión o crear su cuenta (la solicitud se envía sola al ingresar).
      try { localStorage.setItem('pendingRequest', JSON.stringify(draft)) } catch {}
      setNeedAccount(true)
      toast('Para enviar tu solicitud, inicia sesión o crea tu cuenta gratis. Tus datos quedan guardados.', { duration: 6000, icon: '🔐' })
      document.getElementById('account-box')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setSaving(true)
    try {
      if (isMant) {
        const r = await getStatuses().catch(() => ({ data: [] }))
        const st = r.data || []
        const statusId = (st.find((s) => /abierto|nuevo|open/i.test(s.name)) || st[0])?.id
        const created = await createTicket(buildMaintTicket(draft, { statusId, clientId: user.id }))
        // Fotos del problema: se suben ya creado el ticket (los archivos no caben en el borrador local).
        for (const f of photos) {
          try { await uploadAttachment(created.data.id, f) } catch { /* una foto fallida no bloquea la solicitud */ }
        }
        clearSolicitudDraft(tipo)
        toast.success('Solicitud de mantenimiento enviada. Te confirmaremos la disponibilidad.')
        navigate('/tickets')
      } else if (isPedido) {
        await createClientDispatch({ title: draft.title, notes: draft.notes || null, items: draft.items })
        clearSolicitudDraft(tipo)
        toast.success('Pedido enviado. Un agente lo revisará.')
        navigate('/mis-pedidos')
      } else {
        const r = await getStatuses().catch(() => ({ data: [] }))
        const st = r.data || []
        const statusId = (st.find((s) => /abierto|nuevo|open/i.test(s.name)) || st[0])?.id
        await createTicket({ title: draft.title, description: draft.notes || '', priority: 'medium', status_id: statusId, client_id: user.id, category: 'Solicitud web', charger: 'Sin cargador' })
        clearSolicitudDraft(tipo)
        toast.success('Ticket creado.')
        navigate('/tickets')
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al enviar la solicitud')
    } finally { setSaving(false) }
  }

  const inputCls = 'input w-full'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col" style={{ backgroundColor: bg }}>
      {/* Fondo decorativo (igual al login) */}
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/5 rounded-full pointer-events-none" />
      <div className="absolute -bottom-32 -right-20 w-[28rem] h-[28rem] bg-white/5 rounded-full pointer-events-none" />

      <header className="relative z-10 flex items-center justify-between px-4 sm:px-8 py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg overflow-hidden ring-1 ring-white/20">
            <img src={companyLogoUrl()} onError={onLogoError} alt={brandName} className="w-full h-full object-cover" />
          </div>
          <span className="font-bold text-white text-sm">{brandName}</span>
        </div>
        <button onClick={() => navigate('/login')} className="flex items-center gap-1.5 text-sm font-medium text-blue-100 hover:text-white">
          <LogIn size={16} /> Iniciar sesión
        </button>
      </header>

      <main className="relative z-10 flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 sm:py-8 w-full">
          <button onClick={() => navigate('/bienvenido')} className="flex items-center gap-1.5 text-sm text-blue-100 hover:text-white mb-4">
            <ArrowLeft size={16} /> Volver
          </button>

          <div className="flex items-center gap-3 mb-5">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white shadow-lg ${T.icon}`}>
              {isMant ? <Wrench size={22} /> : isPedido ? <ShoppingCart size={22} /> : <LifeBuoy size={22} />}
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">{T.title}</h1>
              <p className="text-xs text-blue-200">{T.sub}</p>
            </div>
          </div>

          {restored?.savedAt && (restored.title?.trim() || restored.notes?.trim() || restored.lines?.some((l) => (l.description || '').trim()) || restored.requestedDate) && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <b>Recuperamos tu solicitud en curso.</b> Revísala y envíala de nuevo.
              {isMant && ' Si habías adjuntado fotos, vuelve a agregarlas.'}
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-xl p-5 sm:p-6 space-y-4">
            <div>
              <label className={labelCls}>Asunto *</label>
              <input className={inputCls}
                placeholder={isMant ? 'Ej.: Mantenimiento preventivo de la flota de oficina' : isPedido ? 'Ej.: Necesito 3 laptops para ventas' : 'Ej.: Mi computadora no enciende'}
                value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontSize: '16px' }} />
            </div>

            {isMant && (
              <div>
                <label className={labelCls}>Tipo de mantenimiento *</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MAINT_TYPES.map((t) => (
                    <button key={t.value} type="button" onClick={() => setMaintType(t.value)}
                      className={`text-left rounded-xl border-2 p-3 transition-colors ${maintType === t.value ? 'border-teal-600 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <p className={`text-sm font-semibold ${maintType === t.value ? 'text-teal-800' : 'text-gray-700'}`}>{t.label}</p>
                      <p className="text-xs text-gray-500">{t.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className={labelCls}>Descripción</label>
              <textarea className="input w-full h-28 resize-none"
                placeholder={isMant ? 'Describe qué se debe revisar o reparar y cualquier detalle útil para el técnico.' : isPedido ? 'Cuéntanos qué necesitas, para qué lo usarás, presupuesto aproximado… No te preocupes si no sabes el modelo exacto.' : 'Describe el problema con el mayor detalle posible.'}
                value={notes} onChange={(e) => setNotes(e.target.value)} style={{ fontSize: '16px' }} />
            </div>

            {(isPedido || isMant) && (
              <div>
                <label className={labelCls}>{isMant ? 'Equipos de la flota *' : 'Artículos (opcional)'}</label>
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="flex gap-2">
                      <input className="input flex-1 text-sm" placeholder={isMant ? 'Tipo de equipo (ej.: Laptop, Impresora)' : 'Descripción del artículo'} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} style={{ fontSize: '16px' }} />
                      <input type="number" min="1" className="input w-20 text-sm text-right" placeholder="Cant." value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} style={{ fontSize: '16px' }} />
                      {lines.length > 1 && <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500 px-1"><X size={16} /></button>}
                    </div>
                  ))}
                </div>
                <button onClick={addLine} className={`text-xs font-medium flex items-center gap-1 mt-2 ${isMant ? 'text-teal-700 hover:text-teal-900' : 'text-blue-600 hover:text-blue-800'}`}><Plus size={12} /> {isMant ? 'Agregar equipo' : 'Agregar artículo'}</button>
              </div>
            )}

            {isMant && (
              <>
                <div>
                  <label className={labelCls}>Fecha propuesta</label>
                  <input type="date" className={inputCls} value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} style={{ fontSize: '16px' }} />
                  <p className="flex items-start gap-1.5 text-xs text-teal-800 bg-teal-50 border border-teal-100 rounded-lg p-2.5 mt-2">
                    <Info size={14} className="flex-shrink-0 mt-px" />
                    Dominus Tech confirmará la disponibilidad y te avisará la fecha y hora definitiva.
                  </p>
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Datos de contacto *</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Nombre del contacto *</label>
                      <input className={inputCls} value={contactName} onChange={(e) => setContactName(e.target.value)} style={{ fontSize: '16px' }} />
                    </div>
                    <div>
                      <label className={labelCls}>Correo *</label>
                      <input type="email" className={inputCls} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} style={{ fontSize: '16px' }} />
                    </div>
                    <div>
                      <label className={labelCls}>Teléfono *</label>
                      <input type="tel" className={inputCls} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} style={{ fontSize: '16px' }} />
                    </div>
                    <div>
                      <label className={labelCls}>Ubicación *</label>
                      <input className={inputCls} placeholder="Dirección donde está la flota" value={location} onChange={(e) => setLocation(e.target.value)} style={{ fontSize: '16px' }} />
                    </div>
                  </div>
                </div>

                {user && photosOn && (
                  <div className="border-t border-gray-100 pt-4">
                    <label className={labelCls}>Fotos del problema o de la flota (opcional)</label>
                    <label className="inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:text-teal-900 cursor-pointer">
                      <Plus size={14} /> Agregar fotos
                      <input type="file" accept="image/*" multiple className="hidden"
                        onChange={(e) => { setPhotos((ps) => [...ps, ...Array.from(e.target.files || [])]); e.target.value = '' }} />
                    </label>
                    {photos.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {photos.map((f, i) => (
                          <li key={i} className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 rounded-md px-2 py-1">
                            <span className="truncate">{f.name}</span>
                            <button type="button" onClick={() => setPhotos((ps) => ps.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-500 ml-2"><X size={14} /></button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Aviso: se necesita cuenta para enviar */}
          {!user && (
            <div id="account-box" className={`mt-4 rounded-xl border bg-white/10 p-4 transition-all ${needAccount ? 'border-amber-300 ring-2 ring-amber-300/60' : 'border-white/15'}`}>
              {needAccount && (
                <p className="text-sm font-semibold text-amber-200 mb-2">Ya casi está: inicia sesión o crea tu cuenta para enviar la solicitud.</p>
              )}
              <p className="text-sm text-blue-50">Para <b className="text-white">enviar</b> tu solicitud necesitas una cuenta (gratis). Guardaremos lo que escribiste y lo enviaremos apenas ingreses.</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button onClick={() => saveDraftAndGo('/login')} className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-white text-gray-800 rounded-lg hover:bg-gray-100"><LogIn size={15} /> Iniciar sesión</button>
                <button onClick={() => saveDraftAndGo('/login?registro=1')} className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white rounded-lg ${T.accent}`}><UserPlus size={15} /> Crear una cuenta</button>
              </div>
            </div>
          )}

          <div className="flex justify-end mt-4">
            <button onClick={submit} disabled={saving || !title.trim()}
              className={`flex items-center gap-2 px-5 py-2.5 text-white rounded-lg font-medium disabled:opacity-60 transition-colors shadow-lg ${T.accent}`}>
              <Send size={16} /> {saving ? 'Enviando…' : (user ? 'Enviar solicitud' : 'Continuar')}
            </button>
          </div>
        </div>
      </main>

      <footer className="relative z-10 py-5 flex items-center justify-center gap-2">
        <img src={dgsLogo} alt="DG Solutions" className="w-6 h-6 rounded-md object-cover opacity-70" />
        <p className="text-[11px] text-blue-200/50">Aplicación desarrollada por <span className="text-blue-100/80 font-semibold">DG Solutions</span></p>
      </footer>
    </div>
  )
}
