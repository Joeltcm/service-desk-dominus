import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ModulesProvider } from './context/ModulesContext'
import SystemConfig from './pages/SystemConfig'
import { UnsavedChangesProvider } from './context/UnsavedChangesContext'
import { RoleFeaturesProvider } from './context/RoleFeaturesContext'
import { InstallProvider } from './context/InstallContext'
import { getFormatSettings, getCompanySettings } from './services/api'
import { setFmtConfig } from './utils/fmt'
import { CompanyProvider, setCompanyCache } from './context/CompanyContext'
import { ConfirmProvider } from './context/ConfirmContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Tickets from './pages/Tickets'
import TicketForm from './pages/TicketForm'
import TicketDetail from './pages/TicketDetail'
import Users from './pages/Users'
import KnowledgeBase from './pages/KnowledgeBase'
import Reports from './pages/Reports'
import Agenda from './pages/Agenda'
import Profile from './pages/Profile'
import Contacts from './pages/Contacts'
import Suppliers from './pages/Suppliers'
import Orders from './pages/Orders'
import Quotes from './pages/Quotes'
import Facturas from './pages/Facturas'
import Warranties from './pages/Warranties'
import Despacho from './pages/Despacho'
import VentasDashboard from './pages/VentasDashboard'
import Settings from './pages/Settings'
import Gastos from './pages/Gastos'
import GastosDashboard from './pages/GastosDashboard'
import ClientDocs from './pages/ClientDocs'
import ClientPortal from './pages/ClientPortal'
import MisPedidos from './pages/MisPedidos'
import ResetPassword from './pages/ResetPassword'
import Letters from './pages/Letters'
import Contratos from './pages/Contratos'
import Impresoras from './pages/Impresoras'
import Suministros from './pages/Suministros'
import Papelera from './pages/Papelera'
import Inventario from './pages/Inventario'
import PartApprovals from './pages/PartApprovals'
import CuentasPorCobrar from './pages/CuentasPorCobrar'
import CuentasPorPagar from './pages/CuentasPorPagar'
import Pagos from './pages/Pagos'
import Oportunidades from './pages/Oportunidades'
import Licencias from './pages/Licencias'
import Projects from './pages/Projects'
import PedidosDashboard from './pages/PedidosDashboard'

function FormatLoader() {
  const { user } = useAuth()
  useEffect(() => {
    if (!user) return
    getFormatSettings()
      .then(r => setFmtConfig({
        tz:         r.data.tz          || 'America/Panama',
        dateFormat: r.data.date_format || 'dd/MM/yyyy',
        time12:     r.data.time_format !== '24h',
      }))
      .catch(() => {})
    getCompanySettings()
      .then(r => {
        setCompanyCache(r.data)
        // Apply dynamic favicon if one is configured
        if (r.data.has_favicon) {
          const v = Date.now()
          ;['icon', 'shortcut icon'].forEach(rel => {
            let link = document.querySelector(`link[rel="${rel}"]`)
            if (!link) { link = document.createElement('link'); link.rel = rel; document.head.appendChild(link) }
            link.href = `/api/settings/favicon?v=${v}`
          })
          const touch = document.querySelector('link[rel="apple-touch-icon"]')
          if (touch) touch.href = `/api/settings/favicon?v=${v}`
        }
        // Apply dynamic page title
        if (r.data.company_app_name) document.title = r.data.company_app_name
      })
      .catch(() => {})
  }, [user?.id])
  return null
}

