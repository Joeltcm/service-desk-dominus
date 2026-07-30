/**
 * Shared item-editor table used by Quotes, Orders, Dispatches, and Invoices.
 * Items shape: { code, description, qty, unit_price }
 */
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { X, Search } from 'lucide-react'
import { searchInventory } from '../services/api'
import toast from 'react-hot-toast'

const LOW_STOCK_THRESHOLD = 5

// Aviso al seleccionar un artículo del inventario: alerta restrictiva si no hay
// stock, o aviso si está bajo. (El campo quantity viene en la respuesta del buscador.)
function alertStockOnSelect(inv) {
  const qty = parseFloat(inv.quantity || '0') || 0
  if (qty <= 0) {
    toast.error(`⛔ Sin stock disponible de "${inv.name || inv.code}" (0 en inventario)`, { duration: 6000 })
  } else if (qty <= LOW_STOCK_THRESHOLD) {
    toast(`Stock bajo de "${inv.name || inv.code}": ${qty} disponible(s)`, { icon: '⚠️', duration: 5000 })
  }
}

export const EMPTY_ITEM = { code: '', description: '', qty: 1, unit_price: '', itbms: true }

export function parseItems(str) {
  if (!str) return [{ ...EMPTY_ITEM }]
  try {
    const arr = JSON.parse(str)
    if (Array.isArray(arr) && arr.length)
      return arr.map(it => ({
        code: it.code || '',
        description: it.description || '',
        qty: it.qty ?? 1,
        unit_price: it.unit_price ?? '',
        itbms: it.itbms !== false,
      }))
  } catch {}
  return [{ ...EMPTY_ITEM }]
}

export function calcTotals(items, itbms) {
  const subtotal = items.reduce((s, it) => {
    const line = Math.round((parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0) * 100) / 100
    return s + line
  }, 0)
  if (!itbms) return { subtotal, itbmsAmt: 0, total: subtotal }
  const taxable = items.reduce((s, it) => {
    if (it.itbms === false) return s
    return s + Math.round((parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0) * 100) / 100
  }, 0)
  const itbmsAmt = Math.ceil(taxable * 0.07 * 100) / 100
  return { subtotal, itbmsAmt, total: subtotal + itbmsAmt }
}

function fmtMoney(n) { return Number(n || 0).toFixed(2) }

