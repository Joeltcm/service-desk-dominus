import React, { useEffect, useState } from 'react'
import { Settings2, Save, ToggleLeft, ToggleRight, Shield, Clock, Users, ScrollText, CreditCard, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { getSystemModules, updateSystemModules, getTrialConfig, updateTrial, getMaxUsers, setMaxUsers, getBillingConfig, confirmBillingPayment } from '../services/api'
import { useModules } from '../context/ModulesContext'
import { useCompany } from '../context/CompanyContext'
import { RoleFeaturesPanel, AuditPanel } from './Settings'

// En vertical 'it_support' el grupo de impresión se presenta como "Equipos"
// (el módulo 'impresoras' habilita la sección de Equipos).
function verticalizeGroups(groups, itMode) {
  if (!itMode) return groups
  return groups.map(g => ({
    ...g,
    group: g.group === 'MPS / Impresión' ? 'Equipos / Soporte' : g.group,
    items: g.items.map(it => {
      if (it.key === 'impresoras') return { ...it, label: 'Equipos', desc: 'Gestión de equipos en campo (impresoras, PC, redes, portátiles…)' }
      if (it.key === 'contratos')  return { ...it, desc: 'Contratos de servicio y soporte técnico' }
      if (it.key === 'suministros') return { ...it, desc: 'Stock de repuestos y suministros' }
      return it
    }),
  }))
}

const MODULE_GROUPS = [
  {
    group: 'Servicio',
    items: [
      { key: 'tickets',             label: 'Tickets',                  desc: 'Sistema principal de soporte y seguimiento' },
      { key: 'agenda',              label: 'Agenda',                   desc: 'Calendario, visitas y programación' },
      { key: 'proyectos',           label: 'Proyectos',                desc: 'Gestión de proyectos y pesos de tickets' },
      { key: 'dashboard_servicios', label: 'Dashboard',                 desc: 'Panel de métricas de soporte' },
      { key: 'reportes',            label: 'Reportes',                 desc: 'Informes y estadísticas' },
      { key: 'knowledge_base',      label: 'Base de Conocimientos',    desc: 'Artículos y documentación interna' },
    ],
  },
  {
    group: 'Comercial',
    items: [
      { key: 'contactos',       label: 'Contactos',              desc: 'Directorio de contactos y empresas' },
      { key: 'oportunidades',   label: 'Oportunidades',          desc: 'Pipeline de ventas y seguimiento comercial' },
      { key: 'cotizaciones',    label: 'Cotizaciones',           desc: 'Generación y gestión de cotizaciones' },
      { key: 'pedidos',         label: 'Pedidos',                desc: 'Pedidos de clientes y control de entregas' },
      { key: 'facturas',        label: 'Facturas / Pagos / CxC', desc: 'Facturación, pagos y cuentas por cobrar' },
      { key: 'gastos',          label: 'Gastos / CxP',           desc: 'Control de gastos y cuentas por pagar' },
      { key: 'inventario',      label: 'Inventario',             desc: 'Control de stock e inventario' },
      { key: 'proveedores',     label: 'Proveedores',            desc: 'Directorio de proveedores' },
      { key: 'garantias',       label: 'Garantías',              desc: 'Gestión de garantías de productos' },
      { key: 'licencias',       label: 'Licencias Software',     desc: 'Control de licencias y renovaciones' },
      { key: 'dashboard_ventas',label: 'Dashboard Ventas',       desc: 'Panel de métricas comerciales' },
    ],
  },
  {
    group: 'MPS / Impresión',
    items: [
      { key: 'contratos',   label: 'Contratos',          desc: 'Contratos de servicio MPS y soporte' },
      { key: 'impresoras',  label: 'Flota (Impresoras)', desc: 'Gestión de flota de impresoras en campo' },
      { key: 'suministros', label: 'Suministros',         desc: 'Stock de tóner y suministros MPS' },
    ],
  },
  {
    group: 'Documentos',
    items: [
      { key: 'cartas', label: 'Cartas', desc: 'Generación de cartas y documentos formales' },
    ],
  },
  {
    group: 'Integraciones',
    items: [
      { key: 'google_calendar', label: 'Google Calendar', desc: 'Conexión y sincronización con Google Calendar. Si se desactiva, la agenda sigue funcionando de forma interna (sin crear eventos en Google).' },
    ],
  },
]

export default function SystemConfig() {
  const [modules, setModulesLocal] = useState(null)
  const [saving, setSaving] = useState(false)
  const { setModules: setGlobalModules } = useModules()
  const { vertical } = useCompany()
  const groups = verticalizeGroups(MODULE_GROUPS, vertical === 'it_support')

  const [trial, setTrial] = useState({ enabled: false, start_date: null, days: 14 })
  const [trialSaving, setTrialSaving] = useState(false)

  const [userLimit, setUserLimit] = useState({ max_users: 0, staff_count: 0 })
  const [limitSaving, setLimitSaving] = useState(false)

  const [billing, setBilling] = useState(null)
  const [billingConfirming, setBillingConfirming] = useState(false)

  useEffect(() => {
    getSystemModules().then(r => setModulesLocal(r.data)).catch(() => toast.error('Error cargando configuración'))
    getTrialConfig().then(r => setTrial(r.data)).catch(() => {})
    getMaxUsers().then(r => setUserLimit(r.data)).catch(() => {})
    getBillingConfig().then(r => setBilling(r.data)).catch(() => {})
  }, [])

  const handleConfirmPayment = async () => {
    setBillingConfirming(true)
    try {
      const r = await confirmBillingPayment()
      setBilling(r.data)
      toast.success('Pago confirmado. Plazo reiniciado.')
    } catch {
      toast.error('Error al confirmar el pago')
    } finally {
      setBillingConfirming(false)
    }
  }

  const fmtDate = (iso) => {
    if (!iso) return '—'
    try {
      return new Date(String(iso).slice(0, 10) + 'T12:00:00')
        .toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })
    } catch { return '—' }
  }

  const BILLING_UI = {
    al_dia:     { label: 'Al día',     cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    aviso:      { label: 'En aviso',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    suspendido: { label: 'Suspendido', cls: 'bg-red-50 text-red-700 border-red-200' },
  }

  const handleLimitSave = async () => {
    setLimitSaving(true)
    try {
      const r = await setMaxUsers(Number(userLimit.max_users) || 0)
      setUserLimit(r.data)
      toast.success('Límite de usuarios guardado')
    } catch {
      toast.error('Error al guardar el límite de usuarios')
    } finally {
      setLimitSaving(false)
    }
  }

  const toggle = (key) => {
    setModulesLocal(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleTrialSave = async () => {
    setTrialSaving(true)
    try {
      const r = await updateTrial(trial)
      setTrial(r.data)
      toast.success('Configuración de prueba guardada')
    } catch {
      toast.error('Error al guardar período de prueba')
    } finally {
      setTrialSaving(false)
    }
  }

  const trialEndDate = () => {
    if (!trial.start_date) return null
    const d = new Date(trial.start_date + 'T12:00:00')
    d.setDate(d.getDate() + Number(trial.days))
    return d
  }

  const trialDaysRemaining = () => {
    const end = trialEndDate()
    if (!end) return null
    return Math.ceil((end - new Date()) / 86400000)
  }

  const handleSave = async () => {
    if (!modules) return
    setSaving(true)
    try {
      const r = await updateSystemModules(modules)
      setModulesLocal(r.data)
      setGlobalModules(r.data)
      toast.success('Configuración de módulos guardada')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (!modules) {
    return <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
  }

  const enabledCount = Object.values(modules).filter(Boolean).length
  const total = Object.keys(modules).length

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 md:pr-14 lg:pr-28">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Settings2 size={18} className="text-violet-500" /> Configuración del sistema
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Controla qué módulos son visibles en esta instalación. {enabledCount}/{total} habilitados.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2 disabled:opacity-50"
        >
          <Save size={14} />
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>

      {groups.map(({ group, items }) => (
        <div key={group} className="card space-y-1">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">{group}</h2>
          {items.map(({ key, label, desc }) => {
            const on = !!modules[key]
            return (
              <button
                key={key}
                onClick={() => toggle(key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left ${on ? 'bg-violet-50 hover:bg-violet-100' : 'hover:bg-gray-50'}`}
              >
                {on
                  ? <ToggleRight size={22} className="text-violet-500 flex-shrink-0" />
                  : <ToggleLeft size={22} className="text-gray-300 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${on ? 'text-violet-900' : 'text-gray-500'}`}>{label}</p>
                  <p className="text-xs text-gray-400 truncate">{desc}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${on ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-400'}`}>
                  {on ? 'Activo' : 'Oculto'}
                </span>
              </button>
            )
          })}
        </div>
      ))}

      <div className="card bg-amber-50 border border-amber-200">
        <p className="text-xs text-amber-700">
          <strong>Nota:</strong> Los cambios son inmediatos para todos los usuarios activos al recargar la página. Los módulos desactivados solo se ocultan del menú — los datos y APIs permanecen intactos.
        </p>
      </div>

      {/* Facturación / Acceso al portal */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
            <CreditCard size={14} className="text-emerald-500" /> Facturación · Acceso al portal
          </h2>
          {billing && (
            <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${(BILLING_UI[billing.status] || BILLING_UI.al_dia).cls}`}>
              {(BILLING_UI[billing.status] || BILLING_UI.al_dia).label}
              {billing.status === 'aviso' && billing.days_left != null
                ? ` · ${billing.days_left} día${billing.days_left !== 1 ? 's' : ''}`
                : ''}
            </span>
          )}
        </div>

        <p className="text-xs text-gray-400">
          Corte el <strong>día {billing?.cutoff_day ?? 15}</strong> de cada mes. A los{' '}
          <strong>{billing?.notice_days ?? 5} días</strong> sin confirmar aparece el aviso al staff, y a los{' '}
          <strong>{billing?.suspend_days ?? 15} días</strong> se deshabilita su acceso. Los clientes no se ven afectados.
        </p>

        {billing && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-gray-400 mb-0.5">Último pago confirmado</p>
              <p className="font-semibold text-gray-700">{fmtDate(billing.last_confirmed_at)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-gray-400 mb-0.5">Próximo corte</p>
              <p className="font-semibold text-gray-700">{fmtDate(billing.next_due)}</p>
            </div>
          </div>
        )}

        {billing?.status === 'suspendido' && (
          <div className="rounded-lg bg-red-50 text-red-700 p-3 text-xs font-medium">
            El acceso del staff está deshabilitado por falta de pago. Confirma el pago para reactivarlo.
          </div>
        )}

        <button
          onClick={handleConfirmPayment}
          disabled={billingConfirming}
          className="w-full text-sm px-3 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors font-medium"
        >
          <CheckCircle2 size={15} /> {billingConfirming ? 'Confirmando...' : 'Confirmar pago del mes'}
        </button>
      </div>

      {/* Trial period */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
            <Clock size={14} className="text-amber-500" /> Período de Prueba
          </h2>
          <button
            onClick={handleTrialSave}
            disabled={trialSaving}
            className="text-xs px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            <Save size={12} /> {trialSaving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">Activar período de prueba</p>
            <p className="text-xs text-gray-400">Bloquea el acceso al vencer. El superadmin siempre puede entrar.</p>
          </div>
          <button onClick={() => setTrial(t => ({ ...t, enabled: !t.enabled }))}>
            {trial.enabled
              ? <ToggleRight size={24} className="text-amber-500" />
              : <ToggleLeft size={24} className="text-gray-300" />}
          </button>
        </div>

        {trial.enabled && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Fecha de inicio</label>
                <input
                  type="date"
                  value={trial.start_date || ''}
                  onChange={e => setTrial(t => ({ ...t, start_date: e.target.value || null }))}
                  className="input-field text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Duración (días)</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={trial.days}
                  onChange={e => setTrial(t => ({ ...t, days: parseInt(e.target.value) || 14 }))}
                  className="input-field text-sm w-full"
                />
              </div>
            </div>

            {trialEndDate() && (
              <div className={`rounded-lg p-3 text-xs font-medium ${
                (trialDaysRemaining() ?? 1) < 0
                  ? 'bg-red-50 text-red-700'
                  : (trialDaysRemaining() ?? 1) <= 3
                  ? 'bg-orange-50 text-orange-700'
                  : 'bg-amber-50 text-amber-700'
              }`}>
                Vence el{' '}
                <strong>
                  {trialEndDate().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}
                </strong>
                {' — '}
                {(trialDaysRemaining() ?? 0) < 0
                  ? 'Período vencido'
                  : trialDaysRemaining() === 0
                  ? 'Vence hoy'
                  : `${trialDaysRemaining()} día${trialDaysRemaining() !== 1 ? 's' : ''} restante${trialDaysRemaining() !== 1 ? 's' : ''}`}
              </div>
            )}
          </>
        )}
      </div>

      {/* Límite de usuarios */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
            <Users size={14} className="text-blue-500" /> Límite de usuarios
          </h2>
          <button
            onClick={handleLimitSave}
            disabled={limitSaving}
            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            <Save size={12} /> {limitSaving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
        <p className="text-xs text-gray-400">
          Máximo de usuarios <strong>staff</strong> (técnicos, admin, ventas, etc.) que el administrador puede crear. Los clientes no cuentan. <strong>0 = ilimitado.</strong>
        </p>
        <div className="flex items-end gap-4">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Máximo permitido</label>
            <input
              type="number"
              min="0"
              value={userLimit.max_users}
              onChange={e => setUserLimit(u => ({ ...u, max_users: e.target.value }))}
              className="input-field text-sm w-32"
            />
          </div>
          <div className={`rounded-lg px-3 py-2 text-xs font-medium ${
            userLimit.max_users > 0 && userLimit.staff_count >= userLimit.max_users
              ? 'bg-red-50 text-red-700'
              : 'bg-blue-50 text-blue-700'
          }`}>
            En uso: <strong>{userLimit.staff_count}</strong>{userLimit.max_users > 0 ? ` / ${userLimit.max_users}` : ' (sin límite)'}
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
          <Shield size={14} className="text-indigo-500" /> Accesos por rol
        </h2>
        <p className="text-xs text-gray-400 mb-3">
          Activa o desactiva funciones específicas para Técnico, Ventas y Cliente. El Administrador siempre tiene acceso total.
        </p>
        <RoleFeaturesPanel />
      </div>

      {/* Auditoría del sistema */}
      <div>
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
          <ScrollText size={14} className="text-violet-500" /> Auditoría del sistema
        </h2>
        <p className="text-xs text-gray-400 mb-3">
          Registro de inicios de sesión (exitosos y fallidos), creación/edición/eliminación de registros y otros cambios importantes.
        </p>
        <AuditPanel />
      </div>
    </div>
  )
}
