import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, QrCode, AlertTriangle } from 'lucide-react'

// Extrae el N° de ticket del contenido del QR. Solo se usa el id numérico y se
// navega DENTRO de la app (nunca al URL escaneado) para evitar redirecciones a
// sitios externos desde un QR malicioso.
export function extractTicketId(text) {
  if (!text) return null
  const s = String(text).trim()
  const m = s.match(/\/tickets\/(\d+)/i)
  if (m) return m[1]
  if (/^\d+$/.test(s)) return s
  return null
}

export default function TicketScanner({ onClose }) {
  const navigate = useNavigate()
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const doneRef = useRef(false)
  const jsqrRef = useRef(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('Iniciando cámara…')

  useEffect(() => {
    let cancelled = false

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }

    const tick = () => {
      if (doneRef.current || cancelled) return
      const v = videoRef.current
      const c = canvasRef.current
      if (v && c && jsqrRef.current && v.readyState === v.HAVE_ENOUGH_DATA) {
        const w = v.videoWidth
        const h = v.videoHeight
        if (w && h) {
          c.width = w
          c.height = h
          const ctx = c.getContext('2d', { willReadFrequently: true })
          ctx.drawImage(v, 0, 0, w, h)
          const img = ctx.getImageData(0, 0, w, h)
          const code = jsqrRef.current(img.data, w, h, { inversionAttempts: 'dontInvert' })
          if (code && code.data) {
            const id = extractTicketId(code.data)
            if (id) {
              doneRef.current = true
              stop()
              navigate(`/tickets/${id}`)
              onClose?.()
              return
            }
            setStatus('QR no reconocido — apunta al código del ticket')
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este dispositivo/navegador no permite acceder a la cámara.')
        return
      }
      try {
        // Carga diferida del decodificador (evita inflar el bundle principal).
        jsqrRef.current = (await import('jsqr')).default
      } catch {
        setError('No se pudo cargar el lector de QR.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const v = videoRef.current
        v.srcObject = stream
        v.setAttribute('playsinline', 'true')
        v.muted = true
        await v.play()
        setStatus('Apunta la cámara al código QR del ticket')
        rafRef.current = requestAnimationFrame(tick)
      } catch (e) {
        setError(
          e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
            ? 'Permiso de cámara denegado. Habilítalo en los ajustes del navegador y vuelve a intentar.'
            : 'No se pudo acceder a la cámara.'
        )
      }
    }

    start()
    return () => { cancelled = true; stop() }
  }, [navigate, onClose])

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 text-white bg-black/60">
        <div className="flex items-center gap-2">
          <QrCode size={18} />
          <span className="text-sm font-semibold">Escanear ticket</span>
        </div>
        <button onClick={onClose} className="p-2 -mr-2 rounded-lg hover:bg-white/10" aria-label="Cerrar">
          <X size={22} />
        </button>
      </div>

      {/* Camera / error */}
      <div className="flex-1 relative overflow-hidden">
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8 gap-3 text-white">
            <AlertTriangle size={40} className="text-amber-400" />
            <p className="text-sm text-white/80 max-w-xs leading-relaxed">{error}</p>
            <button onClick={onClose} className="mt-2 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-medium">
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
            {/* Marco guía */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-56 h-56 max-w-[70vw] max-h-[70vw] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            </div>
            <div className="absolute bottom-8 left-0 right-0 text-center px-6">
              <p className="text-white text-sm bg-black/50 inline-block px-3 py-1.5 rounded-full">{status}</p>
            </div>
          </>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
