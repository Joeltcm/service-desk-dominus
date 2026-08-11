import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { companyLogoUrl, getPublicCompanyInfo } from '../services/api'
import defaultLogo from '../assets/default-logo.png'
import dgsLogo from '../assets/dgs-logo.png'
import { LifeBuoy, ShoppingCart, Ticket, Package, ArrowRight, LogIn } from 'lucide-react'

export default function PublicLanding() {
  const navigate = useNavigate()
  const [info, setInfo] = useState({ company_name: '', company_sidebar_color: '' })
  useEffect(() => { getPublicCompanyInfo().then((r) => setInfo(r.data || {})).catch(() => {}) }, [])
  const brandName = info.company_name || info.company_app_name || 'Dominus Tech'
  const bg = info.company_sidebar_color || '#1a3353'
  const onLogoError = (e) => { e.currentTarget.onerror = null; e.currentTarget.src = defaultLogo }

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

      <main className="relative z-10 flex-1 flex items-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 w-full">
          <div className="text-center mb-9">
            <div className="inline-flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-2xl shadow-2xl overflow-hidden mb-4 ring-4 ring-white/20">
              <img src={companyLogoUrl()} onError={onLogoError} alt={brandName} className="w-full h-full object-cover" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">{brandName}</h1>
            <p className="text-blue-200 mt-2">¿Cómo te ayudamos hoy? Levanta un ticket o solicita un pedido.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <button
              onClick={() => navigate('/solicitar?tipo=ticket')}
              className="group relative overflow-hidden rounded-2xl p-6 sm:p-8 text-left bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
            >
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center mb-4"><LifeBuoy size={26} /></div>
              <h2 className="text-xl font-bold">Levantar un ticket</h2>
              <p className="text-white/80 text-sm mt-1">Reporta una falla o solicita soporte técnico.</p>
              <span className="inline-flex items-center gap-1 text-sm font-semibold mt-4">Empezar <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" /></span>
              <Ticket size={120} className="absolute -right-6 -bottom-6 text-white/10" />
            </button>

            <button
              onClick={() => navigate('/solicitar?tipo=pedido')}
              className="group relative overflow-hidden rounded-2xl p-6 sm:p-8 text-left bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
            >
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center mb-4"><ShoppingCart size={26} /></div>
              <h2 className="text-xl font-bold">Solicitar un pedido</h2>
              <p className="text-white/80 text-sm mt-1">Pide equipos o artículos; nosotros lo evaluamos por ti.</p>
              <span className="inline-flex items-center gap-1 text-sm font-semibold mt-4">Empezar <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" /></span>
              <Package size={120} className="absolute -right-6 -bottom-6 text-white/10" />
            </button>
          </div>

          <p className="text-center text-xs text-blue-200/50 mt-6">Al enviar te pediremos iniciar sesión o crear una cuenta (gratis).</p>
        </div>
      </main>

      <footer className="relative z-10 py-5 flex items-center justify-center gap-2">
        <img src={dgsLogo} alt="DG Solutions" className="w-6 h-6 rounded-md object-cover opacity-70" />
        <p className="text-[11px] text-blue-200/50">Aplicación desarrollada por <span className="text-blue-100/80 font-semibold">DG Solutions</span></p>
      </footer>
    </div>
  )
}
