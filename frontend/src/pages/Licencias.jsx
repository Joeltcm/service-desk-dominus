import { companyLogoSrc } from '../utils/branding'
import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { openPdfWindow, sharePdfFromHtml } from '../utils/pdfViewer'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import ClientAutocomplete from '../components/ClientAutocomplete'
import logoWindowsSrc from '../assets/logo-windows.jpg'
import logoOfficeSrc  from '../assets/logo-office.jpg'
import logoEsetSrc    from '../assets/logo-eset.jpg'
import logoSageSrc    from '../assets/logo-sage.png'
import {
  getLicenses, createLicense, updateLicense, deleteLicense,
  getNextLicenseNumber, sendLicenseEmail, getCompanySettings, getContacts, getCompanies,
  getSuppliers, getInvoices,
} from '../services/api'
import {
  Plus, Search, X, Save, Pencil, Trash2, Printer, Download, ArrowLeft,
  KeyRound, Mail, Send, Hash, MapPin, Phone, Calendar,
  Copy, CheckCircle2, Clock, Archive, Share2,
} from 'lucide-react'
import { fmtD } from '../utils/fmt'
import toast from 'react-hot-toast'
import { useUnsavedWarning } from '../hooks/useUnsavedWarning'

// ── Logo mapping ───────────────────────────────────────
// Returns the Vite-resolved asset URL (correct regardless of BASE_URL)
function getSoftwareLogo(name) {
  if (!name) return null
  const n = name.toLowerCase()
  if (n.includes('windows')) return logoWindowsSrc
  if (n.includes('office'))  return logoOfficeSrc
  if (n.includes('eset'))    return logoEsetSrc
  if (n.includes('sage'))    return logoSageSrc
  return null
}

// ── Constants ──────────────────────────────────────────
const SOFTWARE_LIST = [
  'Microsoft Windows 11 Home',
  'Microsoft Windows 11 Pro',
  'Microsoft Windows 10',
  'Microsoft Windows Server 2022',
  'Microsoft Office 365',
  'Microsoft Office 2021',
  'Microsoft Office 2019',
  'ESET NOD32 Antivirus',
  'ESET Internet Security',
  'ESET Home Security Essential',
  'ESET Home Security Premium',
  'ESET Smart Security Premium',
  'ESET PROTECT (Empresarial)',
  'Kaspersky Standard',
  'Kaspersky Plus',
  'Kaspersky Premium',
  'Norton 360',
  'Avast Business Antivirus',
  'Malwarebytes Business',
  'Sage 50',
  'Sage 100',
  'QuickBooks Desktop',
  'QuickBooks Online',
  'Adobe Acrobat Pro',
  'Adobe Creative Cloud',
  'AutoCAD',
  'CorelDRAW',
  'Otro',
]

const LICENSE_TYPES = [
  'Perpetua',
  'Suscripción anual',
  'Suscripción mensual',
  'OEM',
  'Volumen',
  'Educativa',
]

const VALIDITY_OPTIONS = [
  '1 año',
  '2 años',
  '3 años',
  'Perpetua',
  '30 días',
  '6 meses',
]

const STATUSES = ['Borrador', 'Emitida', 'Enviada', 'Archivada']

const STATUS_STYLE = {
  Borrador:  'bg-gray-100 text-gray-600',
  Emitida:   'bg-blue-100 text-blue-700',
  Enviada:   'bg-green-100 text-green-700',
  Archivada: 'bg-slate-100 text-slate-500',
}

const STATUS_ICON = {
  Borrador:  <Clock size={11} />,
  Emitida:   <KeyRound size={11} />,
  Enviada:   <CheckCircle2 size={11} />,
  Archivada: <Archive size={11} />,
}

const EMPTY_FORM = {
  license_number: '',
  software_name: '',
  software_custom: '',
  software_version: '',
  license_type: 'Perpetua',
  license_key: '',
  seats: 1,
  purchase_date: new Date().toISOString().split('T')[0],
  expiry_date: '',
  validity_period: '',
  client_name: '',
  client_ruc: '',
  client_email: '',
  client_phone: '',
  client_address: '',
  invoice_ref: '',
  supplier: '',
  notes: '',
  status: 'Emitida',
}