function ItemRow({ item, idx, onChange, onRemove, canRemove, descSuggestions, itbmsEnabled }) {
  const [showCodeSugg, setShowCodeSugg] = useState(false)
  const [showDescSugg, setShowDescSugg] = useState(false)
  const [codeInvResults, setCodeInvResults] = useState([])
  const [descInvResults, setDescInvResults] = useState([])
  const [codeDropStyle, setCodeDropStyle] = useState({})
  const [descDropStyle, setDescDropStyle] = useState({})
  const codeTimerRef = useRef(null)
  const descTimerRef = useRef(null)
  const codeRef = useRef(null)
  const descRef = useRef(null)

  const calcDropStyle = (ref) => {
    if (!ref.current) return {}
    const rect = ref.current.getBoundingClientRect()
    // Use visualViewport when available (iOS keyboard resize awareness)
    const vvHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight
    const vvOffsetTop = window.visualViewport ? window.visualViewport.offsetTop : 0
    const flipUp = vvHeight - (rect.bottom - vvOffsetTop) < 220
    return {
      position: 'fixed',
      left: rect.left,
      width: Math.max(rect.width, 260),
      zIndex: 9999,
      ...(flipUp
        ? { bottom: vvHeight - (rect.top - vvOffsetTop) + 2 }
        : { top: rect.bottom + 2 }),
    }
  }

  const searchCode = useCallback((q) => {
    clearTimeout(codeTimerRef.current)
    if (!q.trim()) { setCodeInvResults([]); return }
    codeTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchInventory(q)
        setCodeInvResults(res.data || [])
      } catch { setCodeInvResults([]) }
    }, 200)
  }, [])

  const searchDesc = useCallback((q) => {
    clearTimeout(descTimerRef.current)
    if (!q.trim()) { setDescInvResults([]); return }
    descTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchInventory(q)
        setDescInvResults(res.data || [])
      } catch { setDescInvResults([]) }
    }, 200)
  }, [])

  const selectInventoryFromCode = (inv) => {
    onChange(idx, 'code', inv.code)
    onChange(idx, 'description', inv.name)
    onChange(idx, 'unit_price', inv.unit_price || '')
    alertStockOnSelect(inv)
    setCodeInvResults([])
    setShowCodeSugg(false)
    descRef.current?.focus()
  }

  const selectInventoryFromDesc = (inv) => {
    onChange(idx, 'code', inv.code)
    onChange(idx, 'description', inv.name)
    onChange(idx, 'unit_price', inv.unit_price || '')
    alertStockOnSelect(inv)
    setDescInvResults([])
    setShowDescSugg(false)
  }

  const filteredDescSugg = descSuggestions
    ? (item.description
        ? descSuggestions.filter(s => s.toLowerCase().includes(item.description.toLowerCase())).slice(0, 6)
        : descSuggestions.slice(0, 6))
    : []

  const line = (parseFloat(item.qty) || 0) * (parseFloat(item.unit_price) || 0)

  return (
    <tr className="group border-b border-gray-100 last:border-0">
      {/* # */}
      <td className="py-2 pl-1 pr-1 w-7 text-xs text-gray-400 text-center">{idx + 1}</td>

      {/* Code */}
      <td className="py-1 pr-1 w-28">
        <input
          ref={codeRef}
          className="w-full input text-xs py-1.5 px-2 font-mono"
          value={item.code}
          placeholder="Código"
          onChange={e => { onChange(idx, 'code', e.target.value); searchCode(e.target.value) }}
          onFocus={() => { setShowCodeSugg(true); setCodeDropStyle(calcDropStyle(codeRef)); if (item.code) searchCode(item.code) }}
          onBlur={() => setTimeout(() => setShowCodeSugg(false), 150)}
          autoComplete="off"
          style={{ fontSize: '16px' }}
        />
        {showCodeSugg && codeInvResults.length > 0 && (
          <ul style={codeDropStyle} className="bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto">
            {codeInvResults.map(inv => (
              <li key={inv.id}>
                <button
                  type="button"
                  onMouseDown={() => selectInventoryFromCode(inv)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-blue-700">{inv.code}</span>
                    <span className="text-xs text-gray-400">${parseFloat(inv.unit_price || 0).toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-gray-700 truncate">{inv.name}</p>
                  {(() => { const q = parseFloat(inv.quantity || '0') || 0; return (
                    <p className={`text-xs ${q <= 0 ? 'text-red-500 font-semibold' : q <= LOW_STOCK_THRESHOLD ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                      Stock: {inv.quantity || '0'} {inv.unit || ''}{q <= 0 ? ' · ⛔ sin stock' : q <= LOW_STOCK_THRESHOLD ? ' · ⚠️ bajo' : ''}
                    </p>
                  )})()}
                </button>
              </li>
            ))}
          </ul>
        )}
      </td>

      {/* Description */}
      <td className="py-1 pr-2">
        <input
          ref={descRef}
          className="w-full input text-sm py-1.5 px-2"
          value={item.description}
          placeholder="Descripción del artículo o servicio..."
          onChange={e => { onChange(idx, 'description', e.target.value); setShowDescSugg(true); setDescDropStyle(calcDropStyle(descRef)); searchDesc(e.target.value) }}
          onFocus={() => { setShowDescSugg(true); setDescDropStyle(calcDropStyle(descRef)); if (item.description) searchDesc(item.description) }}
          onBlur={() => setTimeout(() => setShowDescSugg(false), 150)}
          autoComplete="off"
          style={{ fontSize: '16px' }}
        />
        {showDescSugg && (descInvResults.length > 0 || filteredDescSugg.length > 0) && (
          <ul style={descDropStyle} className="bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto">
            {descInvResults.map(inv => (
              <li key={`inv-${inv.id}`}>
                <button
                  type="button"
                  onMouseDown={() => selectInventoryFromDesc(inv)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-800 font-medium truncate">{inv.name}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">${parseFloat(inv.unit_price || 0).toFixed(2)}</span>
                  </div>
                  {(() => { const q = parseFloat(inv.quantity || '0') || 0; return (
                    <p className="text-xs font-mono"><span className="text-blue-600">{inv.code}</span> · <span className={q <= 0 ? 'text-red-500 font-semibold' : q <= LOW_STOCK_THRESHOLD ? 'text-amber-600 font-medium' : 'text-gray-400'}>Stock: {inv.quantity || '0'}{q <= 0 ? ' ⛔' : q <= LOW_STOCK_THRESHOLD ? ' ⚠️' : ''}</span></p>
                  )})()}
                </button>
              </li>
            ))}
            {descInvResults.length > 0 && filteredDescSugg.length > 0 && (
              <li className="px-3 py-1 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">Sugerencias</li>
            )}
            {filteredDescSugg.map(s => (
              <li key={s}>
                <button
                  type="button"
                  onMouseDown={() => { onChange(idx, 'description', s); setShowDescSugg(false) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 text-gray-800"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </td>

      {/* Qty */}
      <td className="py-1 pr-2 w-20">
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          className="w-full input text-sm py-1.5 px-2 text-center"
          value={item.qty}
          onChange={e => onChange(idx, 'qty', e.target.value)}
          style={{ fontSize: '16px' }}
        />
      </td>

      {/* Unit price */}
      <td className="py-1 pr-2 w-28">
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          className="w-full input text-sm py-1.5 px-2 text-right"
          value={item.unit_price}
          placeholder="0.00"
          onChange={e => onChange(idx, 'unit_price', e.target.value)}
          style={{ fontSize: '16px' }}
        />
      </td>

      {/* ITBMS per-item toggle */}
      {itbmsEnabled && (
        <td className="py-1 pr-2 w-12 text-center">
          <input
            type="checkbox"
            checked={item.itbms !== false}
            onChange={e => onChange(idx, 'itbms', e.target.checked)}
            className="rounded border-gray-300 accent-amber-500 cursor-pointer"
            title="Aplica ITBMS 7%"
          />
        </td>
      )}

      {/* Line total */}
      <td className="py-1 pr-1 w-28 text-right text-sm font-semibold text-gray-900">
        ${fmtMoney(line)}
      </td>

      {/* Remove */}
      <td className="py-1 pr-2 w-10 text-center">
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(idx)}
            className="p-2.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </td>
    </tr>
  )
}

/**
 * Full item table: headers + rows + add button + totals.
 * Props:
 *   items         – array of item objects
 *   onChange      – (idx, field, value) callback
 *   onRemove      – (idx) callback
 *   onAdd         – () callback
 *   itbms         – bool
 *   onItbmsChange – (bool) callback
 *   descSuggestions – string[] for description autocomplete (optional)
 *   readOnly      – bool (hide add/remove controls)
 */
export default function ItemEditor({ items, onChange, onRemove, onAdd, itbms, onItbmsChange, descSuggestions, readOnly }) {
  const { subtotal, itbmsAmt, total } = calcTotals(items, itbms)

  return (
    <div className="space-y-2">
      <div className="relative">
      <div className="overflow-x-auto -mx-1">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="pb-2 pl-1 pr-1 w-7 text-xs font-medium text-gray-400 text-center">#</th>
              <th className="pb-2 pr-1 w-28 text-xs font-medium text-gray-400 text-left">Código</th>
              <th className="pb-2 pr-2 text-xs font-medium text-gray-400 text-left">Descripción</th>
              <th className="pb-2 pr-2 w-20 text-xs font-medium text-gray-400 text-center">Cant.</th>
              <th className="pb-2 pr-2 w-28 text-xs font-medium text-gray-400 text-right">Precio unit.</th>
              {itbms && <th className="pb-2 pr-2 w-12 text-xs font-medium text-amber-600 text-center">ITBMS</th>}
              <th className="pb-2 pr-1 w-28 text-xs font-medium text-gray-400 text-right">Total</th>
              <th className="pb-2 pr-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <ItemRow
                key={idx}
                item={item}
                idx={idx}
                onChange={onChange}
                onRemove={onRemove}
                canRemove={!readOnly && items.length > 1}
                descSuggestions={descSuggestions}
                itbmsEnabled={!!itbms}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent sm:hidden" />
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={onAdd}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium py-1 px-2 rounded hover:bg-blue-50 transition-colors"
        >
          + Agregar línea
        </button>
      )}

      {/* Totals */}
      <div className="border-t border-gray-100 pt-3 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Subtotal</span>
          <span className="font-medium">${fmtMoney(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!itbms}
              onChange={e => onItbmsChange?.(e.target.checked)}
              disabled={readOnly}
              className="rounded border-gray-300"
            />
            <span className="text-gray-500">ITBMS 7%</span>
          </label>
          <span className={itbms ? 'font-medium text-amber-700' : 'text-gray-400'}>${fmtMoney(itbmsAmt)}</span>
        </div>
        <div className="flex items-center justify-between text-base font-bold border-t border-gray-100 pt-2">
          <span>Total</span>
          <span>${fmtMoney(total)}</span>
        </div>
      </div>
    </div>
  )
}
