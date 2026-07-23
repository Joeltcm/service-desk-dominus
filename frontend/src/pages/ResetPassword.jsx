import React, { useState } from 'react'
import { useCompany } from '../context/CompanyContext'
import defaultLogo from '../assets/default-logo.png'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { resetPassword } from '../services/api'
import { Lock, Eye, EyeOff, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ResetPassword() {
  const { company_name } = useCompany()
  const [params]    = useSearchParams()
  const navigate    = useNavigate()
  const token       = params.get('token') || ''

  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [showPass, setShowPass]     = useState(false)
  const [loading, setLoading]       = useState(false)
  const [done, setDone]             = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password !== confirm) return toast.error('Las contraseñas no coinciden')
    if (password.length < 6) return toast.error('Mínimo 6 caracteres')
    setLoading(true)
    try {
      await resetPassword(token, password)
      setDone(true)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Enlace inválido o expirado')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl overflow-hidden shadow ring-2 ring-gray-200">
            <img src={defaultLogo} alt="DG" className="w-full h-full object-cover" />
          </div>
          <span className="font-bold text-gray-900 text-lg tracking-tight">{company_name || 'Service Desk'}</span>
        </div>

        {done ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={32} className="text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Contraseña actualizada</h2>
            <p className="text-sm text-gray-500 mb-6">Tu contraseña fue cambiada exitosamente.</p>
            <button
              onClick={() => navigate('/login')}
              className="w-full py-2.5 bg-[#1a3353] text-white rounded-lg text-sm font-semibold hover:bg-[#1e3d61] transition-colors"
            >
              Ir al inicio de sesión
            </button>
          </div>
        ) : !token ? (
          <div className="text-center">
            <p className="text-gray-500 text-sm mb-4">Enlace de recuperación inválido.</p>
            <button onClick={() => navigate('/login')} className="text-blue-600 hover:underline text-sm">
              Volver al inicio de sesión
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Nueva contraseña</h2>
            <p className="text-sm text-gray-500 mb-8">Elige una contraseña segura para tu cuenta.</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nueva contraseña</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    className="w-full pl-9 pr-10 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                    style={{ fontSize: 16 }}
                    placeholder="Mínimo 6 caracteres"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirmar contraseña</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                    style={{ fontSize: 16 }}
                    placeholder="Repite la contraseña"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#1a3353] text-white rounded-lg text-sm font-semibold hover:bg-[#1e3d61] transition-colors disabled:opacity-60 shadow-sm mt-2"
              >
                {loading ? 'Guardando...' : 'Cambiar contraseña'}
              </button>
            </form>

            <div className="mt-5 text-center">
              <button onClick={() => navigate('/login')} className="text-sm text-gray-500 hover:text-gray-700 hover:underline">
                Volver al inicio de sesión
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
