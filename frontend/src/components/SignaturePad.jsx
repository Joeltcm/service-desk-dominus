import React, { useRef, useEffect, useState } from 'react'
import { Eraser } from 'lucide-react'

/**
 * Pad de firma sobre <canvas>. Táctil + mouse (pointer events) para móvil/PWA.
 * Llama onChange(dataUrl) al terminar cada trazo, y onChange('') al limpiar.
 */
export default function SignaturePad({ onChange, height = 150, label = 'Firma' }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const last = useRef({ x: 0, y: 0 })
  const [empty, setEmpty] = useState(true)

  // Ajusta el tamaño real del canvas a su contenedor (nítido en pantallas HiDPI).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.offsetWidth || 300
    canvas.width = w * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
  }, [height])

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e) => {
    e.preventDefault()
    drawing.current = true
    last.current = pos(e)
  }

  const move = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = pos(e)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    if (empty) setEmpty(false)
  }

  const end = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    drawing.current = false
    if (!empty && onChange) onChange(canvasRef.current.toDataURL('image/png'))
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setEmpty(true)
    if (onChange) onChange('')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          <Eraser size={13} /> Limpiar
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{ height, touchAction: 'none', width: '100%' }}
        className="border border-gray-300 rounded-lg bg-white cursor-crosshair"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      {empty && <p className="text-[11px] text-gray-400 mt-1">Firma aquí con el dedo o el mouse</p>}
    </div>
  )
}
