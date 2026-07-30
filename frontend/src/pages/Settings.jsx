import { showConfirm } from '../utils/confirm'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'react-hot-toast'
import {
  Settings as SettingsIcon, Mail, Send, Save, Eye, EyeOff,
  MessageCircle, Inbox, RefreshCw, Globe, Clock, ChevronRight,
  Users, Plus, Edit, Trash2, X, Shield, UserCheck, Search, Building2,
  Activity, Filter, Tag, Check, Timer, Zap, Palette, Image, Ban, Pencil,
} from 'lucide-react'
import {
  getSmtpSettings, saveSmtpSettings, testSmtpSettings,
  getImapSettings, saveImapSettings, pollImap,
  getFormatSettings, saveFormatSettings,
  getCompanySettings, saveCompanySettings, uploadCompanyLogo, deleteCompanyLogo, companyLogoUrl,
  uploadFavicon, deleteFavicon, faviconUrl, uploadPwaIcon, deletePwaIcon, pwaIconUrl,
  getSlaSettings, saveSlaSettings,
  getUsers, createUser, updateUser, deleteUser,
  getRoleFeatures, saveRoleFeatures,
  getAuditLog,
  getClientCategories, createClientCategory, updateClientCategory, deleteClientCategory,
  getCannedResponses, createCannedResponse, updateCannedResponse, deleteCannedResponse,
} from '../services/api'
import { ROLE_FEATURE_DEFS, normLevel } from '../context/RoleFeaturesContext'
import { setCompanyCache, getCompanyCache } from '../context/CompanyContext'
import { setFmtConfig } from '../utils/fmt'
import { useAuth } from '../context/AuthContext'
import { useFormGuard } from '../context/UnsavedChangesContext'
import { useRoleFeatures } from '../context/RoleFeaturesContext'

// ── Role definitions ───────────────────────────────────────────────────────
export const ROLES = [
  { value: 'admin',      label: 'Administrador', color: 'bg-purple-100 text-purple-700',    desc: 'Acceso total al sistema' },
  { value: 'supervisor', label: 'Supervisor',     color: 'bg-indigo-100 text-indigo-700',    desc: 'Supervisión de operaciones sin gestión de usuarios' },
  { value: 'agent',      label: 'Técnico',        color: 'bg-blue-100 text-blue-700',        desc: 'Gestión de tickets y servicio técnico' },
  { value: 'ventas',     label: 'Ventas',         color: 'bg-emerald-100 text-emerald-700',  desc: 'Cotizaciones, pedidos y facturas' },
  { value: 'supplies',   label: 'Responsable de Inventario', color: 'bg-teal-100 text-teal-700', desc: 'Inventario, suministros, despachos y aprobación de partes' },
  { value: 'client',     label: 'Cliente',        color: 'bg-gray-100 text-gray-700',        desc: 'Acceso a sus propios tickets' },
]

export const ROLE_MAP = Object.fromEntries(ROLES.map(r => [r.value, r]))

// ── Constants ──────────────────────────────────────────────────────────────
const TIMEZONES = [
  { value: 'America/Panama',                label: 'Panamá (UTC-5)' },
  { value: 'America/Bogota',                label: 'Colombia / Bogotá (UTC-5)' },
  { value: 'America/Lima',                  label: 'Perú / Lima (UTC-5)' },
  { value: 'America/Quito',                 label: 'Ecuador / Quito (UTC-5)' },
  { value: 'America/Costa_Rica',            label: 'Costa Rica (UTC-6)' },
  { value: 'America/El_Salvador',           label: 'El Salvador (UTC-6)' },
  { value: 'America/Tegucigalpa',           label: 'Honduras (UTC-6)' },
  { value: 'America/Managua',               label: 'Nicaragua (UTC-6)' },
  { value: 'America/Guatemala',             label: 'Guatemala (UTC-6)' },
  { value: 'America/Mexico_City',           label: 'México / Ciudad de México (UTC-6/-5)' },
  { value: 'America/Caracas',               label: 'Venezuela / Caracas (UTC-4)' },
  { value: 'America/Santiago',              label: 'Chile / Santiago (UTC-4/-3)' },
  { value: 'America/Sao_Paulo',             label: 'Brasil / São Paulo (UTC-3/-2)' },
  { value: 'America/Argentina/Buenos_Aires',label: 'Argentina / Buenos Aires (UTC-3)' },
  { value: 'America/New_York',              label: 'EE.UU. / Nueva York (UTC-5/-4)' },
  { value: 'America/Chicago',               label: 'EE.UU. / Chicago (UTC-6/-5)' },
  { value: 'America/Denver',                label: 'EE.UU. / Denver (UTC-7/-6)' },
  { value: 'America/Los_Angeles',           label: 'EE.UU. / Los Ángeles (UTC-8/-7)' },
  { value: 'Europe/Madrid',                 label: 'España / Madrid (UTC+1/+2)' },
  { value: 'UTC',                           label: 'UTC (Universal)' },
]

const DATE_FORMATS = [
  { value: 'dd/MM/yyyy',       label: 'DD/MM/AAAA',    example: '15/01/2024' },
  { value: 'MM/dd/yyyy',       label: 'MM/DD/AAAA',    example: '01/15/2024' },
  { value: 'yyyy-MM-dd',       label: 'AAAA-MM-DD',    example: '2024-01-15' },
  { value: "d 'de' MMMM yyyy", label: 'D de Mes AAAA', example: '15 de enero 2024' },
]

const SMTP_FIELDS = [
  { key: 'smtp_host',     label: 'Servidor SMTP',      placeholder: 'smtp.gmail.com',      type: 'text' },
  { key: 'smtp_port',     label: 'Puerto',              placeholder: '587',                 type: 'number' },
  { key: 'smtp_user',     label: 'Usuario / Correo',   placeholder: 'tu@correo.com',       type: 'text' },
  { key: 'smtp_password', label: 'Contraseña',          placeholder: '••••••••',            type: 'password' },
  { key: 'smtp_from',     label: 'Dirección remitente', placeholder: 'soporte@empresa.com', type: 'text' },
]

const SMTP_EMPTY = { smtp_host: '', smtp_port: '587', smtp_user: '', smtp_password: '', smtp_from: '', smtp_tls: 'true', brevo_api_key: '', admin_notification_email: '' }
const IMAP_EMPTY = { imap_host: '', imap_port: '993', imap_user: '', imap_password: '', imap_ssl: 'true', imap_enabled: 'false', imap_poll_interval: '120', imap_create_tickets: 'true' }
const FMT_EMPTY  = { tz: 'America/Panama', date_format: 'dd/MM/yyyy', time_format: '12h' }
const USER_EMPTY = { name: '', email: '', password: '', role: 'client', phone: '', company: '', address: '', client_category_id: '' }

// ── Category grid ──────────────────────────────────────────────────────────
const CATEGORIES = [
  {
    id: 'users',
    icon: Users,
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
    title: 'Usuarios',
    description: 'Crea, edita y gestiona los usuarios del sistema. Asigna roles: Administrador, Técnico, Ventas y Cliente.',
  },
  {
    id: 'role_assign',
    icon: UserCheck,
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    title: 'Roles de usuario',
    description: 'Cambia el rol asignado a cada miembro del equipo (Administrador, Técnico, Ventas).',
  },
  {
    id: 'email',
    icon: Mail,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    title: 'Correo electrónico',
    description: 'Configure servidores SMTP para envío y buzón IMAP para recepción de respuestas.',
  },
  {
    id: 'datetime',
    icon: Globe,
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    border: 'border-indigo-200',
    title: 'Fecha y hora',
    description: 'Zona horaria y formato de fecha/hora aplicados en todo el sistema.',
  },
  {
    id: 'notifications',
    icon: MessageCircle,
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-200',
    title: 'Notificaciones',
    description: 'Canales adicionales para contactar clientes: WhatsApp y más.',
  },
  {
    id: 'branding',
    icon: Palette,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    title: 'Marca / Branding',
    description: 'Logo, favicon, ícono PWA, nombre de la aplicación y colores del sistema.',
  },
  {
    id: 'company',
    icon: Building2,
    color: 'text-teal-600',
    bg: 'bg-teal-50',
    border: 'border-teal-200',
    title: 'Datos de la empresa',
    description: 'Nombre, dirección, RUC y contacto que aparecen en cartas, cotizaciones y facturas.',
  },
  {
    id: 'audit',
    icon: Activity,
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
    title: 'Auditoría del sistema',
    description: 'Registro de todas las acciones realizadas en el sistema: creaciones, modificaciones y eliminaciones.',
  },
  {
    id: 'client_categories',
    icon: Tag,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    title: 'Categorías de clientes',
    description: 'Define niveles de servicio para clientes: Premium, Estándar, VIP, etc. con colores personalizados.',
  },
  {
    id: 'sla',
    icon: Timer,
    color: 'text-cyan-600',
    bg: 'bg-cyan-50',
    border: 'border-cyan-200',
    title: 'SLA por prioridad',
    description: 'Tiempo máximo de respuesta en horas hábiles para cada nivel de prioridad de tickets.',
  },
  {
    id: 'canned',
    icon: Zap,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    title: 'Respuestas predefinidas',
    description: 'Plantillas de respuesta rápida para usar en comentarios de tickets.',
  },
]

