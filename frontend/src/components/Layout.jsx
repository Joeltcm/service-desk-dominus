import { showConfirm } from '../utils/confirm'
import React, { useState, useEffect } from 'react'
import defaultLogo from '../assets/default-logo.png'
import { NavLink, useNavigate, useLocation, useMatch } from 'react-router-dom'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import { useAuth } from '../context/AuthContext'
import { getDashboard, getTrialStatus } from '../services/api'
import { useUnsavedChanges } from '../context/UnsavedChangesContext'
import {
  LayoutDashboard, Ticket, BookOpen, BarChart2,
  LogOut, Menu, X, ChevronDown, CalendarDays, UserCircle, ContactRound, Truck, ShoppingCart, ShieldCheck, PackageCheck, ClipboardList, Receipt, TrendingUp, Settings, Settings2, TrendingDown, FileText, Mail, Trash2, Package, Banknote, HandCoins, Wallet, Target, KeyRound, Plus, Smartphone, FolderKanban, FileSignature, Printer, Layers, Clock, Lock, QrCode
} from 'lucide-react'
import TicketScanner from './TicketScanner'
import { ROLE_MAP } from '../pages/Settings'
import { useRoleFeatures } from '../context/RoleFeaturesContext'
import { useInstall } from '../context/InstallContext'
import { useCompany } from '../context/CompanyContext'
import { useModules } from '../context/ModulesContext'
import PushPromptBanner from './PushPromptBanner'

