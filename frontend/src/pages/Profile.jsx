import { showConfirm } from '../utils/confirm'
import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getCalendarStatus, getCalendarAuthUrl, disconnectCalendar, updateMe, testPushNotification, uploadMyPhoto, deleteMyPhoto } from '../services/api'
import {
  User, Mail, Phone, Building, Calendar, CheckCircle,
  XCircle, ExternalLink, RefreshCw, Save, Shield, Lock, Pencil, X, Bell, BellOff, Camera,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useFormGuard } from '../context/UnsavedChangesContext'
import { useModules } from '../context/ModulesContext'
import { isPushSupported, subscribeToPush, unsubscribeFromPush, getPushSubscription } from '../utils/pushNotifications'

const ROLE_LABELS = { admin: 'Administrador', supervisor: 'Supervisor', agent: 'Agente', client: 'Cliente' }
const ROLE_GRADIENT = {
  admin: 'from-purple-600 to-purple-800',
  supervisor: 'from-indigo-600 to-indigo-800',
  agent: 'from-blue-600 to-blue-800',
  client: 'from-[#1a3353] to-[#0f2340]',
}
const ROLE_BADGE = {
  admin: 'bg-purple-100 text-purple-700 border border-purple-200',
  supervisor: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
  agent: 'bg-blue-100 text-blue-700 border border-blue-200',
  client: 'bg-slate-100 text-slate-700 border border-slate-200',
}

function AvatarLetters({ name, size = 'lg' }) {
  const initials = (name || '?').split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
  const cls = size === 'lg'
    ? 'w-24 h-24 text-3xl ring-4 ring-white/30'
    : 'w-14 h-14 text-xl ring-2 ring-white/20'
  return (
    <div className={`${cls} rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center font-bold text-white flex-shrink-0`}>
      {initials}
    </div>
  )
}