// ── Main component ─────────────────────────────────────────────────────────
export default function Settings() {
  const { user } = useAuth()
  const [active, setActive]   = useState(null)
  const [loading, setLoading] = useState(true)

  // SMTP
  const [form, setForm]           = useState(SMTP_EMPTY)
  const [showPassword, setShowPw] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [saving, setSaving]       = useState(false)
  const [testing, setTesting]     = useState(false)
  const [isDirty, setIsDirty]     = useState(false)
  useFormGuard(isDirty)

  // IMAP
  const [imapForm, setImapForm]     = useState(IMAP_EMPTY)
  const [showImapPw, setShowImapPw] = useState(false)
  const [savingImap, setSavingImap] = useState(false)
  const [polling, setPolling]       = useState(false)

  // Format
  const [fmtForm, setFmtForm]     = useState(FMT_EMPTY)
  const [savingFmt, setSavingFmt] = useState(false)

  // Company
  const COMPANY_EMPTY = { company_name: '', company_address: '', company_ruc: '', company_phone: '', company_email: '' }
  const [coForm, setCoForm]       = useState(COMPANY_EMPTY)
  const [savingCo, setSavingCo]   = useState(false)

  useEffect(() => {
    Promise.all([getSmtpSettings(), getImapSettings(), getFormatSettings(), getCompanySettings()])
      .then(([smtpR, imapR, fmtR, coR]) => {
        setForm({ ...SMTP_EMPTY, ...smtpR.data })
        setImapForm({ ...IMAP_EMPTY, ...imapR.data })
        setFmtForm({ ...FMT_EMPTY, ...fmtR.data })
        setCoForm({ ...COMPANY_EMPTY, ...coR.data })
      })
      .catch(() => toast.error('Error al cargar configuración'))
      .finally(() => setLoading(false))
    setTestEmail(user?.email || '')
  }, [user])

  const handleChange = (key, val) => { setIsDirty(true); setForm(f => ({ ...f, [key]: val })) }
  const handleSave = async () => {
    setSaving(true)
    try { await saveSmtpSettings(form); setIsDirty(false); toast.success('Configuración SMTP guardada') }
    catch { toast.error('Error al guardar') }
    finally { setSaving(false) }
  }
  const handleTest = async () => {
    if (!testEmail) { toast.error('Ingresa un correo de prueba'); return }
    setTesting(true)
    try { await testSmtpSettings({ ...form, to: testEmail }); toast.success(`Correo enviado a ${testEmail}`) }
    catch (e) { toast.error(e.response?.data?.detail || 'Error al enviar prueba') }
    finally { setTesting(false) }
  }

  const handleImapChange = (key, val) => setImapForm(f => ({ ...f, [key]: val }))
  const handleSaveImap = async () => {
    setSavingImap(true)
    try { await saveImapSettings(imapForm); toast.success('Configuración IMAP guardada') }
    catch { toast.error('Error al guardar IMAP') }
    finally { setSavingImap(false) }
  }
  const handlePollNow = async () => {
    setPolling(true)
    try {
      const r = await pollImap()
      const { processed, skipped, error } = r.data
      if (error) toast.error(`Error: ${error}`)
      else toast.success(`${processed} mensaje(s) procesado(s), ${skipped} omitido(s)`)
    } catch (e) { toast.error(e.response?.data?.detail || 'Error al verificar buzón') }
    finally { setPolling(false) }
  }

  const handleSaveFmt = async () => {
    setSavingFmt(true)
    try {
      await saveFormatSettings(fmtForm)
      setFmtConfig({ tz: fmtForm.tz, dateFormat: fmtForm.date_format, time12: fmtForm.time_format !== '24h' })
      toast.success('Formato guardado. Recargando...')
      setTimeout(() => window.location.reload(), 1200)
    } catch { toast.error('Error al guardar formato') }
    finally { setSavingFmt(false) }
  }

  const handleSaveCo = async () => {
    setSavingCo(true)
    try {
      await saveCompanySettings(coForm)
      // Refresca el singleton que usan los generadores de PDF/documentos, así los
      // datos de empresa (dirección, RUC, etc.) se reflejan sin recargar la página.
      setCompanyCache({ ...getCompanyCache(), ...coForm })
      toast.success('Datos de empresa guardados')
    }
    catch { toast.error('Error al guardar datos de empresa') }
    finally { setSavingCo(false) }
  }

  if (loading) return <div className="p-6 text-center text-gray-500">Cargando configuración...</div>

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">

      <div className="flex items-center gap-3 mb-8">
        <SettingsIcon size={22} className="text-gray-500" />
        <h1 className="text-xl font-bold text-gray-900">Configuración del sistema</h1>
      </div>

      {/* Category grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {CATEGORIES.map(({ id, icon: Icon, color, bg, border, title, description }) => {
          const isActive = active === id
          return (
            <button
              key={id}
              onClick={() => setActive(isActive ? null : id)}
              className={`text-left p-5 rounded-xl border-2 transition-all duration-150 hover:shadow-md group
                ${isActive ? `${border} ${bg} shadow-md` : 'border-gray-200 bg-white hover:border-gray-300'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? bg : 'bg-gray-100 group-hover:bg-gray-200'} transition-colors`}>
                  <Icon size={20} className={isActive ? color : 'text-gray-500'} />
                </div>
                <ChevronRight size={16} className={`mt-1 flex-shrink-0 transition-all duration-200 ${isActive ? `${color} rotate-90` : 'text-gray-300 group-hover:text-gray-400'}`} />
              </div>
              <p className={`mt-3 font-semibold text-sm ${isActive ? 'text-gray-900' : 'text-gray-800'}`}>{title}</p>
              <p className="mt-1 text-xs text-gray-500 leading-relaxed">{description}</p>
            </button>
          )
        })}
      </div>

      {/* Panels */}
      {active === 'users'         && <UsersPanel currentUser={user} />}
      {active === 'role_assign'   && <RoleAssignPanel currentUser={user} />}
      {active === 'email'         && (
        <EmailPanel
          form={form} handleChange={handleChange} showPassword={showPassword} setShowPw={setShowPw}
          testEmail={testEmail} setTestEmail={setTestEmail} saving={saving} testing={testing}
          handleSave={handleSave} handleTest={handleTest}
          imapForm={imapForm} handleImapChange={handleImapChange} showImapPw={showImapPw}
          setShowImapPw={setShowImapPw} savingImap={savingImap} polling={polling}
          handleSaveImap={handleSaveImap} handlePollNow={handlePollNow}
        />
      )}
      {active === 'datetime'      && <DateTimePanel fmtForm={fmtForm} setFmtForm={setFmtForm} savingFmt={savingFmt} handleSaveFmt={handleSaveFmt} />}
      {active === 'notifications' && <NotificationsPanel />}
      {active === 'branding'      && <BrandingPanel coForm={coForm} setCoForm={setCoForm} savingCo={savingCo} handleSaveCo={handleSaveCo} />}
      {active === 'company'       && <CompanyPanel coForm={coForm} setCoForm={setCoForm} savingCo={savingCo} handleSaveCo={handleSaveCo} />}
      {active === 'audit'         && <AuditPanel />}
      {active === 'client_categories' && <ClientCategoriesPanel />}
      {active === 'sla'           && <SlaPanel />}
      {active === 'canned'        && <CannedPanel />}
    </div>
  )
}

