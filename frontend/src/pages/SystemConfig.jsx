import React, { useEffect, useState } from 'react'
import { Settings2, Save, ToggleLeft, ToggleRight, Shield, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { getSystemModules, updateSystemModules, getTrialConfig, updateTrial } from '../services/api'
import { useModules } from '../context/ModulesContext'
import { useCompany } from '../context/CompanyContext'
import { RoleFeaturesPanel } from './Settings'

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
]

export default function SystemConfig() {
  const [modules, setModulesLocal] = useState(null)
  const [saving, setSaving] = useState(false)
  const { setModules: setGlobalModules } = useModules()
  const { vertical } = useCompany()
  const groups = verticalizeGroups(MODULE_GROUPS, vertical === 'it_support')

  const [trial, setTrial] = useState({ enabled: false, start_date: null, days: 14 })
  const [trialSaving, setTrialSaving] = useState(false)

  useEffect(() => {
    getSystemModules().then(r => setModulesLocal(r.data)).catch(() => toast.error('Error cargando configuración'))
    getTrialConfig().then(r => setTrial(r.data)).catch(() => {})
  }, [])

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
      <div className="flex items-center justify-between gap-4">
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

      <div>
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
          <Shield size={14} className="text-indigo-500" /> Accesos por rol
        </h2>
        <p className="text-xs text-gray-400 mb-3">
          Activa o desactiva funciones específicas para Técnico, Ventas y Cliente. El Administrador siempre tiene acceso total.
        </p>
        <RoleFeaturesPanel />
      </div>
    </div>
  )
}