const navItems = [
  { to: '/dashboard',         group: 'main',      subgroup: null,       featureKey: 'dashboard_servicios', moduleKey: 'dashboard_servicios', label: 'Dashboard',             icon: LayoutDashboard, roles: ['admin', 'supervisor', 'agent', 'superadmin'],            color: 'text-blue-500',    bg: 'bg-blue-500/15' },
  { to: '/ventas',            group: 'main',      subgroup: null,       featureKey: 'dashboard_ventas',    moduleKey: 'dashboard_ventas',    label: 'Dashboard Ventas',      icon: TrendingUp,      roles: ['admin', 'supervisor', 'agent', 'ventas', 'superadmin'],  color: 'text-emerald-500', bg: 'bg-emerald-500/15' },
  { to: '/tickets',           group: 'main',      subgroup: null,       featureKey: 'tickets',             moduleKey: 'tickets',             label: 'Tickets',               icon: Ticket,          roles: ['admin', 'supervisor', 'agent', 'client', 'supplies', 'superadmin'], color: 'text-orange-500',  bg: 'bg-orange-500/15' },
  { to: '/mis-documentos',    group: 'main',      subgroup: null,       featureKey: 'mis_documentos',      moduleKey: null,                  label: 'Mis Documentos',        icon: FileText,        roles: ['client'],                    color: 'text-indigo-500',  bg: 'bg-indigo-500/15' },
  { to: '/agenda',            group: 'main',      subgroup: null,       featureKey: 'agenda',              moduleKey: 'agenda',              label: 'Agenda',                icon: CalendarDays,    roles: ['admin', 'supervisor', 'agent', 'client', 'superadmin'],  color: 'text-violet-500',  bg: 'bg-violet-500/15' },
  { to: '/projects',          group: 'main',      subgroup: null,       featureKey: null,                  moduleKey: 'proyectos',           label: 'Proyectos',             icon: FolderKanban,    roles: ['admin', 'supervisor', 'agent', 'superadmin'],            color: 'text-indigo-500',  bg: 'bg-indigo-500/15' },
  { to: '/oportunidades',     group: 'comercial', subgroup: 'ventas',   featureKey: null,                  moduleKey: 'oportunidades',       label: 'Oportunidades',         icon: Target,          roles: ['admin', 'supervisor', 'agent', 'ventas', 'superadmin'],  color: 'text-violet-500',  bg: 'bg-violet-500/15' },
  { to: '/quotes',            group: 'comercial', subgroup: 'ventas',   featureKey: 'quotes',              moduleKey: 'cotizaciones',        label: 'Cotizaciones',          icon: ClipboardList,   roles: ['admin', 'supervisor', 'agent', 'ventas', 'superadmin'],  color: 'text-indigo-500',  bg: 'bg-indigo-500/15' },
  { to: '/pedidos/dashboard', group: 'comercial', subgroup: 'ventas',   featureKey: 'pedidos',             moduleKey: 'pedidos',             label: 'Dashboard Pedidos',     icon: BarChart2,       roles: ['admin', 'supervisor', 'agent', 'ventas', 'superadmin'],  color: 'text-sky-600',     bg: 'bg-sky-500/15' },
  { to: '/pedidos',           group: 'comercial', subgroup: 'ventas',   featureKey: 'pedidos',             moduleKey: 'pedidos',             label: 'Pedidos',               icon: PackageCheck,    roles: ['admin', 'supervisor', 'agent', 'ventas', 'superadmin'],  color: 'text-teal-500',    bg: 'bg-teal-500/15' },
  { to: '/facturas',          group: 'comercial', subgroup: 'ventas',   featureKey: 'facturas',            moduleKey: 'facturas',            label: 'Facturas',              icon: Receipt,         roles: ['admin', 'supervisor', 'agent', 'ventas', 'superadmin'],  color: 'text-rose-500',    bg: 'bg-rose-500/15' },
  { to: '/warranties',        group: 'comercial', subgroup: 'ventas',   featureKey: 'warranties',          moduleKey: 'garantias',           label: 'Garantías',             icon: ShieldCheck,     roles: ['admin', 'supervisor', 'agent', 'superadmin'],            color: 'text-lime-500',    bg: 'bg-lime-500/15' },
  { to: '/gastos',            group: 'comercial', subgroup: 'finanzas', featureKey: 'gastos',              moduleKey: 'gastos',              label: 'Gastos',                icon: TrendingDown,    roles: ['admin', 'supervisor', 'agent', 'superadmin'],            color: 'text-red-500',     bg: 'bg-red-500/15' },
  { to: '/pagos',             group: 'comercial', subgroup: 'finanzas', featureKey: 'facturas',            moduleKey: 'facturas',            label: 'Pagos',                 icon: Wallet,          roles: ['admin', 'supervisor', 'agent', 'ventas', 'superadmin'],  color: 'text-indigo-500',  bg: 'bg-indigo-500/15' },
  { to: '/cuentas-por-cobrar',group: 'comercial', subgroup: 'finanzas', featureKey: 'facturas',            moduleKey: 'facturas',            label: 'Cuentas por Cobrar',    icon: Banknote,        roles: ['admin', 'supervisor', 'agent', 'ventas', 'superadmin'],  color: 'text-emerald-600', bg: 'bg-emerald-500/15' },
  { to: '/cuentas-por-pagar', group: 'comercial', subgroup: 'finanzas', featureKey: 'gastos',              moduleKey: 'gastos',              label: 'Cuentas por Pagar',     icon: HandCoins,       roles: ['admin', 'supervisor', 'agent', 'superadmin'],            color: 'text-red-600',     bg: 'bg-red-500/15' },
  { to: '/contacts',          group: 'comercial', subgroup: 'maestros', featureKey: 'contacts',            moduleKey: 'contactos',           label: 'Contactos',             icon: ContactRound,    roles: ['admin', 'supervisor', 'agent', 'superadmin'],            color: 'text-cyan-500',    bg: 'bg-cyan-500/15' },
  { to: '/suppliers',         group: 'comercial', subgroup: 'maestros', featureKey: 'suppliers',           moduleKey: 'proveedores',         label: 'Proveedores',           icon: Truck,           roles: ['admin', 'supervisor', 'ventas', 'superadmin'],           color: 'text-amber-500',   bg: 'bg-amber-500/15' },
  { to: '/inventario',        group: 'comercial', subgroup: 'maestros', featureKey: 'inventario',          moduleKey: 'inventario',          label: 'Inventario',            icon: Package,         roles: ['admin', 'supervisor', 'agent', 'ventas', 'superadmin'],  color: 'text-emerald-500', bg: 'bg-emerald-500/15' },
  { to: '/licencias',         group: 'comercial', subgroup: 'maestros', featureKey: null,                  moduleKey: 'licencias',           label: 'Licencias Software',    icon: KeyRound,        roles: ['admin', 'supervisor', 'agent', 'superadmin'],            color: 'text-teal-500',    bg: 'bg-teal-500/15' },
  { to: '/contratos',         group: 'comercial', subgroup: 'maestros', featureKey: 'contratos',           moduleKey: 'contratos',           label: 'Contratos',             icon: FileSignature,   roles: ['admin', 'supervisor', 'agent', 'supplies', 'superadmin'], color: 'text-indigo-500',  bg: 'bg-indigo-500/15' },
  { to: '/impresoras',        group: 'comercial', subgroup: 'maestros', featureKey: 'impresoras',          moduleKey: 'impresoras',          label: 'Flota',                 icon: Printer,         roles: ['admin', 'supervisor', 'agent', 'supplies', 'superadmin'], color: 'text-sky-500',     bg: 'bg-sky-500/15' },
  { to: '/suministros',       group: 'comercial', subgroup: 'maestros', featureKey: 'suministros',         moduleKey: 'suministros',         label: 'Suministros',           icon: Layers,          roles: ['admin', 'supervisor', 'agent', 'supplies', 'superadmin'], color: 'text-violet-500',  bg: 'bg-violet-500/15' },
  { to: '/cartas',            group: 'comercial', subgroup: 'maestros', featureKey: 'cartas',              moduleKey: 'cartas',              label: 'Cartas',                icon: Mail,            roles: ['admin', 'supervisor', 'agent', 'superadmin'],            color: 'text-sky-600',     bg: 'bg-sky-600/15' },
  { to: '/knowledge-base',    group: 'sistema',   subgroup: null,       featureKey: 'knowledge_base',      moduleKey: 'knowledge_base',      label: 'Base de Conocimientos', icon: BookOpen,        roles: ['admin', 'supervisor', 'agent', 'client', 'superadmin'],  color: 'text-green-500',   bg: 'bg-green-500/15' },
  { to: '/reports',           group: 'sistema',   subgroup: null,       featureKey: 'reports',             moduleKey: 'reportes',            label: 'Reportes',              icon: BarChart2,       roles: ['admin', 'supervisor', 'agent', 'client', 'supplies', 'superadmin'], color: 'text-purple-500',  bg: 'bg-purple-500/15' },
  { to: '/papelera',          group: 'sistema',   subgroup: null,       featureKey: null,                  moduleKey: null,                  label: 'Papelera',              icon: Trash2,          roles: ['admin', 'superadmin'],       color: 'text-red-400',     bg: 'bg-red-500/15' },
  { to: '/settings',          group: 'sistema',   subgroup: null,       featureKey: null,                  moduleKey: null,                  label: 'Configuración',         icon: Settings,        roles: ['admin', 'superadmin'],       color: 'text-slate-400',   bg: 'bg-white/10' },
  { to: '/system',            group: 'sistema',   subgroup: null,       featureKey: null,                  moduleKey: null,                  label: 'Sistema',               icon: Settings2,       roles: ['superadmin'],                color: 'text-violet-400',  bg: 'bg-violet-500/15' },
]