export default function Profile() {
  const { user, login } = useAuth()
  const { modules } = useModules()
  const photoInputRef = useRef(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [calStatus, setCalStatus] = useState(null)
  const [calLoading, setCalLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [permGranted, setPermGranted] = useState('Notification' in window && Notification.permission === 'granted')
  const [pushLoading, setPushLoading] = useState(false)
  const [pushTesting, setPushTesting] = useState(false)

  useEffect(() => {
    getPushSubscription().then((sub) => setPushEnabled(!!sub))
  }, [])

  const handleTestPush = async () => {
    setPushTesting(true)
    try {
      if (!pushEnabled) {
        await subscribeToPush()
        setPushEnabled(true)
      }
      const res = await testPushNotification()
      const { sent, total, results } = res.data
      if (sent > 0) {
        toast.success(`Notificación enviada (${sent}/${total} suscripciones)`)
      } else {
        const firstError = results?.find(r => r.error)
        const detail = firstError
          ? `[${firstError.p256dh}] ${firstError.error}`
          : 'Sin suscripciones activas o error desconocido'
        toast.error(detail, { duration: 12000 })
      }
    } catch (err) {
      const msg = err.response?.data?.detail || err?.message || 'Error al enviar notificación de prueba'
      toast.error(msg)
    } finally {
      setPushTesting(false)
    }
  }

  const handleTogglePush = async () => {
    setPushLoading(true)
    try {
      if (pushEnabled) {
        await unsubscribeFromPush()
        setPushEnabled(false)
        toast.success('Notificaciones desactivadas')
      } else {
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') { toast.error('Permiso de notificaciones denegado'); return }
        setPermGranted(true)
        await subscribeToPush()
        setPushEnabled(true)
        toast.success('Notificaciones activadas')
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || 'Error al configurar notificaciones')
    } finally {
      setPushLoading(false)
    }
  }

  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', password: '', password2: '' })
  const [saving, setSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  useFormGuard(isDirty && editMode)

  useEffect(() => {
    if (user) {
      setForm({ name: user.name, email: user.email || '', phone: user.phone || '', company: user.company || '', password: '', password2: '' })
    }
  }, [user])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('calendar_connected') === '1') {
      toast.success('¡Google Calendar conectado exitosamente!')
      window.history.replaceState({}, '', window.location.pathname)
      fetchCalendarStatus()
    } else if (params.get('calendar_error')) {
      const err = params.get('calendar_error').replace(/_/g, ' ')
      toast.error(`Error al conectar Google Calendar: ${err}`, { duration: 10000 })
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const fetchCalendarStatus = () => {
    setCalLoading(true)
    getCalendarStatus()
      .then((res) => setCalStatus(res.data))
      .catch(() => setCalStatus({ connected: false, google_email: null }))
      .finally(() => setCalLoading(false))
  }

  useEffect(() => { fetchCalendarStatus() }, [])

  const handleConnect = async () => {
    setConnecting(true)
    let res
    try {
      res = await getCalendarAuthUrl()
    } catch (err) {
      toast.error('Error al obtener URL de autorización')
      setConnecting(false)
      return
    }
    const popup = window.open(res.data.auth_url, '_blank', 'width=600,height=700')
    if (!popup) {
      // Popup bloqueado — redirigir ventana principal
      window.location.href = res.data.auth_url
      return
    }
    toast('Autoriza el acceso en la ventana que se abrió.', { icon: '🔑', duration: 8000 })
    let attempts = 0
    const interval = setInterval(() => {
      attempts++
      if (popup.closed) { clearInterval(interval); setConnecting(false); return }
      getCalendarStatus().then((r) => {
        if (r.data.connected) {
          setCalStatus(r.data)
          clearInterval(interval)
          setConnecting(false)
          toast.success(`Google Calendar conectado: ${r.data.google_email || 'cuenta vinculada'}`)
        }
      }).catch(() => {})
      if (attempts >= 30) { clearInterval(interval); setConnecting(false) }
    }, 2000)
  }

  const handleDisconnect = async () => {
    if (!await showConfirm('¿Deseas desvincular tu cuenta de Google Calendar?')) return
    setDisconnecting(true)
    try {
      await disconnectCalendar()
      setCalStatus({ connected: false, google_email: null })
      toast.success('Cuenta de Google Calendar desvinculada')
    } catch {
      toast.error('Error al desvincular')
    } finally {
      setDisconnecting(false)
    }
  }

  const handleSaveProfile = async (e) => {
    e.preventDefault()
    if (form.password && form.password !== form.password2) {
      toast.error('Las contraseñas no coinciden')
      return
    }
    setSaving(true)
    try {
      const payload = { name: form.name, email: form.email, phone: form.phone, company: form.company }
      if (form.password) payload.password = form.password
      const res = await updateMe(payload)
      const token = localStorage.getItem('token')
      login(token, res.data)
      toast.success('Perfil actualizado')
      setIsDirty(false)
      setEditMode(false)
      setForm((f) => ({ ...f, password: '', password2: '' }))
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error guardando perfil')
    } finally {
      setSaving(false)
    }
  }

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 512_000) {
      toast.error('La imagen es demasiado grande. Máximo ~500 KB.')
      e.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = async (ev) => {
      setPhotoUploading(true)
      try {
        await uploadMyPhoto(ev.target.result)
        const token = localStorage.getItem('token')
        login(token, { ...user, profile_photo: ev.target.result })
        toast.success('Foto de perfil actualizada')
      } catch (err) {
        toast.error(err.response?.data?.detail || 'Error subiendo foto')
      } finally {
        setPhotoUploading(false)
        e.target.value = ''
      }
    }
    reader.readAsDataURL(file)
  }

  const handleDeletePhoto = async () => {
    if (!await showConfirm('¿Eliminar foto de perfil?')) return
    setPhotoUploading(true)
    try {
      await deleteMyPhoto()
      const token = localStorage.getItem('token')
      login(token, { ...user, profile_photo: null })
      toast.success('Foto eliminada')
    } catch {
      toast.error('Error eliminando foto')
    } finally {
      setPhotoUploading(false)
    }
  }

  if (!user) return null

  const gradient = ROLE_GRADIENT[user.role] || ROLE_GRADIENT.client

  return (
    <div className="max-w-2xl mx-auto pb-10">
      {/* ── Hero banner ── */}
      <div className={`bg-gradient-to-br ${gradient} rounded-b-3xl px-6 pt-8 pb-10 relative overflow-hidden`}>
        {/* Decorative circles */}
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/5" />
        <div className="absolute -bottom-12 -left-8 w-52 h-52 rounded-full bg-white/5" />

        <div className="relative flex items-end gap-5">
          {(user.role === 'admin' || user.role === 'supervisor' || user.role === 'agent') ? (
            <div className="relative group flex-shrink-0">
              {user.profile_photo ? (
                <img src={user.profile_photo} alt={user.name}
                  className="w-24 h-24 rounded-2xl object-cover ring-4 ring-white/30" />
              ) : (
                <AvatarLetters name={user.name} size="lg" />
              )}
              {/* Móvil: badge de cámara siempre visible en esquina inferior */}
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={photoUploading}
                className="absolute bottom-1 right-1 w-8 h-8 rounded-full bg-black/70 text-white flex items-center justify-center sm:hidden shadow"
                title="Cambiar foto"
              >
                <Camera size={14} />
              </button>
              {/* Desktop: overlay al hacer hover */}
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={photoUploading}
                className="absolute inset-0 rounded-2xl bg-black/50 hidden sm:flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                title="Cambiar foto"
              >
                <Camera size={22} className="text-white" />
              </button>
              {user.profile_photo && (
                <button
                  onClick={handleDeletePhoto}
                  disabled={photoUploading}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shadow"
                  title="Eliminar foto"
                >
                  <X size={12} />
                </button>
              )}
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
            </div>
          ) : (
            <AvatarLetters name={user.name} size="lg" />
          )}
          <div className="pb-1">
            <h1 className="text-2xl font-bold text-white leading-tight">{user.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${ROLE_BADGE[user.role]}`}>
                {ROLE_LABELS[user.role]}
              </span>
              {user.company && (
                <span className="text-xs text-white/70 flex items-center gap-1">
                  <Building size={11} /> {user.company}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 -mt-4 space-y-4">
        {/* ── Account info card ── */}
        <div className="card shadow-lg">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-gray-900 text-base">Información de cuenta</h2>
            {!editMode && (
              <button
                onClick={() => setEditMode(true)}
                className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                <Pencil size={13} /> Editar
              </button>
            )}
          </div>

          {editMode ? (
            <form id="profile-form" onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Nombre</label>
                  <input className="input" style={{ fontSize: '16px' }} value={form.name}
                    onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, name: e.target.value })) }} required />
                </div>
                <div>
                  <label className="label">Teléfono</label>
                  <input className="input" style={{ fontSize: '16px' }} value={form.phone}
                    onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, phone: e.target.value })) }} />
                </div>
              </div>
              <div>
                <label className="label">Correo electrónico</label>
                <input type="email" className="input" style={{ fontSize: '16px' }} value={form.email}
                  onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, email: e.target.value })) }} required />
              </div>
              <div>
                <label className="label">Empresa</label>
                <input className="input" style={{ fontSize: '16px' }} value={form.company}
                  onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, company: e.target.value })) }} />
              </div>

              <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  <Lock size={13} /> Cambiar contraseña
                  <span className="text-xs font-normal text-gray-400">(dejar vacío para no cambiar)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Nueva contraseña</label>
                    <input type="password" className="input" style={{ fontSize: '16px' }} value={form.password}
                      onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, password: e.target.value })) }} />
                  </div>
                  <div>
                    <label className="label">Confirmar</label>
                    <input type="password" className="input" style={{ fontSize: '16px' }} value={form.password2}
                      onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, password2: e.target.value })) }} />
                  </div>
                </div>
              </div>
            </form>
          ) : (
            <div className="divide-y divide-gray-100">
              <InfoRow icon={Mail} label="Correo electrónico" value={user.email} />
              <InfoRow icon={Phone} label="Teléfono" value={user.phone} />
              <InfoRow icon={Building} label="Empresa" value={user.company} />
              <InfoRow icon={Shield} label="Rol" value={ROLE_LABELS[user.role]} />
            </div>
          )}
        </div>

        {/* ── Google Calendar — solo admin y agente, y si la integración está habilitada ── */}
        {modules?.google_calendar !== false && (user.role === 'admin' || user.role === 'supervisor' || user.role === 'agent') && (
          <div className="card shadow-lg space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center shadow-sm flex-shrink-0">
                <GoogleIcon />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Google Calendar</h2>
                <p className="text-xs text-gray-500">Vincula tu cuenta para agendar tickets en tu calendario</p>
              </div>
            </div>

            {calLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <RefreshCw size={14} className="animate-spin" /> Verificando conexión...
              </div>
            ) : calStatus?.connected ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCircle size={18} className="text-green-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-green-800">Cuenta conectada</p>
                    {calStatus.google_email && <p className="text-xs text-green-600">{calStatus.google_email}</p>}
                  </div>
                  <button onClick={fetchCalendarStatus} className="p-1.5 hover:bg-green-100 rounded-lg text-green-500" title="Verificar">
                    <RefreshCw size={13} />
                  </button>
                </div>
                <div className="text-xs text-gray-500 space-y-1 pl-1">
                  <p className="flex items-center gap-1.5"><span className="text-green-500">✓</span> Puedes agendar tickets directamente en tu Google Calendar</p>
                  <p className="flex items-center gap-1.5"><span className="text-green-500">✓</span> Los eventos incluyen: contacto, empresa, ubicación y asunto</p>
                </div>
                <button onClick={handleDisconnect} disabled={disconnecting}
                  className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 font-medium">
                  <XCircle size={14} /> {disconnecting ? 'Desvinculando...' : 'Desvincular cuenta de Google'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                  <XCircle size={18} className="text-gray-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-700">No conectado</p>
                    <p className="text-xs text-gray-400">Vincula tu cuenta de Google para habilitar la integración</p>
                  </div>
                </div>
                <div className="text-xs text-gray-400 space-y-1 pl-1">
                  <p>Al conectar podrás:</p>
                  <p className="flex items-center gap-1.5"><span>•</span> Crear eventos en tu Google Calendar desde cada ticket</p>
                  <p className="flex items-center gap-1.5"><span>•</span> Ver los eventos en tu Agenda de Gmail</p>
                </div>
                <button onClick={handleConnect} disabled={connecting} className="btn-primary flex items-center gap-2">
                  <GoogleIcon size={16} white />
                  {connecting ? 'Abriendo...' : 'Conectar con Google Calendar'}
                </button>
                <p className="text-xs text-gray-400">
                  Se abrirá una ventana de Google para autorizar el acceso. Solo se solicitan permisos para crear y eliminar eventos.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Notificaciones push ── */}
      {isPushSupported() && (
        <div className="card mx-4 sm:mx-6 mb-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
            <Bell size={15} className="text-blue-600" /> Notificaciones push
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-gray-700">
                  {permGranted ? 'Activadas en este dispositivo' : 'Desactivadas en este dispositivo'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Recibe alertas de nuevos tickets y comentarios de clientes aunque el navegador esté minimizado.
                </p>
              </div>
              {!permGranted && (
                <button
                  onClick={handleTogglePush}
                  disabled={pushLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 disabled:opacity-60 bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Bell size={14} />
                  {pushLoading ? 'Procesando...' : 'Activar'}
                </button>
              )}
              {permGranted && pushEnabled && (
                <button
                  onClick={handleTogglePush}
                  disabled={pushLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 disabled:opacity-60 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                >
                  <BellOff size={14} />
                  {pushLoading ? 'Procesando...' : 'Desactivar'}
                </button>
              )}
            </div>
            {permGranted && (
              <button
                onClick={handleTestPush}
                disabled={pushTesting}
                className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
              >
                <Bell size={12} />
                {pushTesting ? 'Enviando...' : 'Enviar notificación de prueba'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Sticky save bar ── */}
      {editMode && (
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 sm:px-6 py-3 flex items-center gap-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] z-10">
          <span className={`text-xs flex items-center gap-1.5 ${isDirty ? 'text-amber-600' : 'text-gray-300'}`}>
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${isDirty ? 'bg-amber-500 animate-pulse' : 'bg-gray-300'}`} />
            {isDirty ? 'Sin guardar' : 'Sin cambios'}
          </span>
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={() => { setIsDirty(false); setEditMode(false) }}
              className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5">
              <X size={13} /> Cancelar
            </button>
            <button type="submit" form="profile-form" disabled={saving}
              className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
              <Save size={13} /> {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
        <Icon size={14} className="text-gray-500" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-900 truncate">{value}</p>
      </div>
    </div>
  )
}

function GoogleIcon({ size = 16, white = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {white ? (
        <path d="M12 11v2.6h4.4c-.2 1-1.3 3-4.4 3-2.6 0-4.8-2.2-4.8-4.8s2.2-4.8 4.8-4.8c1.5 0 2.5.6 3.1 1.2l2.1-2c-1.3-1.2-3-2-5.2-2C7 4.2 3.2 8 3.2 12s3.8 7.8 8.8 7.8c5.1 0 8.4-3.6 8.4-8.6 0-.6-.1-1-.2-1.4H12z" fill="currentColor" />
      ) : (
        <>
          <path d="M21.8 12.2c0-.7-.1-1.3-.2-2H12v3.8h5.5c-.2 1.3-1 2.4-2.1 3.1v2.6h3.4c2-1.8 3-4.5 3-7.5z" fill="#4285F4" />
          <path d="M12 22c2.7 0 5-1 6.7-2.4l-3.4-2.6c-.9.6-2 1-3.3 1-2.6 0-4.7-1.7-5.5-4H2.9v2.7C4.6 19.9 8 22 12 22z" fill="#34A853" />
          <path d="M6.5 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.3H2.9C2.3 8.5 2 9.7 2 11s.3 2.5.9 3.7L6.5 14z" fill="#FBBC05" />
          <path d="M12 5.4c1.4 0 2.7.5 3.7 1.4l2.8-2.8C16.9 2.5 14.6 1.4 12 1.4 8 1.4 4.6 3.5 2.9 6.7l3.6 2.7C7.3 7.1 9.4 5.4 12 5.4z" fill="#EA4335" />
        </>
      )}
    </svg>
  )
}