// ── PDF builder ────────────────────────────────────────
export function buildLicenseHTML(lic, company, origin) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

  const fmtDate = (d) => {
    if (!d) return ''
    try {
      const dt = new Date(d + 'T12:00:00')
      return `${dt.getDate()} de ${months[dt.getMonth()]} de ${dt.getFullYear()}`
    } catch { return d }
  }

  const co = company || {}
  const coName    = co.company_name    || 'Service Desk'
  const coAddress = co.company_address || 'Panamá'
  const coRuc     = co.company_ruc     || ''
  const coPhone   = co.company_phone   || ''
  const coEmail   = co.company_email   || ''

  const footerParts = [esc(coName)]
  if (coRuc)   footerParts.push(`RUC: ${esc(coRuc)}`)
  if (coPhone) footerParts.push(`Tel: ${esc(coPhone)}`)
  if (coEmail) footerParts.push(esc(coEmail))

  const row = (label, value, mono = false) => {
    if (!value) return ''
    const style = mono ? 'font-family:monospace;font-size:11pt;letter-spacing:0.5px;color:#1a1a1a;' : ''
    return `<tr>
      <td style="padding:7px 12px 7px 0;color:#555;font-size:9.5pt;white-space:nowrap;width:160px;vertical-align:top">${esc(label)}</td>
      <td style="padding:7px 0;font-size:10pt;font-weight:600;color:#111;${style}">${esc(value)}</td>
    </tr>`
  }

  const keyBlock = lic.license_key ? `
    <div style="margin:24px 0;background:#f4f6f9;border:1px solid #d0d9e8;border-radius:10px;padding:18px 20px">
      <div style="font-size:8.5pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Clave / Serial de licencia</div>
      <div style="font-family:monospace;font-size:13pt;letter-spacing:2px;color:#1a1a1a;word-break:break-all;line-height:1.6">${esc(lic.license_key)}</div>
    </div>` : ''

  const seatsStr = lic.seats > 1 ? `${lic.seats} usuarios` : '1 usuario'

  const clientBlock = (lic.client_name || lic.client_ruc) ? `
    <div style="border-top:1px solid #ddd;margin:20px 0;padding-top:16px">
      <div style="font-size:8.5pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Licenciado a</div>
      <table style="width:100%;border-collapse:collapse">
        ${row('Nombre', lic.client_name)}
        ${row('RUC', lic.client_ruc)}
        ${row('Email', lic.client_email)}
        ${row('Teléfono', lic.client_phone)}
        ${row('Dirección', lic.client_address)}
      </table>
    </div>` : ''

  return `<div style="font-family:Arial,sans-serif;font-size:11pt;color:#111;max-width:720px;margin:0 auto;padding:24px 32px">

  <!-- Letterhead -->
  <div style="display:flex;align-items:center;border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:20px;gap:14px">
    <img src="${companyLogoSrc(origin)}" alt="Logo" style="width:56px;height:56px;object-fit:contain;border-radius:8px">
    <div style="flex:1">
      <div style="font-size:18pt;font-weight:bold;color:#1e3a5f">${esc(coName)}</div>
      <div style="font-size:9pt;color:#555;margin-top:2px">${esc(coAddress)}${coRuc ? ` · RUC: ${esc(coRuc)}` : ''}</div>
      ${(coPhone || coEmail) ? `<div style="font-size:9pt;color:#555">${[coPhone && `Tel: ${esc(coPhone)}`, coEmail && esc(coEmail)].filter(Boolean).join(' · ')}</div>` : ''}
    </div>
    <div style="text-align:right;min-width:120px">
      <div style="font-size:8.5pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase;letter-spacing:0.5px">Licencia de Software</div>
      <div style="font-size:9pt;font-family:monospace;color:#444;margin-top:3px">${esc(lic.license_number || '')}</div>
    </div>
  </div>

  <!-- Title -->
  <div style="text-align:center;margin:20px 0 24px">
    <div style="font-size:14pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase;letter-spacing:1px">Certificado de Licencia de Software</div>
    <div style="font-size:9pt;color:#888;margin-top:4px">Por medio del presente documento se certifica la adquisición de la siguiente licencia</div>
  </div>

  <!-- Software banner -->
  ${(() => {
    const logo = getSoftwareLogo(lic.software_name)
    // logo is a Vite-resolved path like /assets/logo-office-abc.jpg — prefix origin for PDF window
    const logoSrc = logo ? (logo.startsWith('http') ? logo : `${origin}${logo}`) : null
    const logoImg = logoSrc ? `<img src="${logoSrc}" alt="" style="height:52px;max-width:130px;object-fit:contain;background:#fff;border-radius:7px;padding:5px;flex-shrink:0">` : ''
    return `<div style="background:#1e3a5f;border-radius:10px;padding:16px 20px;margin-bottom:20px;color:#fff;display:flex;align-items:center;gap:16px">
    <div style="flex:1">
      <div style="font-size:16pt;font-weight:bold">${esc(lic.software_name)}</div>
      ${lic.software_version ? `<div style="font-size:10pt;opacity:0.8;margin-top:4px">Versión: ${esc(lic.software_version)}</div>` : ''}
      ${lic.license_type ? `<div style="font-size:10pt;opacity:0.75;margin-top:2px">${esc(lic.license_type)}</div>` : ''}
    </div>
    ${logoImg}
  </div>`
  })()}

  <!-- License key -->
  ${keyBlock}

  <!-- Details -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
    ${row('Cantidad de usuarios', seatsStr)}
    ${row('Fecha de compra', fmtDate(lic.purchase_date))}
    ${row('Período de vigencia', lic.validity_period)}
    ${row('Vencimiento', fmtDate(lic.expiry_date))}
    ${row('Proveedor', lic.supplier)}
    ${row('Ref. Factura', lic.invoice_ref)}
  </table>

  ${clientBlock}

  ${lic.notes ? `<div style="background:#fffbea;border:1px solid #f0e68c;border-radius:8px;padding:12px 16px;margin:16px 0;font-size:10pt;color:#7a6000">${esc(lic.notes)}</div>` : ''}

  <!-- Footer -->
  <div style="margin-top:32px;padding-top:8px;border-top:1px solid #ddd;font-size:7.5pt;color:#999;text-align:center">
    ${footerParts.join(' · ')}
  </div>
</div>`
}

