import React from 'react'
import { useNavigate } from 'react-router-dom'
import { companyLogoUrl } from '../services/api'
import dgsLogo from '../assets/dgs-logo.png'
import { LifeBuoy, ShoppingCart, Ticket, Package, ArrowRight, LogIn } from 'lucide-react'

export default function PublicLanding() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-8 py-4">
        <img
          src={companyLogoUrl()} alt="Logo" className="h-9 w-auto object-contain"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
        <button onClick={() => navigate('/login')} className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900">
          <LogIn size={16} /> Iniciar sesión
        </button>
      </header>

      <main className="flex-1 flex items-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 w-full">
          <div className="text-center mb-8">
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">¿Cómo te ayudamos hoy?</h1>
            <p className="text-gray-500 mt-2">Levanta un ticket de soporte o solicita un pedido. Es rápido.</p>
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
              className="group relative overflow-hidden rounded-2xl p-6 sm:p-8 text-left bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
            >
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center mb-4"><ShoppingCart size={26} /></div>
              <h2 className="text-xl font-bold">Solicitar un pedido</h2>
              <p className="text-white/80 text-sm mt-1">Pide equipos o artículos; nosotros lo evaluamos por ti.</p>
              <span className="inline-flex items-center gap-1 text-sm font-semibold mt-4">Empezar <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" /></span>
              <Package size={120} className="absolute -right-6 -bottom-6 text-white/10" />
            </button>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">Al enviar te pediremos iniciar sesión o crear una cuenta (gratis).</p>
        </div>
      </main>

      <footer className="py-5 flex items-center justify-center gap-2">
        <img src={dgsLogo} alt="DG Solutions" className="w-6 h-6 rounded-md object-cover opacity-70" />
        <p className="text-[11px] text-gray-400">Aplicación desarrollada por <span className="text-gray-600 font-semibold">DG Solutions</span></p>
      </footer>
    </div>
  )
}