const GROUP_LABELS    = { main: null, comercial: 'Comercial', sistema: 'Sistema' }
const SUBGROUP_LABELS = { ventas: 'Ventas', finanzas: 'Finanzas', maestros: 'Maestros' }

function NavItem({ item, collapsed, onNavigate, badge }) {
  const { isDirty, setDirty } = useUnsavedChanges()
  const navigate = useNavigate()
  const location = useLocation()
  const match = useMatch(item.to)
  const isActive = Boolean(match)
  const Icon = item.icon
  const { vertical } = useCompany()
  // Vertical IT: "Flota" (impresoras) se muestra como "Equipos"
  const label = (vertical === 'it_support' && item.moduleKey === 'impresoras') ? 'Equipos' : item.label

  const handleClick = async (e) => {
    if (isDirty && location.pathname !== item.to) {
      e.preventDefault()
      if (await showConfirm('Tienes cambios sin guardar. ¿Deseas continuar sin guardar?')) {
        setDirty(false)
        navigate(item.to)
        onNavigate()
      }
    } else {
      onNavigate()
    }
  }

  return (
    <NavLink
      to={item.to}
      onClick={handleClick}
      className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all text-sm min-h-[36px] ${
        isActive
          ? 'bg-white text-gray-800 font-semibold shadow-sm'
          : 'text-slate-400 font-medium hover:bg-white/10 hover:text-slate-200'
      }`}
    >
      <span className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors relative ${
        isActive ? item.bg : 'bg-transparent'
      }`}>
        <Icon size={15} className={isActive ? item.color : 'text-slate-500'} />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none shadow-sm">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className={collapsed ? 'md:hidden' : ''}>{label}</span>
    </NavLink>
  )
}