// ── FieldSuggest ───────────────────────────────────────
function FieldSuggest({ value, onChange, suggestions = [], placeholder, className = 'input' }) {
  const [open, setOpen] = useState(false)
  const q = (value || '').trim().toLowerCase()
  const hits = q.length > 0
    ? suggestions.filter(s => s.toLowerCase().includes(q)).slice(0, 8)
    : []
  return (
    <div className="relative">
      <input
        className={className}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        style={{ fontSize: '16px' }}
      />
      {open && hits.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 top-full mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {hits.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={() => { onChange(s); setOpen(false) }}
                className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 text-sm text-gray-800 transition-colors"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── StatusBadge ────────────────────────────────────────
function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'}`}>
      {STATUS_ICON[status]} {status}
    </span>
  )
}

// ── CopyButton ─────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button onClick={handle} className="p-1.5 rounded text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors" title="Copiar">
      {copied ? <CheckCircle2 size={13} className="text-teal-500" /> : <Copy size={13} />}
    </button>
  )
}

// ── LicenseDetail ──────────────────────────────────────
function LicenseDetail({ lic, company, onEdit, onDelete, onPrint, onDownload, onShare, onEmail }) {
  const logo = getSoftwareLogo(lic.software_name)
  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 flex items-center gap-3">
          {logo ? (
            <img src={logo} alt="" className="w-14 h-14 object-contain rounded-xl border border-gray-100 bg-white p-1.5 flex-shrink-0 shadow-sm" />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-teal-50 flex items-center justify-center flex-shrink-0">
              <KeyRound size={26} className="text-teal-400" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs font-mono text-gray-400">{lic.license_number}</p>
            <h2 className="text-lg font-bold text-gray-900 mt-0.5 leading-tight">{lic.software_name}</h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <StatusBadge status={lic.status} />
              {lic.license_type && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{lic.license_type}</span>}
              {lic.software_version && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">v{lic.software_version}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          <button onClick={onPrint} className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            <Printer size={13} /> <span className="hidden sm:inline">Imprimir</span>
          </button>
          <button onClick={onDownload} className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors">
            <Download size={13} /> <span className="hidden sm:inline">Descargar</span>
          </button>
          <button onClick={onShare} className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 transition-colors">
            <Share2 size={13} /> <span className="hidden sm:inline">Compartir</span>
          </button>
          <button onClick={onEmail} className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-teal-200 text-teal-700 hover:bg-teal-50 transition-colors">
            <Send size={13} /> <span className="hidden sm:inline">Enviar</span>
          </button>
          <button onClick={onEdit} className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            <Pencil size={13} /> <span className="hidden sm:inline">Editar</span>
          </button>
          <button onClick={onDelete} className="p-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* License key */}
      {lic.license_key && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <KeyRound size={11} /> Clave / Serial de licencia
          </p>
          <div className="flex items-center gap-2">
            <p className="font-mono text-base tracking-widest text-gray-900 break-all flex-1">{lic.license_key}</p>
            <CopyButton text={lic.license_key} />
          </div>
        </div>
      )}

      {/* Info grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Client */}
        {(lic.client_name || lic.client_email) && (
          <div className="card space-y-1.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Licenciado a</p>
            {lic.client_name && <p className="text-sm font-medium text-gray-900">{lic.client_name}</p>}
            {lic.client_ruc && <p className="text-xs text-gray-500">RUC: {lic.client_ruc}</p>}
            {lic.client_email && <p className="text-xs text-gray-500 flex items-center gap-1"><Mail size={10} /> {lic.client_email}</p>}
            {lic.client_phone && <p className="text-xs text-gray-500 flex items-center gap-1"><Phone size={10} /> {lic.client_phone}</p>}
            {lic.client_address && <p className="text-xs text-gray-500 flex items-center gap-1"><MapPin size={10} /> {lic.client_address}</p>}
          </div>
        )}

        {/* Details */}
        <div className="card space-y-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Detalles</p>
          {lic.seats > 1 && <p className="text-xs text-gray-600"><span className="font-medium">{lic.seats}</span> usuarios</p>}
          {lic.purchase_date && <p className="text-xs text-gray-600 flex items-center gap-1"><Calendar size={10} /> Compra: {fmtD(lic.purchase_date)}</p>}
          {lic.validity_period && <p className="text-xs text-gray-600">Vigencia: <span className="font-medium">{lic.validity_period}</span></p>}
          {lic.expiry_date && <p className="text-xs text-gray-600 flex items-center gap-1"><Calendar size={10} /> Vence: {fmtD(lic.expiry_date)}</p>}
          {lic.supplier && <p className="text-xs text-gray-600">Proveedor: <span className="font-medium">{lic.supplier}</span></p>}
          {lic.invoice_ref && <p className="text-xs text-gray-600 flex items-center gap-1"><Hash size={10} /> {lic.invoice_ref}</p>}
        </div>
      </div>

      {lic.notes && (
        <div className="card bg-amber-50 border-amber-100">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Notas</p>
          <p className="text-sm text-amber-800 whitespace-pre-wrap">{lic.notes}</p>
        </div>
      )}

      <p className="text-xs text-gray-300 text-right">Creada: {fmtD(lic.created_at)}</p>
    </div>
  )
}

// ── LicenseForm ────────────────────────────────────────
function LicenseForm({ initial, contacts, companies, supplierNames, invoiceNumbers, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY_FORM)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const isCustom = form.software_name === 'Otro'

  // Fill all client fields when any autocomplete suggestion is picked
  const fillClient = (c) => {
    setForm(f => ({
      ...f,
      client_name:    c.name    || f.client_name,
      client_ruc:     c.ruc     || f.client_ruc,
      client_email:   c.email   || f.client_email,
      client_phone:   c.phone   || f.client_phone,
      client_address: c.address || f.client_address,
    }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const name = isCustom ? form.software_custom.trim() : form.software_name
    if (!name) return toast.error('El software es requerido')
    const payload = { ...form, software_name: name }
    delete payload.software_custom
    payload.seats = Number(payload.seats) || 1
    payload.expiry_date = payload.expiry_date || null
    payload.purchase_date = payload.purchase_date || null
    onSave(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between -mb-1">
        <h2 className="font-bold text-gray-900">{initial ? 'Editar licencia' : 'Nueva licencia'}</h2>
        <button type="button" onClick={onCancel}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
      </div>

      {/* Identification */}
      <div className="card grid grid-cols-2 gap-3">
        <div>
          <label className="label">N° Licencia</label>
          <input className="input font-mono" value={form.license_number} onChange={e => set('license_number', e.target.value)} placeholder="LIC-0001" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Estado</label>
          <select className="input" value={form.status} onChange={e => set('status', e.target.value)} style={{ fontSize: '16px' }}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Software */}
      <div className="card space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Software</p>
        <div>
          <label className="label">Nombre del software *</label>
          <select className="input" value={form.software_name} onChange={e => set('software_name', e.target.value)} style={{ fontSize: '16px' }}>
            <option value="">— Seleccionar —</option>
            {SOFTWARE_LIST.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {isCustom && (
          <div>
            <label className="label">Nombre personalizado *</label>
            <input className="input" value={form.software_custom} onChange={e => set('software_custom', e.target.value)} placeholder="Ej: Sage Buscador Pro 2024" style={{ fontSize: '16px' }} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Versión</label>
            <input className="input" value={form.software_version} onChange={e => set('software_version', e.target.value)} placeholder="2024, 365, 11..." style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="label">Tipo de licencia</label>
            <select className="input" value={form.license_type} onChange={e => set('license_type', e.target.value)} style={{ fontSize: '16px' }}>
              {LICENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* License key */}
      <div className="card space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
          <KeyRound size={11} /> Clave / Serial
        </p>
        <textarea
          className="input font-mono resize-none tracking-widest"
          rows={3}
          value={form.license_key}
          onChange={e => set('license_key', e.target.value)}
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          style={{ fontSize: '16px' }}
        />
      </div>

      {/* Validity */}
      <div className="card grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Cantidad de usuarios</label>
          <input type="number" min="1" className="input" value={form.seats} onChange={e => set('seats', e.target.value)} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Período de vigencia</label>
          <select className="input" value={form.validity_period} onChange={e => set('validity_period', e.target.value)} style={{ fontSize: '16px' }}>
            <option value="">— Seleccionar —</option>
            {VALIDITY_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Fecha de compra</label>
          <input type="date" className="input" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Fecha de vencimiento</label>
          <input type="date" className="input" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Proveedor</label>
          <FieldSuggest
            value={form.supplier}
            onChange={v => set('supplier', v)}
            suggestions={supplierNames}
            placeholder="Nombre del proveedor"
          />
        </div>
        <div>
          <label className="label">Ref. Factura</label>
          <FieldSuggest
            value={form.invoice_ref}
            onChange={v => set('invoice_ref', v)}
            suggestions={invoiceNumbers}
            placeholder="FAC-0001"
          />
        </div>
      </div>

      {/* Client — each field is its own autocomplete */}
      <div className="card space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Cliente / Licenciado</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <ClientAutocomplete
              field="name"
              label="Nombre"
              value={form.client_name}
              onChange={v => set('client_name', v)}
              onSelect={fillClient}
              contacts={contacts}
              companies={companies}
              placeholder="Buscar o escribir nombre..."
            />
          </div>
          <div>
            <ClientAutocomplete
              field="ruc"
              label="RUC"
              value={form.client_ruc}
              onChange={v => set('client_ruc', v)}
              onSelect={fillClient}
              contacts={contacts}
              companies={companies}
              placeholder="RUC del cliente"
            />
          </div>
          <div>
            <ClientAutocomplete
              field="email"
              label="Email"
              value={form.client_email}
              onChange={v => set('client_email', v)}
              onSelect={fillClient}
              contacts={contacts}
              companies={companies}
              placeholder="correo@ejemplo.com"
            />
          </div>
          <div>
            <ClientAutocomplete
              field="phone"
              label="Teléfono"
              value={form.client_phone}
              onChange={v => set('client_phone', v)}
              onSelect={fillClient}
              contacts={contacts}
              companies={companies}
              placeholder="6000-0000"
            />
          </div>
          <div>
            <label className="label">Dirección</label>
            <input className="input" value={form.client_address} onChange={e => set('client_address', e.target.value)} style={{ fontSize: '16px' }} />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="card">
        <label className="label">Notas adicionales</label>
        <textarea className="input resize-none" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Instrucciones de activación, condiciones, etc." style={{ fontSize: '16px' }} />
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 px-5 py-2.5 disabled:opacity-50">
          <Save size={14} /> {saving ? 'Guardando...' : 'Guardar'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
      </div>
    </form>
  )
}

// ── EmailModal ─────────────────────────────────────────
function EmailModal({ lic, onClose, onSent }) {
  const [email, setEmail] = useState(lic.client_email || '')
  const [subject, setSubject] = useState(`Licencia de Software — ${lic.software_name} (${lic.license_number || ''})`)
  const [sending, setSending] = useState(false)

  const handle = async () => {
    if (!email.trim()) return toast.error('Ingresa un correo de destino')
    setSending(true)
    try {
      await sendLicenseEmail(lic.id, { email, subject, origin: window.location.origin })
      toast.success('Correo enviado')
      onSent()
      onClose()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error enviando correo')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Send size={16} /> Enviar licencia por correo</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="label">Destinatario</label>
            <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="label">Asunto</label>
            <input className="input" value={subject} onChange={e => setSubject(e.target.value)} style={{ fontSize: '16px' }} />
          </div>
        </div>
        <div className="flex gap-2 p-5 pt-0">
          <button onClick={handle} disabled={sending} className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5 disabled:opacity-50">
            <Mail size={14} /> {sending ? 'Enviando...' : 'Enviar'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm transition-colors">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────
export default function Licencias() {
  const navigate = useNavigate()
  const { ref: urlRef } = useParams()
  const [licenses, setLicenses] = useState([])
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const { skip: skipWarning } = useUnsavedWarning(editing)
  const detailSwipe = useTouchSwipe({ onSwipeRight: () => { setMobileDetailOpen(false); navigate(-1) } })
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [company, setCompany] = useState(null)
  const [contacts, setContacts] = useState([])
  const [companies, setCompanies] = useState([])
  const [emailOpen, setEmailOpen] = useState(false)
  const [supplierNames, setSupplierNames] = useState([])
  const [invoiceNumbers, setInvoiceNumbers] = useState([])

  const load = useCallback(() => {
    getLicenses().then(r => setLicenses(r.data)).catch(() => toast.error('Error cargando licencias'))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!urlRef) { if (selected) { setSelected(null); setMobileDetailOpen(false) } return }
    if (licenses.length === 0) return
    if (selected?.license_number === urlRef) return
    const found = licenses.find((l) => l.license_number === urlRef)
    if (found) { setSelected(found); setEditing(false); setMobileDetailOpen(true) }
  }, [urlRef, licenses]) // eslint-disable-line

  useEffect(() => {
    Promise.allSettled([
      getCompanySettings(), getContacts(), getCompanies(),
      getSuppliers(), getInvoices(),
    ]).then(([cr, conr, compr, supr, invr]) => {
      if (cr.status === 'fulfilled') setCompany(cr.value.data)
      if (conr.status === 'fulfilled') setContacts(conr.value.data)
      if (compr.status === 'fulfilled') setCompanies(compr.value.data)
      if (supr.status === 'fulfilled') {
        const names = (supr.value.data || []).map(s => s.name).filter(Boolean)
        setSupplierNames([...new Set(names)])
      }
      if (invr.status === 'fulfilled') {
        const nums = (invr.value.data || []).map(i => i.invoice_number || i.number).filter(Boolean)
        setInvoiceNumbers([...new Set(nums)])
      }
    })
  }, [])

  const filtered = licenses.filter(l => {
    const q = search.toLowerCase()
    const match = !q || [l.license_number, l.software_name, l.client_name, l.client_ruc, l.license_key].some(v => v?.toLowerCase().includes(q))
    const matchStatus = !filterStatus || l.status === filterStatus
    return match && matchStatus
  })

  const handleNew = async () => {
    const num = await getNextLicenseNumber().then(r => r.data.number).catch(() => 'LIC-0001')
    setSelected(null)
    setIsNew(true)
    setEditing(true)
    setMobileDetailOpen(true)
    setSelected({ license_number: num })
  }

  const handleSave = async (payload) => {
    setSaving(true)
    try {
      let saved
      if (isNew) {
        saved = await createLicense(payload).then(r => r.data)
        toast.success('Licencia creada')
      } else {
        saved = await updateLicense(selected.id, payload).then(r => r.data)
        toast.success('Licencia guardada')
      }
      setSelected(saved)
      setLicenses(prev => isNew ? [saved, ...prev] : prev.map(l => l.id === saved.id ? saved : l))
      setEditing(false)
      setIsNew(false)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error guardando licencia')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected || !confirm(`¿Eliminar licencia ${selected.license_number}?`)) return
    try {
      await deleteLicense(selected.id)
      setLicenses(prev => prev.filter(l => l.id !== selected.id))
      setSelected(null)
      setMobileDetailOpen(false)
      navigate('/licencias', { replace: true })
      toast.success('Licencia eliminada')
    } catch { toast.error('Error eliminando') }
  }

  const handlePrint = () => {
    if (!selected) return
    const html = buildLicenseHTML(selected, company, window.location.origin)
    openPdfWindow(`Licencia ${selected.license_number}`, html, { autoprint: true })
  }

  const handleDownload = () => {
    if (!selected) return
    const html = buildLicenseHTML(selected, company, window.location.origin)
    openPdfWindow(`Licencia ${selected.license_number}`, html, { autoprint: false })
  }

  const handleShare = async () => {
    if (!selected) return
    const html = buildLicenseHTML(selected, company, window.location.origin)
    const filename = `Licencia-${selected.license_number || selected.id}.pdf`
    await sharePdfFromHtml(`Licencia ${selected.license_number}`, html, filename)
  }

  const handleEdit = () => {
    setIsNew(false)
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setIsNew(false)
    if (isNew) { setSelected(null); setMobileDetailOpen(false); navigate('/licencias', { replace: true }) }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left panel */}
      <div className={`${mobileDetailOpen ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-gray-200 bg-white flex-shrink-0`}>
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Licencias</h1>
              <p className="text-xs text-teal-500 font-medium mt-0.5">{filtered.length} registrada{filtered.length !== 1 ? 's' : ''}</p>
            </div>
            <button onClick={handleNew} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
              <Plus size={15} /> Nueva
            </button>
          </div>
        </div>

        <div className="px-4 py-3 space-y-2 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-8 w-full text-sm" placeholder="Buscar software, cliente, clave..." value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: '16px' }} />
          </div>
          <select className="input w-full text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ fontSize: '16px' }}>
            <option value="">Todos los estados</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-teal-50 flex items-center justify-center mb-4">
                <KeyRound size={28} className="text-teal-300" />
              </div>
              <p className="text-sm font-medium text-gray-400">Sin licencias</p>
              <p className="text-xs text-gray-300 mt-1">Usa "Nueva" para registrar tu primera licencia</p>
            </div>
          ) : filtered.map(l => {
            const logo = getSoftwareLogo(l.software_name)
            return (
            <button
              key={l.id}
              onClick={() => { setSelected(l); setEditing(false); setMobileDetailOpen(true); navigate('/licencias/' + l.license_number) }}
              className={`w-full flex items-start gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left ${selected?.id === l.id ? 'bg-teal-50 border-l-2 border-l-teal-500' : ''}`}
            >
              {logo ? (
                <img src={logo} alt="" className="w-9 h-9 rounded-lg border border-gray-100 bg-white object-contain p-0.5 flex-shrink-0 mt-0.5" />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <KeyRound size={16} className="text-teal-600" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-gray-400">{l.license_number}</p>
                <p className="text-sm font-medium text-gray-900 truncate">{l.software_name}</p>
                {l.client_name && <p className="text-xs text-gray-400 truncate">{l.client_name}</p>}
                {l.expiry_date && <p className="text-xs text-gray-400">Vence: {fmtD(l.expiry_date)}</p>}
              </div>
              <div className="flex-shrink-0 flex flex-col items-end gap-1 pt-0.5">
                <StatusBadge status={l.status} />
              </div>
            </button>
            )
          })}
        </div>
      </div>

      {/* Right panel */}
      <div className={`${mobileDetailOpen ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-y-auto overscroll-contain min-h-0 bg-gray-50`} {...detailSwipe}>
        {mobileDetailOpen && (
          <button onClick={() => { if (editing && !window.confirm('Hay cambios sin guardar. ¿Descartar?')) return; skipWarning(); cancelEdit(); setMobileDetailOpen(false); navigate(-1) }} className="md:hidden flex items-center gap-2 text-sm text-gray-500 px-4 py-3 border-b border-gray-100 bg-white">
            <ArrowLeft size={16} /> Volver
          </button>
        )}

        {editing ? (
          <LicenseForm
            initial={isNew ? { ...EMPTY_FORM, license_number: selected?.license_number || '' } : {
              ...selected,
              software_name: SOFTWARE_LIST.includes(selected?.software_name) ? selected.software_name : 'Otro',
              software_custom: SOFTWARE_LIST.includes(selected?.software_name) ? '' : (selected?.software_name || ''),
              purchase_date: selected?.purchase_date || '',
              expiry_date: selected?.expiry_date || '',
            }}
            contacts={contacts}
            companies={companies}
            supplierNames={supplierNames}
            invoiceNumbers={invoiceNumbers}
            onSave={handleSave}
            onCancel={cancelEdit}
            saving={saving}
          />
        ) : selected && selected.software_name ? (
          <>
            <LicenseDetail
              lic={selected}
              company={company}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onPrint={handlePrint}
              onDownload={handleDownload}
              onShare={handleShare}
              onEmail={() => setEmailOpen(true)}
            />
            {emailOpen && (
              <EmailModal
                lic={selected}
                onClose={() => setEmailOpen(false)}
                onSent={() => {
                  setSelected(s => ({ ...s, status: 'Enviada' }))
                  setLicenses(prev => prev.map(l => l.id === selected.id ? { ...l, status: 'Enviada' } : l))
                }}
              />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-center px-4">
            <div className="w-20 h-20 rounded-2xl bg-teal-50 flex items-center justify-center mb-4">
              <KeyRound size={36} className="text-teal-200" />
            </div>
            <p className="text-sm font-medium text-gray-400">Selecciona una licencia</p>
            <p className="text-xs text-gray-300 mt-1">o crea una nueva con el botón "Nueva"</p>
          </div>
        )}
      </div>
    </div>
  )
}
