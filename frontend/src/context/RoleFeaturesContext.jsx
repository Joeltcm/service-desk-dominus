import React, { createContext, useContext, useEffect, useState } from 'react'
import { getRoleFeatures } from '../services/api'
import { useAuth } from './AuthContext'

export const ROLE_FEATURE_DEFS = [
  { key: 'dashboard_servicios', label: 'Dashboard',             roles: ['agent'] },
  { key: 'dashboard_ventas',    label: 'Dashboard Ventas',      roles: ['agent', 'ventas'] },
  { key: 'tickets',             label: 'Tickets',               roles: ['agent', 'client', 'supplies'] },
  { key: 'agenda',              label: 'Agenda',                roles: ['agent', 'client'] },
  { key: 'contacts',            label: 'Contactos',             roles: ['agent', 'client'] },
  { key: 'suppliers',           label: 'Proveedores',           roles: ['ventas'] },
  { key: 'quotes',              label: 'Cotizaciones',          roles: ['agent', 'ventas'] },
  { key: 'pedidos',              label: 'Pedidos',               roles: ['agent', 'ventas'] },
  { key: 'facturas',            label: 'Facturas',              roles: ['agent', 'ventas'] },
  { key: 'warranties',          label: 'Garantías',             roles: ['agent'] },
  { key: 'gastos',              label: 'Gastos',                roles: ['agent'] },
  { key: 'knowledge_base',      label: 'Base de Conocimientos', roles: ['agent', 'client'] },
  { key: 'reports',             label: 'Reportes',               roles: ['agent', 'supplies'] },
  { key: 'contratos',           label: 'Contratos',             roles: ['agent', 'supplies'] },
  { key: 'impresoras',          label: 'Flota',                  roles: ['agent', 'supplies'] },
  { key: 'suministros',         label: 'Suministros',            roles: ['agent', 'supplies'] },
  { key: 'inventario',          label: 'Inventario',             roles: ['agent', 'supplies'] },
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
