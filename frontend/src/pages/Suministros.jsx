import { showConfirm } from '../utils/confirm'
import { companyLogoSrc } from '../utils/branding'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { fmtD } from '../utils/fmt'
import { useSearchParams } from 'react-router-dom'
import { getCompanyCache } from '../context/CompanyContext'
import {
  getSupplyLots, createSupplyLot, updateSupplyLot, deleteSupplyLot,
  getSupplyDeliveries, getSupplyDelivery, createSupplyDelivery, updateSupplyDelivery, deleteSupplyDelivery,
  getContracts, getPrinters, getSupplyItems, getUsers, createUser, getSupplyStats,
} from '../services/api'
import {
  Plus, Search, X, Save, Pencil, Trash2, Package, Truck,
  Printer as PrinterIcon, AlertCircle, CheckCircle2, FileText,
  ChevronDown, ChevronUp, ExternalLink, UserPlus, BarChart2,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import toast from 'react-hot-toast'

// ── Helpers ───────────────────────────────────────────

function StockBadge({ available, total }) {
  const pct = total > 0 ? available / total : 0
  const color = available === 0 ? 'red' : pct <= 0.25 ? 'amber' : 'green'
  const cls = { red: 'bg-red-100 text-red-700', amber: 'bg-amber-100 text-amber-700', green: 'bg-green-100 text-green-700' }[color]
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {available === 0 ? <AlertCircle size={11} /> : <CheckCircle2 size={11} />}
      {available}/{total}
    </span>
  )
}

function inp(extra = '') {
  return `border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 ${extra}`
}

// ── Client Autocomplete with create ──────────────────