// ── Shared user search with suggestions ────────────────────────────────────
function UserSearchInput({ users, onSearch, placeholder = 'Buscar por nombre, email o empresa...' }) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const ref = useRef(null)

  const suggestions = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return users.filter(u =>
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.company || '').toLowerCase().includes(q)
    ).slice(0, 8)
  }, [query, users])

  const select = (u) => {
    setQuery(u.name)
    setOpen(false)
    onSearch(u.name)
  }

  const clear = () => { setQuery(''); setOpen(false); onSearch('') }

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); onSearch(e.target.value) }}
          onFocus={() => query && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="input pl-8 pr-8"
          style={{ fontSize: '16px' }}
        />
        {query && (
          <button onMouseDown={e => { e.preventDefault(); clear() }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {suggestions.map(u => (
            <li key={u.id}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); select(u) }}
                className="w-full text-left px-3 py-2.5 hover:bg-violet-50 text-sm flex items-center gap-2.5 border-b border-gray-50 last:border-0"
              >
                <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {u.name[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{u.name}</p>
                  <p className="text-xs text-gray-400 truncate">{u.email}{u.company ? ` · ${u.company}` : ''}</p>
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${ROLE_MAP[u.role]?.color || 'bg-gray-100 text-gray-600'}`}>
                  {ROLE_MAP[u.role]?.label || u.role}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Role assignment panel ──────────────────────────────────────────────────
function RoleAssignPanel({ currentUser }) {
  const [users, setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState({})

  const fetchUsers = () =>
    getUsers()
      .then(r => setUsers(r.data.filter(u => u.role !== 'client' && u.role !== 'superadmin')))
      .catch(() => toast.error('Error cargando usuarios'))
      .finally(() => setLoading(false))

  useEffect(() => { fetchUsers() }, [])

  const visible = useMemo(() => {
    if (!search.trim()) return users
    const q = search.toLowerCase()
    return users.filter(u =>
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.company || '').toLowerCase().includes(q)
    )
  }, [users, search])

  const handleRoleChange = async (u, newRole) => {
    if (u.role === newRole) return
    setSaving(s => ({ ...s, [u.id]: true }))
    try {
      await updateUser(u.id, { role: newRole })
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: newRole } : x))
      toast.success(`Rol de ${u.name} actualizado`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error actualizando rol')
    } finally {
      setSaving(s => ({ ...s, [u.id]: false }))
    }
  }

  const nonClientRoles = ROLES.filter(r => r.value !== 'client')

  return (
    <div className="animate-fade-in">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <UserCheck size={16} className="text-orange-600" />
          <h2 className="font-semibold text-gray-800 text-sm">Roles de usuario</h2>
          <span className="text-xs text-gray-400 ml-1">({users.length} miembros del equipo)</span>
        </div>

        <div className="px-5 py-4 border-b border-gray-100">
          <UserSearchInput users={users} onSearch={setSearch} />
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin resultados</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {visible.map(u => {
              const isSelf = u.id === currentUser?.id
              return (
                <div key={u.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {u.name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">{u.name}</p>
                      {isSelf && <span className="text-xs text-orange-500 font-medium">(tú)</span>}
                    </div>
                    <p className="text-xs text-gray-400 truncate">{u.email}{u.company ? ` · ${u.company}` : ''}</p>
                  </div>
                  <div className="flex-shrink-0">
                    {saving[u.id] ? (
                      <span className="text-xs text-gray-400 px-3 py-1.5">Guardando...</span>
                    ) : (
                      <div className="flex gap-1.5 flex-wrap justify-end">
                        {nonClientRoles.map(r => (
                          <button
                            key={r.value}
                            onClick={() => !isSelf && handleRoleChange(u, r.value)}
                            disabled={isSelf}
                            title={isSelf ? 'No puedes cambiar tu propio rol' : r.label}
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all border ${
                              u.role === r.value
                                ? `${r.color} border-transparent ring-2 ring-offset-1 ring-current`
                                : `bg-gray-50 text-gray-400 border-gray-200 ${!isSelf ? 'hover:border-gray-300 hover:text-gray-600 cursor-pointer' : 'cursor-not-allowed opacity-50'}`
                            }`}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Users panel ────────────────────────────────────────────────────────────
function UsersPanel({ currentUser }) {
  const [users, setUsers]       = useState([])
  const [clientCats, setClientCats] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [form, setForm]         = useState(USER_EMPTY)
  const [saving, setSaving]     = useState(false)
  const [roleFilter, setRoleFilter] = useState('')
  const [search, setSearch]     = useState('')

  const fetchUsers = () =>
    getUsers()
      .then(r => setUsers(r.data.filter(u => u.is_active)))
      .catch(() => toast.error('Error cargando usuarios'))
      .finally(() => setLoading(false))

  useEffect(() => {
    fetchUsers()
    getClientCategories().then(r => setClientCats(r.data)).catch(() => {})
  }, [])

  const openCreate = () => { setEditUser(null); setForm({ ...USER_EMPTY, client_category_id: '' }); setShowModal(true) }
  const openEdit   = (u) => {
    setEditUser(u)
    setForm({ name: u.name, email: u.email, password: '', role: u.role, phone: u.phone || '', company: u.company || '', address: u.address || '', client_category_id: u.client_category_id || '' })
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form, client_category_id: form.client_category_id ? Number(form.client_category_id) : null }
      if (!payload.password) delete payload.password
      if (editUser) { await updateUser(editUser.id, payload); toast.success('Usuario actualizado') }
      else           { await createUser(payload);              toast.success('Usuario creado') }
      setShowModal(false)
      fetchUsers()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error guardando usuario') }
    finally { setSaving(false) }
  }

  const handleDelete = async (u) => {
    if (!await showConfirm(`¿Desactivar al usuario ${u.name}?`)) return
    try { await deleteUser(u.id); toast.success('Usuario desactivado'); fetchUsers() }
    catch (err) { toast.error(err.response?.data?.detail || 'Error al desactivar usuario') }
  }

  const visible = useMemo(() => {
    let list = roleFilter ? users.filter(u => u.role === roleFilter) : users
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.company || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [users, roleFilter, search])

  return (
    <div className="animate-fade-in space-y-4">

      {/* Role legend + actions */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-violet-600" />
            <h2 className="font-semibold text-gray-800 text-sm">Gestión de usuarios</h2>
            <span className="text-xs text-gray-400 ml-1">({users.length} usuarios)</span>
          </div>
          <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors min-h-[36px]">
            <Plus size={14} /> Nuevo usuario
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-gray-100">
          <UserSearchInput users={users} onSearch={q => { setSearch(q); setRoleFilter('') }} />
        </div>

        {/* Role cards */}
        <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-gray-100">
          {ROLES.map(r => {
            const count = users.filter(u => u.role === r.value).length
            const isActive = roleFilter === r.value
            return (
              <button
                key={r.value}
                onClick={() => setRoleFilter(isActive ? '' : r.value)}
                className={`text-left p-3 rounded-lg border transition-colors ${isActive ? 'border-violet-300 bg-violet-50' : 'border-gray-100 bg-gray-50 hover:border-gray-200'}`}
              >
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${r.color} mb-1.5`}>{r.label}</span>
                <p className="text-xs text-gray-500 leading-tight">{r.desc}</p>
                <p className="text-lg font-bold text-gray-900 mt-1">{count}</p>
              </button>
            )
          })}
        </div>

        {/* User list */}
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin usuarios{search ? ' que coincidan con la búsqueda' : roleFilter ? ' con este rol' : ''}</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {visible.map(u => {
              const role = ROLE_MAP[u.role]
              const isSelf = u.id === currentUser?.id
              return (
                <div key={u.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="w-9 h-9 rounded-full bg-violet-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {u.name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">{u.name}</p>
                      {isSelf && <span className="text-xs text-violet-500 font-medium">(tú)</span>}
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${role?.color || 'bg-gray-100 text-gray-600'}`}>
                        {role?.label || u.role}
                      </span>
                      {!u.is_active && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">Inactivo</span>}
                    </div>
                    <p className="text-xs text-gray-400 truncate">{u.email}{u.company ? ` · ${u.company}` : ''}{u.phone ? ` · ${u.phone}` : ''}</p>
                    {u.client_category && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full font-medium text-white"
                        style={{ backgroundColor: u.client_category.color }}>
                        {u.client_category.name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(u)} className="p-1.5 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-700 transition-colors" title="Editar">
                      <Edit size={14} />
                    </button>
                    {!isSelf && (
                      <button onClick={() => handleDelete(u)} className="p-1.5 hover:bg-red-100 rounded text-red-400 hover:text-red-600 transition-colors" title="Desactivar usuario">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
              <h3 className="font-semibold text-gray-900">{editUser ? 'Editar usuario' : 'Nuevo usuario'}</h3>
              <button onClick={() => setShowModal(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="label">Nombre completo *</label>
                  <input className="input" style={{fontSize:'16px'}} value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} required />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Correo electrónico *</label>
                  <input type="email" className="input" style={{fontSize:'16px'}} value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} required />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{editUser ? 'Nueva contraseña (vacío = sin cambios)' : 'Contraseña *'}</label>
                  <input type="password" className="input" style={{fontSize:'16px'}} value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} required={!editUser} />
                </div>
              </div>

              {/* Role selector */}
              <div>
                <label className="label">Perfil / Rol *</label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLES.map(r => (
                    <label
                      key={r.value}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        form.role === r.value ? 'border-violet-400 bg-violet-50' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input type="radio" name="role" value={r.value} checked={form.role === r.value} onChange={() => setForm(f => ({...f, role: r.value}))} className="mt-0.5 text-violet-600" />
                      <div>
                        <p className={`text-xs font-semibold px-1.5 py-0.5 rounded inline-block mb-0.5 ${r.color}`}>{r.label}</p>
                        <p className="text-xs text-gray-400 leading-tight">{r.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Teléfono</label>
                  <input className="input" style={{fontSize:'16px'}} value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} inputMode="tel" placeholder="+507 6000-0000" />
                </div>
                <div>
                  <label className="label">Empresa</label>
                  <input className="input" style={{fontSize:'16px'}} value={form.company} onChange={e => setForm(f => ({...f, company: e.target.value}))} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Dirección</label>
                  <input className="input" style={{fontSize:'16px'}} value={form.address} onChange={e => setForm(f => ({...f, address: e.target.value}))} placeholder="Ej: Calle 50, Torre Global, Of. 12" />
                </div>
                {(form.role === 'client' || !form.role) && clientCats.filter(c => c.is_active).length > 0 && (
                  <div className="sm:col-span-2">
                    <label className="label">Categoría de cliente</label>
                    <select className="input" style={{fontSize:'16px'}} value={form.client_category_id}
                      onChange={e => setForm(f => ({...f, client_category_id: e.target.value}))}>
                      <option value="">Sin categoría</option>
                      {clientCats.filter(c => c.is_active).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  <Save size={14} />{saving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Role Features Panel ────────────────────────────────────────────────────
const CONFIGURABLE_ROLES = [
  { value: 'agent',      label: 'Técnico',    color: 'bg-blue-100 text-blue-700' },
  { value: 'supervisor', label: 'Supervisor', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'ventas',     label: 'Ventas',     color: 'bg-emerald-100 text-emerald-700' },
  { value: 'supplies',   label: 'Resp. Inventario', color: 'bg-teal-100 text-teal-700' },
  { value: 'client',     label: 'Cliente',    color: 'bg-gray-100 text-gray-700' },
]

const LEVEL_META = {
  none:  { label: 'Sin acceso', Icon: Ban,    active: 'bg-gray-200 text-gray-600' },
  read:  { label: 'Lectura',    Icon: Eye,    active: 'bg-blue-100 text-blue-700' },
  write: { label: 'Edición',    Icon: Pencil, active: 'bg-violet-600 text-white' },
}

function LevelSelect({ value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
      {['none', 'read', 'write'].map(lvl => {
        const m = LEVEL_META[lvl]
        const active = value === lvl
        return (
          <button key={lvl} type="button" title={m.label} onClick={() => onChange(lvl)}
            className={`px-2 py-1.5 flex items-center justify-center transition-colors ${active ? m.active : 'text-gray-300 hover:bg-gray-50'}`}>
            <m.Icon size={13} />
          </button>
        )
      })}
    </div>
  )
}

export function RoleFeaturesPanel() {
  const { reload } = useRoleFeatures()
  const [features, setFeatures] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getRoleFeatures().then(r => setFeatures(r.data)).catch(() => toast.error('Error cargando permisos'))
  }, [])

  const setLevel = (role, key, level) => {
    setFeatures(f => ({
      ...f,
      [role]: { ...f[role], [key]: level },
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveRoleFeatures(features)
      toast.success('Permisos guardados')
      reload()
    } catch { toast.error('Error guardando permisos') }
    finally { setSaving(false) }
  }

  if (!features) return <div className="p-6 text-center text-sm text-gray-400">Cargando permisos...</div>

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50 flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Shield size={16} className="text-violet-600" />
          <h2 className="font-semibold text-gray-800 text-sm">Acceso por rol</h2>
          <span className="hidden sm:inline text-xs text-gray-400 ml-1">El Administrador siempre tiene acceso total</span>
          <span className="text-[11px] text-gray-400 flex items-center gap-2 ml-2">
            <span className="flex items-center gap-1"><Ban size={12} className="text-gray-400" /> Sin acceso</span>
            <span className="flex items-center gap-1"><Eye size={12} className="text-blue-500" /> Lectura</span>
            <span className="flex items-center gap-1"><Pencil size={12} className="text-violet-600" /> Edición</span>
          </span>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors min-h-[36px] disabled:opacity-50"
        >
          <Save size={13} />{saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 w-full">MÓDULO</th>
              {CONFIGURABLE_ROLES.map(r => (
                <th key={r.value} className="px-4 py-3 text-center w-28">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${r.color}`}>{r.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {ROLE_FEATURE_DEFS.map(feat => (
              <tr key={feat.key} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 text-sm text-gray-700 font-medium">{feat.label}</td>
                {CONFIGURABLE_ROLES.map(r => {
                  const eligible = feat.roles.includes(r.value)
                  const level = normLevel(features[r.value]?.[feat.key]) ?? 'write'
                  return (
                    <td key={r.value} className="px-4 py-3 text-center">
                      {eligible ? (
                        <div className="flex justify-center">
                          <LevelSelect value={level} onChange={(lvl) => setLevel(r.value, feat.key, lvl)} />
                        </div>
                      ) : (
                        <span className="text-gray-200 text-lg">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Email panel ────────────────────────────────────────────────────────────
function EmailPanel({
  form, handleChange, showPassword, setShowPw, testEmail, setTestEmail,
  saving, testing, handleSave, handleTest,
  imapForm, handleImapChange, showImapPw, setShowImapPw,
  savingImap, polling, handleSaveImap, handlePollNow,
}) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <Mail size={16} className="text-blue-600" />
          <h2 className="font-semibold text-gray-800 text-sm">Envío de correo (SMTP)</h2>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-500">Las notificaciones y respuestas a tickets se enviarán desde esta cuenta.</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key de Brevo <span className="text-blue-600 font-semibold">(recomendado)</span></label>
            <input
              type="password"
              value={form.brevo_api_key || ''}
              onChange={e => handleChange('brevo_api_key', e.target.value)}
              placeholder="xkeysib-..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ fontSize: '16px' }}
            />
            <p className="text-xs text-gray-400 mt-1">Cuando está configurado, se usa Brevo API en lugar de SMTP. Los campos SMTP quedan opcionales.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Correo copia administrador (BCC)</label>
            <input
              type="email"
              value={form.admin_notification_email || ''}
              onChange={e => handleChange('admin_notification_email', e.target.value)}
              placeholder="admin@empresa.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ fontSize: '16px' }}
            />
            <p className="text-xs text-gray-400 mt-1">Recibirá una copia oculta (BCC) de todas las notificaciones enviadas a clientes y agentes.</p>
          </div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">O configurar SMTP manualmente:</p>
          {SMTP_FIELDS.map(({ key, label, placeholder, type }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <div className="relative">
                <input
                  type={key === 'smtp_password' && !showPassword ? 'password' : (type === 'password' ? 'text' : type)}
                  value={form[key] || ''}
                  onChange={e => handleChange(key, e.target.value)}
                  placeholder={placeholder}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                  style={{ fontSize: '16px' }}
                />
                {key === 'smtp_password' && (
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <input id="smtp_tls" type="checkbox" checked={form.smtp_tls === 'true'}
              onChange={e => handleChange('smtp_tls', e.target.checked ? 'true' : 'false')}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <label htmlFor="smtp_tls" className="text-sm text-gray-700">Usar STARTTLS (puerto 587)</label>
          </div>
          <div className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3 space-y-1">
            <p><strong>Gmail:</strong> smtp.gmail.com · Puerto 587 · TLS activado · Contraseña de aplicación</p>
            <p><strong>Outlook:</strong> smtp.office365.com · Puerto 587 · TLS activado</p>
          </div>
        </div>
        <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">Enviar correo de prueba</p>
          <div className="flex gap-2">
            <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)}
              placeholder="correo@destino.com"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ fontSize: '16px' }} />
            <button onClick={handleTest} disabled={testing}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium min-h-[44px] disabled:opacity-50">
              <Send size={15} />{testing ? 'Enviando...' : 'Probar'}
            </button>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-medium min-h-[44px] disabled:opacity-50">
            <Save size={15} />{saving ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <Inbox size={16} className="text-purple-600" />
          <h2 className="font-semibold text-gray-800 text-sm">Recepción de respuestas (IMAP)</h2>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-500">
            Monitorea el buzón de entrada y procesa correos automáticamente: las respuestas a tickets existentes se añaden como comentarios, y los correos nuevos pueden crear tickets automáticamente.
          </p>
          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <input id="imap_enabled" type="checkbox" checked={imapForm.imap_enabled === 'true'}
                onChange={e => handleImapChange('imap_enabled', e.target.checked ? 'true' : 'false')}
                className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500" />
              <label htmlFor="imap_enabled" className="text-sm font-medium text-gray-700">Activar recepción de correos</label>
            </div>
            <div className="flex items-center gap-3 pl-1">
              <input id="imap_create_tickets" type="checkbox" checked={imapForm.imap_create_tickets === 'true'}
                onChange={e => handleImapChange('imap_create_tickets', e.target.checked ? 'true' : 'false')}
                disabled={imapForm.imap_enabled !== 'true'}
                className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 disabled:opacity-40" />
              <label htmlFor="imap_create_tickets" className={`text-sm text-gray-700 ${imapForm.imap_enabled !== 'true' ? 'opacity-40' : 'font-medium'}`}>
                Crear ticket automáticamente desde correos nuevos
              </label>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { key: 'imap_host', label: 'Servidor IMAP', placeholder: 'imap.gmail.com', type: 'text' },
              { key: 'imap_port', label: 'Puerto', placeholder: '993', type: 'number' },
              { key: 'imap_user', label: 'Usuario / Correo', placeholder: 'soporte@empresa.com', type: 'text' },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <input type={type} value={imapForm[key]} onChange={e => handleImapChange(key, e.target.value)}
                  placeholder={placeholder}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  style={{ fontSize: '16px' }} />
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
              <div className="relative">
                <input type={showImapPw ? 'text' : 'password'} value={imapForm.imap_password}
                  onChange={e => handleImapChange('imap_password', e.target.value)} placeholder="••••••••"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 pr-10"
                  style={{ fontSize: '16px' }} />
                <button type="button" onClick={() => setShowImapPw(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showImapPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Intervalo de revisión (segundos)</label>
              <input type="number" value={imapForm.imap_poll_interval}
                onChange={e => handleImapChange('imap_poll_interval', e.target.value)} placeholder="120"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                style={{ fontSize: '16px' }} />
            </div>
            <div className="flex items-end">
              <div className="flex items-center gap-3 pb-1">
                <input id="imap_ssl" type="checkbox" checked={imapForm.imap_ssl === 'true'}
                  onChange={e => handleImapChange('imap_ssl', e.target.checked ? 'true' : 'false')}
                  className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500" />
                <label htmlFor="imap_ssl" className="text-sm text-gray-700">Usar SSL (puerto 993)</label>
              </div>
            </div>
          </div>
          <div className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3 space-y-1">
            <p><strong>Importante:</strong> Este correo se usará como <strong>Reply-To</strong> en todas las notificaciones al cliente.</p>
            <p><strong>Gmail:</strong> imap.gmail.com · Puerto 993 · SSL activado · Contraseña de aplicación</p>
          </div>
        </div>
        <div className="px-5 pb-5 border-t border-gray-100 pt-4 flex flex-wrap gap-3">
          <button onClick={handleSaveImap} disabled={savingImap}
            className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-medium min-h-[44px] disabled:opacity-50">
            <Save size={15} />{savingImap ? 'Guardando...' : 'Guardar configuración IMAP'}
          </button>
          <button onClick={handlePollNow} disabled={polling}
            className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium min-h-[44px] disabled:opacity-50">
            <RefreshCw size={15} className={polling ? 'animate-spin' : ''} />
            {polling ? 'Verificando...' : 'Verificar buzón ahora'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Date & Time panel ──────────────────────────────────────────────────────
function DateTimePanel({ fmtForm, setFmtForm, savingFmt, handleSaveFmt }) {
  return (
    <div className="animate-fade-in">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <Globe size={16} className="text-indigo-600" />
          <h2 className="font-semibold text-gray-800 text-sm">Zona horaria y formato de fecha/hora</h2>
        </div>
        <div className="p-5 space-y-5">
          <p className="text-sm text-gray-500">Se aplican en todo el sistema: tickets, agenda, facturas, órdenes y reportes.</p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Zona horaria</label>
            <select value={fmtForm.tz} onChange={e => setFmtForm(f => ({ ...f, tz: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }}>
              {TIMEZONES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Formato de fecha</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DATE_FORMATS.map(({ value, label, example }) => (
                <label key={value}
                  className={`flex flex-col items-center justify-center border rounded-lg p-3 cursor-pointer transition-colors text-center gap-1
                    ${fmtForm.date_format === value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}>
                  <input type="radio" name="date_format" value={value} checked={fmtForm.date_format === value}
                    onChange={() => setFmtForm(f => ({ ...f, date_format: value }))} className="sr-only" />
                  <span className="text-xs font-semibold">{label}</span>
                  <span className="text-xs text-gray-400">{example}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Formato de hora</label>
            <div className="flex gap-3">
              {[{ value: '12h', label: '12 horas', example: '10:30 AM' }, { value: '24h', label: '24 horas', example: '22:30' }].map(({ value, label, example }) => (
                <label key={value}
                  className={`flex items-center gap-3 flex-1 border rounded-lg px-4 py-3 cursor-pointer transition-colors
                    ${fmtForm.time_format === value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}>
                  <input type="radio" name="time_format" value={value} checked={fmtForm.time_format === value}
                    onChange={() => setFmtForm(f => ({ ...f, time_format: value }))} className="w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500" />
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-gray-400">{example}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="text-xs text-gray-400 bg-indigo-50 border border-indigo-100 rounded-lg p-3 flex items-center gap-2">
            <Clock size={12} className="flex-shrink-0" />
            Al guardar se recargará la página para aplicar los cambios en todo el sistema.
          </div>
        </div>
        <div className="px-5 pb-5">
          <button onClick={handleSaveFmt} disabled={savingFmt}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium min-h-[44px] disabled:opacity-50">
            <Save size={15} />{savingFmt ? 'Guardando...' : 'Guardar formato'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Branding panel ─────────────────────────────────────────────────────────
function AssetUploader({ label, hint, hasAsset, assetUrl, onUpload, onDelete, accept = 'image/png,image/jpeg,image/webp,image/x-icon,image/svg+xml', previewClass = 'w-20 h-20' }) {
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(0)
  const ref = useRef(null)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast.error('Archivo demasiado grande (máx 2 MB)'); return }
    setBusy(true)
    try {
      await onUpload(file)
      setKey(k => k + 1)
      toast.success(`${label} actualizado`)
    } catch { toast.error(`Error subiendo ${label.toLowerCase()}`) }
    finally { setBusy(false); e.target.value = '' }
  }

  const handleDel = async () => {
    try { await onDelete(); setKey(k => k + 1); toast.success(`${label} eliminado`) }
    catch { toast.error(`Error eliminando ${label.toLowerCase()}`) }
  }

  return (
    <div className="flex items-center gap-5">
      <div className={`${previewClass} rounded-xl border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center flex-shrink-0`}>
        {hasAsset
          ? <img key={key} src={`${assetUrl()}?v=${key}`} alt={label} className="w-full h-full object-contain p-1" />
          : <Image size={20} className="text-gray-300" />}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs text-gray-500">{hint}</p>
        <div className="flex gap-2 flex-wrap">
          <input ref={ref} type="file" accept={accept} className="hidden" onChange={handleFile} />
          <button onClick={() => ref.current?.click()} disabled={busy}
            className="text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition disabled:opacity-50">
            {busy ? 'Subiendo...' : `Subir ${label.toLowerCase()}`}
          </button>
          {hasAsset && (
            <button onClick={handleDel} className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition">
              Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function BrandingPanel({ coForm, setCoForm, savingCo, handleSaveCo }) {
  const [assets, setAssets] = useState({ has_logo: false, has_favicon: false, has_pwa_icon: false })

  useEffect(() => {
    getCompanySettings().then(r => setAssets({ has_logo: !!r.data.has_logo, has_favicon: !!r.data.has_favicon, has_pwa_icon: !!r.data.has_pwa_icon })).catch(() => {})
  }, [])

  const fld = (key) => ({ value: coForm[key] || '', onChange: (e) => setCoForm(f => ({ ...f, [key]: e.target.value })) })

  const section = (title, icon, children) => (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
        {icon}
        <h2 className="font-semibold text-gray-800 text-sm">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )

  return (
    <div className="animate-fade-in space-y-4">
      {/* Imágenes */}
      {section('Imágenes de marca', <Image size={16} className="text-purple-600" />,
        <div className="space-y-5">
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Logo de la empresa</p>
            <p className="text-xs text-gray-500 mb-3">Aparece en el sidebar, PDFs, notas de despacho y correos. PNG/JPG/WebP · máx 2 MB</p>
            <AssetUploader label="Logo" hint="" hasAsset={assets.has_logo} assetUrl={companyLogoUrl}
              onUpload={async (f) => { await uploadCompanyLogo(f); setAssets(a => ({ ...a, has_logo: true })) }}
              onDelete={async () => { await deleteCompanyLogo(); setAssets(a => ({ ...a, has_logo: false })) }} />
          </div>
          <hr className="border-gray-100" />
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Favicon</p>
            <p className="text-xs text-gray-500 mb-3">Ícono en la pestaña del navegador. PNG, ICO o SVG · máx 1 MB · recomendado 32×32 px</p>
            <AssetUploader label="Favicon" hint="" hasAsset={assets.has_favicon} assetUrl={faviconUrl}
              previewClass="w-10 h-10"
              accept="image/png,image/x-icon,image/svg+xml"
              onUpload={async (f) => {
                await uploadFavicon(f)
                setAssets(a => ({ ...a, has_favicon: true }))
                const v = Date.now()
                ;['icon', 'shortcut icon'].forEach(rel => {
                  let link = document.querySelector(`link[rel="${rel}"]`)
                  if (!link) { link = document.createElement('link'); link.rel = rel; document.head.appendChild(link) }
                  link.href = `/api/settings/favicon?v=${v}`
                })
              }}
              onDelete={async () => {
                await deleteFavicon()
                setAssets(a => ({ ...a, has_favicon: false }))
                ;['icon', 'shortcut icon'].forEach(rel => {
                  const link = document.querySelector(`link[rel="${rel}"]`)
                  if (link) link.href = `/api/settings/favicon?v=${Date.now()}`
                })
              }} />
          </div>
          <hr className="border-gray-100" />
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Ícono PWA</p>
            <p className="text-xs text-gray-500 mb-3">Ícono de la app al instalarla en el dispositivo. PNG · recomendado 512×512 px</p>
            <AssetUploader label="Ícono PWA" hint="" hasAsset={assets.has_pwa_icon} assetUrl={pwaIconUrl}
              accept="image/png,image/jpeg,image/webp"
              onUpload={async (f) => { await uploadPwaIcon(f); setAssets(a => ({ ...a, has_pwa_icon: true })) }}
              onDelete={async () => { await deletePwaIcon(); setAssets(a => ({ ...a, has_pwa_icon: false })) }} />
          </div>
        </div>
      )}

      {/* Nombre de la aplicación */}
      {section('Nombre de la aplicación', <Palette size={16} className="text-purple-600" />,
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Título mostrado en la pestaña del navegador y en el acceso directo de la PWA.</p>
          <div>
            <label className="label">Nombre de la app</label>
            <input className="input" style={{ fontSize: '16px' }} {...fld('company_app_name')} placeholder="Mi CRM" />
          </div>
          <button onClick={handleSaveCo} disabled={savingCo} className="btn-primary flex items-center gap-2">
            <Save size={14} />{savingCo ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      )}

      {/* Colores */}
      {section('Colores del sistema', <Palette size={16} className="text-purple-600" />,
        <div className="space-y-4">
          <p className="text-xs text-gray-500">Los cambios de color se aplican tras recargar la página.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Color del sidebar</label>
              <div className="flex items-center gap-3 mt-1">
                <input type="color" value={coForm.company_sidebar_color || '#1a3353'} onChange={e => setCoForm(f => ({ ...f, company_sidebar_color: e.target.value }))}
                  className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
                <input className="input flex-1" value={coForm.company_sidebar_color || '#1a3353'} onChange={e => setCoForm(f => ({ ...f, company_sidebar_color: e.target.value }))}
                  placeholder="#1a3353" maxLength={7} />
              </div>
              <div className="mt-2 h-8 rounded-lg border border-gray-200" style={{ background: coForm.company_sidebar_color || '#1a3353' }} />
            </div>
            <div>
              <label className="label">Color de acento</label>
              <div className="flex items-center gap-3 mt-1">
                <input type="color" value={coForm.company_accent_color || '#3b82f6'} onChange={e => setCoForm(f => ({ ...f, company_accent_color: e.target.value }))}
                  className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
                <input className="input flex-1" value={coForm.company_accent_color || '#3b82f6'} onChange={e => setCoForm(f => ({ ...f, company_accent_color: e.target.value }))}
                  placeholder="#3b82f6" maxLength={7} />
              </div>
              <div className="mt-2 h-8 rounded-lg border border-gray-200" style={{ background: coForm.company_accent_color || '#3b82f6' }} />
            </div>
          </div>
          <button onClick={handleSaveCo} disabled={savingCo} className="btn-primary flex items-center gap-2">
            <Save size={14} />{savingCo ? 'Guardando...' : 'Guardar colores'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Notifications panel ────────────────────────────────────────────────────
function CompanyPanel({ coForm, setCoForm, savingCo, handleSaveCo }) {
  const [hasLogo, setHasLogo] = useState(false)
  const [logoKey, setLogoKey] = useState(0)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoInputRef = useRef(null)

  useEffect(() => {
    getCompanySettings().then(r => setHasLogo(!!r.data.has_logo)).catch(() => {})
  }, [])

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast.error('Logo demasiado grande (máx 2 MB)'); return }
    setUploadingLogo(true)
    try {
      await uploadCompanyLogo(file)
      setHasLogo(true)
      setLogoKey(k => k + 1)
      toast.success('Logo actualizado')
    } catch { toast.error('Error subiendo logo') }
    finally { setUploadingLogo(false); e.target.value = '' }
  }

  const handleLogoDelete = async () => {
    try {
      await deleteCompanyLogo()
      setHasLogo(false)
      setLogoKey(k => k + 1)
      toast.success('Logo eliminado')
    } catch { toast.error('Error eliminando logo') }
  }

  const fld = (key) => ({
    value: coForm[key] || '',
    onChange: (e) => setCoForm((f) => ({ ...f, [key]: e.target.value })),
  })
  return (
    <div className="animate-fade-in space-y-4">
      {/* Logo de empresa */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <Building2 size={16} className="text-teal-600" />
          <h2 className="font-semibold text-gray-800 text-sm">Logo de la empresa</h2>
        </div>
        <div className="p-5 flex items-center gap-5">
          <div className="w-20 h-20 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center flex-shrink-0">
            {hasLogo
              ? <img key={logoKey} src={`${companyLogoUrl()}?v=${logoKey}`} alt="Logo" className="w-full h-full object-contain p-1" />
              : <span className="text-xs text-gray-400 text-center px-2">Sin logo</span>
            }
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-500">PNG, JPG o WebP · máx 2 MB<br/>Aparece en la pantalla de login y documentos</p>
            <div className="flex gap-2">
              <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoUpload} />
              <button onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1">
                {uploadingLogo ? 'Subiendo...' : 'Subir logo'}
              </button>
              {hasLogo && (
                <button onClick={handleLogoDelete} className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition">
                  Eliminar
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Datos de empresa */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <Building2 size={16} className="text-teal-600" />
          <h2 className="font-semibold text-gray-800 text-sm">Datos de la empresa</h2>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-500">Estos datos aparecen en el encabezado de cartas, cotizaciones, facturas y correos enviados desde el sistema.</p>
          <div>
            <label className="label">Nombre de la empresa *</label>
            <input className="input" style={{ fontSize: '16px' }} {...fld('company_name')} placeholder="Service Desk" />
          </div>
          <div>
            <label className="label">Dirección</label>
            <input className="input" style={{ fontSize: '16px' }} {...fld('company_address')} placeholder="Panamá, Punta Pacífica, PH Pacific Wind" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">RUC</label>
              <input className="input" style={{ fontSize: '16px' }} {...fld('company_ruc')} placeholder="4-754-575 DV 85" />
            </div>
            <div>
              <label className="label">Teléfono</label>
              <input className="input" style={{ fontSize: '16px' }} {...fld('company_phone')} inputMode="tel" placeholder="+507 0000-0000" />
            </div>
          </div>
          <div>
            <label className="label">Email de la empresa</label>
            <input type="email" className="input" style={{ fontSize: '16px' }} {...fld('company_email')} placeholder="info@empresa.com" />
          </div>
          <button onClick={handleSaveCo} disabled={savingCo} className="btn-primary flex items-center gap-2">
            <Save size={14} />{savingCo ? 'Guardando...' : 'Guardar datos'}
          </button>
        </div>
      </div>
    </div>
  )
}

function NotificationsPanel() {
  return (
    <div className="animate-fade-in">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <MessageCircle size={16} className="text-green-600" />
          <h2 className="font-semibold text-gray-800 text-sm">WhatsApp</h2>
        </div>
        <div className="p-5 space-y-3 text-sm text-gray-600">
          <p>El sistema genera un enlace de WhatsApp para contactar al cliente directamente desde el ticket, usando el número registrado en su perfil.</p>
          <p>Para activarlo, asegúrate de que cada cliente tenga su número de teléfono registrado en <strong>Configuración → Usuarios → editar usuario</strong>.</p>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-800">
            <p className="font-medium mb-1">Cómo funciona</p>
            <p>Al abrir un ticket, si el cliente tiene número de teléfono, aparecerá un botón de WhatsApp que abre una conversación directa con un mensaje predefinido sobre el ticket.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Client Categories Panel ────────────────────────────────────────────────
const CAT_COLORS = [
  '#6B7280','#3B82F6','#8B5CF6','#EC4899','#EF4444','#F97316',
  '#EAB308','#22C55E','#14B8A6','#06B6D4','#6366F1','#F59E0B',
]

const EMPTY_CAT = { name: '', color: '#6B7280', description: '', order: 0 }

function ClientCategoriesPanel() {
  const [cats, setCats]       = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm]       = useState(EMPTY_CAT)
  const [saving, setSaving]   = useState(false)

  const fetchCats = () =>
    getClientCategories()
      .then(r => setCats(r.data))
      .catch(() => toast.error('Error cargando categorías'))
      .finally(() => setLoading(false))

  useEffect(() => { fetchCats() }, [])

  const openCreate = () => { setEditing(null); setForm(EMPTY_CAT); setShowForm(true) }
  const openEdit   = (c) => { setEditing(c); setForm({ name: c.name, color: c.color, description: c.description || '', order: c.order }); setShowForm(true) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Ingresa un nombre')
    setSaving(true)
    try {
      const payload = { ...form, order: Number(form.order) || 0 }
      if (editing) { await updateClientCategory(editing.id, payload); toast.success('Categoría actualizada') }
      else          { await createClientCategory(payload);             toast.success('Categoría creada') }
      setShowForm(false)
      fetchCats()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error guardando') }
    finally { setSaving(false) }
  }

  const handleDelete = async (c) => {
    if (!await showConfirm(`¿Eliminar la categoría "${c.name}"?`)) return
    try { await deleteClientCategory(c.id); toast.success('Categoría eliminada'); fetchCats() }
    catch (err) { toast.error(err.response?.data?.detail || 'Error al eliminar') }
  }

  const toggleActive = async (c) => {
    try {
      await updateClientCategory(c.id, { is_active: !c.is_active })
      setCats(prev => prev.map(x => x.id === c.id ? { ...x, is_active: !c.is_active } : x))
    } catch { toast.error('Error') }
  }

  return (
    <div className="animate-fade-in">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Tag size={16} className="text-amber-600" />
            <h2 className="font-semibold text-gray-800 text-sm">Categorías de clientes</h2>
            <span className="text-xs text-gray-400 ml-1">({cats.length} categorías)</span>
          </div>
          <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors min-h-[36px]">
            <Plus size={14} /> Nueva categoría
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
        ) : cats.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            <Tag size={32} className="mx-auto mb-2 text-gray-200" />
            <p>Aún no hay categorías. Crea la primera ahora.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {cats.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{c.name}</span>
                    {!c.is_active && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Inactivo</span>}
                  </div>
                  {c.description && <p className="text-xs text-gray-400 truncate">{c.description}</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggleActive(c)} title={c.is_active ? 'Desactivar' : 'Activar'}
                    className={`p-1.5 rounded text-xs transition-colors ${c.is_active ? 'hover:bg-gray-200 text-gray-400' : 'hover:bg-green-100 text-gray-300 hover:text-green-600'}`}>
                    <Check size={14} />
                  </button>
                  <button onClick={() => openEdit(c)} className="p-1.5 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-700 transition-colors">
                    <Edit size={14} />
                  </button>
                  <button onClick={() => handleDelete(c)} className="p-1.5 hover:bg-red-100 rounded text-gray-300 hover:text-red-600 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-semibold text-gray-900">{editing ? 'Editar categoría' : 'Nueva categoría'}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="label">Nombre *</label>
                <input className="input" style={{ fontSize: '16px' }} value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Premium, Estándar, VIP..." required />
              </div>
              <div>
                <label className="label">Descripción</label>
                <input className="input" style={{ fontSize: '16px' }} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Descripción breve (opcional)" />
              </div>
              <div>
                <label className="label">Color</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {CAT_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                  <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    className="w-7 h-7 rounded-full border border-gray-300 cursor-pointer overflow-hidden p-0" title="Color personalizado" />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: form.color }}>
                    {form.name || 'Vista previa'}
                  </span>
                  <span className="text-xs text-gray-400">Vista previa</span>
                </div>
              </div>
              <div>
                <label className="label">Orden</label>
                <input type="number" className="input" style={{ fontSize: '16px' }} value={form.order}
                  onChange={e => setForm(f => ({ ...f, order: e.target.value }))} placeholder="0" min="0" />
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  <Save size={14} />{saving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Canned Responses Panel ─────────────────────────────────────────────────
function CannedPanel() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ title: '', content: '', category: '' })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const load = () => {
    setLoading(true)
    getCannedResponses().then(r => setItems(r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openCreate = () => { setEditing(null); setForm({ title: '', content: '', category: '' }); setShowForm(true) }
  const openEdit = (item) => { setEditing(item); setForm({ title: item.title, content: item.content, category: item.category || '' }); setShowForm(true) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.content.trim()) { toast.error('Título y contenido son obligatorios'); return }
    setSaving(true)
    try {
      if (editing) await updateCannedResponse(editing.id, form)
      else await createCannedResponse(form)
      toast.success(editing ? 'Respuesta actualizada' : 'Respuesta creada')
      setShowForm(false)
      load()
    } catch {
      toast.error('Error guardando respuesta')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (item) => {
    if (!await showConfirm(`¿Eliminar "${item.title}"?`)) return
    try {
      await deleteCannedResponse(item.id)
      toast.success('Respuesta eliminada')
      load()
    } catch {
      toast.error('Error eliminando')
    }
  }

  const filtered = search ? items.filter(i => i.title.toLowerCase().includes(search.toLowerCase()) || (i.category || '').toLowerCase().includes(search.toLowerCase())) : items

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-purple-600" />
          <h2 className="font-semibold text-gray-800 text-sm">Respuestas predefinidas</h2>
          <span className="text-xs text-gray-400 ml-1">({items.length})</span>
        </div>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors min-h-[36px]">
          <Plus size={14} /> Nueva respuesta
        </button>
      </div>
      {items.length > 4 && (
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9 text-sm" placeholder="Buscar respuestas..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      )}
      {loading ? (
        <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-gray-400 text-sm">
          <Zap size={32} className="mx-auto mb-2 text-gray-200" />
          <p>Sin respuestas predefinidas</p>
          <p className="text-xs mt-1">Crea plantillas para responder tickets más rápido</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {filtered.map(item => (
            <div key={item.id} className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50 group">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                  {item.category && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700">{item.category}</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 line-clamp-2">{item.content}</p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button onClick={() => openEdit(item)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                  <Edit size={14} />
                </button>
                <button onClick={() => handleDelete(item)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
              <h3 className="font-semibold text-gray-900">{editing ? 'Editar respuesta' : 'Nueva respuesta'}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto">
              <div className="p-5 space-y-4">
                <div>
                  <label className="label">Título *</label>
                  <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Ej: Saludos iniciales" style={{ fontSize: '16px' }} autoFocus={!editing} />
                </div>
                <div>
                  <label className="label">Categoría</label>
                  <input className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="Ej: Saludos, Cierre, Técnico..." style={{ fontSize: '16px' }} />
                </div>
                <div>
                  <label className="label">Contenido *</label>
                  <textarea className="input resize-none" rows={6} value={form.content}
                    onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                    placeholder="Escribe el texto de la respuesta..." style={{ fontSize: '16px' }} />
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-100 flex-shrink-0">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  <Save size={14} />{saving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SLA Panel ──────────────────────────────────────────────────────────────
const SLA_PRIORITIES = [
  { key: 'sla_critical', label: 'Crítico',  color: 'text-red-600',    badge: 'bg-red-100 text-red-700' },
  { key: 'sla_high',     label: 'Alto',     color: 'text-orange-600', badge: 'bg-orange-100 text-orange-700' },
  { key: 'sla_medium',   label: 'Medio',    color: 'text-yellow-600', badge: 'bg-yellow-100 text-yellow-700' },
  { key: 'sla_low',      label: 'Bajo',     color: 'text-gray-500',   badge: 'bg-gray-100 text-gray-600' },
]
const SLA_DEFAULTS_MINUTES = { sla_critical: 240, sla_high: 540, sla_medium: 1620, sla_low: 2700 }

function minutesToHours(m) { return +(m / 60).toFixed(2) }
function hoursToMinutes(h) { return Math.max(1, Math.round(parseFloat(h) * 60)) }

function SlaPanel() {
  const [form, setForm]   = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSlaSettings()
      .then(r => {
        const mins = { ...SLA_DEFAULTS_MINUTES, ...r.data }
        setForm(Object.fromEntries(Object.keys(mins).map(k => [k, minutesToHours(mins[k])])))
      })
      .catch(() => toast.error('Error cargando SLA'))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const minutes = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, hoursToMinutes(v)]))
      await saveSlaSettings(minutes)
      toast.success('SLA guardado')
    } catch { toast.error('Error al guardar SLA') }
    finally { setSaving(false) }
  }

  if (!form) return <div className="p-6 text-center text-sm text-gray-400">Cargando...</div>

  return (
    <div className="animate-fade-in">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <Timer size={16} className="text-cyan-600" />
          <h2 className="font-semibold text-gray-800 text-sm">SLA por prioridad</h2>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-500">Tiempo máximo de respuesta en <strong>horas hábiles</strong> (lunes a viernes, 8 AM–5 PM) por nivel de prioridad.</p>
          {SLA_PRIORITIES.map(({ key, label, badge }) => (
            <div key={key} className="flex items-center gap-4">
              <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold w-20 justify-center flex-shrink-0 ${badge}`}>{label}</span>
              <div className="flex-1 relative">
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="input w-full pr-14"
                  style={{ fontSize: '16px' }}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">horas</span>
              </div>
              <span className="text-xs text-gray-400 w-24 text-right flex-shrink-0">
                = {hoursToMinutes(form[key])} min
              </span>
            </div>
          ))}
          <div className="text-xs text-gray-400 bg-cyan-50 border border-cyan-100 rounded-lg p-3 flex items-center gap-2">
            <Timer size={12} className="flex-shrink-0 text-cyan-500" />
            Los cambios aplican a tickets creados a partir de este momento. Los tickets existentes conservan su SLA original.
          </div>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium min-h-[44px] disabled:opacity-50">
            <Save size={14} />{saving ? 'Guardando...' : 'Guardar SLA'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Audit Panel ────────────────────────────────────────────────────────────
export function AuditPanel() {
  const [rows, setRows]       = React.useState([])
  const [total, setTotal]     = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [offset, setOffset]   = React.useState(0)
  const LIMIT = 50

  const [filters, setFilters] = React.useState({
    entity_type: '', action: '', q: '', date_from: '', date_to: '',
  })

  const ACTION_LABELS = {
    create: 'Creación', update: 'Modificación', delete: 'Eliminación',
    restore: 'Restauración', permanent_delete: 'Elim. permanente', login: 'Inicio de sesión',
  }
  const ACTION_COLORS = {
    create: 'bg-green-100 text-green-700', update: 'bg-blue-100 text-blue-700',
    delete: 'bg-red-100 text-red-700', restore: 'bg-yellow-100 text-yellow-700',
    permanent_delete: 'bg-red-200 text-red-800', login: 'bg-gray-100 text-gray-600',
  }
  const ENTITY_LABELS = {
    ticket: 'Ticket', factura: 'Factura', cotizacion: 'Cotización',
    gasto: 'Gasto', contacto: 'Contacto', empresa: 'Empresa',
    pedido: 'Pedido', usuario: 'Usuario',
  }

  const load = async (off = 0) => {
    setLoading(true)
    try {
      const params = { limit: LIMIT, offset: off, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }
      const { data } = await getAuditLog(params)
      setRows(data.items)
      setTotal(data.total)
      setOffset(off)
    } catch { toast.error('Error al cargar auditoría') }
    finally { setLoading(false) }
  }

  React.useEffect(() => { load(0) }, [])

  const fmt = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('es-PA', { dateStyle: 'short', timeStyle: 'short' })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
        <Activity size={16} className="text-rose-600" />
        <h2 className="font-semibold text-gray-800 text-sm">Auditoría del sistema</h2>
        <span className="ml-auto text-xs text-gray-400">{total} registros</span>
      </div>

      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-2 items-end">
        <input
          type="text"
          placeholder="Buscar usuario o nombre..."
          value={filters.q}
          onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200 w-44"
        />
        <select
          value={filters.entity_type}
          onChange={e => setFilters(f => ({ ...f, entity_type: e.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
        >
          <option value="">Todos los módulos</option>
          {Object.entries(ENTITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select
          value={filters.action}
          onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
        >
          <option value="">Todas las acciones</option>
          {Object.entries(ACTION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="date" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200" />
        <input type="date" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200" />
        <button onClick={() => load(0)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-sm hover:bg-rose-700 transition-colors">
          <Filter size={13} /> Filtrar
        </button>
        <button onClick={() => { setFilters({ entity_type: '', action: '', q: '', date_from: '', date_to: '' }); setTimeout(() => load(0), 50) }}
          className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors">
          Limpiar
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fecha</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Usuario</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Acción</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Módulo</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Elemento</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin registros</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{fmt(r.created_at)}</td>
                <td className="px-4 py-2.5 font-medium text-gray-800">{r.user_name}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[r.action] || 'bg-gray-100 text-gray-600'}`}>
                    {ACTION_LABELS[r.action] || r.action}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-600">{ENTITY_LABELS[r.entity_type] || r.entity_type}</td>
                <td className="px-4 py-2.5 text-gray-700">{r.entity_name || `#${r.entity_id}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > LIMIT && (
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
          <span>Mostrando {offset + 1}–{Math.min(offset + LIMIT, total)} de {total}</span>
          <div className="flex gap-2">
            <button disabled={offset === 0} onClick={() => load(offset - LIMIT)}
              className="px-3 py-1 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors">
              Anterior
            </button>
            <button disabled={offset + LIMIT >= total} onClick={() => load(offset + LIMIT)}
              className="px-3 py-1 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors">
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