const FAB_ITEMS = [
  { label: 'Escanear ticket',  action: 'scan',               Icon: QrCode,        bg: 'bg-slate-700',  roles: ['admin','supervisor','agent','superadmin'],          moduleKey: 'tickets' },
  { label: 'Nuevo Ticket',     to: '/tickets/new',           Icon: Ticket,        bg: 'bg-orange-500', roles: ['admin','supervisor','agent','client','superadmin'], moduleKey: 'tickets' },
  { label: 'Nueva Cotización', to: '/quotes?action=new',     Icon: ClipboardList, bg: 'bg-indigo-500', roles: ['admin','supervisor','agent','ventas','superadmin'], moduleKey: 'cotizaciones' },
  { label: 'Nueva Factura',    to: '/facturas?action=new',   Icon: Receipt,       bg: 'bg-rose-500',   roles: ['admin','supervisor','agent','ventas','superadmin'], moduleKey: 'facturas' },
  { label: 'Nuevo Pedido',     to: '/pedidos?action=new',    Icon: ShoppingCart,  bg: 'bg-sky-500',    roles: ['admin','supervisor','agent','ventas','superadmin'], moduleKey: 'pedidos' },
  { label: 'Nuevo Contacto',   to: '/contacts?action=new',   Icon: ContactRound,  bg: 'bg-cyan-500',   roles: ['admin','supervisor','agent','superadmin'],          moduleKey: 'contactos' },
  { label: 'Nuevo Gasto',      to: '/gastos?action=new',     Icon: TrendingDown,  bg: 'bg-red-500',    roles: ['admin','supervisor','agent','superadmin'],          moduleKey: 'gastos' },
  { label: 'Nueva Garantía',   to: '/warranties?action=new', Icon: ShieldCheck,   bg: 'bg-lime-500',   roles: ['admin','supervisor','agent','superadmin'],          moduleKey: 'garantias' },
]

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const { isDirty, setDirty } = useUnsavedChanges()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [openTickets, setOpenTickets] = useState(0)
  const [trial, setTrial] = useState({ active: false, expired: false, days_remaining: null })
  const [trialLoading, setTrialLoading] = useState(true)
  const [trialOverlay, setTrialOverlay] = useState(false)
  const { canInstall, isInstalled, install } = useInstall()

  useEffect(() => { setFabOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!user || user.role === 'superadmin') {
      setTrialLoading(false)
      return
    }
    getTrialStatus()
      .then(r => {
        setTrial(r.data)
        if (r.data.expired) setTrialOverlay(true)
      })
      .catch(() => {})
      .finally(() => setTrialLoading(false))
  }, [user?.id])

  useEffect(() => {
    const handler = () => setTrialOverlay(true)
    window.addEventListener('trial-expired', handler)
    return () => window.removeEventListener('trial-expired', handler)
  }, [])

  useEffect(() => {
    if (!['admin', 'agent'].includes(user?.role)) return
    const fetchCounts = () => {
      getDashboard().then((r) => {
        const total = r.data?.total_tickets || 0
        const resolved = r.data?.resolved_tickets || 0
        setOpenTickets(total - resolved)
      }).catch(() => {})
    }
    fetchCounts()
    const interval = setInterval(fetchCounts, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [user?.role])

  const handleLogout = async () => {
    if (isDirty && !await showConfirm('Tienes cambios sin guardar. ¿Deseas continuar sin guardar?')) return
    setDirty(false)
    logout()
    navigate('/login')
  }

  const guardNavigate = async (to) => {
    if (isDirty && !await showConfirm('Tienes cambios sin guardar. ¿Deseas continuar sin guardar?')) return
    setDirty(false)
    navigate(to)
    setUserMenuOpen(false)
    closeMobile()
  }

  const closeMobile = () => setMobileOpen(false)

  const { features } = useRoleFeatures()
  const { company_name: companyName, company_app_name: appName, company_sidebar_color: sidebarColor, has_logo: hasLogo } = useCompany()
  const logoSrc = hasLogo ? '/api/settings/logo' : defaultLogo
  const { modules } = useModules()

  useEffect(() => {
    const name = appName || companyName || 'Service Desk'
    document.title = `Service Desk · ${name}`
  }, [companyName, appName])

  const [openSubgroups, setOpenSubgroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nav_subgroups') || 'null') || { ventas: true, finanzas: true, maestros: true } }
    catch { return { ventas: true, finanzas: true, maestros: true } }
  })

  const toggleSubgroup = (sg) => {
    setOpenSubgroups(prev => {
      const next = { ...prev, [sg]: !prev[sg] }
      localStorage.setItem('nav_subgroups', JSON.stringify(next))
      return next
    })
  }

  // Swipe left on sidebar → close; swipe right from left edge on main → open
  const sidebarSwipe = useTouchSwipe({ onSwipeLeft: closeMobile })
  const mainSwipe    = useTouchSwipe({ onSwipeRight: () => setMobileOpen(true), edgeOnly: 24 })
  const visibleItems = navItems.filter(item => {
    if (!item.roles.includes(user?.role)) return false
    // superadmin sees all modules always
    if (user?.role === 'superadmin') return true
    // while modules are loading (null), hide any item that has a moduleKey
    if (item.moduleKey && modules === null) return false
    // once loaded, hide explicitly disabled modules
    if (item.moduleKey && modules[item.moduleKey] === false) return false
    if (user?.role === 'admin' || !item.featureKey) return true
    const roleFeats = features[user?.role] || {}
    return roleFeats[item.featureKey] !== false
  })
  const initials = user?.name?.[0]?.toUpperCase()

  // Auto-expand subgroup containing the active route
  useEffect(() => {
    const active = visibleItems.find(i => location.pathname === i.to || location.pathname.startsWith(i.to + '/'))
    if (active?.subgroup && openSubgroups[active.subgroup] === false) {
      toggleSubgroup(active.subgroup)
    }
  }, [location.pathname]) // eslint-disable-line

  const renderNav = () => {
    let lastGroup = null
    let lastSubgroup = null
    const nodes = []
    for (const item of visibleItems) {
      const isNewGroup    = item.group !== lastGroup
      const isNewSubgroup = item.group === 'comercial' && item.subgroup !== lastSubgroup
      const prevGroup     = lastGroup
      lastGroup    = item.group
      lastSubgroup = item.subgroup

      if (isNewGroup && prevGroup !== null)
        nodes.push(<div key={`sep-${item.group}`} className="my-2 border-t border-white/10" />)

      if (isNewGroup && GROUP_LABELS[item.group] && sidebarOpen)
        nodes.push(
          <p key={`gl-${item.group}`} className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 pt-1 pb-0.5 md:block hidden">
            {GROUP_LABELS[item.group]}
          </p>
        )

      if (isNewSubgroup && item.subgroup && sidebarOpen) {
        const isOpen = openSubgroups[item.subgroup] !== false
        nodes.push(
          <button key={`sg-${item.subgroup}`} onClick={() => toggleSubgroup(item.subgroup)}
            className="flex items-center justify-between w-full px-2 py-0.5 mt-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-slate-300 transition-colors md:flex hidden">
            <span>{SUBGROUP_LABELS[item.subgroup]}</span>
            <ChevronDown size={10} className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} />
          </button>
        )
      }

      const sgVisible = mobileOpen || item.group !== 'comercial' || !item.subgroup || openSubgroups[item.subgroup] !== false
      if (sgVisible)
        nodes.push(<NavItem key={item.to} item={item} collapsed={!sidebarOpen} onNavigate={closeMobile} badge={item.to === '/tickets' ? openTickets : 0} />)
    }
    return nodes
  }

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm" onClick={closeMobile} />
      )}

      {/* Sidebar */}
      <aside
        style={{ backgroundColor: sidebarColor || '#1a3353' }}
        className={[
          'flex flex-col',
          'fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:inset-auto md:z-auto md:translate-x-0 md:transition-all md:duration-200',
          sidebarOpen ? 'md:w-60' : 'md:w-16',
        ].join(' ')}
        {...sidebarSwipe}
      >

        {/* Logo */}
        <div className="flex items-center justify-between h-14 md:h-16 px-4 border-b border-white/10 flex-shrink-0">
          <div className={`flex items-center gap-2.5 ${!sidebarOpen ? 'md:hidden' : ''}`}>
            <div className="w-[54px] h-[54px] rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-white/20">
              <img src={logoSrc} alt={companyName || 'Logo'} className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-white text-sm tracking-tight">{companyName || 'Service Desk'}</span>
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden md:flex p-1.5 rounded-lg hover:bg-white/10 text-slate-400 transition-colors"
          >
            {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
          <button onClick={closeMobile} className="md:hidden p-1.5 rounded-lg hover:bg-white/10 text-slate-400">
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {renderNav()}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-white/10">
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 w-full px-2 py-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <div className="w-7 h-7 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ring-2 ring-blue-400/30">
                {initials}
              </div>
              <div className={`flex-1 text-left min-w-0 ${!sidebarOpen ? 'md:hidden' : ''}`}>
                <p className="text-xs font-semibold text-white truncate leading-tight">{user?.name}</p>
                <p className="text-xs text-slate-400 leading-tight">{ROLE_MAP[user?.role]?.label || user?.role}</p>
              </div>
              <ChevronDown size={14} className={`text-slate-500 ${!sidebarOpen ? 'md:hidden' : ''}`} />
            </button>

            {userMenuOpen && (
              <div className="absolute bottom-full left-0 mb-2 w-52 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50">
                <button
                  onClick={() => guardNavigate('/profile')}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <UserCircle size={15} className="text-gray-400" />
                  Mi perfil y Calendar
                </button>
                {!isInstalled && (
                  <>
                    <div className="border-t border-gray-100 my-1" />
                    {canInstall ? (
                      <button
                        onClick={async () => { await install(); setUserMenuOpen(false) }}
                        className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-blue-600 hover:bg-blue-50 transition-colors font-medium"
                      >
                        <Smartphone size={15} className="text-blue-500" />
                        Instalar app
                      </button>
                    ) : (
                      <div className="px-4 py-2.5">
                        <p className="text-xs font-semibold text-gray-500 mb-1.5 flex items-center gap-1.5">
                          <Smartphone size={12} className="text-gray-400" />
                          Instalar app
                        </p>
                        {/iphone|ipad|ipod/i.test(navigator.userAgent) ? (
                          <p className="text-xs text-gray-500 leading-relaxed">
                            En Safari: toca <strong>Compartir</strong> (⬆) → <strong>"En la pantalla de inicio"</strong>
                          </p>
                        ) : (
                          <p className="text-xs text-gray-500 leading-relaxed">
                            En Chrome: menú <strong>⋮</strong> → <strong>"Añadir a pantalla de inicio"</strong>
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
                <div className="border-t border-gray-100 my-1" />
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut size={15} className="text-red-400" />
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0 relative" {...mainSwipe}>
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center h-14 px-4 border-b border-white/10 flex-shrink-0 gap-3" style={{ backgroundColor: sidebarColor || '#1a3353' }}>
          <button
            onClick={() => setMobileOpen(true)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-300"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-[46px] h-[46px] rounded-lg overflow-hidden ring-1 ring-white/20">
              <img src={logoSrc} alt={companyName || 'Logo'} className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-sm text-white tracking-tight">{companyName || 'Service Desk'}</span>
          </div>
          <button
            className="ml-auto w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 ring-blue-400/30"
            onClick={() => guardNavigate('/profile')}
          >
            {initials}
          </button>
        </div>

        {trialLoading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Cargando...</div>
        ) : null}

        {!trialLoading && trial.active && !trial.expired && (
          <div className={`flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold flex-shrink-0 ${
            trial.days_remaining <= 3
              ? 'bg-red-600 text-white'
              : trial.days_remaining <= 7
              ? 'bg-amber-500 text-white'
              : 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white'
          }`}>
            <Clock size={13} className="flex-shrink-0" />
            Período de prueba: <strong className="ml-0.5">{trial.days_remaining} día{trial.days_remaining !== 1 ? 's' : ''} restante{trial.days_remaining !== 1 ? 's' : ''}</strong>
          </div>
        )}

        {!trialLoading && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <PushPromptBanner />
            <div className="flex-1 overflow-y-auto pb-20 md:pb-0 flex flex-col">
              {children}
            </div>
          </div>
        )}

        {trialOverlay && (
          <div className="absolute inset-0 z-50 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4 text-center p-8">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <Lock size={28} className="text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Período de prueba vencido</h2>
            <p className="text-sm text-gray-500 max-w-sm leading-relaxed">
              Tu acceso gratuito ha finalizado. Contacta al equipo de soporte para continuar usando la plataforma.
            </p>
            <button
              onClick={handleLogout}
              className="mt-2 flex items-center gap-2 text-sm text-red-600 hover:text-red-800 font-medium transition-colors"
            >
              <LogOut size={14} />
              Cerrar sesión
            </button>
          </div>
        )}
      </main>

      {/* FAB Speed Dial */}
      {FAB_ITEMS.some(i => i.roles.includes(user?.role) && (user?.role === 'superadmin' || !i.moduleKey || (modules !== null && modules[i.moduleKey] !== false))) && (
        <div className="fixed right-6 z-50" style={{ bottom: 'max(24px, calc(env(safe-area-inset-bottom, 0px) + 16px))' }}>
          {fabOpen && (
            <>
              <div className="fixed inset-0" onClick={() => setFabOpen(false)} />
              <div className="absolute bottom-16 right-0 flex flex-col-reverse gap-2.5 items-end pb-1">
                {FAB_ITEMS.filter(i => i.roles.includes(user?.role) && (user?.role === 'superadmin' || !i.moduleKey || (modules !== null && modules[i.moduleKey] !== false))).map(({ label, to, action, Icon, bg }) => (
                  <button
                    key={to || action}
                    onClick={() => { if (action === 'scan') setShowScanner(true); else navigate(to); setFabOpen(false) }}
                    className="relative flex items-center gap-2.5 group"
                  >
                    <span className="bg-gray-900 text-white text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-md font-medium">
                      {label}
                    </span>
                    <div className={`w-11 h-11 rounded-full ${bg} text-white shadow-lg flex items-center justify-center flex-shrink-0 hover:scale-110 transition-transform`}>
                      <Icon size={18} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            onClick={() => setFabOpen(!fabOpen)}
            className={`w-14 h-14 rounded-full text-white shadow-2xl flex items-center justify-center transition-all duration-200 ${fabOpen ? 'bg-gray-700 hover:bg-gray-800 rotate-45' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            <Plus size={24} />
          </button>
        </div>
      )}

      {showScanner && <TicketScanner onClose={() => setShowScanner(false)} />}
    </div>
  )
}