function ClientPicker({ users, value, onChange, onSelectId, onCreateNew }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const q = (value || '').toLowerCase()
  const filtered = users.filter(u =>
    u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.company?.toLowerCase().includes(q)
  ).slice(0, 8)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        value={value}
        onChange={e => { onChange(e.target.value); onSelectId(null); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar cliente…"
        className={inp('w-full')}
      />
      {open && (value.length > 0) && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {filtered.map(u => (
            <button
              key={u.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(u.name); onSelectId(u.id); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-violet-50 flex flex-col"
            >
              <span className="font-medium text-gray-800">{u.name}</span>
              {u.company && <span className="text-xs text-gray-400">{u.company}</span>}
            </button>
          ))}
          {filtered.length === 0 && value.trim() && (
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); onCreateNew(value.trim()); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm text-violet-600 hover:bg-violet-50 flex items-center gap-2"
            >
              <UserPlus size={14} /> Crear cliente "{value.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Delivery note HTML generator ──────────────────────

function generateDeliveryNoteHtml(delivery, co = {}) {
  const fmtDate = (d) => { if (!d) return ''; const [y,m,day] = d.split('-'); return `${day}/${m}/${y}` }
  const companyName = co.company_name || 'Service Desk'
  const logoUrl = co.logoUrl || ''
  const companyAddress = co.company_address || ''
  const companyPhone = co.company_phone || ''
  const isContract = !!delivery.contract_id
  const recipient = isContract
    ? (delivery.contract_client || delivery.client_name || 'Cliente')
    : (delivery.client_name || 'Cliente')

  // Parse snapshots
  const lines = (delivery.lines || []).map(line => {
    const snap = line.printer_snapshot ? (() => { try { return JSON.parse(line.printer_snapshot) } catch { return null } })() : null
    return { ...line, snap }
  })

  // Group lines by printer (key = printer_id, or snap serial, or 'none')
  const groupLines = () => {
    const order = []
    const map = {}
    lines.forEach(line => {
      const key = line.printer_id ? `p${line.printer_id}` : (line.snap ? `s${line.snap.serial_number||JSON.stringify(line.snap)}` : 'none')
      if (!map[key]) { map[key] = { snap: line.snap, items: [] }; order.push(key) }
      map[key].items.push(line)
    })
    // printers first, no-printer last
    const printerKeys = order.filter(k => k !== 'none')
    const noneKey = order.includes('none') ? ['none'] : []
    return [...printerKeys, ...noneKey].map(k => map[k])
  }
  const groups = groupLines()

  const th = (label, align='left', extra='') =>
    `<th style="padding:4px 6px;background:#f3f4f6;font-size:10px;text-transform:uppercase;letter-spacing:.04em;text-align:${align};${extra}">${label}</th>`
  const td = (content, align='left', extra='') =>
    `<td style="padding:4px 6px;border-bottom:1px solid #eee;font-size:11px;text-align:${align};${extra}">${content}</td>`
  const tdm = (content) =>
    `<td style="padding:4px 6px;border-bottom:1px solid #eee;font-family:monospace;font-size:10px">${content || '—'}</td>`
  const groupHeader = (content, cols) =>
    `<tr><td colspan="${cols}" style="padding:5px 6px;background:#ede9fe;font-size:10px;font-weight:600;color:#3b0764;border-bottom:1px solid #c4b5fd">${content}</td></tr>`

  const subHead1 = `<tr>${th('Código')}${th('Descripción')}${th('Cant.','center')}${th('Serie')}${!isContract ? th('Precio','right') : ''}</tr>`
  const subHead2 = `<tr>${th('Código')}${th('Descripción')}${th('Cant.','center')}${th('Serie')}${th('','right')}</tr>`
  const subHead3 = `<tr>${th('Código')}${th('Descripción')}${th('Cant.','center')}${th('Serie')}${th('Costo unit.','right')}${th('Total empresa','right')}</tr>`

  // ── Copy 1: cliente ──
  const cols1 = isContract ? 4 : 5
  const rows1 = groups.map(g => {
    const snap = g.snap
    const assetId1 = snap?.asset_id || ''
    const printerInfo1 = snap
      ? [snap.contact_name ? `👤 ${snap.contact_name}` : '',
          snap.location ? `📍 ${snap.location}` : '',
          `<b>${snap.brand||''} ${snap.model||''}</b>`,
          snap.serial_number ? `S/N: ${snap.serial_number}` : '',
          snap.ip_address ? `IP: ${snap.ip_address}` : '',
        ].filter(Boolean).join(' &nbsp;·&nbsp; ')
      : 'Sin equipo asignado'
    const hdr1 = `<tr><td colspan="${cols1}" style="padding:5px 6px;background:#ede9fe;border-bottom:1px solid #c4b5fd">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:10px;font-weight:600;color:#3b0764">${printerInfo1}</span>
        ${assetId1 ? `<span style="font-size:13px;font-weight:800;color:#3b0764;letter-spacing:1px;margin-left:8px">ID: ${assetId1}</span>` : ''}
      </div>
    </td></tr>`
    return hdr1 + subHead1 +
      g.items.map(line =>
        `<tr>${tdm(line.item_code)}${td(line.item_name)}${td(line.quantity_dispatched,'center')}${tdm(line.serial_number)}${!isContract ? td(`$${line.exit_price||'0.00'}`, 'right') : ''}</tr>`
      ).join('')
  }).join('')

  // ── Copy 3: interna empresa (costo + firmas) ──
  const cols3 = 6
  const rows3 = groups.map(g => {
    const snap = g.snap
    const printerLine = snap
      ? [snap.contact_name ? `👤 ${snap.contact_name}` : '',
          snap.location ? `📍 ${snap.location}` : '',
          `<b>${snap.brand||''} ${snap.model||''}</b>`,
          snap.serial_number ? `S/N: ${snap.serial_number}` : '',
          snap.ip_address ? `IP: ${snap.ip_address}` : '',
        ].filter(Boolean).join(' · ')
      : 'Sin equipo asignado'
    return groupHeader(printerLine, cols3) + subHead3 +
      g.items.map(line => {
        const cost = line.unit_cost || null
        const total = cost ? `$${(parseFloat(cost) * line.quantity_dispatched).toFixed(2)}` : '—'
        return `<tr>${tdm(line.item_code)}${td(line.item_name)}${td(line.quantity_dispatched,'center')}${tdm(line.serial_number)}${td(cost ? `$${cost}` : '—', 'right')}${td(`<b>${total}</b>`, 'right')}</tr>`
      }).join('')
  }).join('')

  const notes = delivery.notes ? `<p style="margin:5px 0 0;font-size:10px;color:#555"><b>Obs:</b> ${delivery.notes}</p>` : ''

  const sig1 = `<div style="display:flex;gap:40px;margin-top:36px">
    <div style="flex:1;border-top:1px solid #aaa;padding-top:4px;font-size:10px;color:#666">Entregado por</div>
    <div style="flex:1;border-top:1px solid #aaa;padding-top:4px;font-size:10px;color:#666">Recibido por</div>
  </div>`

  const sig3 = `<div style="display:flex;gap:40px;margin-top:36px">
    <div style="flex:1;border-top:1px solid #aaa;padding-top:4px;font-size:10px;color:#666">Firma Autorizada</div>
    <div style="flex:1;border-top:1px solid #aaa;padding-top:4px;font-size:10px;color:#666">Firma Solcomsa</div>
  </div>`

  const headerInner = (withLogo) => `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:10px">
        ${withLogo && logoUrl ? `<img src="${logoUrl}" alt="Logo" style="width:52px;height:52px;object-fit:contain;border-radius:6px;flex-shrink:0">` : ''}
        <div>
          ${withLogo
            ? `<div style="font-size:13px;font-weight:700;color:#111">${companyName}</div>
               ${companyAddress ? `<div style="font-size:9px;color:#666;margin-top:1px">${companyAddress}</div>` : ''}
               ${companyPhone ? `<div style="font-size:9px;color:#666">Tel: ${companyPhone}</div>` : ''}
               <div style="font-size:14px;font-weight:700;margin-top:4px;border-top:1px solid #eee;padding-top:3px">Nota de Despacho</div>`
            : `<div style="font-size:9px;color:#888">${companyName}</div>
               <div style="font-size:14px;font-weight:700">Nota de Despacho</div>`}
          <div style="font-size:11px;color:#444;margin-top:1px"><b>${delivery.delivery_number}</b> · ${fmtDate(delivery.delivery_date)}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:9px;color:#888">${isContract ? 'Contrato MPS' : 'Venta Directa'}</div>
        <div style="font-size:12px;font-weight:600">${recipient}</div>
        ${delivery.invoice_number ? `<div style="font-size:9px;color:#888">Factura: ${delivery.invoice_number}</div>` : ''}
      </div>
    </div>`

  const block = (label, rowsHtml, footer='', withLogo=false) => `
  <div style="padding:8px 0">
    <div style="font-size:8px;color:#aaa;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:3px">${label}</div>
    ${headerInner(withLogo)}
    <table style="width:100%;border-collapse:collapse"><tbody>${rowsHtml}</tbody></table>
    ${notes}${footer}
  </div>`

  const cut = `<div style="margin:2px 0;border-top:1px dashed #bbb;text-align:center;font-size:8px;color:#ccc;padding-top:2px;letter-spacing:4px">✂ · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ✂</div>`

  // ── Copy 2: etiqueta suministro — una por ítem para pegar en cada caja ──
  const cols2 = 5
  const copy2Blocks = lines.map((line, idx) => {
    const snap = line.snap
    const assetId = snap?.asset_id || ''
    const printerInfo = snap
      ? [snap.contact_name ? `👤 ${snap.contact_name}` : '',
          snap.location ? `📍 ${snap.location}` : '',
          `<b>${snap.brand||''} ${snap.model||''}</b>`,
          snap.serial_number ? `S/N: ${snap.serial_number}` : '',
          snap.ip_address ? `IP: ${snap.ip_address}` : '',
        ].filter(Boolean).join(' &nbsp;·&nbsp; ')
      : 'Sin equipo asignado'
    const hdr = `<tr><td colspan="${cols2}" style="padding:4px 6px;background:#ede9fe;border-bottom:1px solid #c4b5fd">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:10px;font-weight:600;color:#3b0764">${printerInfo}</span>
        ${assetId ? `<span style="font-size:18px;font-weight:800;color:#3b0764;letter-spacing:2px;margin-left:12px">ID: ${assetId}</span>` : ''}
      </div>
    </td></tr>`
    const rowHtml = hdr + subHead2 +
      `<tr>${tdm(line.item_code)}${td(line.item_name)}${td(line.quantity_dispatched,'center')}${tdm(line.serial_number)}<td style="padding:4px 6px;border-bottom:1px solid #eee"></td></tr>`
    const label = lines.length > 1
      ? `Copia Suministro ${idx + 1}/${lines.length} — pegar en la caja del producto`
      : 'Copia Suministro — pegar en la caja del producto'
    return block(label, rowHtml, '')
  }).join(cut)

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <title>Nota de Despacho ${delivery.delivery_number}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;color:#222;font-size:11px}
    @media print{
      html,body{height:100%}
      @page{size:A4 portrait;margin:8mm 10mm}
      body{margin:0}
    }
    @media screen{body{margin:16px;max-width:700px}}
  </style></head><body>
  ${block('Copia Cliente', rows1, sig1, true)}
  ${cut}
  ${copy2Blocks}
  ${cut}
  ${block('Copia Empresa — CONFIDENCIAL', rows3, sig3)}
  </body></html>`
}

// ── Edit delivery modal (saves to DB) ────────────────

function parsePrinterSnap(snap) {
  try { return snap ? JSON.parse(snap) : null } catch { return null }
}

function lineFromDispatch(l) {
  const snap = parsePrinterSnap(l.printer_snapshot)
  return {
    id: l.id,
    item_code: l.item_code,
    item_name: l.item_name,
    quantity_dispatched: l.quantity_dispatched,
    serial_number: l.serial_number || '',
    exit_price: l.exit_price || '',
    printer_serial_input: snap?.serial_number || '',
    printer_id: l.printer_id || null,
    printer_model_display: snap ? `${snap.brand || ''} ${snap.model || ''}`.trim() : '',
    printer_location_display: snap?.location || '',
    printer_contact_display: snap?.contact_name || '',
  }
}

const EMPTY_NEW_LINE = { item_code: '', item_name: '', quantity_dispatched: 1, serial_number: '', exit_price: '', printer_serial_input: '', printer_id: null, printer_model_display: '', printer_location_display: '', printer_contact_display: '' }

function EditDeliveryModal({ open, delivery, printers, knownItems, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    delivery_date: delivery?.delivery_date || '',
    dispatch_condition: delivery?.dispatch_condition || '',
    delivery_method: delivery?.delivery_method || '',
    notes: delivery?.notes || '',
  }))
  const [lines, setLines] = useState(() => (delivery?.lines || []).map(lineFromDispatch))
  const [newLines, setNewLines] = useState([])
  const [saving, setSaving] = useState(false)

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const sl = (idx, k, v) => setLines(ls => ls.map((l, i) => i === idx ? { ...l, [k]: v } : l))
  const slm = (idx, patch) => setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l))

  const isDirectSale = delivery && !delivery.contract_id

  const snl = (idx, k, v) => setNewLines(ls => ls.map((l, i) => i === idx ? { ...l, [k]: v } : l))
  const snlm = (idx, patch) => setNewLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l))
  const addNewLine = () => setNewLines(ls => [...ls, { ...EMPTY_NEW_LINE }])
  const removeNewLine = idx => setNewLines(ls => ls.filter((_, i) => i !== idx))

  const save = async () => {
    setSaving(true)
    try {
      const validNew = newLines.filter(l => l.item_code.trim())
      const payload = {
        delivery_date: form.delivery_date || undefined,
        dispatch_condition: form.dispatch_condition || null,
        delivery_method: form.delivery_method || null,
        notes: form.notes || null,
        lines: lines.map(l => ({
          id: l.id,
          serial_number: l.serial_number || null,
          exit_price: l.exit_price || null,
          printer_id: l.printer_id || null,
        })),
        ...(validNew.length > 0 && {
          add_lines: validNew.map(l => ({
            item_code: l.item_code.trim(),
            quantity_dispatched: parseInt(l.quantity_dispatched) || 1,
            serial_number: l.serial_number || null,
            exit_price: l.exit_price || '0.00',
            printer_id: l.printer_id || null,
          }))
        }),
      }
      const res = await updateSupplyDelivery(delivery.id, payload)
      toast.success('Entrega actualizada')
      onSaved(res.data)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error actualizando entrega')
    } finally { setSaving(false) }
  }

  const print = () => {
    const merged = {
      ...delivery,
      notes: form.notes,
      delivery_date: form.delivery_date,
      lines: (delivery.lines || []).map((l, i) => ({
        ...l,
        serial_number: lines[i]?.serial_number ?? l.serial_number,
      })),
    }
    const co = getCompanyCache()
    const html = generateDeliveryNoteHtml(merged, { ...co, logoUrl: companyLogoSrc(window.location.origin) })
    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
    w.print()
  }

  if (!open || !delivery) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-6 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-800">
            Editar <span className="text-violet-600">{delivery.delivery_number}</span>
          </h2>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Fecha</label>
              <input type="date" value={form.delivery_date} onChange={e => sf('delivery_date', e.target.value)} className={inp('w-full')} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">
                {delivery.contract_id ? `Contrato · ${delivery.contract_number}` : 'Cliente'}
              </label>
              <input readOnly value={delivery.contract_client || delivery.client_name || '—'}
                className={inp('w-full bg-gray-50 text-gray-500 cursor-default')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Condición de despacho</label>
              <select value={form.dispatch_condition} onChange={e => sf('dispatch_condition', e.target.value)} className={inp('w-full')}>
                <option value="">— Seleccionar —</option>
                {delivery.contract_id ? (
                  <>
                    <option value="Pro-Activo">Pro-Activo</option>
                    <option value="Incidente">Incidente</option>
                    <option value="Solicitud">Solicitud</option>
                  </>
                ) : (
                  <option value="Ventas">Ventas</option>
                )}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Método de entrega</label>
              <select value={form.delivery_method} onChange={e => sf('delivery_method', e.target.value)} className={inp('w-full')}>
                <option value="">— Seleccionar —</option>
                <option value="Mensajería Interna">Mensajería Interna</option>
                <option value="Mensajería Externa">Mensajería Externa</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Observaciones</label>
            <textarea value={form.notes} onChange={e => sf('notes', e.target.value)}
              rows={2} placeholder="Observaciones…" className={inp('w-full resize-none')} />
          </div>

          {/* ── Líneas existentes ── */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Líneas</label>
            {lines.length === 0 && <p className="text-xs text-gray-400 italic">Sin líneas registradas.</p>}
            {lines.map((line, idx) => (
              <div key={line.id} className="border border-gray-100 rounded-xl p-3 bg-gray-50 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{line.item_code}</span>
                  <span>{line.item_name}</span>
                  <span className="ml-auto text-gray-400">×{line.quantity_dispatched}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Serie suministro</label>
                    <input value={line.serial_number}
                      onChange={e => sl(idx, 'serial_number', e.target.value)}
                      placeholder="S/N" className={inp('w-full font-mono text-xs')} />
                  </div>
                  {isDirectSale && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-gray-400">Precio venta</label>
                      <input type="number" step="0.01" value={line.exit_price}
                        onChange={e => sl(idx, 'exit_price', e.target.value)}
                        placeholder="0.00" className={inp('w-full')} />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Serie impresora</label>
                    <PrinterSerialPicker
                      printers={printers}
                      value={line.printer_serial_input}
                      onSelect={(id, serial, model, location, contact) =>
                        slm(idx, { printer_id: id, printer_serial_input: serial, printer_model_display: model, printer_location_display: location, printer_contact_display: contact })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Modelo</label>
                    <input readOnly value={line.printer_model_display} placeholder="(auto)"
                      className={inp('w-full bg-white text-gray-500 cursor-default text-xs')} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Dirección</label>
                    <input readOnly value={line.printer_location_display} placeholder="(auto)"
                      className={inp('w-full bg-white text-gray-500 cursor-default text-xs')} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Contacto</label>
                    <input readOnly value={line.printer_contact_display} placeholder="(auto)"
                      className={inp('w-full bg-white text-gray-500 cursor-default text-xs')} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Nuevos suministros ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Agregar suministros</label>
              <button onClick={addNewLine}
                className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium">
                <Plus size={13} /> Agregar ítem
              </button>
            </div>
            {newLines.map((line, idx) => (
              <div key={idx} className="border border-violet-100 rounded-xl p-3 bg-violet-50/40 flex flex-col gap-2">
                <div className="grid grid-cols-5 gap-2 items-end">
                  <div className="col-span-3 flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Código / Nombre</label>
                    <ItemCodePicker
                      knownItems={knownItems}
                      value={line.item_code}
                      itemName={line.item_name}
                      onChange={(code, name) => snlm(idx, { item_code: code, item_name: name })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Cantidad</label>
                    <input type="number" min="1" value={line.quantity_dispatched}
                      onChange={e => snl(idx, 'quantity_dispatched', e.target.value)}
                      className={inp('w-full')} />
                  </div>
                  <button onClick={() => removeNewLine(idx)} className="mb-0.5 text-red-400 hover:text-red-600">
                    <X size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Serie suministro</label>
                    <input value={line.serial_number}
                      onChange={e => snl(idx, 'serial_number', e.target.value)}
                      placeholder="S/N" className={inp('w-full font-mono text-xs')} />
                  </div>
                  {isDirectSale && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-gray-400">Precio venta</label>
                      <input type="number" step="0.01" value={line.exit_price}
                        onChange={e => snl(idx, 'exit_price', e.target.value)}
                        placeholder="0.00" className={inp('w-full')} />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Serie impresora</label>
                    <PrinterSerialPicker
                      printers={printers}
                      value={line.printer_serial_input}
                      onSelect={(id, serial, model, location, contact) =>
                        snlm(idx, { printer_id: id, printer_serial_input: serial, printer_model_display: model, printer_location_display: location, printer_contact_display: contact })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Modelo</label>
                    <input readOnly value={line.printer_model_display} placeholder="(auto)"
                      className={inp('w-full bg-white text-gray-500 cursor-default text-xs')} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Dirección</label>
                    <input readOnly value={line.printer_location_display} placeholder="(auto)"
                      className={inp('w-full bg-white text-gray-500 cursor-default text-xs')} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Contacto</label>
                    <input readOnly value={line.printer_contact_display} placeholder="(auto)"
                      className={inp('w-full bg-white text-gray-500 cursor-default text-xs')} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-100">Cancelar</button>
          <button onClick={print}
            className="flex items-center gap-2 px-4 py-2.5 border border-violet-200 text-violet-700 rounded-xl text-sm font-medium hover:bg-violet-50">
            <FileText size={14} /> Imprimir
          </button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
            <Save size={14} /> {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Lot form modal ────────────────────────────────────

const EMPTY_LOT = { item_code: '', item_name: '', entry_date: '', unit_cost: '', quantity_received: 1, notes: '' }

function LotModal({ open, lot, knownItems, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_LOT)
  useEffect(() => {
    if (lot) {
      setForm({ item_code: lot.item_code, item_name: lot.item_name, entry_date: lot.entry_date, unit_cost: lot.unit_cost ?? '', quantity_received: lot.quantity_received, notes: lot.notes ?? '' })
    } else {
      setForm(EMPTY_LOT)
    }
  }, [lot, open])

  const s = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.item_code || !form.item_name || !form.entry_date) { toast.error('Código, nombre y fecha son requeridos'); return }
    const payload = { ...form, quantity_received: parseInt(form.quantity_received) || 1 }
    try {
      if (lot) { await updateSupplyLot(lot.id, payload); toast.success('Lote actualizado') }
      else { await createSupplyLot(payload); toast.success('Lote registrado') }
      onSaved()
    } catch (err) { toast.error(err?.response?.data?.detail || 'Error guardando lote') }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-800">{lot ? 'Editar lote' : 'Nuevo lote'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Código *</label>
              <input list="item-codes" value={form.item_code}
                onChange={e => { const k = knownItems.find(i => i.item_code === e.target.value); s('item_code', e.target.value); if (k) s('item_name', k.item_name) }}
                placeholder="Ej: 56F4U00" className={inp('w-full')} />
              <datalist id="item-codes">{knownItems.map(i => <option key={i.item_code} value={i.item_code}>{i.item_name}</option>)}</datalist>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Nombre *</label>
              <input value={form.item_name} onChange={e => s('item_name', e.target.value)} placeholder="Tóner Lexmark…" className={inp('w-full')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Fecha de entrada *</label>
              <input type="date" value={form.entry_date} onChange={e => s('entry_date', e.target.value)} className={inp('w-full')} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Cantidad recibida</label>
              <input type="number" min="1" value={form.quantity_received} onChange={e => s('quantity_received', e.target.value)} className={inp('w-full')} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Costo unitario (compra)</label>
            <input type="number" step="0.01" placeholder="0.00" value={form.unit_cost} onChange={e => s('unit_cost', e.target.value)} className={inp('w-full')} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Notas</label>
            <textarea value={form.notes} onChange={e => s('notes', e.target.value)} rows={2} className={inp('w-full resize-none')} />
          </div>
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-100">Cancelar</button>
          <button onClick={save} className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700">
            <Save size={15} /> {lot ? 'Guardar' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Delivery modal ────────────────────────────────────

const EMPTY_LINE = {
  item_code: '', item_name: '',
  quantity_dispatched: 1, serial_number: '', exit_price: '',
  printer_serial_input: '', printer_id: null,
  printer_model_display: '', printer_location_display: '', printer_contact_display: '',
  notes: '',
}

function ItemCodePicker({ knownItems, value, itemName, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const q = (value || '').toLowerCase()
  const filtered = knownItems.filter(i =>
    i.item_code.toLowerCase().includes(q) || i.item_name.toLowerCase().includes(q)
  ).slice(0, 10)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        value={value}
        onChange={e => { onChange(e.target.value, ''); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Código…"
        className={inp('w-full font-mono text-xs')}
      />
      {open && value.length > 0 && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-44 overflow-y-auto">
          {filtered.map(i => (
            <button key={i.item_code} type="button"
              onMouseDown={e => { e.preventDefault(); onChange(i.item_code, i.item_name); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-violet-50 flex items-center gap-2">
              <span className="font-mono text-gray-500 shrink-0">{i.item_code}</span>
              <span className="text-gray-700 truncate">{i.item_name}</span>
              <span className="ml-auto text-gray-400 shrink-0">{i.available} disp.</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PrinterSerialPicker({ printers, value, onSelect }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const q = (value || '').toLowerCase()
  const filtered = printers.filter(p =>
    q.length > 0 && (
      (p.serial_number || '').toLowerCase().includes(q) ||
      (p.brand || '').toLowerCase().includes(q) ||
      (p.model || '').toLowerCase().includes(q)
    )
  ).slice(0, 10)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        value={value}
        onChange={e => { onSelect(null, e.target.value, '', '', ''); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Serie impresora…"
        className={inp('w-full font-mono text-xs')}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-44 overflow-y-auto">
          {filtered.map(p => {
            const sn = p.serial_number || ''
            const tail = sn.slice(-4)
            const head = sn.slice(0, -4)
            return (
              <button key={p.id} type="button"
                onMouseDown={e => {
                  e.preventDefault()
                  onSelect(p.id, sn, `${p.brand || ''} ${p.model || ''}`.trim(), p.location || '', p.contact_name || '')
                  setOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-violet-50 flex flex-col gap-0.5">
                <span className="font-mono text-gray-700">
                  <span className="text-gray-400">{head}</span><span className="font-bold text-violet-700">{tail}</span>
                </span>
                <span className="text-gray-400">{p.brand} {p.model}{p.location ? ` · ${p.location}` : ''}{p.contact_name ? ` · ${p.contact_name}` : ''}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DeliveryModal({ open, contracts, printers, knownItems, users, onClose, onSaved }) {
  const EMPTY_FORM = { delivery_date: new Date().toISOString().split('T')[0], contract_id: null, resolved_contract_number: '', client_id: null, client_name: '', dispatch_condition: '', delivery_method: '', notes: '' }
  const [form, setForm] = useState(EMPTY_FORM)
  const [lines, setLines] = useState([{ ...EMPTY_LINE }])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) { setForm({ ...EMPTY_FORM, delivery_date: new Date().toISOString().split('T')[0] }); setLines([{ ...EMPTY_LINE }]) }
  }, [open])

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const sl = (idx, k, v) => setLines(ls => ls.map((l, i) => i === idx ? { ...l, [k]: v } : l))
  const slm = (idx, patch) => setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l))
  const addLine = () => setLines(ls => [...ls, { ...EMPTY_LINE }])
  const removeLine = (idx) => setLines(ls => ls.filter((_, i) => i !== idx))

  const handlePrinterSelect = (id, serial, model, location, contact, lineIdx) => {
    slm(lineIdx, { printer_id: id, printer_serial_input: serial, printer_model_display: model, printer_location_display: location, printer_contact_display: contact })
    if (id) {
      const printer = printers.find(p => p.id === id)
      if (printer?.contract_id) {
        const contract = contracts.find(c => c.id === printer.contract_id)
        if (contract) {
          setForm(f => ({
            ...f,
            contract_id: contract.id,
            resolved_contract_number: contract.contract_number || '',
            client_name: contract.client_company || contract.client_name || '',
            client_id: null,
          }))
        }
      }
    }
  }

  const handleCreateClient = async (name) => {
    try {
      const res = await createUser({ name, email: `${Date.now()}@pendiente.local`, password: 'changeme123', role: 'client' })
      toast.success(`Cliente "${name}" creado`)
      setForm(f => ({ ...f, client_id: res.data.id, client_name: name }))
    } catch { toast.error('Error creando cliente') }
  }

  const save = async () => {
    if (!form.delivery_date) { toast.error('La fecha es requerida'); return }
    if (!form.client_name.trim()) { toast.error('Ingresa el cliente'); return }
    if (lines.some(l => !l.item_code.trim())) { toast.error('Ingresa el código en cada línea'); return }

    const isContract = !!form.contract_id
    const payload = {
      delivery_date: form.delivery_date,
      contract_id: isContract ? form.contract_id : null,
      client_id: !isContract ? form.client_id : null,
      client_name: !isContract ? form.client_name : null,
      dispatch_condition: form.dispatch_condition || null,
      delivery_method: form.delivery_method || null,
      notes: form.notes || null,
      lines: lines.map(l => ({
        item_code: l.item_code.trim(),
        quantity_dispatched: parseInt(l.quantity_dispatched) || 1,
        serial_number: l.serial_number || null,
        exit_price: l.exit_price || '0.00',
        printer_id: l.printer_id ? parseInt(l.printer_id) : null,
        notes: l.notes || null,
      })),
    }

    setSaving(true)
    try {
      const res = await createSupplyDelivery(payload)
      toast.success(`Entrega ${res.data.delivery_number} registrada`)
      onSaved(res.data)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error registrando entrega')
    } finally { setSaving(false) }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-6 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-800">Nueva Entrega</h2>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>

        {/* Header */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Fecha</label>
            <input type="date" value={form.delivery_date} onChange={e => sf('delivery_date', e.target.value)} className={inp('w-full')} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">
              Cliente
              {form.contract_id && form.resolved_contract_number && (
                <span className="ml-2 text-indigo-600 font-normal text-[10px] bg-indigo-50 px-1.5 py-0.5 rounded-full">
                  {form.resolved_contract_number}
                </span>
              )}
            </label>
            <ClientPicker users={users} value={form.client_name}
              onChange={v => setForm(f => ({ ...f, client_name: v, contract_id: null, resolved_contract_number: '' }))}
              onSelectId={id => sf('client_id', id)}
              onCreateNew={handleCreateClient} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Condición de despacho</label>
            <select value={form.dispatch_condition} onChange={e => sf('dispatch_condition', e.target.value)} className={inp('w-full')}>
              <option value="">— Seleccionar —</option>
              {form.contract_id ? (
                <>
                  <option value="Pro-Activo">Pro-Activo</option>
                  <option value="Incidente">Incidente</option>
                  <option value="Solicitud">Solicitud</option>
                </>
              ) : (
                <option value="Ventas">Ventas</option>
              )}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Método de entrega</label>
            <select value={form.delivery_method} onChange={e => sf('delivery_method', e.target.value)} className={inp('w-full')}>
              <option value="">— Seleccionar —</option>
              <option value="Mensajería Interna">Mensajería Interna</option>
              <option value="Mensajería Externa">Mensajería Externa</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1 mb-5">
          <label className="text-xs text-gray-500 font-medium">Notas de entrega</label>
          <input value={form.notes} onChange={e => sf('notes', e.target.value)} placeholder="Observaciones…" className={inp('w-full')} />
        </div>

        {/* Lines */}
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ítems a despachar</span>
          <button onClick={addLine} className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium">
            <Plus size={13} /> Agregar ítem
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {lines.map((line, idx) => (
            <div key={idx} className="border border-gray-100 rounded-xl p-3 bg-gray-50 flex flex-col gap-3">
              {/* Supply row */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Package size={10} /> Suministro
                </p>
                <div className="grid grid-cols-12 gap-2 items-start">
                  {/* Qty */}
                  <div className="col-span-2 flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Cant.</label>
                    <input type="number" min="1" value={line.quantity_dispatched}
                      onChange={e => sl(idx, 'quantity_dispatched', e.target.value)}
                      className={inp('w-full text-center')} />
                  </div>
                  {/* Code + autocomplete */}
                  <div className="col-span-4 flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Código</label>
                    <ItemCodePicker
                      knownItems={knownItems}
                      value={line.item_code}
                      itemName={line.item_name}
                      onChange={(code, name) => slm(idx, { item_code: code, item_name: name })}
                    />
                  </div>
                  {/* Description — readonly */}
                  <div className="col-span-4 flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Descripción</label>
                    <input readOnly value={line.item_name} placeholder="(autocomplete)"
                      className={inp('w-full bg-white text-gray-500 cursor-default text-xs')} />
                  </div>
                  {/* Supply serial */}
                  <div className="col-span-2 flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Serie</label>
                    <input value={line.serial_number} onChange={e => sl(idx, 'serial_number', e.target.value)}
                      placeholder="S/N" className={inp('w-full font-mono text-xs')} />
                  </div>
                </div>
                {!form.contract_id && (
                  <div className="mt-2 flex flex-col gap-1 w-40">
                    <label className="text-[10px] text-gray-400">Precio venta</label>
                    <input type="number" step="0.01" placeholder="0.00" value={line.exit_price}
                      onChange={e => sl(idx, 'exit_price', e.target.value)} className={inp('w-full')} />
                  </div>
                )}
              </div>

              {/* Printer row */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <PrinterIcon size={10} /> Impresora (opcional)
                </p>
                <div className="grid grid-cols-4 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Serie</label>
                    <PrinterSerialPicker
                      printers={printers}
                      value={line.printer_serial_input}
                      onSelect={(id, serial, model, location, contact) =>
                        handlePrinterSelect(id, serial, model, location, contact, idx)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Modelo</label>
                    <input readOnly value={line.printer_model_display} placeholder="(autocomplete)"
                      className={inp('w-full bg-white text-gray-500 cursor-default text-xs')} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Dirección</label>
                    <input readOnly value={line.printer_location_display} placeholder="(autocomplete)"
                      className={inp('w-full bg-white text-gray-500 cursor-default text-xs')} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400">Contacto</label>
                    <input readOnly value={line.printer_contact_display} placeholder="(autocomplete)"
                      className={inp('w-full bg-white text-gray-500 cursor-default text-xs')} />
                  </div>
                </div>
              </div>

              {/* Notes + remove */}
              <div className="flex items-center gap-2">
                <input placeholder="Notas de línea (opcional)" value={line.notes}
                  onChange={e => sl(idx, 'notes', e.target.value)} className={inp('flex-1 text-xs')} />
                {lines.length > 1 && (
                  <button onClick={() => removeLine(idx)} className="p-1.5 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-100">Cancelar</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
            <Save size={15} /> {saving ? 'Guardando…' : 'Registrar entrega'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────

// ── Supply Dashboard ──────────────────────────────────

const COND_COLORS = { 'Pro-Activo': '#7c3aed', 'Incidente': '#dc2626', 'Solicitud': '#2563eb', 'Ventas': '#059669', 'Sin condición': '#9ca3af' }
const METHOD_COLORS = ['#7c3aed', '#a78bfa']

function SupplyDashboard() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let from = dateFrom, to = dateTo
      if (!useCustom) {
        if (month) {
          const mm = month.padStart(2, '0')
          const lastDay = new Date(year, parseInt(month), 0).getDate()
          from = `${year}-${mm}-01`
          to = `${year}-${mm}-${lastDay}`
        } else {
          from = `${year}-01-01`
          to = `${year}-12-31`
        }
      }
      const res = await getSupplyStats({ date_from: from || undefined, date_to: to || undefined })
      setStats(res.data)
    } catch { toast.error('Error cargando estadísticas') }
    finally { setLoading(false) }
  }, [year, month, dateFrom, dateTo, useCustom])

  useEffect(() => { load() }, [load])

  const fmt = (n) => `$${Number(n || 0).toFixed(2)}`

  return (
    <div className="flex flex-col gap-6">
      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 font-medium">Modo</label>
          <button onClick={() => setUseCustom(false)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${!useCustom ? 'bg-violet-600 text-white border-violet-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            Año / Mes
          </button>
          <button onClick={() => setUseCustom(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${useCustom ? 'bg-violet-600 text-white border-violet-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            Personalizado
          </button>
        </div>
        {!useCustom ? (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Año</label>
              <select value={year} onChange={e => { setYear(parseInt(e.target.value)); setMonth('') }}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
                {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Mes (opcional)</label>
              <select value={month} onChange={e => setMonth(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
                <option value="">Todo el año</option>
                {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
                  <option key={i+1} value={i+1}>{m}</option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Desde</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Hasta</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
          </>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-10">Cargando estadísticas…</p>
      ) : !stats ? null : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Entregas totales', value: stats.total_deliveries, color: 'text-violet-600' },
              { label: 'Costo total empresa', value: fmt(stats.total_cost), color: 'text-red-600' },
              { label: 'Clientes atendidos', value: stats.by_client.length, color: 'text-blue-600' },
              { label: 'Ítems despachados', value: stats.by_condition.reduce((s, c) => s + c.items, 0), color: 'text-emerald-600' },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs text-gray-400">{k.label}</p>
                <p className={`text-2xl font-bold mt-1 ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* By condition bar chart */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-sm font-semibold text-gray-700 mb-3">Despachos por condición</p>
              {stats.by_condition.length === 0 ? (
                <p className="text-xs text-gray-400 py-6 text-center">Sin datos</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={stats.by_condition} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="condition" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v, n) => [v, n === 'count' ? 'Entregas' : n === 'items' ? 'Ítems' : 'Costo']} />
                    <Bar dataKey="count" name="Entregas" radius={[4,4,0,0]}>
                      {stats.by_condition.map((c, i) => (
                        <Cell key={i} fill={COND_COLORS[c.condition] || '#7c3aed'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
              <div className="mt-2 flex flex-col gap-1">
                {stats.by_condition.map(c => (
                  <div key={c.condition} className="flex items-center justify-between text-xs text-gray-600">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ background: COND_COLORS[c.condition] || '#7c3aed' }} />
                      {c.condition}
                    </span>
                    <span className="text-gray-400">{c.count} entrega(s) · {c.items} ítem(s) · {fmt(c.cost)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Delivery method pie */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-sm font-semibold text-gray-700 mb-3">Método de entrega</p>
              {stats.by_method.length === 0 ? (
                <p className="text-xs text-gray-400 py-6 text-center">Sin datos</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={stats.by_method} dataKey="count" nameKey="method" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                      {stats.by_method.map((_, i) => <Cell key={i} fill={METHOD_COLORS[i % METHOD_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Monthly trend */}
          {stats.by_month.length > 1 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-sm font-semibold text-gray-700 mb-3">Tendencia mensual</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={stats.by_month} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Entregas" fill="#7c3aed" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top clients table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">Clientes — despachos y costos</p>
            {stats.by_client.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">Sin datos</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left pb-2 font-medium">Cliente</th>
                    <th className="text-center pb-2 font-medium">Entregas</th>
                    <th className="text-center pb-2 font-medium">Ítems</th>
                    <th className="text-right pb-2 font-medium">Costo empresa</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.by_client.map(c => (
                    <tr key={c.client} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="py-2 text-gray-800 font-medium">{c.client}</td>
                      <td className="py-2 text-center text-gray-500">{c.count}</td>
                      <td className="py-2 text-center text-gray-500">{c.items}</td>
                      <td className="py-2 text-right text-gray-700 font-semibold">{fmt(c.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function Suministros() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'stock'
  const setTab = (t) => setSearchParams({ tab: t }, { replace: true })
  const [lots, setLots] = useState([])
  const [deliveries, setDeliveries] = useState([])
  const [contracts, setContracts] = useState([])
  const [printers, setPrinters] = useState([])
  const [users, setUsers] = useState([])
  const [knownItems, setKnownItems] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const [lotModal, setLotModal] = useState(false)
  const [editingLot, setEditingLot] = useState(null)
  const [deliveryModal, setDeliveryModal] = useState(false)
  const [expandedDelivery, setExpandedDelivery] = useState(null)
  const [previewDelivery, setPreviewDelivery] = useState(null)

  const openEdit = async (d) => {
    try {
      const res = await getSupplyDelivery(d.id)
      setPreviewDelivery(res.data)
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || 'Error desconocido'
      toast.error(`Error cargando entrega: ${detail}`)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [lotRes, delRes, cRes, pRes, uRes, iRes] = await Promise.allSettled([
        getSupplyLots(), getSupplyDeliveries(), getContracts(), getPrinters(), getUsers(), getSupplyItems(),
      ])
      if (lotRes.status === 'fulfilled') setLots(lotRes.value.data)
      if (delRes.status === 'fulfilled') setDeliveries(delRes.value.data)
      if (cRes.status === 'fulfilled') setContracts(cRes.value.data)
      if (pRes.status === 'fulfilled') setPrinters(pRes.value.data)
      if (uRes.status === 'fulfilled') setUsers(uRes.value.data)
      if (iRes.status === 'fulfilled') setKnownItems(iRes.value.data)
    } catch { toast.error('Error cargando datos') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const deleteLot = async (lot) => {
    if (!await showConfirm(`¿Eliminar lote "${lot.item_name}"?`)) return
    try { await deleteSupplyLot(lot.id); toast.success('Lote eliminado'); load() }
    catch { toast.error('Error eliminando lote') }
  }

  const deleteDelivery = async (d) => {
    if (!await showConfirm(`¿Eliminar entrega ${d.delivery_number}? Se revertirá el stock de los ítems despachados.`)) return
    try { await deleteSupplyDelivery(d.id); toast.success('Entrega eliminada'); if (expandedDelivery?.id === d.id) setExpandedDelivery(null); load() }
    catch { toast.error('Error eliminando entrega') }
  }

  const filteredLots = lots.filter(l => {
    if (!q) return true
    const lq = q.toLowerCase()
    return [l.item_code, l.item_name, l.notes].some(v => v?.toLowerCase().includes(lq))
  })

  const filteredDeliveries = deliveries.filter(d => {
    if (!q) return true
    const lq = q.toLowerCase()
    return [d.delivery_number, d.contract_number, d.contract_client, d.client_name].some(v => v?.toLowerCase().includes(lq))
  })

  return (
    <div className="flex flex-col gap-4 p-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package size={22} className="text-violet-600" />
          <h1 className="text-xl font-bold text-gray-800">Suministros</h1>
        </div>
        <div className="flex gap-2">
          {tab === 'stock' && (
            <button onClick={() => { setEditingLot(null); setLotModal(true) }}
              className="flex items-center gap-2 px-3 py-2 border border-violet-200 text-violet-700 rounded-xl text-sm font-medium hover:bg-violet-50">
              <Plus size={15} /> Nuevo lote
            </button>
          )}
          <button onClick={() => setDeliveryModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700">
            <Truck size={15} /> Nueva entrega
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[['stock', 'Stock'], ['entregas', 'Entregas'], ['dashboard', 'Dashboard']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Search — hidden on dashboard */}
      {tab !== 'dashboard' && (
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tab === 'stock' ? 'Buscar por código o nombre…' : 'Buscar entregas…'}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
          {q && <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X size={14} /></button>}
        </div>
      )}

      {tab === 'dashboard' ? (
        <SupplyDashboard />
      ) : loading ? (
        <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
      ) : tab === 'stock' ? (
        // ── Stock tab ──
        filteredLots.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">No hay lotes.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredLots.map(lot => (
              <div key={lot.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-600">{lot.item_code}</span>
                    <span className="text-sm font-semibold text-gray-800 truncate">{lot.item_name}</span>
                    <StockBadge available={lot.available} total={lot.quantity_received} />
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                    <span>Entrada: {lot.entry_date}</span>
                    <span>Costo: ${lot.unit_cost ?? '0.00'}</span>
                    <span>Despachado: {lot.dispatched_qty}/{lot.quantity_received}</span>
                  </div>
                </div>
                <button onClick={() => { setEditingLot(lot); setLotModal(true) }} className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50"><Pencil size={14} /></button>
                <button onClick={() => deleteLot(lot)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )
      ) : (
        // ── Entregas tab ──
        filteredDeliveries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">No hay entregas registradas.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredDeliveries.map(d => {
              const isOpen = expandedDelivery?.id === d.id
              const isContract = !!d.contract_id
              return (
                <div key={d.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button onClick={() => setExpandedDelivery(isOpen ? null : d)} className="flex-1 flex items-center gap-3 text-left min-w-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-800">{d.delivery_number}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isContract ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {isContract ? 'MPS' : 'Venta directa'}
                          </span>
                          <span className="text-sm text-gray-600">{isContract ? `${d.contract_number} · ${d.contract_client}` : d.client_name}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                          <span>{fmtD(d.delivery_date)}</span>
                          <span>{d.lines?.length ?? 0} ítem(s)</span>
                          {d.dispatch_condition && <span className="bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-full font-medium">{d.dispatch_condition}</span>}
                          {d.delivery_method && <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{d.delivery_method}</span>}
                          {d.invoice_number && <span className="text-emerald-600 font-medium">Factura: {d.invoice_number}</span>}
                        </div>
                      </div>
                      {isOpen ? <ChevronUp size={15} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={15} className="text-gray-400 flex-shrink-0" />}
                    </button>
                    <button onClick={() => openEdit(d)} title="Editar entrega"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50"><Pencil size={14} /></button>
                    <button onClick={() => { const co = getCompanyCache(); const html = generateDeliveryNoteHtml(d, { ...co, logoUrl: companyLogoSrc(window.location.origin) }); const w = window.open('', '_blank'); w.document.write(html); w.document.close(); w.print() }} title="Imprimir nota"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50"><FileText size={14} /></button>
                    <button onClick={() => deleteDelivery(d)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                  {isOpen && (
                    <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                      {d.lines?.map(line => {
                        const snap = line.printer_snapshot ? (() => { try { return JSON.parse(line.printer_snapshot) } catch { return null } })() : null
                        return (
                          <div key={line.id} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap text-xs">
                                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{line.item_code}</span>
                                <span className="text-gray-700 font-medium">{line.item_name}</span>
                                <span className="text-gray-500">×{line.quantity_dispatched}</span>
                                {line.serial_number && <span className="font-mono text-gray-400">S/N: {line.serial_number}</span>}
                                {line.exit_price && line.exit_price !== '0.00' && <span className="text-emerald-600 font-medium">${line.exit_price}</span>}
                              </div>
                              {snap && (
                                <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 flex-wrap">
                                  <PrinterIcon size={11} />
                                  <span>{snap.brand} {snap.model}</span>
                                  {snap.serial_number && <span>· S/N {snap.serial_number}</span>}
                                  {snap.location && <span>· {snap.location}</span>}
                                  {snap.contact_name && <span>· {snap.contact_name}</span>}
                                  {snap.ip_address && <span>· {snap.ip_address}</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                      {d.notes && <p className="text-xs text-gray-400 mt-2 italic">{d.notes}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Modals */}
      <LotModal open={lotModal} lot={editingLot} knownItems={knownItems}
        onClose={() => setLotModal(false)} onSaved={() => { setLotModal(false); load() }} />

      <DeliveryModal open={deliveryModal} contracts={contracts} printers={printers}
        knownItems={knownItems} users={users}
        onClose={() => setDeliveryModal(false)}
        onSaved={(delivery) => {
          setDeliveryModal(false)
          setTab('deliveries')
          load()
          setPreviewDelivery(delivery)
        }}
      />

      <EditDeliveryModal
        key={previewDelivery?.id ?? 'none'}
        open={!!previewDelivery}
        delivery={previewDelivery}
        printers={printers}
        knownItems={knownItems}
        onClose={() => setPreviewDelivery(null)}
        onSaved={() => { setPreviewDelivery(null); load() }}
      />
    </div>
  )
}
