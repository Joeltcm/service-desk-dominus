import React, { useState, useEffect } from 'react'
import defaultLogo from '../assets/default-logo.png'
import dgsLogo from '../assets/dgs-logo.png'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { login as apiLogin, register as apiRegister, getCaptcha, forgotPassword, getPublicCompanyInfo, companyLogoUrl } from '../services/api'
import { Eye, EyeOff, Lock, Mail, RefreshCw, User, Phone, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Login() {
  const { company_sidebar_color: sidebarColor, company_name: companyName } = useCompany()
  const [publicInfo, setPublicInfo] = useState({ company_name: '', has_logo: false })
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [errorMsg, setErrorMsg] = useState('')

  // Login fields
  const [email, setEmail]           = useState(() => localStorage.getItem('remembered_email') || '')
  const [password, setPassword]     = useState('')
  const [showPass, setShowPass]     = useState(false)
  const [loading, setLoading]       = useState(false)
  const [remember, setRemember]     = useState(() => !!localStorage.getItem('remembered_email'))
  const [keepSession, setKeepSession] = useState(() => localStorage.getItem('keep_session') === '1')

  // Register fields
  const [regName, setRegName]         = useState('')
  const [regEmail, setRegEmail]       = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirm, setRegConfirm]   = useState('')
  const [regPhone, setRegPhone]       = useState('')
  const [regCompany, setRegCompany]   = useState('')
  const [showRegPass, setShowRegPass] = useState(false)

  // Captcha (shared)
  const [captcha, setCaptcha]             = useState(null)
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [captchaLoading, setCaptchaLoading] = useState(false)

  // Forgot password
  const [showForgot, setShowForgot]   = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent]   = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  const { login } = useAuth()
  const navigate  = useNavigate()

  useEffect(() => {
    getPublicCompanyInfo().then(r => setPublicInfo(r.data)).catch(() => {})
  }, [])

  const brandName = publicInfo.company_name || companyName || 'Service Desk'
  // El logo se pide directo al endpoint (primer render, sin esperar publicInfo → sin
  // parpadeo del default). Si no hay logo configurado, onError cae al default.
  const onLogoError = (e) => { e.currentTarget.onerror = null; e.currentTarget.src = defaultLogo }

  const loadCaptcha = async () => {
    setCaptchaLoading(true)
    setCaptchaAnswer('')
    try {
      const res = await getCaptcha()
      setCaptcha(res.data)
    } catch {
      toast.error('Error cargando captcha')
    } finally {
      setCaptchaLoading(false)
    }
  }

  useEffect(() => { loadCaptcha() }, [])

  const switchMode = (next) => {
    setMode(next)
    setErrorMsg('')
    setCaptchaAnswer('')
    loadCaptcha()
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    if (!captcha) return setErrorMsg('Espera a que cargue el captcha')
    if (!captchaAnswer.trim()) return setErrorMsg('Debes completar la verificación de seguridad')
    setLoading(true)
    try {
      const res = await apiLogin(email, password, captcha.id, captchaAnswer, keepSession)
      if (remember) localStorage.setItem('remembered_email', email)
      else localStorage.removeItem('remembered_email')
      if (keepSession) localStorage.setItem('keep_session', '1')
      else localStorage.removeItem('keep_session')
      login(res.data.access_token, res.data.user, keepSession)
      const role = res.data.user.role
      navigate(role === 'client' ? '/tickets' : role === 'superadmin' ? '/system' : '/dashboard')
    } catch (err) {
      const msg = err.response?.data?.detail || 'Error al ingresar'
      setErrorMsg(typeof msg === 'string' ? msg : 'Email o contraseña incorrectos')
      loadCaptcha()
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    if (!regName.trim()) return setErrorMsg('Ingresa tu nombre completo')
    if (regPassword.length < 6) return setErrorMsg('La contraseña debe tener al menos 6 caracteres')
    if (regPassword !== regConfirm) return setErrorMsg('Las contraseñas no coinciden')
    if (!captcha) return setErrorMsg('Espera a que cargue el captcha')
    if (!captchaAnswer.trim()) return setErrorMsg('Debes completar la verificación de seguridad')
    setLoading(true)
    try {
      const res = await apiRegister({
        name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
        phone: regPhone.trim() || null,
        company: regCompany.trim() || null,
        captcha_id: captcha.id,
        captcha_answer: captchaAnswer,
      })
      login(res.data.access_token, res.data.user)
      toast.success('¡Cuenta creada exitosamente!')
      navigate('/tickets')
    } catch (err) {
      const msg = err.response?.data?.detail || 'Error al crear cuenta'
      setErrorMsg(typeof msg === 'string' ? msg : 'Error al crear cuenta')
      loadCaptcha()
    } finally {
      setLoading(false)
    }
  }

  const handleForgot = async (e) => {
    e.preventDefault()
    if (!forgotEmail.trim()) return
    setForgotLoading(true)
    try {
      await forgotPassword(forgotEmail.trim(), window.location.origin)
      setForgotSent(true)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error enviando email')
    } finally {
      setForgotLoading(false)
    }
  }

  const captchaBlock = (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">Verificación de seguridad</label>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-sm font-semibold text-blue-800 select-none">
          {captchaLoading ? 'Cargando...' : (captcha?.question || '—')}
        </div>
        <button
          type="button"
          onClick={loadCaptcha}
          disabled={captchaLoading}
          className="p-2.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors disabled:opacity-40"
          title="Nueva pregunta"
        >
          <RefreshCw size={15} className={captchaLoading ? 'animate-spin' : ''} />
        </button>
      </div>
      <input
        type="number"
        className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
        style={{ fontSize: 16 }}
        placeholder="Tu respuesta"
        value={captchaAnswer}
        onChange={e => setCaptchaAnswer(e.target.value)}
        required
      />
    </div>
  )

  return (
    <div className="min-h-screen flex">
      {/* Left panel – branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center p-12 relative overflow-hidden" style={{ backgroundColor: sidebarColor || '#1a3353' }}>
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/5 rounded-full" />
        <div className="absolute -bottom-32 -right-20 w-[28rem] h-[28rem] bg-white/5 rounded-full" />
        <div className="relative z-10 text-center">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-2xl shadow-2xl overflow-hidden mb-6 ring-4 ring-white/20">
            <img
              src={companyLogoUrl()}
              onError={onLogoError}
              alt={brandName}
              className="w-full h-full object-cover"
            />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">{brandName}</h1>
          <p className="text-blue-200 text-base">Plataforma de Gestión Empresarial</p>
          <div className="mt-10 grid grid-cols-2 gap-4 text-left">
            {[
              { label: 'Tickets',  desc: 'Soporte y seguimiento' },
              { label: 'Ventas',   desc: 'Cotizaciones y pedidos' },
              { label: 'Facturas', desc: 'Facturación y cobros' },
              { label: 'Reportes', desc: 'Métricas y análisis' },
            ].map(f => (
              <div key={f.label} className="bg-white/8 rounded-xl px-4 py-3 border border-white/10">
                <p className="text-white font-semibold text-sm">{f.label}</p>
                <p className="text-blue-300 text-xs mt-0.5">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Developer credit */}
        <div className="absolute bottom-8 left-12 right-12 z-10 flex items-center gap-3 border-t border-white/10 pt-5">
          <img src={dgsLogo} alt="DG Solutions" className="w-9 h-9 rounded-xl object-cover flex-shrink-0 opacity-90" />
          <p className="text-blue-200/60 text-xs leading-snug">
            Aplicación desarrollada por{' '}
            <span className="text-blue-100/90 font-semibold">DG Solutions</span>
          </p>
        </div>
      </div>

      {/* Right panel – form */}
      <div className="flex-1 flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl overflow-hidden shadow ring-2 ring-gray-200">
              <img src={companyLogoUrl()} onError={onLogoError} alt={brandName} className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-gray-900 text-lg tracking-tight">{brandName}</span>
          </div>

          {errorMsg && (
            <div className="mb-4 flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
              <span>{errorMsg}</span>
            </div>
          )}

          {mode === 'login' ? (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">Bienvenido</h2>
              <p className="text-sm text-gray-500 mb-8">Ingresa tus credenciales para continuar</p>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="email"
                      autoComplete="email"
                      className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                      style={{ fontSize: 16 }}
                      placeholder="tu@email.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Contraseña</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type={showPass ? 'text' : 'password'}
                      autoComplete="current-password"
                      className="w-full pl-9 pr-10 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                      style={{ fontSize: 16 }}
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {captchaBlock}

                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={e => setRemember(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 accent-[#1a3353] cursor-pointer"
                    />
                    <span className="text-sm text-gray-600">Recordar usuario</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={keepSession}
                      onChange={e => setKeepSession(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 accent-[#1a3353] cursor-pointer"
                    />
                    <span className="text-sm text-gray-600">Mantener sesión iniciada <span className="text-gray-400">(30 días)</span></span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 shadow-sm mt-2" style={{ backgroundColor: sidebarColor || '#1a3353' }}
                >
                  {loading ? 'Ingresando...' : 'Ingresar'}
                </button>
              </form>

              <div className="mt-5 flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => { setShowForgot(true); setForgotSent(false); setForgotEmail('') }}
                  className="text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                >
                  ¿Olvidaste tu contraseña?
                </button>
                <div className="text-sm text-gray-500">
                  ¿No tienes cuenta?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="text-blue-600 font-semibold hover:text-blue-800 hover:underline transition-colors"
                  >
                    Crear cuenta
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">Crear cuenta</h2>
              <p className="text-sm text-gray-500 mb-8">Regístrate para acceder al portal de soporte</p>

              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre completo</label>
                  <div className="relative">
                    <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                      style={{ fontSize: 16 }}
                      placeholder="Juan Pérez"
                      value={regName}
                      onChange={e => setRegName(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="email"
                      className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                      style={{ fontSize: 16 }}
                      placeholder="tu@email.com"
                      value={regEmail}
                      onChange={e => setRegEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Contraseña</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type={showRegPass ? 'text' : 'password'}
                      className="w-full pl-9 pr-10 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                      style={{ fontSize: 16 }}
                      placeholder="Mínimo 6 caracteres"
                      value={regPassword}
                      onChange={e => setRegPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPass(!showRegPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showRegPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirmar contraseña</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type={showRegPass ? 'text' : 'password'}
                      className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                      style={{ fontSize: 16 }}
                      placeholder="Repite la contraseña"
                      value={regConfirm}
                      onChange={e => setRegConfirm(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Teléfono <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <div className="relative">
                    <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="tel"
                      className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                      style={{ fontSize: 16 }}
                      placeholder="+507 6000-0000"
                      value={regPhone}
                      onChange={e => setRegPhone(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Empresa <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <div className="relative">
                    <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                      style={{ fontSize: 16 }}
                      placeholder="Nombre de tu empresa"
                      value={regCompany}
                      onChange={e => setRegCompany(e.target.value)}
                    />
                  </div>
                </div>

                {captchaBlock}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 shadow-sm mt-2" style={{ backgroundColor: sidebarColor || '#1a3353' }}
                >
                  {loading ? 'Creando cuenta...' : 'Crear cuenta'}
                </button>
              </form>

              <div className="mt-5 text-center text-sm text-gray-500">
                ¿Ya tienes cuenta?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-blue-600 font-semibold hover:text-blue-800 hover:underline transition-colors"
                >
                  Ingresar
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal recuperación */}
      {showForgot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            {forgotSent ? (
              <div className="text-center">
                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Mail size={24} className="text-green-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">Revisa tu correo</h3>
                <p className="text-sm text-gray-500 mb-6">
                  Si ese email está registrado, recibirás un enlace para restablecer tu contraseña en los próximos minutos.
                </p>
                <button
                  onClick={() => setShowForgot(false)}
                  className="w-full py-2.5 text-white rounded-lg text-sm font-semibold transition-colors" style={{ backgroundColor: sidebarColor || '#1a3353' }}
                >
                  Entendido
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-bold text-gray-900 mb-1">Recuperar contraseña</h3>
                <p className="text-sm text-gray-500 mb-5">
                  Ingresa tu email y te enviaremos un enlace para crear una nueva contraseña.
                </p>
                <form onSubmit={handleForgot} className="space-y-4">
                  <div className="relative">
                    <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="email"
                      className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                      style={{ fontSize: 16 }}
                      placeholder="tu@email.com"
                      value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="w-full py-2.5 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-60" style={{ backgroundColor: sidebarColor || '#1a3353' }}
                  >
                    {forgotLoading ? 'Enviando...' : 'Enviar enlace'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForgot(false)}
                    className="w-full py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
