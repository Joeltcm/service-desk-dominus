import React, { useEffect, useRef } from 'react'
import { Eraser } from 'lucide-react'

// Pad de firma sobre canvas (mouse, táctil y lápiz vía Pointer Events).
// `value` es el data URL actual; `onChange` recibe el nuevo data URL (o null al borrar).
export default function SignaturePad({ value, onChange, height = 150, disabled = false }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const lastPt = useRef(null)

  const ctx = () => canvasRef.current.getContext('2d')
  const cssW = () => canvasRef.current.clientWidth

  // Configura el canvas (resolución de pantalla) y dibuja la firma existente.
  useEffect(() => {
    const c = canvasRef.current
    const ratio = window.devicePixelRatio || 1
    c.width = cssW() * ratio
    c.height = height * ratio
    const g = c.getContext('2d')
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    g.lineWidth = 2.2
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.strokeStyle = '#0f172a'
    if (value) {
      const img = new Image()
      img.onload = () => g.drawImage(img, 0, 0, cssW(), height)
      img.src = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onDown = (e) => {
    if (disabled) return
    e.preventDefault()
    canvasRef.current.setPointerCapture?.(e.pointerId)
    drawing.current = true
    lastPt.current = pos(e)
  }

  const onMove = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    const p = pos(e)
    const g = ctx()
    g.beginPath()
    g.moveTo(lastPt.current.x, lastPt.current.y)
    g.lineTo(p.x, p.y)
    g.stroke()
    lastPt.current = p
  }

  const onUp = () => {
    if (!drawing.current) return
    drawing.current = false
    onChange?.(canvasRef.current.toDataURL('image/png'))
  }

  const clear = () => {
    ctx().clearRect(0, 0, cssW(), height)
    onChange?.(null)
  }

  return (
    <div>
      <div className="relative rounded-lg border-2 border-dashed border-gray-300 bg-white" style={{ touchAction: 'none' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          onPointerCancel={onUp}
          style={{ width: '100%', height: `${height}px`, display: 'block', cursor: disabled ? 'default' : 'crosshair' }}
        />
        {!value && <p className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 pointer-events-none">Firme aquí</p>}
      </div>
      {!disabled && (
        <button type="button" onClick={clear} className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-800 flex items-center gap-1">
          <Eraser size={12} /> Borrar firma
        </button>
      )}
    </div>
  )
}
