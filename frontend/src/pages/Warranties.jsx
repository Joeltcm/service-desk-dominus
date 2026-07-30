import { showConfirm } from '../utils/confirm'
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { companyLogoSrc } from '../utils/branding'
import { useSearchParams, useNavigate, useParams, useLocation } from 'react-router-dom'
import { openPdfWindow, sharePdfFromHtml } from '../utils/pdfViewer'
import ClientAutocomplete from '../components/ClientAutocomplete'
import { Plus, Trash2, Printer, ShieldCheck, ShieldOff, Save, FileCheck, Search, Edit2, Calendar, Download, AlertTriangle, Receipt, X, UserPlus, Upload, Check, PenLine, Share2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { getWarranties, getNextWarrantyNumber, createWarranty, updateWarranty, deleteWarranty, getInvoices, getContacts, getCompanies, createContact, getAgents, uploadMySignature, deleteMySignature } from '../services/api'
import { useFormGuard } from '../context/UnsavedChangesContext'
import { useAuth } from '../context/AuthContext'
import { useCompany, getCompanyCache } from '../context/CompanyContext'
import { useModuleAccess } from '../context/RoleFeaturesContext'
import { fmtD } from '../utils/fmt'

// ── Warranty conditions per equipment type ─────────────
const CONDITIONS = {
  Computadora: {
    label: 'Computadora de Escritorio',
    aplica: [
      'Defectos de fabricación en componentes internos (placa madre, RAM, fuente de poder, disco duro/SSD) bajo uso normal.',
      'Fallas de encendido o apagado sin causa de daño externo visible.',
      'Problemas de reconocimiento de hardware en condiciones normales de operación.',
      'Defectos en puertos y conectores bajo uso apropiado.',
      'Fallas en ventiladores internos por defecto de fabricación.',
    ],
    noAplica: [
      'Daño causado por líquidos, humedad o exposición a condiciones ambientales inadecuadas.',
      'Daños físicos por golpes, caídas o maltrato.',
      'Daño por variaciones de voltaje, sobretensión eléctrica o descargas atmosféricas.',
      'Modificaciones o reparaciones realizadas por personal no autorizado.',
      'Daños causados por virus, malware o software de terceros.',
      'Negligencia, uso indebido o contrario al manual del fabricante.',
      'Acumulación excesiva de polvo o suciedad por falta de mantenimiento preventivo.',
      'Daños causados por instalación incorrecta de componentes o periféricos.',
    ],
  },
  Laptop: {
    label: 'Laptop / Computadora Portátil',
    aplica: [
      'Fallas en la pantalla sin daño físico visible (líneas, apagado repentino, falla de retroiluminación).',
      'Defectos en el teclado, touchpad o botones bajo uso normal.',
      'Fallas en la batería que reduzcan su capacidad por debajo del 50% sin causa de mal uso.',
      'Problemas en puertos USB, HDMI y demás conectores bajo uso normal.',
      'Defectos en componentes internos (RAM, SSD/HDD, placa madre) por uso apropiado.',
    ],
    noAplica: [
      'Daño causado por líquidos derramados sobre el equipo.',
      'Pantalla rota, rayada o con daño físico evidente.',
      'Daños por caídas, golpes o presión excesiva sobre el chasis.',
      'Bisagras dañadas por apertura o cierre forzado.',
      'Batería dañada por uso de cargadores no originales o voltaje inadecuado.',
      'Modificaciones de hardware no autorizadas.',
      'Daños por virus, malware o software malintencionado.',
      'Limpieza con productos químicos no aptos para equipos electrónicos.',
    ],
  },
  Impresora: {
    label: 'Impresora',
    aplica: [
      'Fallas mecánicas en el mecanismo de impresión bajo uso normal y adecuado.',
      'Defectos en cabezales de impresión cuando se utilizan consumibles originales o de calidad certificada.',
      'Problemas en el alimentador de papel por falla de componente mecánico.',
      'Fallas en la conectividad USB o de red por defecto de fabricación.',
      'Problemas en pantalla o panel de control por defecto de fábrica.',
    ],
    noAplica: [
      'Uso de cartuchos, tóner o tintas de terceros que causen obstrucción o daño en los cabezales.',
      'Atascos de papel causados por uso de papel fuera de las especificaciones del fabricante.',
      'Daño físico por caída, golpe o mal manejo del equipo.',
      'Daño por líquidos, humedad o ambientes con polvo excesivo.',
      'Cabezales dañados por falta de uso prolongado o tinta seca por inactividad.',
      'Falta de mantenimiento preventivo (limpieza de cabezales, rodillos de arrastre).',
      'Daño por sobretensión eléctrica o fluctuaciones de voltaje.',
    ],
  },
  Monitor: {
    label: 'Monitor',
    aplica: [
      'Fallas en la pantalla sin daño físico visible (píxeles muertos, líneas horizontales o verticales, parpadeo).',
      'Problemas de retroiluminación que afecten la visualización bajo uso normal.',
      'Defectos en los puertos de entrada (HDMI, DisplayPort, VGA, USB) por fabricación.',
      'Fallas en los controles físicos o menú OSD por defecto de fábrica.',
      'Problemas de calibración de color o brillo que no respondan al ajuste manual bajo uso normal.',
    ],
    noAplica: [
      'Pantalla rota, rayada o con daño físico por caída, golpe o presión excesiva.',
      'Daño causado por líquidos derramados sobre el equipo.',
      'Quemado de pantalla (burn-in) por uso prolongado de imágenes estáticas.',
      'Daño por sobretensión eléctrica o fluctuaciones de voltaje sin protección.',
      'Píxeles muertos dentro del límite aceptado por el fabricante (generalmente menos de 3-5 píxeles).',
      'Modificaciones realizadas por personal no autorizado.',
      'Daño cosmético por uso inadecuado (rayones en el panel, base rota por maltrato).',
      'Uso de voltaje fuera de las especificaciones indicadas por el fabricante.',
    ],
  },
  Router: {
    label: 'Router / Equipo de Red',
    aplica: [
      'Fallas en la transmisión de señal inalámbrica sin causa externa identificable.',
      'Defectos en puertos Ethernet (WAN/LAN) bajo uso normal.',
      'Problemas en el firmware de fábrica que impidan el funcionamiento básico del equipo.',
      'Fallas en el encendido o reinicios involuntarios sin causa de mal uso.',
      'Defectos en antenas externas por fabricación bajo uso apropiado.',
    ],
    noAplica: [
      'Daño por sobretensión eléctrica, descarga de rayos o fallas en la red eléctrica.',
      'Daño físico por caída, golpe o presión excesiva sobre el equipo.',
      'Modificaciones de firmware realizadas por el usuario o terceros no autorizados.',
      'Daño por líquidos, humedad o exposición a ambientes corrosivos.',
      'Configuraciones incorrectas realizadas por el usuario o terceros.',
      'Interferencias externas de señal que no sean responsabilidad del equipo.',
      'Uso en condiciones de voltaje fuera de la especificación del fabricante.',
    ],
  },
  Switch: {
    label: 'Switch de Red',
    aplica: [
      'Fallas en puertos Ethernet bajo uso normal y adecuado.',
      'Defectos en el firmware de fábrica que impidan el funcionamiento básico del equipo.',
      'Fallas en el encendido o reinicios involuntarios sin causa de mal uso.',
      'Problemas en el panel de indicadores LED por defecto de fabricación.',
      'Defectos en la carcasa o estructura interna por fabricación bajo uso apropiado.',
    ],
    noAplica: [
      'Daño por sobretensión eléctrica, descarga de rayos o fallas en la red eléctrica.',
      'Daño físico por caída, golpe o presión excesiva sobre el equipo.',
      'Modificaciones de firmware realizadas por el usuario o terceros no autorizados.',
      'Daño por líquidos, humedad o exposición a ambientes corrosivos.',
      'Configuraciones incorrectas realizadas por el usuario o terceros.',
      'Uso de cables o conectores fuera de las especificaciones del fabricante.',
      'Uso en condiciones de voltaje fuera de la especificación del fabricante.',
    ],
  },
}

const EQUIPMENT_TYPES = Object.keys(CONDITIONS)
const WARRANTY_PERIODS = ['30 días', '3 meses', '6 meses', '1 año', '2 años']
const EMPTY_ITEM = { type: 'Laptop', description: '', brand: '', model: '', serial: '' }

function newCertNumber() {
  const d = new Date()
  return `GRT-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
}

function blankForm() {
  return {
    certNumber: newCertNumber(),
    client: '',
    address: '',
    ruc: '',
    date: new Date().toISOString().slice(0, 10),
    warrantyPeriod: '6 meses',
    technician: '',
    notes: '',
    invoice_id: null,
    invoice_ref: '',
    dispatch_id: null,
  }
}

function fmtShortDate(isoOrStr) {
  if (!isoOrStr) return ''
  return fmtD(isoOrStr.slice(0, 10))
}

function calcWarrantyEnd(dateStr, period) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  if (period === '30 días') d.setDate(d.getDate() + 30)
  else if (period === '3 meses') d.setMonth(d.getMonth() + 3)
  else if (period === '6 meses') d.setMonth(d.getMonth() + 6)
  else if (period === '1 año') d.setFullYear(d.getFullYear() + 1)
  else if (period === '2 años') d.setFullYear(d.getFullYear() + 2)
  return fmtD(d.toISOString().slice(0, 10))
}

// Recalcula la fecha real de fin (Date) desde issue_date (ISO) + periodo, para poder
// comparar con hoy. warranty_end guardado es un string ya formateado (no parseable).
function warrantyEndDate(issueDate, period) {
  if (!issueDate) return null
  const d = new Date(String(issueDate).slice(0, 10) + 'T23:59:59')
  if (isNaN(d)) return null
  if (period === '30 días') d.setDate(d.getDate() + 30)
  else if (period === '3 meses') d.setMonth(d.getMonth() + 3)
  else if (period === '6 meses') d.setMonth(d.getMonth() + 6)
  else if (period === '1 año') d.setFullYear(d.getFullYear() + 1)
  else if (period === '2 años') d.setFullYear(d.getFullYear() + 2)
  else return null
  return d
}

// true = vigente, false = expirada, null = no se puede determinar (periodo desconocido)
function warrantyIsActive(w) {
  const end = warrantyEndDate(w.issue_date, w.warranty_period)
  if (!end) return null
  return end.getTime() >= Date.now()
}

// Generates a self-contained HTML string for the certificate (used for saved-cert printing)
function buildCertHTML(f, items, wEnd, origin, signatureUrl = null, companyName = 'Service Desk') {
  const presentTypes = [...new Set(items.map((it) => it.type).filter(Boolean))]

  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const _co = getCompanyCache()
  const itMode = _co.vertical === 'it_support'
  const coAddress = esc(_co.company_address || 'Panamá, Punta Pacífica, PH Pacific Wind')
  const coRuc     = esc(_co.company_ruc     || '4-754-575 DV 85')

  const infoBox = (label, value, highlight = false) =>
    `<div style="padding:5px 8px;background:${highlight ? '#eff6ff' : '#f8f9fb'};border:1px solid ${highlight ? '#93c5fd' : '#e5e7eb'};border-radius:5px">
      <div style="font-size:6.5pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px">${esc(label)}</div>
      <div style="font-size:8.5pt;font-weight:${highlight ? 'bold' : '600'};color:${highlight ? '#1d4ed8' : '#111'}">${esc(value)}</div>
    </div>`

  const infoBoxes = [
    infoBox('Cliente', f.client || '—'),
    f.address ? infoBox('Dirección', f.address) : '',
    f.ruc ? infoBox('RUC', f.ruc) : '',
    infoBox('Fecha de emisión', fmtD(f.date)),
    infoBox('Período de garantía', f.warrantyPeriod),
    infoBox('Válido hasta', wEnd, true),
    f.technician ? infoBox('Técnico responsable', f.technician) : '',
    f.invoiceNumber ? infoBox('N° Factura', f.invoiceNumber) : '',
  ].join('')

  const incomplete = itMode && items.some((it) => !String(it.serial || '').trim())
  const incompleteBanner = incomplete
    ? `<div style="margin:0 0 14px;padding:8px 12px;background:#fef2f2;border:1.5px solid #fca5a5;border-radius:6px;color:#991b1b;font-size:9pt;font-weight:bold">
        ⚠ CERTIFICADO INCOMPLETO — faltan N° de serie de uno o más equipos. Este certificado no es válido hasta completarse.
      </div>`
    : ''

  const rows = items.map((it, i) =>
    `<tr style="background:${i % 2 === 0 ? '#f8f9fb' : '#fff'}">
      <td style="padding:6px 8px;border:1px solid #d1d5db;vertical-align:top">${i + 1}</td>
      <td style="padding:6px 8px;border:1px solid #d1d5db;vertical-align:top">${esc(it.type)}</td>
      <td style="padding:6px 8px;border:1px solid #d1d5db;vertical-align:top">${esc(it.description) || '—'}</td>
      ${itMode ? '' : `<td style="padding:6px 8px;border:1px solid #d1d5db;vertical-align:top">${esc(it.brand) || '—'}</td>
      <td style="padding:6px 8px;border:1px solid #d1d5db;vertical-align:top">${esc(it.model) || '—'}</td>`}
      <td style="padding:6px 8px;border:1px solid #d1d5db;vertical-align:top;font-family:monospace;font-size:9pt">${esc(it.serial) || '—'}</td>
    </tr>`
  ).join('')

  const condSections = presentTypes.map((type) => {
    const cond = CONDITIONS[type]
    if (!cond) return ''
    return `<div style="margin-bottom:20px;page-break-inside:avoid">
      <div style="font-size:10.5pt;font-weight:bold;color:#1e3a5f;border-bottom:1.5px solid #1e3a5f;padding-bottom:3px;margin-bottom:8px">
        CONDICIONES DE GARANTÍA — ${esc(cond.label.toUpperCase())}
      </div>
      <div style="margin-bottom:8px">
        <div style="font-size:9.5pt;font-weight:bold;color:#166534;margin-bottom:4px">✓ La garantía APLICA en los siguientes casos:</div>
        <ol style="margin:0 0 0 18px;padding:0;font-size:9pt;line-height:1.55">
          ${cond.aplica.map((c) => `<li style="margin-bottom:2px">${esc(c)}</li>`).join('')}
        </ol>
      </div>
      <div>
        <div style="font-size:9.5pt;font-weight:bold;color:#991b1b;margin-bottom:4px">✗ La garantía NO APLICA en los siguientes casos:</div>
        <ol style="margin:0 0 0 18px;padding:0;font-size:9pt;line-height:1.55">
          ${cond.noAplica.map((c) => `<li style="margin-bottom:2px">${esc(c)}</li>`).join('')}
        </ol>
      </div>
    </div>`
  }).join('')

  const notesSection = f.notes
    ? `<div style="margin-bottom:20px;padding:10px 14px;background:#f8f9fb;border:1px solid #ddd;border-radius:6px">
        <div style="font-size:9.5pt;font-weight:bold;color:#444;margin-bottom:4px">OBSERVACIONES:</div>
        <div style="font-size:9pt;white-space:pre-wrap">${esc(f.notes)}</div>
      </div>`
    : ''

  const sigLine = (label, sub, imgUrl) =>
    `<div style="text-align:center">
      ${imgUrl
        ? `<div style="height:64px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:4px">
             <img src="${imgUrl}" alt="Firma" style="max-height:60px;max-width:200px;object-fit:contain">
           </div>`
        : `<div style="border-bottom:1.5px solid #333;margin-bottom:6px;height:40px"></div>`
      }
      <div style="font-size:9pt;font-weight:bold;color:#333">${esc(label)}</div>
      ${sub ? `<div style="font-size:8.5pt;color:#666">${esc(sub)}</div>` : ''}
    </div>`

  return `<div style="font-family:Arial,sans-serif;font-size:11pt;color:#111;background:#fff;max-width:780px;margin:0 auto;padding:24px">
    <div style="display:flex;align-items:center;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:12px;gap:14px">
      <img src="${companyLogoSrc(origin)}" alt="Logo" style="width:52px;height:52px;object-fit:contain;border-radius:6px">
      <div style="flex:1">
        <div style="font-size:18pt;font-weight:bold;color:#1e3a5f;letter-spacing:0.5px">${companyName}</div>
        <div style="font-size:9pt;color:#555;margin-top:2px">${coAddress}</div>
        <div style="font-size:9pt;color:#555">RUC: ${coRuc}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:15pt;font-weight:bold;color:#1e3a5f">CERTIFICADO DE GARANTÍA</div>
        <div style="font-size:10pt;color:#444;margin-top:4px;font-family:monospace">N° ${esc(f.certNumber)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">${infoBoxes}</div>
    ${incompleteBanner}
    <div style="margin-bottom:24px">
      <div style="font-size:11pt;font-weight:bold;color:#1e3a5f;border-bottom:2px solid #1e3a5f;padding-bottom:4px;margin-bottom:8px">
        EQUIPOS CUBIERTOS POR LA GARANTÍA
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:9.5pt">
        <thead>
          <tr style="background:#1e3a5f;color:#fff">
            <th style="padding:7px 8px;text-align:left;font-weight:600;font-size:8.5pt;border:1px solid #2d4d7a">#</th>
            <th style="padding:7px 8px;text-align:left;font-weight:600;font-size:8.5pt;border:1px solid #2d4d7a">Tipo</th>
            <th style="padding:7px 8px;text-align:left;font-weight:600;font-size:8.5pt;border:1px solid #2d4d7a">Descripción</th>
            ${itMode ? '' : `<th style="padding:7px 8px;text-align:left;font-weight:600;font-size:8.5pt;border:1px solid #2d4d7a">Marca</th>
            <th style="padding:7px 8px;text-align:left;font-weight:600;font-size:8.5pt;border:1px solid #2d4d7a">Modelo</th>`}
            <th style="padding:7px 8px;text-align:left;font-weight:600;font-size:8.5pt;border:1px solid #2d4d7a">N° de Serie</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${condSections}
    ${notesSection}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:32px;page-break-inside:avoid">
      ${sigLine('Firma del Técnico', f.technician, signatureUrl)}
      ${sigLine('Firma del Cliente', f.client)}
    </div>
    <div style="margin-top:24px;padding-top:10px;border-top:1px solid #ddd;font-size:7.5pt;color:#888;text-align:center">
      Este certificado de garantía es emitido por ${companyName} • ${coAddress} •
      Válido únicamente con sello y firma del técnico autorizado • N° ${esc(f.certNumber)}
    </div>
  </div>`
}

function openCertWindow(certNumber, bodyHTML, autoprint) {
  const ok = openPdfWindow(`Certificado ${certNumber}`, bodyHTML, { autoprint, extraCss: 'body{font-family:Arial,sans-serif}' })
  if (!ok) toast.error('El navegador bloqueó la ventana emergente')
}

/** Builds PDF HTML from a warranty API object (for use in ClientDocs) */
export function buildWarrantyHTML(w, origin) {
  const f = {
    certNumber: w.cert_number || '',
    client: w.client_name || '',
    address: w.client_company || '',
    ruc: w.client_ruc || '',
    date: w.issue_date || '',
    warrantyPeriod: w.warranty_period || '',
    technician: w.technician || '',
    notes: w.notes || '',
  }
  const items = (w.items || []).map(it => ({
    type: it.type || '',
    description: it.description || '',
    brand: it.brand || '',
    model: it.model || '',
    serial: it.serial || '',
  }))
  let coName = 'Service Desk'
  try { const s = localStorage.getItem('company_settings'); if (s) coName = JSON.parse(s).company_name || coName } catch {}
  return buildCertHTML(f, items, w.warranty_end || '', origin, null, coName)
}

export default function Warranties() {
  const { user: currentUser } = useAuth()
  const { company_name, company_address, company_ruc, vertical } = useCompany()
  const itMode = vertical === 'it_support'
  const { canWrite } = useModuleAccess()
  const canEditWarr = canWrite('warranties')
  const coName = company_name || 'Service Desk'
  const coAddress = company_address || 'Panamá, Punta Pacífica, PH Pacific Wind'
  const coRuc = company_ruc || '4-754-575 DV 85'
  const navigate = useNavigate()
  const location = useLocation()
  const { ref: urlRef } = useParams()
  const [warranties, setWarranties] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState(blankForm())
  const [items, setItems] = useState([{ ...EMPTY_ITEM }])
  const [saving, setSaving] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [activeTab, setActiveTab] = useState('editor') // 'editor' | 'guardados' | 'firma'
  const [mobileView, setMobileView] = useState('form') // 'form' | 'preview'
  const [searchQuery, setSearchQuery] = useState('')
  const [snapshot, setSnapshot] = useState(null)   // form+items at last save/load
  const [pendingAction, setPendingAction] = useState(null) // deferred action awaiting confirmation
  const printRef = useRef()
  const [invoices, setInvoices] = useState([])
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [showInvoiceDrop, setShowInvoiceDrop] = useState(false)
  const [contacts, setContacts] = useState([])
  const [companies, setCompanies] = useState([])
  const [agents, setAgents] = useState([])
  const [selectedSig, setSelectedSig] = useState(null) // { agentId, name, url } | null
  const [sigUploading, setSigUploading] = useState(false)
  const sigFileRef = useRef()

  useEffect(() => {
    loadList()
    getInvoices({}).then((r) => {
      setInvoices(r.data)
      // Pre-select invoice if navigated from Facturas
      const preInvId = location.state?.preselectedInvoiceId
      const preInvNum = location.state?.preselectedInvoiceNumber
      if (preInvId && preInvNum) {
        setForm(f => ({ ...f, invoice_id: preInvId }))
        setInvoiceSearch(preInvNum)
        setActiveTab('editor')
        navigate(location.pathname, { replace: true, state: {} })
      }
    }).catch(() => {})
    Promise.allSettled([getContacts(), getCompanies(), getAgents()])
      .then(([cr, comr, ar]) => {
        if (cr.status === 'fulfilled') setContacts(cr.value.data)
        if (comr.status === 'fulfilled') setCompanies(comr.value.data)
        if (ar.status === 'fulfilled') setAgents(ar.value.data)
      })
    const f = blankForm()
    const i = [{ ...EMPTY_ITEM }]
    setSnapshot({ form: f, items: i })
    // Número de certificado secuencial (GRT-0001…), igual que pedidos/tickets.
    // Solo si es un certificado nuevo (no se está abriendo uno existente por URL).
    if (!urlRef) {
      getNextWarrantyNumber()
        .then((r) => {
          const num = r?.data?.number
          if (!num) return
          setForm((prev) => (prev.certNumber === f.certNumber ? { ...prev, certNumber: num } : prev))
          setSnapshot((s) => (s && s.form.certNumber === f.certNumber ? { ...s, form: { ...s.form, certNumber: num } } : s))
        })
        .catch(() => {})
    }

    // Prellenado al venir desde un pedido despachado ("Generar garantía").
    const fd = location.state?.fromDispatch
    if (fd) {
      const newItems = (fd.items && fd.items.length)
        ? fd.items.map((it) => ({ type: it.category || 'Laptop', description: it.description || '', brand: '', model: '', serial: '' }))
        : [{ ...EMPTY_ITEM }]
      setItems(newItems)
      setForm((prev) => ({
        ...prev,
        client: fd.client_name || prev.client,
        address: fd.client_address || prev.address,
        ruc: fd.client_ruc || prev.ruc,
        invoice_ref: fd.dispatch_number || prev.invoice_ref,
        dispatch_id: fd.dispatch_id || prev.dispatch_id,
      }))
      setSnapshot((s) => (s ? {
        ...s,
        form: { ...s.form, client: fd.client_name || '', address: fd.client_address || '', ruc: fd.client_ruc || '', invoice_ref: fd.dispatch_number || '', dispatch_id: fd.dispatch_id || null },
        items: newItems.map((x) => ({ ...x })),
      } : s))
      setActiveTab('editor')
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [])

  async function loadList() {
    try {
      const res = await getWarranties()
      setWarranties(res.data)
    } catch {
      // silent
    } finally {
      setLoadingList(false)
    }
  }

  const doSelectWarranty = useCallback((w, agentsList) => {
    const newForm = {
      certNumber: w.cert_number || '',
      client: w.client_name || '',
      address: w.client_company || '',
      ruc: w.client_ruc || '',
      date: w.issue_date || new Date().toISOString().slice(0, 10),
      warrantyPeriod: w.warranty_period || '3 meses',
      technician: w.technician || '',
      notes: w.notes || '',
      invoice_id: w.invoice_id || null,
      invoice_ref: w.invoice_ref || '',
      dispatch_id: w.dispatch_id || null,
    }
    setInvoiceSearch(w.invoice ? (w.invoice.invoice_number || '') : '')
    const newItems = w.items && w.items.length > 0
      ? w.items.map((it) => ({
          type: it.type || 'Laptop',
          description: it.description || '',
          brand: it.brand || '',
          model: it.model || '',
          serial: it.serial || '',
        }))
      : [{ ...EMPTY_ITEM }]
    setSelectedId(w.id)
    setForm(newForm)
    setItems(newItems)
    setSnapshot({ form: newForm, items: newItems })
    setActiveTab('editor')
    navigate('/warranties/' + w.cert_number)
    if (newForm.technician) {
      const match = agentsList.find((a) => a.name.toLowerCase() === newForm.technician.trim().toLowerCase())
      if (match?.signature) setSelectedSig({ agentId: match.id, name: match.name, url: match.signature })
    }
  }, [])

  function selectWarranty(w) {
    guardAction(() => doSelectWarranty(w, agents))
  }

  useEffect(() => {
    if (!urlRef) { if (selectedId) { setSelectedId(null) } return }
    if (warranties.length === 0) return
    if (selectedId) {
      const cur = warranties.find((w) => w.id === selectedId)
      if (cur?.cert_number === urlRef) return
    }
    const found = warranties.find((w) => w.cert_number === urlRef)
    if (found) doSelectWarranty(found, agents)
  }, [urlRef, warranties]) // eslint-disable-line

  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setSearchParams({}, { replace: true })
      newCert()
    }
  }, []) // eslint-disable-line

  // Limpia el formulario y prepara un certificado nuevo con el siguiente número
  // secuencial. Deja el snapshot igual al formulario → estado "sin cambios".
  async function doNewCert() {
    const f = blankForm()
    try {
      const res = await getNextWarrantyNumber()
      f.certNumber = res.data.number
    } catch { /* keep date-based fallback */ }
    const i = [{ ...EMPTY_ITEM }]
    setSelectedId(null)
    setForm(f)
    setItems(i)
    setSnapshot({ form: f, items: i })
    setActiveTab('editor')
    navigate('/warranties', { replace: true })
  }

  function newCert() {
    guardAction(doNewCert)
  }

  const setField = (f) => (e) => setForm((prev) => ({ ...prev, [f]: e.target.value }))

  // New contact modal
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ name: '', company: '', ruc: '', email: '', phone: '', address: '' })
  const [savingContact, setSavingContact] = useState(false)
  const [companyDrop, setCompanyDrop] = useState([])

  const handleCreateContact = async (e) => {
    e.preventDefault()
    if (!contactForm.name.trim()) return
    setSavingContact(true)
    try {
      const res = await createContact({
        name: contactForm.name, company: contactForm.company || null,
        ruc: contactForm.ruc || null, email: contactForm.email || null,
        phone: contactForm.phone || null, address: contactForm.address || null,
      })
      const c = res.data
      setContacts((prev) => [c, ...prev])
      setForm((prev) => ({
        ...prev,
        client: c.name,
        address: c.company || prev.address,
        ruc: c.ruc || prev.ruc,
      }))
      setShowContactModal(false)
      setContactForm({ name: '', company: '', ruc: '', email: '', phone: '', address: '' })
      toast.success(`Contacto "${c.name}" creado`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error creando contacto')
    } finally {
      setSavingContact(false)
    }
  }
  const addItem = () => { if (items.length < 20) setItems((prev) => [{ ...EMPTY_ITEM }, ...prev]) }
  const removeItem = (i) => setItems((prev) => prev.filter((_, idx) => idx !== i))
  const setItem = (i, field, val) =>
    setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, [field]: val } : item)))

  const warrantyEnd = () => calcWarrantyEnd(form.date, form.warrantyPeriod)

  function autoSelectSigByTechnician(techName, agentsList) {
    if (!techName?.trim()) return
    const match = agentsList.find((a) => a.name.toLowerCase() === techName.trim().toLowerCase())
    if (match?.signature) setSelectedSig({ agentId: match.id, name: match.name, url: match.signature })
  }

  const handleSave = async () => {
    if (!form.client.trim()) { toast.error('El nombre del cliente es requerido'); return false }
    // En it_support la serie es obligatoria para "completar" la garantía, pero se permite
    // guardar incompleta: se avisa y el pedido no podrá entregarse hasta completarla.
    const missingSerials = itMode && items.some((it) => !it.serial?.trim())
    setSaving(true)
    try {
      const payload = {
        cert_number: form.certNumber,
        client_name: form.client,
        client_company: form.address,
        client_ruc: form.ruc,
        issue_date: form.date,
        warranty_period: form.warrantyPeriod,
        warranty_end: warrantyEnd(),
        technician: form.technician,
        notes: form.notes,
        invoice_id: itMode ? null : (form.invoice_id || null),
        invoice_ref: itMode ? (form.invoice_ref || null) : null,
        dispatch_id: form.dispatch_id || null,
        items: items.map((it, i) => ({ ...it, sort_order: i })),
      }
      if (selectedId) {
        await updateWarranty(selectedId, payload)
        toast.success('Cambios guardados ✓')
      } else {
        await createWarranty(payload)
        toast.success('Certificado guardado ✓')
      }
      if (missingSerials) {
        toast('Garantía incompleta: faltan N° de serie. El pedido no podrá entregarse hasta completarla.', { icon: '⚠️', duration: 5000 })
      }
      await loadList()
      // Limpia el formulario automáticamente y prepara el siguiente certificado.
      await doNewCert()
      return true
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al guardar')
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id, e) => {
    e.stopPropagation()
    if (!await showConfirm('¿Eliminar este certificado de garantía?')) return
    try {
      await deleteWarranty(id)
      toast.success('Certificado eliminado')
      if (selectedId === id) {
        setSelectedId(null)
        setForm(blankForm())
        setItems([{ ...EMPTY_ITEM }])
        navigate('/warranties', { replace: true })
      }
      await loadList()
    } catch {
      toast.error('Error al eliminar')
    }
  }

  // Print the certificate currently loaded in the editor
  const handlePrint = (autoprint = true) => {
    const linkedInv = invoices.find((i) => i.id === form.invoice_id)
    const wEnd = warrantyEnd()
    const printForm = { ...form, invoiceNumber: itMode ? (form.invoice_ref || '') : (linkedInv?.invoice_number || '') }
    const origin = window.location.origin
    openCertWindow(form.certNumber, buildCertHTML(printForm, items, wEnd, origin, selectedSig?.url || null, coName), autoprint)
  }

  const handleShare = async () => {
    const linkedInv = invoices.find((i) => i.id === form.invoice_id)
    const wEnd = warrantyEnd()
    const printForm = { ...form, invoiceNumber: itMode ? (form.invoice_ref || '') : (linkedInv?.invoice_number || '') }
    const html = buildCertHTML(printForm, items, wEnd, window.location.origin, selectedSig?.url || null, coName)
    await sharePdfFromHtml(`Certificado ${form.certNumber}`, html, `Garantia-${form.certNumber || 'documento'}.pdf`)
  }

  const shareSavedWarranty = async (w) => {
    const f = {
      certNumber: w.cert_number,
      client: w.client_name || '',
      address: w.client_company || '',
      ruc: w.client_ruc || '',
      date: w.issue_date || '',
      warrantyPeriod: w.warranty_period || '',
      technician: w.technician || '',
      notes: w.notes || '',
      invoiceNumber: itMode ? (w.invoice_ref || '') : (w.invoice?.invoice_number || ''),
    }
    const wItems =
      w.items?.length > 0
        ? w.items.map((it) => ({ type: it.type || 'Laptop', description: it.description || '', brand: it.brand || '', model: it.model || '', serial: it.serial || '' }))
        : [{ type: 'Laptop', description: '', brand: '', model: '', serial: '' }]
    const wEnd = calcWarrantyEnd(f.date, f.warrantyPeriod)
    const sigUrl = agents.find((a) => a.name === f.technician)?.signature || null
    await sharePdfFromHtml(`Certificado ${f.certNumber}`, buildCertHTML(f, wItems, wEnd, window.location.origin, sigUrl, coName), `Garantia-${f.certNumber || w.id}.pdf`)
  }

  // Print a saved warranty directly from its data (without loading into editor)
  const printSavedWarranty = (w, autoprint = true) => {
    const f = {
      certNumber: w.cert_number,
      client: w.client_name || '',
      address: w.client_company || '',
      ruc: w.client_ruc || '',
      date: w.issue_date || '',
      warrantyPeriod: w.warranty_period || '',
      technician: w.technician || '',
      notes: w.notes || '',
      invoiceNumber: itMode ? (w.invoice_ref || '') : (w.invoice?.invoice_number || ''),
    }
    const wItems =
      w.items?.length > 0
        ? w.items.map((it) => ({
            type: it.type || 'Laptop',
            description: it.description || '',
            brand: it.brand || '',
            model: it.model || '',
            serial: it.serial || '',
          }))
        : [{ type: 'Laptop', description: '', brand: '', model: '', serial: '' }]
    const wEnd = calcWarrantyEnd(f.date, f.warrantyPeriod)
    const origin = window.location.origin
    const sigUrl = agents.find((a) => a.name === f.technician)?.signature || null
    openCertWindow(f.certNumber, buildCertHTML(f, wItems, wEnd, origin, sigUrl, coName), autoprint)
  }

  // ── Unsaved-changes guard ──────────────────────────────
  const hasUnsavedChanges = useMemo(() => {
    if (!snapshot) return false
    return JSON.stringify({ form, items }) !== JSON.stringify(snapshot)
  }, [form, items, snapshot])
  useFormGuard(hasUnsavedChanges)

  // Runs deferred action if no unsaved changes, otherwise shows the modal
  function guardAction(action) {
    if (hasUnsavedChanges) {
      setPendingAction(() => action)
    } else {
      action()
    }
  }

  // Block browser close / refresh
  useEffect(() => {
    const handler = (e) => {
      if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedChanges])

  // ──────────────────────────────────────────────────────

  const presentTypes = [...new Set(items.map((it) => it.type).filter(Boolean))]

  // Item field suggestions grouped by equipment type (description, brand, model)
  const itemFieldData = useMemo(() => {
    const byType = {}
    const allDescs = new Set(), allBrands = new Set(), allModels = new Set()
    warranties.forEach((w) => {
      ;(w.items || []).forEach((it) => {
        const t = it.type || ''
        if (!byType[t]) byType[t] = { descriptions: new Set(), brands: new Set(), models: new Set() }
        if (it.description?.trim()) { byType[t].descriptions.add(it.description); allDescs.add(it.description) }
        if (it.brand?.trim())       { byType[t].brands.add(it.brand);       allBrands.add(it.brand) }
        if (it.model?.trim())       { byType[t].models.add(it.model);       allModels.add(it.model) }
      })
    })
    const toArr = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Array.from(v)]))
    return {
      byType: Object.fromEntries(Object.entries(byType).map(([t, d]) => [t, toArr(d)])),
      all: { descriptions: Array.from(allDescs), brands: Array.from(allBrands), models: Array.from(allModels) },
    }
  }, [warranties])

  // Serials already used in other saved warranties (for duplicate detection)
  const usedSerials = useMemo(() => {
    const map = new Map()
    warranties.forEach((w) => {
      if (w.id === selectedId) return
      ;(w.items || []).forEach((it) => {
        if (it.serial?.trim()) {
          map.set(it.serial.trim().toLowerCase(), {
            cert_number: w.cert_number,
            client_name: w.client_name || '—',
          })
        }
      })
    })
    return map
  }, [warranties, selectedId])

  const handleSelectClient = (c) => {
    setForm((prev) => ({
      ...prev,
      client: c.name || '',
      address: c._type === 'contact' ? (c.company || '') : (c.address || ''),
      ruc: c.ruc || '',
    }))
  }

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return warranties
    return warranties.filter((w) => {
      const fields = [
        w.cert_number, w.client_name, w.client_company, w.client_ruc,
        w.technician, w.notes, w.issue_date, w.warranty_period, w.warranty_end,
        ...(w.items || []).flatMap((it) => [it.type, it.description, it.brand, it.model, it.serial]),
      ]
      return fields.some((f) => f && f.toLowerCase().includes(q))
    })
  }, [warranties, searchQuery])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* New contact modal */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><UserPlus size={16} className="text-blue-600" />Nuevo contacto</h3>
              <button onClick={() => setShowContactModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <form onSubmit={handleCreateContact} className="p-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                  <input className="input w-full" value={contactForm.name} onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nombre completo" required autoFocus style={{fontSize:'16px'}} />
                </div>
                <div className="relative">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Empresa</label>
                  <input className="input w-full" value={contactForm.company}
                    onChange={(e) => {
                      const v = e.target.value
                      setContactForm((f) => ({ ...f, company: v }))
                      setCompanyDrop(v.trim() ? companies.filter((c) => c.name.toLowerCase().includes(v.toLowerCase())) : [])
                    }}
                    onBlur={() => setTimeout(() => setCompanyDrop([]), 150)}
                    placeholder="Nombre de la empresa" style={{fontSize:'16px'}} autoComplete="off" />
                  {companyDrop.length > 0 && (
                    <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {companyDrop.map((c) => (
                        <li key={c.id} onMouseDown={() => {
                          setContactForm((f) => ({ ...f, company: c.name, ruc: c.ruc || f.ruc, phone: c.phone || f.phone, email: c.email || f.email }))
                          setCompanyDrop([])
                        }} className="px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm">
                          <span className="font-medium">{c.name}</span>
                          {c.ruc && <span className="text-gray-400 ml-2 text-xs">RUC: {c.ruc}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">RUC</label>
                  <input className="input w-full" value={contactForm.ruc} onChange={(e) => setContactForm((f) => ({ ...f, ruc: e.target.value }))} placeholder="Ej: 8-123-456 DV 12" style={{fontSize:'16px'}} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input className="input w-full" type="email" value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} placeholder="correo@cliente.com" style={{fontSize:'16px'}} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
                  <input className="input w-full" value={contactForm.phone} onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+507 0000-0000" style={{fontSize:'16px'}} />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setShowContactModal(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={savingContact || !contactForm.name.trim()} className="btn-primary flex items-center gap-2">
                  <UserPlus size={14} />{savingContact ? 'Guardando...' : 'Crear contacto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-2 md:px-4 flex items-center gap-1 h-11">
        <button
          onClick={() => guardAction(() => setActiveTab('editor'))}
          className={`flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-md text-xs md:text-sm font-medium transition-colors ${
            activeTab === 'editor' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
          }`}
        >
          <ShieldCheck size={14} />
          <span>
            {selectedId ? 'Editando' : 'Nuevo Certificado'}
            {hasUnsavedChanges && activeTab === 'editor' && (
              <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-400 inline-block align-middle" title="Cambios sin guardar" />
            )}
          </span>
        </button>
        <button
          onClick={() => guardAction(() => setActiveTab('guardados'))}
          className={`flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-md text-xs md:text-sm font-medium transition-colors ${
            activeTab === 'guardados' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
          }`}
        >
          <Search size={14} />
          <span>Guardados</span>
          {warranties.length > 0 && (
            <span className="bg-gray-200 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{warranties.length}</span>
          )}
        </button>
        <button
          onClick={() => guardAction(() => setActiveTab('firma'))}
          className={`flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-md text-xs md:text-sm font-medium transition-colors ${
            activeTab === 'firma' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
          }`}
        >
          <PenLine size={14} />
          <span>Firma</span>
          {selectedSig && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" title="Firma seleccionada" />}
        </button>
      </div>

      {/* ── Guardados tab ── */}
      {activeTab === 'guardados' && (
        <div className="flex-1 overflow-y-auto bg-gray-50 p-3 md:p-6">
          <div className="max-w-4xl mx-auto space-y-3 md:space-y-4">
            {/* Search + new button */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  className="input w-full pl-9 py-2.5 text-sm"
                  placeholder="Buscar por cliente, RUC, N° certificado, equipo, marca, modelo, serie, técnico..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{fontSize:'16px'}}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
                  >×</button>
                )}
              </div>
              {canEditWarr && <button
                onClick={newCert}
                className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2 flex-shrink-0"
              >
                <Plus size={14} /> Nuevo
              </button>}
            </div>

            <p className="text-xs text-gray-400">
              {searchQuery
                ? `${searchResults.length} resultado(s) para "${searchQuery}"`
                : `${warranties.length} certificado(s) guardado(s)`}
            </p>

            {loadingList ? (
              <div className="text-sm text-gray-400 text-center py-10">Cargando...</div>
            ) : searchResults.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-10">
                {searchQuery ? 'Sin resultados para esa búsqueda.' : 'No hay certificados guardados.'}
              </div>
            ) : (
              <div className="space-y-3">
                {searchResults.map((w) => {
                  const active = warrantyIsActive(w)
                  return (
                  <div key={w.id} className="bg-white rounded-xl border border-gray-200 p-3 md:p-4 hover:border-blue-200 hover:shadow-sm transition-all">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      {/* Info */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-mono font-bold text-blue-700 text-sm">{w.cert_number}</span>
                          {w.warranty_period && (
                            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">{w.warranty_period}</span>
                          )}
                          {active !== null && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-1 ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                              {active ? <ShieldCheck size={11} /> : <ShieldOff size={11} />} {active ? 'Vigente' : 'Expirada'}
                            </span>
                          )}
                          {w.warranty_end && (
                            <span className={`text-xs flex items-center gap-1 font-semibold ${active === false ? 'text-red-600' : active ? 'text-emerald-700' : 'text-gray-500'}`}>
                              <Calendar size={11} /> Válido hasta {w.warranty_end}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          {w.client_name && <span className="font-semibold text-gray-800">{w.client_name}</span>}
                          {w.client_ruc && <span className="text-gray-500">RUC: {w.client_ruc}</span>}
                          {w.client_company && <span className="text-gray-500">{w.client_company}</span>}
                          {w.technician && <span className="text-gray-400 text-xs">Técnico: {w.technician}</span>}
                        </div>
                        {w.items && w.items.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {w.items.map((it, i) => (
                              <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                {it.type}{it.brand ? ` · ${it.brand}` : ''}{it.model ? ` ${it.model}` : ''}{it.serial ? ` (${it.serial})` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                        {w.notes && <p className="text-xs text-gray-400 italic truncate">{w.notes}</p>}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                        <button
                          onClick={() => printSavedWarranty(w, true)}
                          className="flex items-center gap-1.5 px-3 min-h-[44px] bg-gray-800 text-white text-xs font-medium rounded-lg hover:bg-gray-900 active:bg-black transition-colors"
                        >
                          <Printer size={13} /> Imprimir
                        </button>
                        <button
                          onClick={() => printSavedWarranty(w, false)}
                          className="flex items-center gap-1.5 px-3 min-h-[44px] bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 active:bg-green-800 transition-colors"
                        >
                          <Download size={13} /> PDF
                        </button>
                        <button
                          onClick={() => shareSavedWarranty(w)}
                          className="flex items-center gap-1.5 px-3 min-h-[44px] bg-cyan-600 text-white text-xs font-medium rounded-lg hover:bg-cyan-700 transition-colors"
                        >
                          <Share2 size={13} /> Compartir
                        </button>
                        <button
                          onClick={() => selectWarranty(w)}
                          className="btn-secondary flex items-center gap-1.5 text-xs px-3 min-h-[44px]"
                        >
                          <Edit2 size={13} /> Editar
                        </button>
                        <button
                          onClick={(e) => handleDelete(w.id, e)}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-red-200 text-red-500 rounded-lg hover:bg-red-50 active:bg-red-100 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Firma tab ── */}
      {activeTab === 'firma' && (
        <div className="flex-1 overflow-y-auto bg-gray-50 p-3 md:p-6">
          {/* Hidden file input */}
          <input
            ref={sigFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              if (file.size > 600_000) { toast.error('La imagen es muy grande. Máximo 600 KB.'); return }
              setSigUploading(true)
              try {
                const reader = new FileReader()
                reader.onload = async (ev) => {
                  const b64 = ev.target.result
                  await uploadMySignature(b64)
                  const res = await getAgents()
                  setAgents(res.data)
                  const me = res.data.find((a) => a.id === currentUser?.id)
                  if (me) setSelectedSig({ agentId: me.id, name: me.name, url: me.signature })
                  toast.success('Firma guardada')
                  setSigUploading(false)
                }
                reader.onerror = () => { toast.error('Error leyendo el archivo'); setSigUploading(false) }
                reader.readAsDataURL(file)
              } catch {
                toast.error('Error subiendo la firma')
                setSigUploading(false)
              }
              e.target.value = ''
            }}
          />

          <div className="max-w-3xl mx-auto space-y-4">
            <div>
              <h2 className="text-base font-bold text-gray-900 mb-1">Firmas de agentes</h2>
              <p className="text-xs text-gray-500">Selecciona la firma que aparecerá en el certificado de garantía. Cada agente puede subir su propia firma manuscrita.</p>
            </div>

            {agents.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-10">Cargando agentes...</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {agents.map((agent) => {
                  const isMe = agent.id === currentUser?.id
                  const isSel = selectedSig?.agentId === agent.id
                  return (
                    <div
                      key={agent.id}
                      className={`bg-white rounded-xl border-2 p-4 transition-all ${
                        isSel ? 'border-blue-500 shadow-md' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-semibold text-gray-900 text-sm">{agent.name}</p>
                          <p className="text-xs text-gray-400 capitalize">{agent.role}</p>
                        </div>
                        {isSel && (
                          <span className="flex items-center gap-1 text-xs text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full">
                            <Check size={11} /> Seleccionada
                          </span>
                        )}
                      </div>

                      {/* Signature preview area */}
                      <div className="border border-gray-100 rounded-lg bg-gray-50 h-24 flex items-center justify-center mb-3 overflow-hidden">
                        {agent.signature ? (
                          <img
                            src={agent.signature}
                            alt={`Firma de ${agent.name}`}
                            className="max-h-20 max-w-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-gray-300 italic">Sin firma cargada</span>
                        )}
                      </div>

                      <div className="flex gap-2">
                        {agent.signature && (
                          <button
                            onClick={() => {
                              if (isSel) {
                                setSelectedSig(null)
                              } else {
                                setSelectedSig({ agentId: agent.id, name: agent.name, url: agent.signature })
                                toast.success(`Firma de ${agent.name} seleccionada`)
                              }
                            }}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors min-h-[40px] ${
                              isSel
                                ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-600'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                          >
                            {isSel ? <X size={13} /> : <Check size={13} />}
                            {isSel ? 'Quitar selección' : 'Usar esta firma'}
                          </button>
                        )}
                        {isMe && (
                          <button
                            disabled={sigUploading}
                            onClick={() => sigFileRef.current?.click()}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors min-h-[40px] disabled:opacity-50"
                          >
                            <Upload size={13} />
                            {sigUploading ? 'Subiendo...' : agent.signature ? 'Actualizar' : 'Subir firma'}
                          </button>
                        )}
                        {isMe && agent.signature && (
                          <button
                            onClick={async () => {
                              if (!await showConfirm('¿Eliminar tu firma?')) return
                              try {
                                await deleteMySignature()
                                const res = await getAgents()
                                setAgents(res.data)
                                if (isSel) setSelectedSig(null)
                                toast.success('Firma eliminada')
                              } catch {
                                toast.error('Error eliminando firma')
                              }
                            }}
                            className="min-h-[40px] min-w-[40px] flex items-center justify-center border border-red-200 text-red-400 rounded-lg hover:bg-red-50 transition-colors"
                            title="Eliminar firma"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Editor tab ── */}
      {activeTab === 'editor' && (
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left: Form */}
          <div className={[
            'flex-col border-r border-gray-200 bg-white flex-shrink-0 overflow-y-auto overscroll-contain min-h-0 w-full md:w-96 lg:w-[420px]',
            mobileView === 'preview' ? 'hidden md:flex' : 'flex',
          ].join(' ')}>
            {/* Header */}
            <div className="flex flex-col border-b border-gray-100 sticky top-0 bg-white z-10">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheck size={18} className="text-blue-600 flex-shrink-0" />
                  <div className="min-w-0">
                    {selectedId ? (
                      <>
                        <h1 className="text-base font-bold text-gray-900 leading-tight">Editando certificado</h1>
                        <p className="text-xs text-blue-600 font-mono truncate">{form.certNumber}</p>
                      </>
                    ) : (
                      <>
                        <h1 className="text-base font-bold text-gray-900 leading-tight">Nuevo certificado</h1>
                        <p className="text-xs text-gray-400">Completa los datos del formulario</p>
                      </>
                    )}
                  </div>
                </div>
                {selectedId && canEditWarr && (
                  <button onClick={newCert} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2 flex-shrink-0">
                    <Plus size={14} /> Nuevo
                  </button>
                )}
              </div>
              {/* Action buttons pinned below title */}
              <div className="flex gap-2 px-4 pb-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 py-2"
                >
                  <Save size={14} />
                  {saving ? 'Guardando...' : selectedId ? 'Actualizar' : 'Guardar'}
                </button>
                <button
                  onClick={() => handlePrint(true)}
                  title="Imprimir"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium transition-colors"
                >
                  <Printer size={14} />
                </button>
                <button
                  onClick={() => handlePrint(false)}
                  title="Guardar como PDF"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-green-300 bg-white text-green-700 hover:bg-green-50 text-sm font-medium transition-colors"
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={handleShare}
                  title="Compartir PDF"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 text-sm font-medium transition-colors"
                >
                  <Share2 size={14} />
                </button>
                <button
                  onClick={() => guardAction(() => setActiveTab('guardados'))}
                  title="Cancelar"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-white text-red-500 hover:bg-red-50 active:bg-red-100 text-sm font-medium transition-colors flex-shrink-0"
                >
                  ✕
                </button>
                {/* Mobile: toggle between form and preview */}
                <button
                  onClick={() => setMobileView(mobileView === 'form' ? 'preview' : 'form')}
                  className="md:hidden flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm font-medium transition-colors flex-shrink-0"
                >
                  {mobileView === 'form' ? <FileCheck size={14} /> : <ShieldCheck size={14} />}
                </button>
              </div>
            </div>

            {/* Form */}
            <div className="p-4 space-y-5">
              {/* Datos del certificado */}
              <section className="space-y-3">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Datos del certificado</h2>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">N° de certificado</label>
                  <input className="input w-full font-mono" value={form.certNumber} onChange={setField('certNumber')} style={{fontSize:'16px'}} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Fecha de emisión</label>
                    <input className="input w-full" type="date" value={form.date} onChange={setField('date')} style={{fontSize:'16px'}} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Período de garantía</label>
                    <select className="input w-full" value={form.warrantyPeriod} onChange={setField('warrantyPeriod')} style={{fontSize:'16px'}}>
                      {WARRANTY_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
              </section>

              {/* Factura relacionada */}
              <section className="space-y-3">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Factura relacionada</h2>
                {itMode ? (
                  <input
                    className="input w-full"
                    placeholder="N° de factura (sistema externo)"
                    value={form.invoice_ref || ''}
                    onChange={(e) => setForm((f) => ({ ...f, invoice_ref: e.target.value }))}
                    style={{ fontSize: '16px' }}
                  />
                ) : form.invoice_id ? (
                  (() => {
                    const inv = invoices.find((i) => i.id === form.invoice_id)
                    return (
                      <div className="flex items-center gap-2 p-2.5 bg-indigo-50 border border-indigo-200 rounded-lg">
                        <Receipt size={14} className="text-indigo-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-indigo-800 font-mono">{inv?.invoice_number || `FAC-${form.invoice_id}`}</p>
                          {inv?.client_name && <p className="text-xs text-indigo-500 truncate">{inv.client_name}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => { setForm((f) => ({ ...f, invoice_id: null })); setInvoiceSearch('') }}
                          className="text-indigo-400 hover:text-red-500 p-0.5"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )
                  })()
                ) : (
                  <div className="relative">
                    <input
                      className="input w-full"
                      placeholder="Buscar por N° factura o cliente..."
                      value={invoiceSearch}
                      onChange={(e) => { setInvoiceSearch(e.target.value); setShowInvoiceDrop(true) }}
                      onFocus={() => setShowInvoiceDrop(true)}
                      onBlur={() => setTimeout(() => setShowInvoiceDrop(false), 150)}
                      autoComplete="off"
                      style={{fontSize:'16px'}}
                    />
                    {showInvoiceDrop && invoiceSearch.trim() && (
                      <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {invoices
                          .filter((inv) => {
                            const q = invoiceSearch.toLowerCase()
                            return (inv.invoice_number || '').toLowerCase().includes(q) ||
                                   (inv.client_name || '').toLowerCase().includes(q)
                          })
                          .slice(0, 8)
                          .map((inv) => (
                            <button
                              key={inv.id}
                              type="button"
                              onMouseDown={() => {
                                setForm((f) => ({
                                  ...f,
                                  invoice_id: inv.id,
                                  client: f.client || inv.client_name || '',
                                  ruc: f.ruc || inv.client_ruc || '',
                                  address: f.address || inv.client_address || '',
                                }))
                                setInvoiceSearch(inv.invoice_number || '')
                                setShowInvoiceDrop(false)
                              }}
                              className="w-full text-left px-3 py-2.5 hover:bg-indigo-50 border-b border-gray-50 last:border-0 transition-colors"
                            >
                              <p className="text-sm font-semibold font-mono text-indigo-700">{inv.invoice_number || `FAC-${inv.id}`}</p>
                              <p className="text-xs text-gray-500">{inv.client_name || '—'}{inv.total ? ` · $${inv.total}` : ''}</p>
                            </button>
                          ))}
                        {invoices.filter((inv) => {
                          const q = invoiceSearch.toLowerCase()
                          return (inv.invoice_number || '').toLowerCase().includes(q) || (inv.client_name || '').toLowerCase().includes(q)
                        }).length === 0 && (
                          <p className="text-xs text-gray-400 px-3 py-3 text-center">Sin resultados</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Datos del cliente */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Datos del cliente</h2>
                  <button type="button" onClick={() => { setContactForm({ name: form.client, company: '', ruc: '', email: '', phone: '', address: '' }); setShowContactModal(true) }}
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium">
                    <UserPlus size={13} /> Nuevo contacto
                  </button>
                </div>
                <ClientAutocomplete
                  field="name"
                  label="Nombre del cliente *"
                  labelClassName="block text-xs font-medium text-gray-600 mb-1"
                  inputClassName="input w-full"
                  value={form.client}
                  onChange={(v) => setForm((prev) => ({ ...prev, client: v }))}
                  onSelect={handleSelectClient}
                  contacts={contacts}
                  companies={companies}
                  placeholder="Nombre completo"
                  required
                />
                <ClientAutocomplete
                  field="address"
                  label="Dirección (opcional)"
                  labelClassName="block text-xs font-medium text-gray-600 mb-1"
                  inputClassName="input w-full"
                  value={form.address}
                  onChange={(v) => setForm((prev) => ({ ...prev, address: v }))}
                  onSelect={handleSelectClient}
                  contacts={contacts}
                  companies={companies}
                  placeholder="Dirección del cliente"
                />
                <ClientAutocomplete
                  field="ruc"
                  label="RUC (opcional)"
                  labelClassName="block text-xs font-medium text-gray-600 mb-1"
                  inputClassName="input w-full"
                  value={form.ruc}
                  onChange={(v) => setForm((prev) => ({ ...prev, ruc: v }))}
                  onSelect={handleSelectClient}
                  contacts={contacts}
                  companies={companies}
                  placeholder="Ej: 8-123-456 DV 12"
                />
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Técnico responsable</label>
                  <input className="input w-full" value={form.technician} onChange={setField('technician')} placeholder="Nombre del técnico" style={{fontSize:'16px'}} />
                </div>
                {/* Signature selector */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Firma del técnico</label>
                  {selectedSig ? (
                    <div className="flex items-center gap-2 p-2 border border-blue-200 rounded-lg bg-blue-50">
                      <img src={selectedSig.url} alt="Firma" className="h-8 max-w-[120px] object-contain" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-blue-800 truncate">{selectedSig.name}</p>
                      </div>
                      <button onClick={() => setSelectedSig(null)} className="text-blue-400 hover:text-red-500 p-0.5 flex-shrink-0" title="Quitar firma">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => guardAction(() => setActiveTab('firma'))}
                      className="w-full flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-xs text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors min-h-[40px]"
                    >
                      <PenLine size={13} /> Seleccionar firma (opcional)
                    </button>
                  )}
                </div>
              </section>

              {/* Equipos */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Equipos ({items.length}/20)</h2>
                  <button
                    onClick={addItem}
                    disabled={items.length >= 20}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 active:text-blue-900 font-medium disabled:opacity-40 py-1.5 px-2 -mr-2 rounded-lg active:bg-blue-50"
                  >
                    <Plus size={13} /> Agregar
                  </button>
                </div>
                {items.map((item, i) => {
                  const typeSuggData = itemFieldData.byType[item.type] || {}
                  const descSuggs  = typeSuggData.descriptions?.length ? typeSuggData.descriptions  : itemFieldData.all.descriptions
                  const brandSuggs = typeSuggData.brands?.length       ? typeSuggData.brands        : itemFieldData.all.brands
                  const modelSuggs = typeSuggData.models?.length       ? typeSuggData.models        : itemFieldData.all.models
                  const serialDup  = item.serial?.trim() ? usedSerials.get(item.serial.trim().toLowerCase()) : null
                  return (
                    <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-2 bg-gray-50">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500">Equipo #{i + 1}</span>
                        {items.length > 1 && (
                          <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600 active:text-red-700 p-2 -mr-1 rounded-lg active:bg-red-50">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      {itMode ? (
                        // Tipo = categoría del inventario (texto libre, se prellena desde el pedido)
                        <div>
                          <input
                            className="input w-full text-sm"
                            value={item.type}
                            onChange={(e) => setItem(i, 'type', e.target.value)}
                            placeholder="Tipo (categoría del inventario)"
                            list="warr-type-options"
                            style={{fontSize:'16px'}}
                          />
                          <datalist id="warr-type-options">
                            {EQUIPMENT_TYPES.map((t) => <option key={t} value={t} />)}
                          </datalist>
                        </div>
                      ) : (
                        <select className="input w-full text-sm" value={item.type} onChange={(e) => setItem(i, 'type', e.target.value)} style={{fontSize:'16px'}}>
                          {(EQUIPMENT_TYPES.includes(item.type) ? EQUIPMENT_TYPES : [item.type, ...EQUIPMENT_TYPES]).map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      )}
                      <ItemSuggestInput
                        value={item.description}
                        onChange={(val) => setItem(i, 'description', val)}
                        placeholder="Descripción"
                        suggestions={descSuggs}
                      />
                      {!itMode && (
                        <div className="grid grid-cols-2 gap-2">
                          <ItemSuggestInput
                            value={item.brand}
                            onChange={(val) => setItem(i, 'brand', val)}
                            placeholder="Marca"
                            suggestions={brandSuggs}
                          />
                          <ItemSuggestInput
                            value={item.model}
                            onChange={(val) => setItem(i, 'model', val)}
                            placeholder="Modelo"
                            suggestions={modelSuggs}
                          />
                        </div>
                      )}
                      {/* Serie: sin sugerencias, con aviso de duplicado */}
                      <div>
                        <input
                          className={`input w-full text-sm ${serialDup ? 'border-amber-400 focus:ring-amber-400' : ''} ${itMode && !item.serial?.trim() ? 'border-red-300 focus:ring-red-400' : ''}`}
                          value={item.serial}
                          onChange={(e) => setItem(i, 'serial', e.target.value)}
                          placeholder={itMode ? 'N° de serie (obligatorio)' : 'N° de serie'}
                          style={{fontSize:'16px'}}
                        />
                        {serialDup && (
                          <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                            <AlertTriangle size={11} />
                            Serie ya registrada en <span className="font-semibold">{serialDup.cert_number}</span>
                            {serialDup.client_name && <span> · {serialDup.client_name}</span>}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </section>

              {/* Observaciones */}
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Observaciones</h2>
                <textarea
                  className="input w-full h-20 resize-none text-sm"
                  value={form.notes}
                  onChange={setField('notes')}
                  placeholder="Notas adicionales para el certificado..."
                  style={{fontSize:'16px'}}
                />
              </section>

              {/* Link to saved list */}
              {warranties.length > 0 && (
                <button
                  onClick={() => setActiveTab('guardados')}
                  className="w-full text-xs text-gray-400 hover:text-blue-600 py-1 flex items-center justify-center gap-1 transition-colors"
                >
                  <FileCheck size={12} /> Ver {warranties.length} certificado(s) guardado(s)
                </button>
              )}
            </div>
          </div>

          {/* Right: Certificate preview */}
          <div className={[
            'flex-1 overflow-y-auto overscroll-contain min-h-0 bg-gray-100 p-2 md:p-6',
            mobileView === 'form' ? 'hidden md:block' : 'block',
          ].join(' ')}>
            {/* Mobile: back to form button */}
            <div className="md:hidden mb-2">
              <button
                onClick={() => setMobileView('form')}
                className="text-xs text-blue-600 font-medium flex items-center gap-1 hover:underline"
              >
                ← Volver al formulario
              </button>
            </div>
            <div className="overflow-x-auto">
              <div
                id="warranty-certificate"
                ref={printRef}
                style={{
                  fontFamily: 'Arial, sans-serif',
                  fontSize: '11pt',
                  color: '#111',
                  background: '#fff',
                  minWidth: '600px',
                  maxWidth: '780px',
                  margin: '0 auto',
                  padding: '24px',
                  boxShadow: '0 2px 16px rgba(0,0,0,0.10)',
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', borderBottom: '3px solid #1e3a5f', paddingBottom: '10px', marginBottom: '12px', gap: '14px' }}>
                  <img src={companyLogoSrc()} alt="Logo" style={{ width: '52px', height: '52px', objectFit: 'contain', borderRadius: '6px' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '18pt', fontWeight: 'bold', color: '#1e3a5f', letterSpacing: '0.5px' }}>{coName}</div>
                    <div style={{ fontSize: '9pt', color: '#555', marginTop: '2px' }}>{coAddress}</div>
                    <div style={{ fontSize: '9pt', color: '#555' }}>RUC: {coRuc}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '15pt', fontWeight: 'bold', color: '#1e3a5f' }}>CERTIFICADO DE GARANTÍA</div>
                    <div style={{ fontSize: '10pt', color: '#444', marginTop: '4px', fontFamily: 'monospace' }}>N° {form.certNumber}</div>
                  </div>
                </div>

                {/* Client info */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                  <InfoBox label="Cliente" value={form.client || '—'} />
                  {form.address && <InfoBox label="Dirección" value={form.address} />}
                  {form.ruc && <InfoBox label="RUC" value={form.ruc} />}
                  <InfoBox label="Fecha de emisión" value={fmtD(form.date)} />
                  <InfoBox label="Período de garantía" value={form.warrantyPeriod} />
                  <InfoBox label="Válido hasta" value={warrantyEnd()} highlight />
                  {form.technician && <InfoBox label="Técnico responsable" value={form.technician} />}
                </div>

                {/* Aviso de certificado incompleto (it_support: faltan series) */}
                {itMode && items.some((it) => !String(it.serial || '').trim()) && (
                  <div style={{ marginBottom: '14px', padding: '8px 12px', background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: '6px', color: '#991b1b', fontSize: '9pt', fontWeight: 'bold' }}>
                    ⚠ CERTIFICADO INCOMPLETO — faltan N° de serie de uno o más equipos. Este certificado no es válido hasta completarse.
                  </div>
                )}

                {/* Equipment table */}
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: '11pt', fontWeight: 'bold', color: '#1e3a5f', borderBottom: '2px solid #1e3a5f', paddingBottom: '4px', marginBottom: '8px' }}>
                    EQUIPOS CUBIERTOS POR LA GARANTÍA
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5pt' }}>
                    <thead>
                      <tr style={{ background: '#1e3a5f', color: '#fff' }}>
                        <th style={thStyle}>#</th>
                        <th style={thStyle}>Tipo</th>
                        <th style={thStyle}>Descripción</th>
                        {!itMode && <th style={thStyle}>Marca</th>}
                        {!itMode && <th style={thStyle}>Modelo</th>}
                        <th style={thStyle}>N° de Serie</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#f8f9fb' : '#fff' }}>
                          <td style={tdStyle}>{i + 1}</td>
                          <td style={tdStyle}>{it.type}</td>
                          <td style={tdStyle}>{it.description || '—'}</td>
                          {!itMode && <td style={tdStyle}>{it.brand || '—'}</td>}
                          {!itMode && <td style={tdStyle}>{it.model || '—'}</td>}
                          <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '9pt' }}>{it.serial || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Conditions per type */}
                {presentTypes.map((type) => {
                  const cond = CONDITIONS[type]
                  if (!cond) return null
                  return (
                    <div key={type} style={{ marginBottom: '20px', pageBreakInside: 'avoid' }}>
                      <div style={{ fontSize: '10.5pt', fontWeight: 'bold', color: '#1e3a5f', borderBottom: '1.5px solid #1e3a5f', paddingBottom: '3px', marginBottom: '8px' }}>
                        CONDICIONES DE GARANTÍA — {cond.label.toUpperCase()}
                      </div>
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ fontSize: '9.5pt', fontWeight: 'bold', color: '#166534', marginBottom: '4px' }}>✓ La garantía APLICA en los siguientes casos:</div>
                        <ol style={{ margin: '0 0 0 18px', padding: 0, fontSize: '9pt', lineHeight: '1.55' }}>
                          {cond.aplica.map((c, i) => <li key={i} style={{ marginBottom: '2px' }}>{c}</li>)}
                        </ol>
                      </div>
                      <div>
                        <div style={{ fontSize: '9.5pt', fontWeight: 'bold', color: '#991b1b', marginBottom: '4px' }}>✗ La garantía NO APLICA en los siguientes casos:</div>
                        <ol style={{ margin: '0 0 0 18px', padding: 0, fontSize: '9pt', lineHeight: '1.55' }}>
                          {cond.noAplica.map((c, i) => <li key={i} style={{ marginBottom: '2px' }}>{c}</li>)}
                        </ol>
                      </div>
                    </div>
                  )
                })}

                {/* Notes */}
                {form.notes && (
                  <div style={{ marginBottom: '20px', padding: '10px 14px', background: '#f8f9fb', border: '1px solid #ddd', borderRadius: '6px' }}>
                    <div style={{ fontSize: '9.5pt', fontWeight: 'bold', color: '#444', marginBottom: '4px' }}>OBSERVACIONES:</div>
                    <div style={{ fontSize: '9pt', whiteSpace: 'pre-wrap' }}>{form.notes}</div>
                  </div>
                )}

                {/* Signatures */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', marginTop: '32px', pageBreakInside: 'avoid' }}>
                  <SignatureLine label="Firma del Técnico" sub={form.technician} sigUrl={selectedSig?.url} />
                  <SignatureLine label="Firma del Cliente" sub={form.client} />
                </div>

                {/* Footer */}
                <div style={{ marginTop: '24px', paddingTop: '10px', borderTop: '1px solid #ddd', fontSize: '7.5pt', color: '#888', textAlign: 'center' }}>
                  Este certificado de garantía es emitido por {coName} •
                  Válido únicamente con sello y firma del técnico autorizado • N° {form.certNumber}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Unsaved changes modal ── */}
      {pendingAction !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={20} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-base">Cambios sin guardar</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    El certificado tiene cambios que no han sido guardados. ¿Qué deseas hacer?
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                {/* Guardar y continuar */}
                <button
                  onClick={async () => {
                    const ok = await handleSave()
                    if (ok) {
                      const action = pendingAction
                      setPendingAction(null)
                      if (action) action()
                    }
                  }}
                  disabled={saving}
                  className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
                >
                  <Save size={15} />
                  {saving ? 'Guardando...' : 'Guardar y continuar'}
                </button>

                {/* Descartar */}
                <button
                  onClick={() => {
                    const action = pendingAction
                    setPendingAction(null)
                    setSnapshot({ form: { ...form }, items: items.map((it) => ({ ...it })) })
                    if (action) action()
                  }}
                  className="w-full py-2.5 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 active:bg-red-100 transition-colors"
                >
                  Descartar cambios y continuar
                </button>

                {/* Cancelar */}
                <button
                  onClick={() => {
                    setPendingAction(null)
                  }}
                  className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ItemSuggestInput({ value, onChange, placeholder, suggestions }) {
  const [show, setShow] = useState(false)
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q || !show || !suggestions?.length) return []
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 6)
  }, [value, show, suggestions])

  return (
    <div className="relative">
      <input
        className="input w-full text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        style={{fontSize:'16px'}}
      />
      {show && filtered.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {filtered.map((s, idx) => (
            <button
              key={idx}
              onMouseDown={() => { onChange(s); setShow(false) }}
              className="w-full text-left px-3 py-2.5 text-sm text-gray-800 hover:bg-blue-50 active:bg-blue-100 border-b border-gray-100 last:border-0 transition-colors min-h-[40px]"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function InfoBox({ label, value, highlight }) {
  return (
    <div style={{ padding: '5px 8px', background: highlight ? '#eff6ff' : '#f8f9fb', border: `1px solid ${highlight ? '#93c5fd' : '#e5e7eb'}`, borderRadius: '5px' }}>
      <div style={{ fontSize: '6.5pt', color: '#6b7280', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '1px' }}>{label}</div>
      <div style={{ fontSize: '8.5pt', fontWeight: highlight ? 'bold' : '600', color: highlight ? '#1d4ed8' : '#111' }}>{value}</div>
    </div>
  )
}

function SignatureLine({ label, sub, sigUrl }) {
  return (
    <div style={{ textAlign: 'center' }}>
      {sigUrl ? (
        <div style={{ height: '64px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', marginBottom: '4px' }}>
          <img src={sigUrl} alt="Firma" style={{ maxHeight: '60px', maxWidth: '200px', objectFit: 'contain' }} />
        </div>
      ) : (
        <div style={{ borderBottom: '1.5px solid #333', marginBottom: '6px', height: '40px' }} />
      )}
      <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#333' }}>{label}</div>
      {sub && <div style={{ fontSize: '8.5pt', color: '#666' }}>{sub}</div>}
    </div>
  )
}

const thStyle = {
  padding: '7px 8px',
  textAlign: 'left',
  fontWeight: '600',
  fontSize: '8.5pt',
  border: '1px solid #2d4d7a',
}

const tdStyle = {
  padding: '6px 8px',
  border: '1px solid #d1d5db',
  verticalAlign: 'top',
}
