import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Ticket, Package, FileText, ArrowRight, LifeBuoy, ShoppingCart } from 'lucide-react'

function QuickLink({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
    >
      <span className="text-gray-400">{icon}</span> {label}
    </button>
  )
}

export default function ClientPortal() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const firstName = (user?.name || '').split(' ')[0] || ''

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Hola{firstName ? `, ${firstName}` : ''} 👋</h1>
          <p className="text-gray-500 mt-1">¿En qué te podemos ayudar hoy?</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          {/* Levantar un ticket */}
          <button
            onClick={() => navigate('/tickets/new')}
            className="group relative overflow-hidden rounded-2xl p-6 sm:p-8 text-left bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
          >
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center mb-4">
              <LifeBuoy size={26} />
            </div>
            <h2 className="text-xl font-bold">Levantar un ticket</h2>
            <p className="text-white/80 text-sm mt-1">Reporta una falla o solicita soporte técnico. Un agente te atenderá.</p>
            <span className="inline-flex items-center gap-1 text-sm font-semibold mt-4">
              Crear ticket <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </span>
            <Ticket size={120} className="absolute -right-6 -bottom-6 text-white/10" />
          </button>

          {/* Solicitar un pedido */}
          <button
            onClick={() => navigate('/mis-pedidos?new=1')}
            className="group relative overflow-hidden rounded-2xl p-6 sm:p-8 text-left bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
          >
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center mb-4">
              <ShoppingCart size={26} />
            </div>
            <h2 className="text-xl font-bold">Solicitar un pedido</h2>
            <p className="text-white/80 text-sm mt-1">Pide equipos o artículos. Descríbelo aunque no sepas el modelo exacto; nosotros lo evaluamos.</p>
            <span className="inline-flex items-center gap-1 text-sm font-semibold mt-4">
              Crear pedido <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </span>
            <Package size={120} className="absolute -right-6 -bottom-6 text-white/10" />
          </button>
        </div>

        {/* Accesos rápidos */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
          <QuickLink icon={<Ticket size={16} />} label="Mis tickets" onClick={() => navigate('/tickets')} />
          <QuickLink icon={<Package size={16} />} label="Mis pedidos" onClick={() => navigate('/mis-pedidos')} />
          <QuickLink icon={<FileText size={16} />} label="Mis documentos" onClick={() => navigate('/mis-documentos')} />
        </div>
      </div>
    </div>
  )
}
