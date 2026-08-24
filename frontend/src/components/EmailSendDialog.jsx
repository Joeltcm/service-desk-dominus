import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Mail, Loader2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Modal para enviar un documento por correo. Prellena el correo del proveedor y
// permite editarlo / agregar más correos (separados por coma). onSend recibe la
// cadena final (ej. "a@x.com, b@y.com") y debe devolver una promesa.
export default function EmailSendDialog({ title = 'Enviar por correo', subtitle, defaultEmail = '', onClose, onSend }) {
  const [value, setValue] = useState(defaultEmail || '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const emails = value.split(/[,;]+/).map(s => s.trim()).filter(Boolean)
    if (!emails.length) return toast.error('Indica al menos un correo')
    const bad = emails.find(e => !EMAIL_RE.test(e))
    if (bad) return toast.error(`Correo no válido: ${bad}`)
    setBusy(true)
    try {
      await onSend(emails.join(','))
      toast.success(emails.length > 1 ? `Correo enviado a ${emails.length} destinatarios` : 'Correo enviado')
      onClose()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'No se pudo enviar')
    } finally { setBusy(false) }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-3" onClick={busy ? undefined : onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-emerald-600" />
            <h2 className="text-base font-bold text-gray-900">{title}</h2>
          </div>
          <button onClick={onClose} disabled={busy} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 disabled:opacity-50"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-2">
          {subtitle && <p className="text-xs text-gray-500 -mt-1">{subtitle}</p>}
          <label className="label">Destinatario(s)</label>
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            rows={2}
            autoFocus
            placeholder="correo@proveedor.com"
            className="input resize-none"
            style={{ fontSize: 16 }}
          />
          <p className="text-[11px] text-gray-400 flex items-center gap-1">
            <Plus size={11} /> Separa varios correos con comas para enviar a más de un destinatario.
          </p>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex gap-2 justify-end">
          <button onClick={onClose} disabled={busy} className="btn-secondary">Cancelar</button>
          <button onClick={submit} disabled={busy} className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />} {busy ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