function PrivateRoute({ children, roles }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Cargando...</div>
  if (!user) return <Navigate to="/login" replace />
  if (roles && user.role !== 'superadmin' && !roles.includes(user.role)) return <Navigate to="/tickets" replace />
  return <Layout>{children}</Layout>
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <>
    <FormatLoader />
    <Routes>
      <Route path="/login" element={user ? <Navigate to={user.role === 'client' ? '/inicio' : user.role === 'superadmin' ? '/system' : '/dashboard'} /> : <Login />} />
      <Route path="/system" element={<PrivateRoute roles={['superadmin']}><SystemConfig /></PrivateRoute>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/dashboard" element={<PrivateRoute roles={['admin', 'agent', 'supervisor']}><Dashboard /></PrivateRoute>} />
      <Route path="/tickets" element={<PrivateRoute><Tickets /></PrivateRoute>} />
      <Route path="/tickets/new" element={<PrivateRoute><TicketForm /></PrivateRoute>} />
      <Route path="/tickets/:id" element={<PrivateRoute><TicketDetail /></PrivateRoute>} />
      <Route path="/tickets/:id/edit" element={<PrivateRoute><TicketForm /></PrivateRoute>} />
      <Route path="/agenda" element={<PrivateRoute><Agenda /></PrivateRoute>} />
      <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
      <Route path="/contacts" element={<PrivateRoute roles={['admin', 'agent', 'supervisor']}><Contacts /></PrivateRoute>} />
      <Route path="/quotes/:ref?" element={<PrivateRoute roles={['admin', 'agent', 'ventas', 'supervisor']}><Quotes /></PrivateRoute>} />
      <Route path="/orders/:ref?" element={<PrivateRoute roles={['admin', 'agent', 'ventas', 'supervisor']}><Orders /></PrivateRoute>} />
      <Route path="/pedidos/dashboard" element={<PrivateRoute roles={['admin', 'agent', 'ventas', 'supervisor']}><PedidosDashboard /></PrivateRoute>} />
      <Route path="/ventas" element={<PrivateRoute roles={['admin', 'agent', 'ventas', 'supervisor']}><VentasDashboard /></PrivateRoute>} />
      <Route path="/pedidos/:ref?" element={<PrivateRoute roles={['admin', 'agent', 'ventas', 'supervisor']}><Despacho /></PrivateRoute>} />
      <Route path="/facturas/:ref?" element={<PrivateRoute roles={['admin', 'agent', 'ventas', 'supervisor']}><Facturas /></PrivateRoute>} />
      <Route path="/warranties/:ref?" element={<PrivateRoute roles={['admin', 'agent', 'supervisor']}><Warranties /></PrivateRoute>} />
      <Route path="/users" element={<PrivateRoute roles={['admin']}><Users /></PrivateRoute>} />
      <Route path="/knowledge-base" element={<PrivateRoute><KnowledgeBase /></PrivateRoute>} />
      <Route path="/gastos/dashboard" element={<PrivateRoute roles={['admin', 'agent', 'supervisor']}><GastosDashboard /></PrivateRoute>} />
      <Route path="/gastos/:ref?" element={<PrivateRoute roles={['admin', 'agent', 'supervisor']}><Gastos /></PrivateRoute>} />
      <Route path="/oportunidades/:ref?" element={<PrivateRoute roles={['admin', 'agent', 'ventas', 'supervisor']}><Oportunidades /></PrivateRoute>} />
      <Route path="/licencias/:ref?" element={<PrivateRoute roles={['admin', 'agent', 'supervisor']}><Licencias /></PrivateRoute>} />
      <Route path="/contratos/:ref?" element={<PrivateRoute roles={['admin', 'agent', 'supplies', 'supervisor']}><Contratos /></PrivateRoute>} />
      <Route path="/impresoras/:ref?" element={<PrivateRoute roles={['admin', 'agent', 'supplies', 'supervisor']}><Impresoras /></PrivateRoute>} />
      <Route path="/suministros" element={<PrivateRoute roles={['admin', 'agent', 'supplies', 'supervisor']}><Suministros /></PrivateRoute>} />
      <Route path="/cuentas-por-cobrar" element={<PrivateRoute roles={['admin', 'agent', 'ventas', 'supervisor']}><CuentasPorCobrar /></PrivateRoute>} />
      <Route path="/cuentas-por-pagar" element={<PrivateRoute roles={['admin', 'agent', 'supervisor']}><CuentasPorPagar /></PrivateRoute>} />
      <Route path="/pagos" element={<PrivateRoute roles={['admin', 'agent', 'ventas', 'supervisor']}><Pagos /></PrivateRoute>} />
      <Route path="/inventario" element={<PrivateRoute roles={['admin', 'agent', 'ventas', 'supplies', 'supervisor']}><Inventario /></PrivateRoute>} />
      <Route path="/partes" element={<PrivateRoute roles={['admin', 'supervisor', 'supplies', 'superadmin']}><PartApprovals /></PrivateRoute>} />
      <Route path="/cartas/:ref?" element={<PrivateRoute roles={['admin', 'agent', 'supervisor']}><Letters /></PrivateRoute>} />
      <Route path="/reports" element={<PrivateRoute roles={['admin', 'agent', 'client', 'supplies', 'supervisor']}><Reports /></PrivateRoute>} />
      <Route path="/papelera" element={<PrivateRoute roles={['admin']}><Papelera /></PrivateRoute>} />
      <Route path="/settings" element={<PrivateRoute roles={['admin', 'superadmin']}><Settings /></PrivateRoute>} />
      <Route path="/projects/:ref?" element={<PrivateRoute roles={['admin', 'agent', 'supervisor']}><Projects /></PrivateRoute>} />
      <Route path="/suppliers/:ref?" element={<PrivateRoute roles={['admin', 'ventas', 'supervisor']}><Suppliers /></PrivateRoute>} />
      <Route path="/mis-documentos/:ref?" element={<PrivateRoute roles={['client']}><ClientDocs /></PrivateRoute>} />
      <Route path="/inicio" element={<PrivateRoute roles={['client']}><ClientPortal /></PrivateRoute>} />
      <Route path="/mis-pedidos" element={<PrivateRoute roles={['client']}><MisPedidos /></PrivateRoute>} />
      <Route path="/" element={<Navigate to={user?.role === 'client' ? '/inicio' : user?.role === 'superadmin' ? '/system' : '/dashboard'} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}

export default function App() {
  const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/'

  return (
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <CompanyProvider>
        <InstallProvider>
          <RoleFeaturesProvider>
          <ModulesProvider>
            <UnsavedChangesProvider>
            <ConfirmProvider>
              <AppRoutes />
              <Toaster
                position={typeof window !== 'undefined' && window.innerWidth < 640 ? 'top-center' : 'top-right'}
                toastOptions={{ duration: 4000 }}
                containerStyle={{ top: 'max(16px, env(safe-area-inset-top, 16px))' }}
              />
            </ConfirmProvider>
            </UnsavedChangesProvider>
          </ModulesProvider>
          </RoleFeaturesProvider>
        </InstallProvider>
        </CompanyProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
