import React, { createContext, useContext, useEffect, useState } from 'react'
import { getRoleFeatures } from '../services/api'
import { useAuth } from './AuthContext'

export const ROLE_FEATURE_DEFS = [
  { key: 'dashboard_servicios', label: 'Dashboard',             roles: ['agent', 'supervisor'] },
  { key: 'dashboard_ventas',    label: 'Dashboard Ventas',      roles: ['agent', 'ventas', 'supervisor'] },
  { key: 'tickets',             label: 'Tickets',               roles: ['agent', 'client', 'supplies', 'supervisor'] },
  { key: 'agenda',              label: 'Agenda',                roles: ['agent', 'client', 'supervisor'] },
  { key: 'mis_documentos',      label: 'Mis Documentos',        roles: ['client'] },
  { key: 'contacts',            label: 'Contactos',             roles: ['agent', 'client', 'supervisor'] },
  { key: 'suppliers',           label: 'Proveedores',           roles: ['ventas', 'supervisor'] },
  { key: 'quotes',              label: 'Cotizaciones',          roles: ['agent', 'ventas', 'supervisor'] },
  { key: 'pedidos',             label: 'Pedidos',               roles: ['agent', 'ventas', 'supervisor'] },
  { key: 'facturas',            label: 'Facturas',              roles: ['agent', 'ventas', 'supervisor'] },
  { key: 'warranties',          label: 'Garantías',             roles: ['agent', 'supervisor'] },
  { key: 'gastos',              label: 'Gastos',                roles: ['agent', 'supervisor'] },
  { key: 'cartas',              label: 'Cartas',                roles: ['agent', 'supervisor'] },
  { key: 'knowledge_base',      label: 'Base de Conocimientos', roles: ['agent', 'client', 'supervisor'] },
  { key: 'reports',             label: 'Reportes',               roles: ['agent', 'supplies', 'supervisor'] },
  { key: 'contratos',           label: 'Contratos',             roles: ['agent', 'supplies', 'supervisor'] },
  { key: 'impresoras',          label: 'Flota',                  roles: ['agent', 'supplies', 'supervisor'] },
  { key: 'suministros',         label: 'Suministros',            roles: ['agent', 'supplies', 'supervisor'] },
  { key: 'inventario',          label: 'Inventario',             roles: ['agent', 'supplies', 'supervisor'] },
]

// Fallback shown before the API call resolves. Kept manually in sync with
// ROLE_FEATURE_DEFS above — a feature added there but not mirrored here will
// default to hidden for that role until getRoleFeatures() returns.
const DEFAULT_FEATURES = {
  agent:    { dashboard_servicios: true, dashboard_ventas: true, tickets: true, agenda: true, contacts: true, quotes: true, pedidos: true, facturas: true, warranties: true, gastos: true, knowledge_base: true, reports: true, contratos: true, impresoras: true, suministros: true, inventario: true },
  ventas:   { dashboard_ventas: true, suppliers: true, quotes: true, pedidos: true, facturas: true },
  supplies: { tickets: true, suministros: true, inventario: true, impresoras: true, contratos: true, reports: true },
  client:   { tickets: true, agenda: true, contacts: true, knowledge_base: true },
}

const RoleFeaturesCtx = createContext({ features: DEFAULT_FEATURES, reload: () => {} })

export function RoleFeaturesProvider({ children }) {
  const { user } = useAuth()
  const [features, setFeatures] = useState(DEFAULT_FEATURES)

  const load = () => {
    if (!user) return
    getRoleFeatures().then(r => setFeatures(r.data)).catch(() => {})
  }

  useEffect(() => { load() }, [user?.id])

  return <RoleFeaturesCtx.Provider value={{ features, reload: load }}>{children}</RoleFeaturesCtx.Provider>
}

export const useRoleFeatures = () => useContext(RoleFeaturesCtx)

// ── Niveles de acceso ──────────────────────────────────────────────────────
// Compatibilidad: los valores antiguos eran booleanos (true = acceso total,
// false = sin acceso). Los nuevos son 'none' | 'read' | 'write'.
export const ACCESS_LEVELS = ['none', 'read', 'write']

export function normLevel(v) {
  if (v === true) return 'write'
  if (v === false) return 'none'
  if (v === 'read' || v === 'write' || v === 'none') return v
  return undefined  // no configurado
}

// Acceso del USUARIO ACTUAL a un módulo (por su rol).
export function useModuleAccess() {
  const { features } = useRoleFeatures()
  const { user } = useAuth()
  const role = user?.role
  const isAdminish = role === 'admin' || role === 'superadmin'
  const level = (key) => {
    if (isAdminish) return 'write'
    const n = normLevel(features?.[role]?.[key])
    return n === undefined ? 'write' : n  // sin configurar = acceso completo (comportamiento previo)
  }
  return {
    level,
    canWrite: (key) => level(key) === 'write',
    canRead: (key) => level(key) !== 'none',
  }
}
