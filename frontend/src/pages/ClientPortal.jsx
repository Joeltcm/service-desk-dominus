import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { companyLogoUrl } from '../services/api'
import defaultLogo from '../assets/default-logo.png'
import dgsLogo from '../assets/dgs-logo.png'
import { LifeBuoy, ShoppingCart, Ticket, Package, FileText, ArrowRight } from 'lucide-react'

function QuickLink({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-3 bg-white/10 border border-white/10 rounded-xl text-sm font-medium text-blue-50 hover:bg-white/15 transition-colors"
    >
      <span className="text-blue-200">{icon}</span> {label}
    </button>
  )
}

export default function ClientPortal() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { company_name: companyName, company_app_name: appName, company_sidebar_color: sidebarColor } = useCompany()
  const brandName = companyName || appName || 'Dominus Tech'
  const firstName = (user?.name || '').split(' ')[0] || ''
  const onLogoError = (e) => { e.currentTarget.onerror = null; e.currentTarget.src = defaultLogo }

  return (
    <div className="flex-1 overflow-y-auto relative" style={{ backgroundColor: sidebarColor || '#1a3353' }}>
      {/* Fondo decorativo (igual al login) */}
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/5 rounded-full pointer-events-none" />
      <div className="absolute -bottom-32 -right-20 w-[28rem] h-[28rem] bg-white/5 rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* Branding — logo protagonista + nombre */}
        <div className="text-center mb-9">
          <div className="inline-flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-2xl shadow-2xl overflow-hidden mb-4 ring-4 ring-white/20">
            <img src={companyLogoUrl()} onError={onLogoError} alt={brandName} className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{brandName}</h1>
          <p className="text-blue-200 mt-1.5">Hola{firstName ? `, ${firstName}` : ''} 👋 ¿En qué te ayudamos hoy?</p>
        </div>

        {/* Acciones */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          <button
            onClick={() => navigate('/tickets/new')}
            className="group relative overflow-hidden rounded-2xl p-6 sm:p-8 text-left bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
          >
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center mb-4"><LifeBuoy size={26} /></div>
            <h2 className="text-xl font-bold">Levantar un ticket</h2>
            <p className="text-white/80 text-sm mt-1">Reporta una falla o solicita soporte técnico. Un agente te atenderá.</p>
            <span className="inline-flex items-center gap-1 text-sm font-semibold mt-4">Crear ticket <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" /></span>
            <Ticket size={120} className="absolute -right-6 -bottom-6 text-white/10" />
          </button>

          <button
            onClick={() => navigate('/mis-pedidos?new=1')}
            className="group relative overflow-hidden rounded-2xl p-6 sm:p-8 text-left bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
          >
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center mb-4"><ShoppingCart size={26} /></div>
            <h2 className="text-xl font-bold">Solicitar un pedido</h2>
            <p className="text-white/80 text-sm mt-1">Pide equipos o artículos. Descríbelo aunque no sepas el modelo exacto; nosotros lo evaluamos.</p>
            <span className="inline-flex items-center gap-1 text-sm font-semibold mt-4">Crear pedido <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" /></span>
            <Package size={120} className="absolute -right-6 -bottom-6 text-white/10" />
          </button>
        </div>

        {/* Accesos rápidos */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
          <QuickLink icon={<Ticket size={16} />} label="Mis tickets" onClick={() => navigate('/tickets')} />
          <QuickLink icon={<Package size={16} />} label="Mis pedidos" onClick={() => navigate('/mis-pedidos')} />
          <QuickLink icon={<FileText size={16} />} label="Mis documentos" onClick={() => navigate('/mis-documentos')} />
        </div>

        {/* Crédito del desarrollador */}
        <div className="flex items-center justify-center gap-2 mt-12">
          <img src={dgsLogo} alt="DG Solutions" className="w-6 h-6 rounded-md object-cover opacity-70" />
          <p className="text-blue-200/50 text-xs">Aplicación desarrollada por <span className="text-blue-100/80 font-semibold">DG Solutions</span></p>
        </div>
      </div>
    </div>
  )
}
