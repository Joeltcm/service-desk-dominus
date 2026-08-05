import { showConfirm } from '../utils/confirm'
import { companyLogoSrc } from '../utils/branding'
import React, { useEffect, useState, useRef } from 'react'
import { openPdfViewerFromHtml, sharePdfFromFullHtml, writePdfViewerToWindow } from '../utils/pdfViewer'
import qrcode from 'qrcode-generator'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getTicket, getTimeline, addTimelineEntry, deleteTimelineEntry,
  getAttachments, uploadAttachment, deleteAttachment,
  downloadWithAuth, updateTicket, getStatuses, getAgents, getCategories,
  createCalendarEvent, getCalendarAuthUrl, deleteCalendarEvent, checkCalendarConflicts,
  createTicketVisit, deleteTicketVisit, rescheduleTicketVisit, cancelTicketVisit, pushVisitToGoogle, updateVisitCosto,
  deleteTicket, linkTicket, unlinkTicket, getTickets,
  getQuotes, getInvoices, updateQuote, updateInvoice,
  getCannedResponses, getTimeLogs, addTimeLog, deleteTimeLog, submitCsat,
} from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useCompany, getCompanyCache } from '../context/CompanyContext'
import StatusBadge from '../components/StatusBadge'
import PriorityBadge from '../components/PriorityBadge'
import PartRequestPanel from '../components/PartRequestPanel'
import {
  ArrowLeft, Edit, Paperclip, Send, Lock, Unlock,
  Calendar, ExternalLink, Trash2, Download, X, Printer, AlertTriangle,
  Link2, Unlink, Search, GitBranch, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, MessageCircle, Mail, Eye, EyeOff,
  FileText, Plus, RefreshCw, XCircle, Share2, CheckCircle, Zap, Clock, Star,
  FilePlus, Receipt,
} from 'lucide-react'
import { getSLAInfo, fmtSlaRemaining } from '../utils/sla'
import { fmtDT, fmtD, fmtTime, toUTC, getFmtTz } from '../utils/fmt'
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz'
import { compressImage } from '../utils/imageCompress'
import toast from 'react-hot-toast'

const PRIORITY_LABELS = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' }

async function fetchAsBase64(url) {
  const token = localStorage.getItem('token')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  const blob = await res.blob()
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.readAsDataURL(blob)
  })
}

function buildReportHTML(ticket, timeline, attachments, imageMap = {}, companyName = 'Service Desk') {
  const logoUrl = companyLogoSrc(window.location.origin)
  const _co = getCompanyCache()
  const coName    = companyName || _co.company_name || 'Service Desk'
  const coAddress = _co.company_address || 'Panamá, Punta Pacífica, PH Pacific Wind'
  const coRuc     = _co.company_ruc     || '4-754-575 DV 85'
  const now = fmtDT(new Date())
  const created = fmtDT(ticket.created_at)
  const closed = ticket.closed_at ? fmtDT(ticket.closed_at) : null
  const scheduled = ticket.scheduled_at ? fmtDT(ticket.scheduled_at) : null

  const PRIORITY_COLORS = { low: '#10b981', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' }
  const PRIORITY_BG    = { low: '#d1fae5', medium: '#fef3c7', high: '#ffedd5', critical: '#fee2e2' }
  const PRIORITY_LABELS_MAP = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' }
  const statusColor   = ticket.status_rel?.color || '#6b7280'
  const priorityColor = PRIORITY_COLORS[ticket.priority] || '#6b7280'
  const priorityBg    = PRIORITY_BG[ticket.priority]    || '#f3f4f6'

  const initials = (name = '') => name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?'

  const comments      = timeline.filter(e => e.entry_type === 'comment')
  const publicComments = comments.filter(e => !e.is_internal)
  const internalNotes  = comments.filter(e => e.is_internal)
  const visits = ticket.visits || []

  // ── helpers ─────────────────────────────────────────────────────────────

  const avatarCircle = (name, bg, fg) =>
    `<div style="width:38px;height:38px;border-radius:50%;background:${bg};color:${fg};font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;letter-spacing:-.5px">${initials(name)}</div>`

  const renderCommentBlock = (e, accent = '#3b82f6', avatarBg = '#dbeafe', avatarFg = '#1d4ed8') => {
    const dt = fmtDT(e.created_at)
    const contentHtml = (e.content || '')
      .replace(/\[img:(\d+)\]/g, (_, id) => {
        const src = imageMap[id]
        return src
          ? `<img src="${src}" style="max-width:100%;max-height:400px;border-radius:8px;margin:10px 0;display:block;box-shadow:0 1px 4px rgba(0,0,0,.12);page-break-inside:avoid" />`
          : '<em style="color:#9ca3af;font-size:11px">[imagen no disponible]</em>'
      })
      .replace(/\n/g, '<br>')
    return `
    <div class="comment-block" style="display:flex;gap:12px;margin-bottom:16px;break-inside:avoid;page-break-inside:avoid">
      ${avatarCircle(e.user?.name, avatarBg, avatarFg)}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;break-after:avoid;page-break-after:avoid">
          <span style="font-size:13px;font-weight:700;color:#0f172a">${e.user?.name || '—'}</span>
          <span style="font-size:11px;color:#94a3b8">${dt}</span>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid ${accent};border-radius:0 10px 10px 10px;padding:11px 15px;font-size:13px;color:#334155;line-height:1.7">${contentHtml}</div>
      </div>
    </div>`
  }

  const commentBlocks  = publicComments.map(e => renderCommentBlock(e, '#1e3a5f', '#e6ecf5', '#1e3a5f')).join('')
  const internalBlocks = internalNotes.map(e => renderCommentBlock(e, '#f59e0b', '#fef3c7', '#92400e')).join('')

  // Timeline-style visits
  const visitRows = visits.map((v, idx) => {
    const dt  = v.scheduled_at ? fmtDT(v.scheduled_at) : '—'
    const dur = v.duration_minutes ? `${v.duration_minutes} min` : ''
    const isLast = idx === visits.length - 1
    return `
    <div style="display:flex;gap:0">
      <!-- timeline spine -->
      <div style="display:flex;flex-direction:column;align-items:center;width:36px;flex-shrink:0">
        <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#34d399,#059669);color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(5,150,105,.35);z-index:1">${idx + 1}</div>
        ${!isLast ? `<div style="width:2px;flex:1;background:linear-gradient(to bottom,#6ee7b7,#d1fae5);min-height:20px;margin-top:2px"></div>` : ''}
      </div>
      <!-- card -->
      <div style="flex:1;margin-left:14px;margin-bottom:${isLast ? '0' : '16px'};background:#f0fdf4;border:1px solid #a7f3d0;border-radius:12px;padding:12px 16px;break-inside:avoid;page-break-inside:avoid">
        <div style="font-size:13px;font-weight:700;color:#065f46;margin-bottom:4px">${dt}${dur ? `<span style="font-weight:400;color:#6b7280;margin-left:10px">&#8203;${dur}</span>` : ''}</div>
        ${v.subject  ? `<div style="font-size:13px;color:#1e293b;font-weight:600;margin-bottom:3px">${v.subject}</div>` : ''}
        ${v.location ? `<div style="font-size:12px;color:#64748b;margin-bottom:3px">&#x1F4CD; ${v.location}</div>` : ''}
        ${v.notes    ? `<div style="font-size:12px;color:#64748b;margin-top:4px;white-space:pre-line;line-height:1.5">${v.notes}</div>` : ''}
      </div>
    </div>`
  }).join('')

  const embeddedIds = new Set(
    [...publicComments, ...internalNotes]
      .flatMap(e => [...(e.content || '').matchAll(/\[img:(\d+)\]/g)].map(m => parseInt(m[1])))
  )
  const standaloneAtts = attachments.filter(a => !embeddedIds.has(a.id))

  const attRows = standaloneAtts.map((a, i) =>
    `<tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
      <td style="padding:9px 12px;font-size:12px;color:#334155;border-bottom:1px solid #f1f5f9">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3b82f6;margin-right:8px;vertical-align:middle"></span>${a.original_name}
      </td>
      <td style="padding:9px 12px;font-size:12px;color:#64748b;text-align:right;border-bottom:1px solid #f1f5f9">${a.file_size ? (a.file_size / 1024).toFixed(1) + ' KB' : '—'}</td>
      <td style="padding:9px 12px;font-size:12px;color:#64748b;text-align:right;border-bottom:1px solid #f1f5f9">${a.uploaded_by?.name || ''}</td>
    </tr>`
  ).join('')

  const field = (label, value) => value ? `
    <div style="display:flex;align-items:baseline;gap:5px;margin-bottom:4px">
      <span style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-weight:700;white-space:nowrap;flex-shrink:0">${label}:</span>
      <span style="font-size:11px;color:#1e293b;font-weight:500;word-break:break-word">${value}</span>
    </div>` : ''

  const sectionHead = (title, color = '#1e3a5f', afterColor = '#e5e7eb') => `
    <div class="section-head" style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <div style="width:4px;height:18px;border-radius:2px;background:${color};flex-shrink:0"></div>
      <span style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:${color}">${title}</span>
      <div style="flex:1;height:1px;background:${afterColor}"></div>
    </div>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Informe Técnico — Ticket #${ticket.id}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, 'Segoe UI', system-ui, -apple-system, sans-serif; color: #111; background: #fff; font-size: 13px; line-height: 1.5; }
    .page { max-width: 800px; margin: 0 auto; background: #fff; }
    .section { margin-bottom: 28px; }
    .section-head { break-after: avoid; page-break-after: avoid; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 22px; break-inside: avoid; page-break-inside: avoid; }
    .comment-block { break-inside: avoid; page-break-inside: avoid; orphans: 4; widows: 4; }
    .info-grid { break-inside: avoid; page-break-inside: avoid; }
    .desc-block { break-inside: avoid; page-break-inside: avoid; }
    p, div { orphans: 2; widows: 2; }
    @page { size: A4; margin: 14mm 12mm; }
    @media print {
      .page { box-shadow: none; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- ═══ HEADER (estilo casa) ═══ -->
  <div style="padding:24px 36px 0">
    <div style="display:flex;align-items:center;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:14px;gap:14px">
      <img src="${logoUrl}" alt="Logo" style="width:52px;height:52px;object-fit:contain;border-radius:6px">
      <div style="flex:1">
        <div style="font-size:18pt;font-weight:bold;color:#1e3a5f">${coName}</div>
        <div style="font-size:9pt;color:#555;margin-top:2px">${coAddress}</div>
        <div style="font-size:9pt;color:#555">RUC: ${coRuc}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:16pt;font-weight:bold;color:#1e3a5f">INFORME TÉCNICO</div>
        <div style="font-size:10pt;color:#444;margin-top:4px;font-family:monospace">Ticket N° #${ticket.id}</div>
      </div>
    </div>

    <!-- título + estado -->
    <div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:6px;padding:11px 14px;margin-bottom:6px">
      <div style="font-size:12pt;font-weight:700;color:#111;line-height:1.35;margin-bottom:8px">${ticket.title}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:20px;background:${statusColor};color:#fff;font-size:9pt;font-weight:700">&#9679; ${ticket.status_rel?.name || '—'}</span>
        <span style="display:inline-flex;align-items:center;padding:2px 9px;border-radius:20px;background:${priorityBg};color:${priorityColor};font-size:9pt;font-weight:700;border:1px solid ${priorityColor}40">${PRIORITY_LABELS_MAP[ticket.priority] || ticket.priority}</span>
        ${ticket.category ? `<span style="display:inline-flex;align-items:center;padding:2px 9px;border-radius:20px;background:#eef1f6;color:#1e3a5f;font-size:9pt;font-weight:600">${ticket.category}</span>` : ''}
      </div>
    </div>
  </div>

  <!-- ═══ META BAR ═══ -->
  <div style="padding:0 36px 6px;display:flex;gap:24px;flex-wrap:wrap">
    <div style="font-size:9pt;color:#64748b"><span style="font-weight:700;color:#475569">Creado:</span> ${created}</div>
    ${closed ? `<div style="font-size:9pt;color:#64748b"><span style="font-weight:700;color:#475569">Cerrado:</span> ${closed}</div>` : ''}
    ${ticket.assigned_agent?.name ? `<div style="font-size:9pt;color:#64748b"><span style="font-weight:700;color:#475569">Agente:</span> ${ticket.assigned_agent.name}</div>` : ''}
    <div style="margin-left:auto;font-size:9pt;color:#94a3b8">Generado: ${now}</div>
  </div>

  <!-- ═══ BODY ═══ -->
  <div style="padding:16px 36px 28px">

    <!-- INFO GENERAL -->
    <div class="section">
      ${sectionHead('Información general')}
      <div class="info-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <!-- cliente -->
        <div class="card" style="background:#f8f9fb;border:1px solid #e5e7eb;border-top:3px solid #1e3a5f;padding:10px 13px">
          <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#1e3a5f;margin-bottom:7px">Cliente</div>
          ${field('Nombre', ticket.client?.name)}
          ${field('Empresa', ticket.client?.company)}
          ${field('Correo electrónico', ticket.client?.email)}
          ${field('Teléfono', ticket.client?.phone)}
        </div>
        <!-- ticket -->
        <div class="card" style="background:#f8f9fb;border:1px solid #e5e7eb;border-top:3px solid #1e3a5f;padding:10px 13px">
          <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#1e3a5f;margin-bottom:7px">Detalles del ticket</div>
          ${field('Agente asignado', ticket.assigned_agent?.name || 'Sin asignar')}
          ${field('Ubicación', ticket.location)}
          ${field('Asunto', ticket.subject)}
          ${scheduled ? field('Próxima visita', scheduled) : ''}
        </div>
      </div>
    </div>

    <!-- DESCRIPCIÓN -->
    <div class="section">
      ${sectionHead('Descripción del problema')}
      <div class="desc-block" style="background:#f8f9fb;border:1px solid #e5e7eb;border-left:4px solid #1e3a5f;border-radius:0 10px 10px 0;padding:15px 18px;font-size:13px;color:#334155;line-height:1.75;white-space:pre-wrap">${ticket.description || '<em style="color:#94a3b8">Sin descripción</em>'}</div>
    </div>

    ${ticket.resolution_notes ? `
    <!-- RESOLUCIÓN -->
    <div class="section">
      ${sectionHead('Resolución', '#059669', '#d1fae5')}
      <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-left:4px solid #059669;border-radius:0 10px 10px 0;padding:15px 18px;font-size:13px;color:#166534;line-height:1.75;white-space:pre-wrap">${ticket.resolution_notes}</div>
    </div>` : ''}

    ${visits.length > 0 ? `
    <!-- VISITAS -->
    <div class="section">
      ${sectionHead(`Visitas agendadas (${visits.length})`, '#059669', '#d1fae5')}
      <div style="padding-left:4px">${visitRows}</div>
    </div>` : ''}

    ${publicComments.length > 0 ? `
    <!-- COMENTARIOS PÚBLICOS -->
    <div class="section">
      ${sectionHead(`Comentarios y respuestas (${publicComments.length})`)}
      ${commentBlocks}
    </div>` : ''}

    ${internalNotes.length > 0 ? `
    <!-- NOTAS INTERNAS -->
    <div class="section">
      ${sectionHead(`Notas internas (${internalNotes.length})`, '#d97706', '#fef3c7')}
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;margin-bottom:14px">
        <span style="font-size:11px;font-weight:700;color:#92400e">&#9888; Uso interno — no compartir con el cliente</span>
      </div>
      ${internalBlocks}
    </div>` : ''}

    ${standaloneAtts.length > 0 ? `
    <!-- ADJUNTOS -->
    <div class="section">
      ${sectionHead(`Archivos adjuntos (${standaloneAtts.length})`)}
      <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f8fafc">
              <th style="text-align:left;font-size:11px;color:#64748b;font-weight:700;padding:10px 12px;border-bottom:1px solid #e2e8f0;letter-spacing:.04em;text-transform:uppercase">Archivo</th>
              <th style="text-align:right;font-size:11px;color:#64748b;font-weight:700;padding:10px 12px;border-bottom:1px solid #e2e8f0;letter-spacing:.04em;text-transform:uppercase">Tamaño</th>
              <th style="text-align:right;font-size:11px;color:#64748b;font-weight:700;padding:10px 12px;border-bottom:1px solid #e2e8f0;letter-spacing:.04em;text-transform:uppercase">Subido por</th>
            </tr>
          </thead>
          <tbody>${attRows}</tbody>
        </table>
      </div>
    </div>` : ''}

  </div><!-- /body -->

  <!-- ═══ FOOTER (estilo casa) ═══ -->
  <div style="margin:0 36px;padding:10px 0 20px;border-top:1px solid #ddd;font-size:7.5pt;color:#888;text-align:center">
    ${coName} · ${coAddress} · RUC: ${coRuc} · Informe Técnico · Ticket N° #${ticket.id}
  </div>

</div><!-- /page -->
</body>
</html>`
}

// ── Comprobante térmico 80mm ───────────────────────────────────────────────
// Layout tipo recibo (ancho útil ~72mm, B/N) para impresoras térmicas de 80mm.
function buildThermalTicketHTML(ticket) {
  const co = getCompanyCache()
  const coName    = co.company_name || 'Service Desk'
  const coAddress = co.company_address || ''
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const PRIORITY_LABELS_MAP = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' }
  const created = fmtDT(ticket.created_at)
  const desc = (ticket.description || '').trim()
  const descShort = desc.length > 220 ? desc.slice(0, 220) + '…' : desc

  // QR → URL del ticket en el sistema
  const rawBase = (import.meta.env.BASE_URL || '/')
  const base = rawBase.endsWith('/') ? rawBase : rawBase + '/'
  const url = `${window.location.origin}${base}tickets/${ticket.id}`
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make()
  const qrImg = qr.createDataURL(4, 1)

  const line = '<div style="border-top:1px dashed #000;margin:6px 0"></div>'
  return `<div class="receipt" style="font-family:'Segoe UI',system-ui,sans-serif;color:#000;font-size:12px;line-height:1.4">
    <div style="text-align:center">
      <div style="font-size:15px;font-weight:800;letter-spacing:.3px">${esc(coName)}</div>
      ${coAddress ? `<div style="font-size:10px">${esc(coAddress)}</div>` : ''}
    </div>
    ${line}
    <div style="display:flex;justify-content:space-between;font-weight:700;font-size:13px">
      <span>TICKET #${ticket.id}</span><span>${esc(created)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:2px">
      <span>Estado: <b>${esc(ticket.status_rel?.name || '—')}</b></span>
      <span>Prioridad: <b>${esc(PRIORITY_LABELS_MAP[ticket.priority] || ticket.priority || '—')}</b></span>
    </div>
    ${line}
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Cliente</div>
    <div style="font-weight:600">${esc(ticket.client?.name || '—')}</div>
    ${ticket.client?.company ? `<div style="font-size:11px">${esc(ticket.client.company)}</div>` : ''}
    ${ticket.client?.phone ? `<div style="font-size:11px">Tel: ${esc(ticket.client.phone)}</div>` : ''}
    ${line}
    ${ticket.category ? `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px">${esc(ticket.category)}</div>` : ''}
    <div style="font-weight:700;font-size:13px;margin:2px 0">${esc(ticket.title)}</div>
    ${descShort ? `<div style="font-size:11px;white-space:pre-wrap">${esc(descShort)}</div>` : ''}
    <div style="font-size:11px;margin-top:4px">Técnico: <b>${esc(ticket.assigned_agent?.name || 'Sin asignar')}</b></div>
    ${line}
    <div style="text-align:center">
      <img src="${qrImg}" style="width:130px;height:130px;image-rendering:pixelated" alt="QR"/>
      <div style="font-size:10px;margin-top:2px">Escanea para ver el ticket</div>
    </div>
    ${line}
    <div style="text-align:center;font-size:10px">${esc(coName)} · Gracias por su preferencia</div>
  </div>`
}

// Abre una ventana e imprime en formato térmico 80mm.
function printThermalTicket(bodyHtml) {
  const pw = window.open('', '_blank', 'width=360,height=640')
  if (!pw) return false
  pw.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket 80mm</title>
<style>@page{size:80mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}body{width:80mm}.receipt{width:72mm;margin:0 auto;padding:3mm 2mm}</style>
</head><body>${bodyHtml}<script>setTimeout(function(){window.print();window.addEventListener('afterprint',function(){window.close()},{once:true})},350)<\/script></body></html>`)
  pw.document.close()
  return true
}

function InlineImage({ ticketId, attId }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let objectUrl
    const token = localStorage.getItem('token')
    fetch(`/api/tickets/${ticketId}/attachments/${attId}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setSrc(objectUrl) })
      .catch(() => {})
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [ticketId, attId])

  if (!src) return <span className="text-xs text-gray-400 italic">cargando imagen…</span>
  return (
    <img
      src={src}
      alt="captura"
      className="max-w-full rounded-lg my-1 block cursor-pointer"
      style={{ maxHeight: 320, display: 'block' }}
      onClick={() => window.open(src, '_blank')}
    />
  )
}

function CommentContent({ content, ticketId }) {
  // FD conversations are stored as HTML; strip tags to plain text for display
  let text = content || ''
  if (text.includes('<') && text.includes('>')) {
    try {
      text = new DOMParser().parseFromString(text, 'text/html').body.textContent || ''
    } catch (_) { /* keep as-is */ }
  }
  const parts = text.split(/(\[img:\d+\])/g)
  if (parts.length === 1) return <span className="whitespace-pre-wrap">{text}</span>
  return (
    <span>
      {parts.map((part, i) => {
        const m = part.match(/^\[img:(\d+)\]$/)
        if (m) return <InlineImage key={i} ticketId={ticketId} attId={m[1]} />
        return <span key={i} className="whitespace-pre-wrap">{part}</span>
      })}
    </span>
  )
}

const ENTRY_ICONS = {
  comment: '💬',
  status_change: '🔄',
  assignment: '👤',
  attachment: '📎',
  calendar: '📅',
  system: '⚙️',
  note: '📝',
}

export default function TicketDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, isAgentOrAdmin } = useAuth()
  const { company_name, vertical } = useCompany()
  const itMode = vertical === 'it_support'
  const coName = company_name || 'Service Desk'
  const fileRef = useRef()
  const editorRef = useRef()
  const conflictTimerRef = useRef(null)
  const activeIdRef = useRef(id)

  const [ticket, setTicket] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [attachments, setAttachments] = useState([])
  const [attImgMap, setAttImgMap] = useState({})   // miniaturas (base64) de adjuntos imagen
  const [lightbox, setLightbox] = useState(null)  // visor: { list: [{id,name}], idx }
  const [statuses, setStatuses] = useState([])
  const [agents, setAgents] = useState([])
  const [categories, setCategories] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [cannedResponses, setCannedResponses] = useState([])
  const [showCannedDrop, setShowCannedDrop] = useState(false)
  const [timeLogs, setTimeLogs] = useState([])
  const [showTimeForm, setShowTimeForm] = useState(false)
  const [timeLogForm, setTimeLogForm] = useState({ hours: '', minutes: '', description: '' })
  const [savingTimeLog, setSavingTimeLog] = useState(false)
  const [csatHover, setCsatHover] = useState(0)
  const [csatRating, setCsatRating] = useState(0)
  const [csatComment, setCsatComment] = useState('')
  const [csatSubmitting, setCsatSubmitting] = useState(false)
  const [csatDone, setCsatDone] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [hasContent, setHasContent] = useState(false)
  const [sendingComment, setSendingComment] = useState(false)
  const [pendingUploads, setPendingUploads] = useState(0)
  const [pendingAttIds, setPendingAttIds] = useState([])
  const [isInternal, setIsInternal] = useState(false)
  const [commentCc, setCommentCc] = useState('')
  const [commentBcc, setCommentBcc] = useState('')
  const [commentStatusId, setCommentStatusId] = useState('')
  const [attachDocsToEmail, setAttachDocsToEmail] = useState(true)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showCalendarModal, setShowCalendarModal] = useState(false)
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [rescheduleVisit, setRescheduleVisit] = useState(null)
  const [rescheduleForm, setRescheduleForm] = useState({ date: '', hour: '8', minute: '00', ampm: 'AM', duration_minutes: 60, is_remote: false })
  const [rescheduling, setRescheduling] = useState(false)
  const [cancelling, setCancelling] = useState(null)
  const [visitCostos, setVisitCostos] = useState({})
  const [calendarForm, setCalendarForm] = useState({
    date: '', hour: '8', minute: '00', ampm: 'AM',
    duration_minutes: 60, location: '', subject: '', notes: '', bcc_email: '',
    endMode: 'duration', endHour: '9', endMinute: '00', endAmpm: 'AM',
    is_remote: false,
  })
  const [conflicts, setConflicts] = useState([])
  const [checkingConflicts, setCheckingConflicts] = useState(false)
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState([])
  const [linkLoading, setLinkLoading] = useState(false)

  const [linkedQuotes, setLinkedQuotes] = useState([])
  const [linkedInvoices, setLinkedInvoices] = useState([])
  const [showLinkDocModal, setShowLinkDocModal] = useState(false)
  const [linkDocType, setLinkDocType] = useState('quote')
  const [linkDocSearch, setLinkDocSearch] = useState('')
  const [linkDocResults, setLinkDocResults] = useState([])
  const [linkDocLoading, setLinkDocLoading] = useState(false)
  const [showResolveModal, setShowResolveModal] = useState(false)
  const [resolveNotes, setResolveNotes] = useState('')
  const [resolving, setResolving] = useState(false)

  const fetchAll = () => {
    const reqId = id
    Promise.all([getTicket(id), getTimeline(id), getAttachments(id), getStatuses(), getCategories(), ...(isAgentOrAdmin ? [getAgents()] : [])])
      .then(([tRes, tlRes, attRes, stRes, catRes, agRes]) => {
        if (activeIdRef.current !== reqId) return
        setTicket(tRes.data)
        setTimeline(tlRes.data)
        setAttachments(attRes.data)
        setStatuses(stRes.data)
        setCategories(catRes.data)
        if (agRes) setAgents(agRes.data)
        const defaultLocation = tRes.data.location || tRes.data.client?.address || ''
        if (tRes.data.scheduled_at) {
          const utcDate = toUTC(tRes.data.scheduled_at)
          const tz = getFmtTz()
          const h24 = parseInt(formatInTimeZone(utcDate, tz, 'H'))
          const mm = formatInTimeZone(utcDate, tz, 'mm')
          const dateStr = formatInTimeZone(utcDate, tz, 'yyyy-MM-dd')
          const h12 = h24 % 12 || 12
          const ampm = h24 >= 12 ? 'PM' : 'AM'
          setCalendarForm((f) => ({
            ...f,
            date: dateStr,
            hour: String(h12),
            minute: mm,
            ampm,
            duration_minutes: tRes.data.duration_minutes || 60,
            location: defaultLocation,
            subject: tRes.data.subject || '',
          }))
        } else {
          setCalendarForm((f) => ({ ...f, location: defaultLocation }))
        }
      })
      .catch(() => { if (activeIdRef.current === reqId) toast.error('Error cargando ticket') })
      .finally(() => { if (activeIdRef.current === reqId) setLoading(false) })
  }

  const fetchLinkedDocs = () => {
    const reqId = id
    Promise.all([
      getQuotes({ ticket_id: id }),
      getInvoices({ ticket_id: id }),
    ]).then(([qRes, iRes]) => {
      if (activeIdRef.current !== reqId) return
      setLinkedQuotes(qRes.data)
      setLinkedInvoices(iRes.data)
    }).catch(() => {})
  }

  useEffect(() => {
    activeIdRef.current = id
    fetchAll()
    fetchLinkedDocs()
  }, [id])

  // Miniaturas de adjuntos que son imagen: se piden con auth (el endpoint de
  // descarga exige Bearer token) y se cachean por id para no repetir el fetch.
  useEffect(() => {
    const pending = attachments.filter((a) => a.content_type?.startsWith('image/') && !attImgMap[a.id])
    pending.forEach(async (att) => {
      const b64 = await fetchAsBase64(`/api/tickets/${id}/attachments/${att.id}/download`)
      if (b64) setAttImgMap((prev) => ({ ...prev, [att.id]: b64 }))
    })
  }, [attachments])

  // Visor: navegación con teclado (← →) y cierre con Escape.
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null)
      else if (e.key === 'ArrowLeft') setLightbox((l) => l && { ...l, idx: (l.idx - 1 + l.list.length) % l.list.length })
      else if (e.key === 'ArrowRight') setLightbox((l) => l && { ...l, idx: (l.idx + 1) % l.list.length })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [!!lightbox])

  useEffect(() => {
    if (isAgentOrAdmin) getCannedResponses().then((r) => setCannedResponses(r.data)).catch(() => {})
  }, [isAgentOrAdmin])

  const fetchTimeLogs = () => {
    if (isAgentOrAdmin) getTimeLogs(id).then((r) => setTimeLogs(r.data)).catch(() => {})
  }
  useEffect(fetchTimeLogs, [id, isAgentOrAdmin])

  useEffect(() => {
    if (ticket?.cc_email) setCommentCc(ticket.cc_email)
  }, [ticket?.id])

  const handleStatusChange = async (statusId) => {
    try {
      await updateTicket(id, { status_id: parseInt(statusId) })
      fetchAll()
      toast.success('Estado actualizado')
    } catch {
      toast.error('Error actualizando estado')
    }
  }

  const handleResolve = async () => {
    const resueltoStatus = statuses.find((s) => s.name === 'Resuelto')
    if (!resueltoStatus) return
    setResolving(true)
    try {
      await updateTicket(id, {
        status_id: resueltoStatus.id,
        ...(resolveNotes.trim() ? { resolution_notes: resolveNotes.trim() } : {}),
      })
      setShowResolveModal(false)
      setResolveNotes('')
      fetchAll()
      toast.success('Ticket marcado como Resuelto')
    } catch {
      toast.error('Error actualizando estado')
    } finally {
      setResolving(false)
    }
  }

  const handlePriorityChange = async (priority) => {
    try {
      await updateTicket(id, { priority })
      fetchAll()
      toast.success('Prioridad actualizada')
    } catch {
      toast.error('Error actualizando prioridad')
    }
  }

  const handleAgentChange = async (agentId) => {
    try {
      await updateTicket(id, { assigned_to_id: agentId ? parseInt(agentId) : null })
      fetchAll()
      toast.success(agentId ? 'Técnico asignado' : 'Asignación removida')
    } catch {
      toast.error('Error actualizando técnico')
    }
  }

  const handleCategoryChange = async (category) => {
    try {
      await updateTicket(id, { category: category || null })
      fetchAll()
      toast.success('Categoría actualizada')
    } catch {
      toast.error('Error actualizando categoría')
    }
  }

  const handleTagsUpdate = async (newTags) => {
    const tagStr = newTags.filter(Boolean).join(',')
    try {
      await updateTicket(id, { tags: tagStr || null })
      fetchAll()
    } catch {
      toast.error('Error actualizando etiquetas')
    }
  }

  const handleAddTimeLog = async (e) => {
    e.preventDefault()
    const h = parseInt(timeLogForm.hours || '0')
    const m = parseInt(timeLogForm.minutes || '0')
    const total = h * 60 + m
    if (total <= 0) { toast.error('Ingresa al menos 1 minuto'); return }
    setSavingTimeLog(true)
    try {
      await addTimeLog(id, { minutes: total, description: timeLogForm.description || null })
      setTimeLogForm({ hours: '', minutes: '', description: '' })
      setShowTimeForm(false)
      fetchTimeLogs()
      toast.success('Tiempo registrado')
    } catch {
      toast.error('Error registrando tiempo')
    } finally {
      setSavingTimeLog(false)
    }
  }

  const handleDeleteTimeLog = async (logId) => {
    try {
      await deleteTimeLog(id, logId)
      fetchTimeLogs()
    } catch {
      toast.error('Error eliminando registro')
    }
  }

  const handleCsatSubmit = async () => {
    if (!csatRating) { toast.error('Selecciona una calificación'); return }
    setCsatSubmitting(true)
    try {
      await submitCsat(id, { rating: csatRating, comment: csatComment || null })
      setCsatDone(true)
      fetchAll()
      toast.success('¡Gracias por tu calificación!')
    } catch {
      toast.error('Error enviando calificación')
    } finally {
      setCsatSubmitting(false)
    }
  }

  const getEffectiveDuration = (form = calendarForm) => {
    if (form.endMode === 'duration') return form.duration_minutes
    const startISO = getScheduledAtISO(form)
    if (!startISO || !form.date) return form.duration_minutes
    let eh = parseInt(form.endHour)
    if (form.endAmpm === 'PM' && eh !== 12) eh += 12
    if (form.endAmpm === 'AM' && eh === 12) eh = 0
    const endISO = fromZonedTime(`${form.date}T${String(eh).padStart(2, '0')}:${form.endMinute}:00`, getFmtTz()).toISOString()
    const diff = Math.round((new Date(endISO) - new Date(startISO)) / 60000)
    return diff > 0 ? diff : form.duration_minutes
  }

  const getScheduledAtISO = (form = calendarForm) => {
    if (!form.date) return ''
    let h = parseInt(form.hour)
    if (form.ampm === 'PM' && h !== 12) h += 12
    if (form.ampm === 'AM' && h === 12) h = 0
    return fromZonedTime(`${form.date}T${String(h).padStart(2, '0')}:${form.minute}:00`, getFmtTz()).toISOString()
  }

  const runConflictCheck = async (form) => {
    const iso = getScheduledAtISO(form)
    if (!iso) { setConflicts([]); return }
    setCheckingConflicts(true)
    try {
      const res = await checkCalendarConflicts(iso, getEffectiveDuration(form), id)
      setConflicts(res.data.conflicts || [])
    } catch { setConflicts([]) }
    finally { setCheckingConflicts(false) }
  }

  const updateCalendarForm = (patch) => {
    const next = { ...calendarForm, ...patch }
    setCalendarForm(next)
    clearTimeout(conflictTimerRef.current)
    conflictTimerRef.current = setTimeout(() => runConflictCheck(next), 500)
  }

  const insertNodeAtCursor = (node) => {
    const sel = window.getSelection()
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      range.insertNode(node)
      range.setStartAfter(node)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    } else {
      editorRef.current?.appendChild(node)
    }
  }

  const getEditorContent = () => {
    const el = editorRef.current
    if (!el) return ''
    const serializeNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent
      if (node.nodeName === 'IMG') {
        const attId = node.dataset?.attId
        return attId ? `[img:${attId}]` : ''
      }
      if (node.nodeName === 'BR') return '\n'
      const inner = Array.from(node.childNodes).map(serializeNode).join('')
      if (node.nodeName === 'DIV' || node.nodeName === 'P') return inner + '\n'
      return inner
    }
    return serializeNode(el).trim()
  }

  const handlePasteInEditor = async (e) => {
    e.preventDefault()
    const items = Array.from(e.clipboardData?.items || [])
    const imageItems = items.filter((item) => item.type.startsWith('image/'))

    if (imageItems.length > 0) {
      for (const item of imageItems) {
        const file = item.getAsFile()
        if (!file) continue
        const previewUrl = URL.createObjectURL(file)
        const img = document.createElement('img')
        img.src = previewUrl
        img.style.cssText = 'max-width:100%;max-height:380px;border-radius:6px;border:1px solid #e5e7eb;margin:6px 0;display:block;cursor:pointer'
        img.contentEditable = 'false'
        insertNodeAtCursor(img)
        setHasContent(true)
        const ext = file.type.split('/')[1] || 'png'
        const named = new File([file], `captura-${Date.now()}.${ext}`, { type: file.type })
        setPendingUploads((n) => n + 1)
        try {
          const res = await uploadAttachment(id, await compressImage(named))
          img.dataset.attId = String(res.data.id)
          URL.revokeObjectURL(previewUrl)
          fetchAll()
        } catch {
          img.remove()
          URL.revokeObjectURL(previewUrl)
          toast.error('Error al subir imagen')
        } finally {
          setPendingUploads((n) => n - 1)
        }
      }
      return
    }

    // Plain text paste — strip HTML
    const text = e.clipboardData.getData('text/plain')
    if (text) {
      const sel = window.getSelection()
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        range.insertNode(document.createTextNode(text))
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      }
      setHasContent(true)
    }
  }

  const handleComment = async (e) => {
    e.preventDefault()
    if (sendingComment) return
    const content = getEditorContent()
    if (!content && pendingAttIds.length === 0) return
    const attIds = [...pendingAttIds]
    setSendingComment(true)
    try {
      await addTimelineEntry(id, {
        content,
        entry_type: 'comment',
        is_internal: isInternal,
        attachment_ids: attIds,
        ...(commentCc.trim() ? { cc_email: commentCc.trim() } : {}),
        ...(commentBcc.trim() ? { bcc_email: commentBcc.trim() } : {}),
        ...(commentStatusId ? { new_status_id: parseInt(commentStatusId) } : {}),
      })
      if (editorRef.current) editorRef.current.innerHTML = ''
      setHasContent(false)
      setCommentCc(ticket?.cc_email || '')
      setCommentBcc('')
      setCommentStatusId('')
      setPendingAttIds([])
      fetchAll()
    } catch {
      toast.error('Error enviando comentario')
    } finally {
      setSendingComment(false)
    }
  }

  const handleSendViaEmail = async (e) => {
    e.preventDefault()
    if (sendingComment) return
    const content = getEditorContent()
    if (!content) return
    setSendingComment(true)
    try {
      await addTimelineEntry(id, {
        content,
        entry_type: 'comment',
        is_internal: false,
        attach_invoice_pdfs: attachDocsToEmail,
        ...(commentCc.trim() ? { cc_email: commentCc.trim() } : {}),
        ...(commentBcc.trim() ? { bcc_email: commentBcc.trim() } : {}),
        ...(commentStatusId ? { new_status_id: parseInt(commentStatusId) } : {}),
      })
      if (editorRef.current) editorRef.current.innerHTML = ''
      setHasContent(false)
      setCommentCc(ticket?.cc_email || '')
      setCommentBcc('')
      setCommentStatusId('')
      setAttachDocsToEmail(true)
      fetchAll()
      toast.success('Comentario enviado y correo notificado al cliente')
    } catch {
      toast.error('Error enviando comentario')
    } finally {
      setSendingComment(false)
    }
  }

  const handleSendViaWhatsApp = async (e) => {
    e.preventDefault()
    if (sendingComment) return
    const content = getEditorContent()
    if (!content) return
    const phone = ticket.client?.phone?.replace(/\D/g, '')
    if (!phone) { toast.error('El cliente no tiene teléfono registrado'); return }
    setSendingComment(true)
    try {
      await addTimelineEntry(id, { content, entry_type: 'comment', is_internal: false })
      if (editorRef.current) editorRef.current.innerHTML = ''
      setHasContent(false)
      fetchAll()
      const plainText = content.replace(/\[img:\d+\]/g, '[imagen adjunta]')
      const clientName = ticket.client?.name || 'Cliente'
      const ticketUrl = `${window.location.origin}/tickets/${ticket.id}`
      const waText = [
        `👋 Hola ${clientName}, le contactamos de *${coName}*.`,
        ``,
        `Le informamos sobre una actualización en su ticket de servicio:`,
        ``,
        `*🎫 Ticket #${ticket.id} — ${ticket.title}*`,
        ``,
        plainText,
        ``,
        `📋 Puede consultar el estado y detalles completos de su ticket aquí:`,
        ticketUrl,
        ``,
        `Quedamos a su disposición para cualquier consulta.`,
        `*${coName}*`,
      ].join('\n')
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(waText)}`, '_blank')
    } catch {
      toast.error('Error enviando comentario')
    } finally {
      setSendingComment(false)
    }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadAttachment(id, await compressImage(file))
      setPendingAttIds(prev => [...prev, res.data.id])
      fetchAll()
      toast.success('Archivo adjuntado')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error subiendo archivo')
    } finally {
      setUploading(false)
      fileRef.current.value = ''
    }
  }

  const handleDeleteAttachment = async (attId) => {
    if (!await showConfirm('¿Eliminar este archivo?')) return
    try {
      await deleteAttachment(id, attId)
      fetchAll()
      toast.success('Archivo eliminado')
    } catch {
      toast.error('Error eliminando archivo')
    }
  }

  const handleCalendarEvent = async () => {
    if (creatingEvent) return
    setCreatingEvent(true)
    try {
      const res = await createTicketVisit({
        ticket_id: parseInt(id),
        scheduled_at: getScheduledAtISO(),
        duration_minutes: getEffectiveDuration(),
        location: calendarForm.location,
        subject: calendarForm.subject,
        notes: calendarForm.notes,
        bcc_email: calendarForm.bcc_email || null,
        is_remote: calendarForm.is_remote,
      })
      const calLinked = res.data?.calendar_linked
      toast.success(calLinked ? 'Visita agendada y sincronizada con Google Calendar' : 'Visita agendada')
      setShowCalendarModal(false)
      fetchAll()
    } catch (err) {
      const detail = err.response?.data?.detail || ''
      if (detail.includes('límite de 10 visitas')) {
        toast.error('Se alcanzó el límite de 10 visitas por ticket')
      } else {
        toast.error(detail || 'Error agendando visita')
      }
    } finally {
      setCreatingEvent(false)
    }
  }

  const handleDeleteVisit = async (visitId) => {
    if (!await showConfirm('¿Eliminar esta visita de Google Calendar?')) return
    try {
      await deleteTicketVisit(visitId)
      fetchAll()
      toast.success('Visita eliminada')
    } catch {
      toast.error('Error eliminando visita')
    }
  }

  const handlePushToGoogle = async (visitId) => {
    try {
      const res = await pushVisitToGoogle(visitId)
      toast.success('Evento creado en Google Calendar')
      if (res.data?.event_link) window.open(res.data.event_link, '_blank')
      fetchAll()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al sincronizar con Google Calendar')
    }
  }

  const openReschedule = (v) => {
    const utcDate = toUTC(v.scheduled_at)
    const tz = getFmtTz()
    const h24 = parseInt(formatInTimeZone(utcDate, tz, 'H'))
    const h12 = h24 % 12 || 12
    setRescheduleForm({
      date: formatInTimeZone(utcDate, tz, 'yyyy-MM-dd'),
      hour: String(h12),
      minute: formatInTimeZone(utcDate, tz, 'mm'),
      ampm: h24 >= 12 ? 'PM' : 'AM',
      duration_minutes: v.duration_minutes || 60,
      is_remote: v.is_remote || false,
    })
    setRescheduleVisit(v)
  }

  const handleReschedule = async () => {
    if (!rescheduleVisit || !rescheduleForm.date) return
    setRescheduling(true)
    try {
      let h = parseInt(rescheduleForm.hour)
      if (rescheduleForm.ampm === 'PM' && h !== 12) h += 12
      if (rescheduleForm.ampm === 'AM' && h === 12) h = 0
      const iso = fromZonedTime(`${rescheduleForm.date}T${String(h).padStart(2, '0')}:${rescheduleForm.minute}:00`, getFmtTz()).toISOString()
      await rescheduleTicketVisit(rescheduleVisit.id, { scheduled_at: iso, duration_minutes: rescheduleForm.duration_minutes, is_remote: rescheduleForm.is_remote })
      setRescheduleVisit(null)
      fetchAll()
      toast.success('Visita reagendada')
    } catch {
      toast.error('Error al reagendar visita')
    } finally {
      setRescheduling(false)
    }
  }

  const handleCostoBlur = async (visitId, rawValue) => {
    const costo = rawValue === '' ? null : parseFloat(rawValue)
    if (costo !== null && isNaN(costo)) return
    try {
      const res = await updateVisitCosto(visitId, costo)
      setTicket(prev => ({
        ...prev,
        visits: prev.visits.map(v => v.id === visitId ? { ...v, costo: res.data.costo } : v)
      }))
    } catch {
      toast.error('Error al guardar el costo')
    }
  }

  const handleCancelVisit = async (visitId) => {
    if (!await showConfirm('¿Cancelar esta visita? El evento quedará marcado en rojo en Google Calendar.')) return
    setCancelling(visitId)
    try {
      await cancelTicketVisit(visitId)
      fetchAll()
      toast.success('Visita cancelada')
    } catch {
      toast.error('Error al cancelar visita')
    } finally {
      setCancelling(null)
    }
  }

  const searchLinkTickets = async (q) => {
    setLinkSearch(q)
    if (!q.trim()) { setLinkResults([]); return }
    setLinkLoading(true)
    try {
      const res = await getTickets({ search: q })
      setLinkResults(res.data.filter((t) => t.id !== parseInt(id) && t.id !== ticket.parent_id))
    } catch { setLinkResults([]) }
    finally { setLinkLoading(false) }
  }

  const handleLink = async (parentId) => {
    try {
      await linkTicket(id, parentId)
      toast.success(`Vinculado al ticket #${parentId}`)
      setShowLinkModal(false)
      setLinkSearch('')
      setLinkResults([])
      fetchAll()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error vinculando ticket')
    }
  }

  const handleUnlink = async () => {
    if (!await showConfirm('¿Desvincular este ticket del ticket primario?')) return
    try {
      await unlinkTicket(id)
      toast.success('Ticket desvinculado')
      fetchAll()
    } catch {
      toast.error('Error desvinculando ticket')
    }
  }

  const searchLinkDocs = async (q) => {
    setLinkDocSearch(q)
    if (!q.trim()) { setLinkDocResults([]); return }
    setLinkDocLoading(true)
    try {
      const fn = linkDocType === 'quote' ? getQuotes : getInvoices
      const res = await fn({ search: q })
      const alreadyLinked = (linkDocType === 'quote' ? linkedQuotes : linkedInvoices).map(d => d.id)
      setLinkDocResults(res.data.filter(d => !alreadyLinked.includes(d.id)))
    } catch { setLinkDocResults([]) }
    finally { setLinkDocLoading(false) }
  }

  const handleLinkDoc = async (docId) => {
    try {
      if (linkDocType === 'quote') await updateQuote(docId, { ticket_id: parseInt(id) })
      else await updateInvoice(docId, { ticket_id: parseInt(id) })
      toast.success(linkDocType === 'quote' ? 'Cotización vinculada' : 'Factura vinculada')
      setShowLinkDocModal(false)
      setLinkDocSearch('')
      setLinkDocResults([])
      fetchLinkedDocs()
    } catch { toast.error('Error vinculando documento') }
  }

  const handleUnlinkDoc = async (docId, type) => {
    try {
      if (type === 'quote') await updateQuote(docId, { ticket_id: null })
      else await updateInvoice(docId, { ticket_id: null })
      fetchLinkedDocs()
    } catch { toast.error('Error desvinculando') }
  }

  const handleDeleteTicket = async () => {
    if (!await showConfirm(`¿Eliminar el ticket #${id} "${ticket.title}"? Esta acción no se puede deshacer.`)) return
    try {
      await deleteTicket(id)
      toast.success('Ticket eliminado')
      navigate('/tickets')
    } catch {
      toast.error('Error al eliminar el ticket')
    }
  }

  const buildImageMap = async () => {
    const imageMap = {}
    for (const entry of timeline) {
      const matches = [...(entry.content || '').matchAll(/\[img:(\d+)\]/g)]
      for (const [, attId] of matches) {
        if (!imageMap[attId]) {
          const b64 = await fetchAsBase64(`/api/tickets/${id}/attachments/${attId}/download`)
          if (b64) imageMap[attId] = b64
        }
      }
    }
    return imageMap
  }

  const swipeBack = useTouchSwipe({ onSwipeRight: () => navigate(-1) })
  // Swipe dentro del visor: navega entre imágenes (si hay más de una).
  const lightboxSwipe = useTouchSwipe({
    onSwipeLeft:  () => setLightbox((l) => (l && l.list.length > 1 ? { ...l, idx: (l.idx + 1) % l.list.length } : l)),
    onSwipeRight: () => setLightbox((l) => (l && l.list.length > 1 ? { ...l, idx: (l.idx - 1 + l.list.length) % l.list.length } : l)),
  })

  const handlePrint = async (autoprint = true) => {
    // Pre-open window synchronously for iOS (blocked after await)
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    let preWin = null
    if (isIOS) {
      preWin = window.open('', '_blank')
      if (preWin) {
        preWin.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#64748b;font-size:15px;font-weight:600}</style></head><body>⏳ Generando…</body></html>`)
        preWin.document.close()
      }
    }
    try {
      const imageMap = await buildImageMap()
      const html = buildReportHTML(ticket, timeline, attachments, imageMap, coName)
      if (isIOS && preWin) {
        writePdfViewerToWindow(preWin, html)
        return
      }
      const ok = openPdfViewerFromHtml(html, { autoprint, delay: 400 })
      if (!ok) toast.error('El navegador bloqueó la ventana emergente')
    } catch {
      if (preWin && !preWin.closed) preWin.close()
      toast.error('Error al generar PDF')
    }
  }

  const handlePrintThermal = () => {
    const ok = printThermalTicket(buildThermalTicketHTML(ticket))
    if (!ok) toast.error('El navegador bloqueó la ventana emergente')
  }

  const handleShare = async () => {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)

    // iOS Safari blocks window.open() and navigator.share() after any await (network/FileReader).
    // Pre-open the window NOW, in the synchronous user-gesture context, then write HTML to it.
    let iosWin = null
    if (isIOS) {
      iosWin = window.open('', '_blank')
      if (iosWin) {
        iosWin.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#64748b;gap:8px;text-align:center;padding:20px}</style></head><body><div style="font-size:36px;margin-bottom:4px">⏳</div><p style="font-size:15px;font-weight:600;margin:0">Generando documento…</p><p style="font-size:13px;margin:4px 0 0;opacity:.7">Esto puede tomar unos segundos</p></body></html>`)
        iosWin.document.close()
      }
    }

    try {
      const imageMap = await buildImageMap()
      const html = buildReportHTML(ticket, timeline, attachments, imageMap, coName)
      const filename = `Ticket-${ticket.id}.pdf`
      const title = `Ticket #${ticket.id} — ${ticket.title}`

      if (isIOS) {
        if (!writePdfViewerToWindow(iosWin, html)) {
          toast.error('El navegador bloqueó la ventana emergente. Permite las ventanas emergentes para compartir.')
        }
        return
      }

      // Android: try Web Share API with generated PDF blob
      const canFileShare = typeof navigator.canShare === 'function' &&
        (() => { try { return navigator.canShare({ files: [new File([''], 'test.pdf', { type: 'application/pdf' })] }) } catch { return false } })()

      if (!canFileShare) {
        // Desktop: open viewer window (user saves as PDF manually)
        const ok = openPdfViewerFromHtml(html, { autoprint: false, delay: 400 })
        if (!ok) toast.error('El navegador bloqueó la ventana emergente')
        return
      }

      toast.loading('Generando PDF…', { id: 'share-pdf' })
      try {
        await sharePdfFromFullHtml(title, html, filename)
      } catch (err) {
        if (err?.name !== 'AbortError') toast.error('Error al compartir PDF')
      } finally {
        toast.dismiss('share-pdf')
      }
    } catch {
      if (iosWin && !iosWin.closed) iosWin.close()
      toast.error('Error al generar PDF')
    }
  }



  const handleWhatsAppWithPdf = async () => {
    const phone = ticket.client?.phone?.replace(/\D/g, '')
    if (!phone) { toast.error('El cliente no tiene teléfono registrado'); return }

    toast('Generando PDF del ticket…', { icon: '⏳' })

    const imageMap = await buildImageMap()
    const html = buildReportHTML(ticket, timeline, attachments, imageMap, coName)
    const win = window.open('', '_blank', 'width=850,height=700')
    win.document.write(html)
    win.document.close()
    win.focus()

    const clientName = ticket.client?.name || 'Cliente'
    const ticketUrl = `${window.location.origin}/tickets/${ticket.id}`
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent([
      `👋 Hola ${clientName}, le contactamos de *${coName}*.`,
      ``,
      `Le informamos sobre una actualización en su ticket de servicio:`,
      ``,
      `*🎫 Ticket #${ticket.id} — ${ticket.title}*`,
      ``,
      `Adjunto encontrará el informe completo en formato PDF con todos los detalles del servicio prestado.`,
      ``,
      `📋 También puede consultar el estado de su ticket aquí:`,
      ticketUrl,
      ``,
      `Quedamos a su disposición para cualquier consulta.`,
      `*${coName}*`,
    ].join('\n'))}`

    win.onafterprint = () => {
      win.close()
      window.open(waUrl, '_blank')
    }

    setTimeout(() => {
      toast('Guarda el PDF y se abrirá WhatsApp automáticamente', { icon: '📎', duration: 5000 })
      win.print()
    }, 400)
  }

  const handleDeleteCalendarEvent = async () => {
    if (!await showConfirm('¿Eliminar el evento de Google Calendar?')) return
    try {
      await deleteCalendarEvent(id)
      fetchAll()
      toast.success('Evento eliminado')
    } catch {
      toast.error('Error eliminando evento')
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando...</div>
  if (!ticket) return null

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto" {...(lightbox ? {} : swipeBack)}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-900 mt-1 flex-shrink-0">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-gray-400 font-mono text-sm">#{ticket.id}</span>
            <PriorityBadge priority={ticket.priority} />
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">{ticket.title}</h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <button onClick={() => handlePrint(false)} title="Ver e imprimir informe técnico" className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
            <Download size={14} /> <span className="hidden sm:inline">PDF</span>
          </button>
          <button onClick={handleShare} title="Compartir PDF" className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors">
            <Share2 size={14} /> <span className="hidden sm:inline">Compartir</span>
          </button>
          {isAgentOrAdmin && (
            <>
              <button onClick={handlePrintThermal} title="Imprimir comprobante en impresora térmica 80mm" className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors">
                <Printer size={14} /> <span className="hidden sm:inline">80mm</span>
              </button>
              <button onClick={() => navigate(`/tickets/${id}/edit`)} className="btn-secondary flex items-center gap-1.5 text-sm">
                <Edit size={14} /> <span className="hidden sm:inline">Editar</span>
              </button>
              <button
                onClick={handleDeleteTicket}
                className="p-1.5 text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Banner móvil del agente asignado — solo para clientes, solo en móvil */}
      {!isAgentOrAdmin && ticket.assigned_agent && (
        <div className="lg:hidden mb-2 flex items-center gap-3 p-3 rounded-xl bg-blue-50 border border-blue-100">
          {ticket.assigned_agent.profile_photo ? (
            <img
              src={ticket.assigned_agent.profile_photo}
              alt={ticket.assigned_agent.name}
              className="w-10 h-10 rounded-xl object-cover flex-shrink-0 shadow-sm"
            />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center flex-shrink-0 shadow-sm">
              <span className="text-white text-sm font-bold">
                {ticket.assigned_agent.name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs text-blue-500">Técnico asignado</p>
            <p className="text-sm font-semibold text-gray-900 truncate">{ticket.assigned_agent.name}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-6">
          {/* Descripción */}
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-3">Descripción</h3>
            <p className="text-gray-700 text-sm whitespace-pre-wrap">
              {ticket.description || <span className="text-gray-400 italic">Sin descripción</span>}
            </p>
            {ticket.resolution_notes && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-xs font-semibold text-green-700 mb-1">Notas de resolución:</p>
                <p className="text-sm text-green-800">{ticket.resolution_notes}</p>
              </div>
            )}
          </div>

          {/* CSAT survey — solo para clientes cuando el ticket está resuelto */}
          {!isAgentOrAdmin && ticket.status_rel?.is_closed && (
            <div className="card border-2 border-yellow-200 bg-yellow-50">
              {ticket.csat_rating || csatDone ? (
                <div className="text-center py-4">
                  <div className="flex justify-center gap-1 mb-2">
                    {[1,2,3,4,5].map((s) => (
                      <Star key={s} size={22} className={s <= (ticket.csat_rating || csatRating) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'} />
                    ))}
                  </div>
                  <p className="text-sm font-medium text-gray-700">¡Gracias por tu calificación!</p>
                  {ticket.csat_comment && <p className="text-xs text-gray-500 mt-1">"{ticket.csat_comment}"</p>}
                </div>
              ) : (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">¿Cómo fue tu experiencia?</h3>
                  <p className="text-xs text-gray-500 mb-3">Califica la atención recibida para este ticket resuelto.</p>
                  <div className="flex gap-2 mb-3">
                    {[1,2,3,4,5].map((s) => (
                      <button key={s} type="button"
                        onMouseEnter={() => setCsatHover(s)}
                        onMouseLeave={() => setCsatHover(0)}
                        onClick={() => setCsatRating(s)}
                        className="p-1 transition-transform hover:scale-110">
                        <Star size={28} className={s <= (csatHover || csatRating) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'} />
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="input resize-none text-sm mb-3"
                    rows={2}
                    value={csatComment}
                    onChange={(e) => setCsatComment(e.target.value)}
                    placeholder="Comentario opcional..."
                    style={{ fontSize: '16px' }}
                  />
                  <button
                    onClick={handleCsatSubmit}
                    disabled={!csatRating || csatSubmitting}
                    className="btn-primary text-sm disabled:opacity-40">
                    {csatSubmitting ? 'Enviando...' : 'Enviar calificación'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* CSAT para agentes — ver rating del cliente */}
          {isAgentOrAdmin && ticket.csat_rating && (
            <div className="card border border-yellow-200 bg-yellow-50">
              <div className="flex items-center gap-3">
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map((s) => (
                    <Star key={s} size={16} className={s <= ticket.csat_rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'} />
                  ))}
                </div>
                <span className="text-xs font-semibold text-gray-700">CSAT del cliente</span>
                {ticket.csat_comment && <span className="text-xs text-gray-500 truncate">"{ticket.csat_comment}"</span>}
              </div>
            </div>
          )}

          {/* Solicitud de partes del inventario (staff) */}
          {isAgentOrAdmin && <PartRequestPanel ticketId={id} />}

          {/* Auditoría (colapsable) */}
          <div className="card">
            <button
              type="button"
              onClick={() => setShowTimeline((v) => !v)}
              className="flex items-center justify-between w-full group"
            >
              <h3 className="font-semibold text-gray-900">Auditoría</h3>
              {showTimeline ? <Eye size={16} className="text-gray-400 group-hover:text-gray-600" /> : <EyeOff size={16} className="text-gray-400 group-hover:text-gray-600" />}
            </button>
            {showTimeline && (
              <div className="space-y-3 mt-4">
                {timeline.filter((e) => e.entry_type !== 'comment').length === 0 && (
                  <p className="text-sm text-gray-400 italic">Sin eventos registrados</p>
                )}
                {timeline.filter((e) => e.entry_type !== 'comment').map((entry) => (
                  <div key={entry.id} className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs flex-shrink-0">
                      {ENTRY_ICONS[entry.entry_type] || '⚙️'}
                    </div>
                    <div className="flex-1 min-w-0 py-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-700">{entry.user?.name}</span>
                        <span className="text-xs text-gray-400 ml-auto">{fmtDT(entry.created_at)}</span>
                      </div>
                      <p className="text-xs text-gray-500 italic mt-0.5">{entry.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Comentarios */}
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">Comentarios</h3>
            <div className="flex flex-col gap-2 bg-gray-50 rounded-xl p-3 min-h-[60px]">
              {timeline.filter((e) => e.entry_type === 'comment').length === 0 && (
                <p className="text-sm text-gray-400 italic text-center py-4">Sin comentarios aún</p>
              )}
              {timeline.filter((e) => e.entry_type === 'comment').map((entry, idx, arr) => {
                const isOwn = entry.user_id === user?.id
                const prevEntry = arr[idx - 1]
                const sameAsPrev = prevEntry && prevEntry.user_id === entry.user_id
                const canDelete = user?.role === 'admin' || user?.role === 'supervisor' || entry.user_id === user?.id

                const handleDeleteComment = async () => {
                  if (!await showConfirm('¿Eliminar este comentario?')) return
                  try {
                    await deleteTimelineEntry(id, entry.id)
                    setTimeline(prev => prev.filter(e => e.id !== entry.id))
                  } catch {
                    toast.error('Error al eliminar comentario')
                  }
                }

                const bubbleBg = entry.is_internal
                  ? 'bg-amber-50 border border-amber-200'
                  : isOwn
                    ? 'bg-blue-600'
                    : 'bg-white border border-gray-200 shadow-sm'
                const textColor = isOwn && !entry.is_internal ? 'text-white' : 'text-gray-800'
                const timeColor = isOwn && !entry.is_internal ? 'text-blue-200' : 'text-gray-400'

                return (
                  <div key={entry.id} className={`group w-full ${!sameAsPrev ? 'mt-3' : 'mt-1'}`}>
                    {!sameAsPrev && (
                      <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1 px-1`}>
                        <span className={`text-xs font-semibold ${isOwn ? 'text-blue-600' : 'text-gray-500'}`}>
                          {entry.user?.name}
                        </span>
                      </div>
                    )}

                    <div className={`w-full rounded-xl overflow-hidden ${bubbleBg}`}>
                      {entry.is_internal && (
                        <div className="flex items-center gap-1 px-3 pt-2 text-xs text-amber-700 font-medium">
                          <Lock size={10} /> Nota interna
                        </div>
                      )}
                      <div className={`px-3 pt-2 pb-1 text-sm ${textColor} leading-relaxed`}>
                        <CommentContent content={entry.content} ticketId={id} />
                      </div>
                      <div className={`flex items-center justify-between px-3 pb-2`}>
                        <span />
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs ${timeColor}`}>{fmtDT(entry.created_at)}</span>
                          {canDelete && (
                            <button
                              onClick={handleDeleteComment}
                              className={`opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all ${
                                isOwn && !entry.is_internal ? 'text-blue-300 hover:text-white' : 'text-red-400 hover:text-red-600'
                              }`}
                              title="Eliminar comentario"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                      {(() => {
                        let meta = {}
                        try { meta = entry.metadata_json ? JSON.parse(entry.metadata_json) : {} } catch {}
                        const ccVal = meta.cc
                        const bccVal = meta.bcc
                        if (!ccVal && !bccVal) return null
                        return (
                          <div className={`px-3 pb-2 flex items-center gap-1.5 flex-wrap text-xs ${isOwn && !entry.is_internal ? 'text-blue-200' : 'text-gray-400'}`}>
                            <Mail size={10} className="flex-shrink-0" />
                            {ccVal && <span>CC: {ccVal}</span>}
                            {ccVal && bccVal && isAgentOrAdmin && <span>·</span>}
                            {bccVal && isAgentOrAdmin && <span>CCO: {bccVal}</span>}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Agregar comentario */}
            <form onSubmit={handleComment} className="mt-4 border-t border-gray-200 pt-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-gray-700">Responder</span>
                {isAgentOrAdmin && (
                  <button
                    type="button"
                    onClick={() => setIsInternal(!isInternal)}
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors ${
                      isInternal ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {isInternal ? <Lock size={11} /> : <Unlock size={11} />}
                    {isInternal ? 'Interno' : 'Público'}
                  </button>
                )}
                {isAgentOrAdmin && cannedResponses.length > 0 && (
                  <div className="relative ml-auto">
                    <button type="button"
                      onClick={() => setShowCannedDrop((v) => !v)}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors">
                      <Zap size={11} /> Respuestas rápidas
                    </button>
                    {showCannedDrop && (
                      <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg w-72 max-h-64 overflow-y-auto"
                        onMouseLeave={() => setShowCannedDrop(false)}>
                        {cannedResponses.map((cr) => (
                          <button key={cr.id} type="button"
                            className="w-full text-left px-3 py-2.5 hover:bg-purple-50 border-b border-gray-50 last:border-0"
                            onClick={() => {
                              if (editorRef.current) {
                                editorRef.current.focus()
                                const selection = window.getSelection()
                                if (selection && selection.rangeCount > 0) {
                                  const range = selection.getRangeAt(0)
                                  range.deleteContents()
                                  const textNode = document.createTextNode(cr.content)
                                  range.insertNode(textNode)
                                  range.setStartAfter(textNode)
                                  range.collapse(true)
                                  selection.removeAllRanges()
                                  selection.addRange(range)
                                } else {
                                  editorRef.current.innerText = (editorRef.current.innerText || '') + cr.content
                                }
                                setHasContent(true)
                              }
                              setShowCannedDrop(false)
                            }}>
                            <p className="text-xs font-medium text-gray-800">{cr.title}</p>
                            {cr.category && <p className="text-xs text-gray-400">{cr.category}</p>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={() => setHasContent(editorRef.current?.innerText.trim().length > 0 || !!editorRef.current?.querySelector('img'))}
                    onPaste={handlePasteInEditor}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleComment(e) }}
                    className="input w-full min-h-[80px] max-h-[400px] overflow-y-auto focus:outline-none"
                    style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.5', fontSize: '16px' }}
                  />
                  {!hasContent && (
                    <span className="absolute top-2 left-3 text-gray-400 text-sm pointer-events-none select-none">
                      Escribe un comentario... (pega imágenes con Ctrl+V)
                    </span>
                  )}
                </div>
                {isAgentOrAdmin && !isInternal && (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        className="input flex-1 text-sm"
                        style={{fontSize:'15px'}}
                        placeholder="CC: correo1, correo2..."
                        value={commentCc}
                        onChange={(e) => setCommentCc(e.target.value)}
                      />
                      <input
                        type="text"
                        className="input flex-1 text-sm"
                        style={{fontSize:'15px'}}
                        placeholder="CCO: correo oculto..."
                        value={commentBcc}
                        onChange={(e) => setCommentBcc(e.target.value)}
                      />
                    </div>
                    <select
                      className="input text-sm"
                      style={{fontSize:'15px'}}
                      value={commentStatusId}
                      onChange={(e) => setCommentStatusId(e.target.value)}
                    >
                      <option value="">Mantener estado actual</option>
                      {statuses.filter((s) => s.is_active).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {isAgentOrAdmin && !isInternal && (() => {
                  const docs = [
                    ...linkedInvoices.filter(i => i.status !== 'Borrador').map(i => i.invoice_number || `FAC-${i.id}`),
                    ...linkedQuotes.filter(q => q.status !== 'Borrador').map(q => q.quote_number || `COT-${q.id}`),
                  ]
                  return docs.length > 0 ? (
                    <label className="flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2.5 py-1.5 mb-1 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={attachDocsToEmail}
                        onChange={e => setAttachDocsToEmail(e.target.checked)}
                        className="accent-indigo-600 w-3.5 h-3.5 cursor-pointer"
                      />
                      <Paperclip size={11} className="shrink-0" />
                      <span>Adjuntar al correo: <strong>{docs.join(', ')}</strong></span>
                    </label>
                  ) : null
                })()}
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  {pendingUploads > 0 && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />
                      Subiendo imagen…
                    </span>
                  )}
                  {isAgentOrAdmin && !isInternal && ticket.client?.email && (
                    <button
                      type="button"
                      onClick={handleSendViaEmail}
                      disabled={!hasContent || pendingUploads > 0 || sendingComment}
                      title={`Enviar y notificar por correo a ${ticket.client.email}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 rounded-lg disabled:opacity-40 transition-colors min-h-[36px]"
                    >
                      <Mail size={14} />
                      <span className="hidden sm:inline">Correo</span>
                    </button>
                  )}
                  {isAgentOrAdmin && !isInternal && ticket.client?.phone && (
                    <button
                      type="button"
                      onClick={handleSendViaWhatsApp}
                      disabled={!hasContent || pendingUploads > 0 || sendingComment}
                      title={`Enviar y notificar por WhatsApp a ${ticket.client.phone}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 active:bg-green-200 border border-green-200 rounded-lg disabled:opacity-40 transition-colors min-h-[36px]"
                    >
                      <MessageCircle size={14} />
                      <span className="hidden sm:inline">WhatsApp</span>
                    </button>
                  )}
                  <button type="submit" disabled={!hasContent || pendingUploads > 0 || sendingComment} className="btn-primary min-h-[36px]">
                    <Send size={15} />
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Adjuntos */}
          <div className="card">
            {(() => {
              const embeddedIds = new Set(
                timeline
                  .filter(e => e.entry_type === 'comment')
                  .flatMap(e => [...(e.content || '').matchAll(/\[img:(\d+)\]/g)].map(m => parseInt(m[1])))
              )
              const standaloneAtts = attachments.filter(a => !embeddedIds.has(a.id))
              const imgAtts = standaloneAtts.filter(a => a.content_type?.startsWith('image/'))
              return (<>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Archivos Adjuntos ({standaloneAtts.length})</h3>
              <button
                onClick={() => fileRef.current.click()}
                disabled={uploading}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <Paperclip size={14} />
                {uploading ? 'Subiendo...' : 'Adjuntar'}
              </button>
              <input ref={fileRef} type="file" className="hidden" onChange={handleFileUpload} />
            </div>
            {standaloneAtts.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">Sin archivos adjuntos</p>
            ) : (
              <div className="space-y-2">
                {standaloneAtts.map((att) => {
                  const isImage = att.content_type?.startsWith('image/')
                  const thumbSrc = attImgMap[att.id]
                  return (
                  <div key={att.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    {isImage && thumbSrc ? (
                      <button
                        type="button"
                        onClick={() => setLightbox({ list: imgAtts.map(a => ({ id: a.id, name: a.original_name })), idx: imgAtts.findIndex(a => a.id === att.id) })}
                        className="flex-shrink-0"
                      >
                        <img src={thumbSrc} alt={att.original_name} className="w-10 h-10 rounded object-cover border border-gray-200" />
                      </button>
                    ) : (
                      <Paperclip size={14} className="text-gray-400 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{att.original_name}</p>
                      <p className="text-xs text-gray-400">
                        {att.file_size ? `${(att.file_size / 1024).toFixed(1)} KB · ` : ''}
                        {att.uploaded_by?.name}
                      </p>
                    </div>
                    <button
                      onClick={() => downloadWithAuth(`/api/tickets/${id}/attachments/${att.id}/download`, att.original_name)}
                      className="p-1.5 hover:bg-gray-200 rounded text-gray-500"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      onClick={() => handleDeleteAttachment(att.id)}
                      className="p-1.5 hover:bg-red-100 rounded text-gray-400 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  )
                })}
              </div>
            )}
            </>)
            })()}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Estado */}
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-3">Estado</h3>
            {isAgentOrAdmin ? (
              <>
                <select
                  className="input"
                  value={ticket.status_rel?.id}
                  onChange={(e) => handleStatusChange(e.target.value)}
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {(() => {
                  const resueltoStatus = statuses.find((s) => s.name === 'Resuelto') || statuses.find((s) => s.is_closed)
                  if (!resueltoStatus || ticket.status_rel?.is_closed) return null
                  return (
                    <button
                      onClick={() => { setResolveNotes(''); setShowResolveModal(true) }}
                      className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 active:bg-green-200 transition-colors"
                    >
                      <CheckCircle size={14} /> Marcar como Resuelto
                    </button>
                  )
                })()}
              </>
            ) : (
              <StatusBadge status={ticket.status_rel} />
            )}
          </div>

          {/* Detalles */}
          <div className="card space-y-3">
            <h3 className="font-semibold text-gray-900 mb-1">Detalles</h3>
            {ticket.contact ? (
              <div>
                <p className="text-xs text-gray-400 mb-1">Contacto</p>
                <button
                  onClick={() => navigate(`/contacts?contact_id=${ticket.contact.id}`)}
                  className="w-full text-left p-2.5 rounded-xl bg-blue-50 border border-blue-100 hover:bg-blue-100 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-blue-800 group-hover:text-blue-900 truncate">
                      {ticket.contact.name}
                    </span>
                    <ExternalLink size={13} className="text-blue-400 flex-shrink-0" />
                  </div>
                  {ticket.contact.company && (
                    <p className="text-xs text-blue-600 mt-0.5 truncate">{ticket.contact.company}</p>
                  )}
                  {ticket.contact.phone && (
                    <p className="text-xs text-gray-500 mt-0.5">{ticket.contact.phone}</p>
                  )}
                  {ticket.contact.email && (
                    <p className="text-xs text-gray-500 truncate">{ticket.contact.email}</p>
                  )}
                </button>
              </div>
            ) : (
              <>
                <Detail label="Cliente" value={ticket.client?.name} />
                <Detail label="Empresa" value={ticket.client?.company} />
              </>
            )}
            {isAgentOrAdmin && ticket.client?.client_category && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Categoría</p>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                  style={{ backgroundColor: ticket.client.client_category.color }}>
                  {ticket.client.client_category.name}
                </span>
              </div>
            )}

            {/* Técnico asignado — editable */}
            <div>
              <p className="text-xs text-gray-400 mb-1">Agente</p>
              {isAgentOrAdmin ? (
                <select
                  className="input text-sm py-1.5"
                  value={ticket.assigned_agent?.id || ''}
                  onChange={(e) => handleAgentChange(e.target.value)}
                >
                  <option value="">Sin asignar</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              ) : (
                ticket.assigned_agent ? (
                  <div className="flex items-center gap-3 mt-1 p-2.5 rounded-xl bg-blue-50 border border-blue-100">
                    {ticket.assigned_agent.profile_photo ? (
                      <img src={ticket.assigned_agent.profile_photo} alt={ticket.assigned_agent.name}
                        className="w-12 h-12 rounded-xl object-cover flex-shrink-0 shadow-sm" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center flex-shrink-0 shadow-sm">
                        <span className="text-white text-base font-bold">
                          {ticket.assigned_agent.name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}
                        </span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 leading-tight">{ticket.assigned_agent.name}</p>
                      <p className="text-xs text-blue-600 mt-0.5">Técnico asignado</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm font-medium text-gray-500 mt-1">Sin asignar</p>
                )
              )}
            </div>

            {/* Categoría — editable */}
            <div>
              <p className="text-xs text-gray-400 mb-1">Categoría</p>
              {isAgentOrAdmin ? (
                <select
                  className="input text-sm py-1.5"
                  value={ticket.category || ''}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                >
                  <option value="">Sin categoría</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm font-medium text-gray-900">{ticket.category || '—'}</p>
              )}
            </div>

            {/* Prioridad — editable */}
            <div>
              <p className="text-xs text-gray-400 mb-1">Prioridad</p>
              {isAgentOrAdmin ? (
                <select
                  className="input text-sm py-1.5"
                  value={ticket.priority}
                  onChange={(e) => handlePriorityChange(e.target.value)}
                >
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                  <option value="critical">Crítica</option>
                </select>
              ) : (
                <PriorityBadge priority={ticket.priority} />
              )}
            </div>

            {/* Tags */}
            {isAgentOrAdmin && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Etiquetas</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(ticket.tags || '').split(',').filter(Boolean).map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                      {tag.trim()}
                      <button type="button" onClick={() => {
                        const newTags = (ticket.tags || '').split(',').filter((t) => t.trim() !== tag.trim())
                        handleTagsUpdate(newTags)
                      }} className="hover:text-red-500 leading-none">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    className="input text-sm py-1 flex-1"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                        e.preventDefault()
                        const existing = (ticket.tags || '').split(',').filter(Boolean).map((t) => t.trim())
                        const newTag = tagInput.trim()
                        if (!existing.includes(newTag)) handleTagsUpdate([...existing, newTag])
                        setTagInput('')
                      }
                    }}
                    placeholder="Nueva etiqueta..."
                    style={{ fontSize: '14px' }}
                  />
                  <button type="button" className="btn-secondary text-xs px-2"
                    onClick={() => {
                      if (!tagInput.trim()) return
                      const existing = (ticket.tags || '').split(',').filter(Boolean).map((t) => t.trim())
                      const newTag = tagInput.trim()
                      if (!existing.includes(newTag)) handleTagsUpdate([...existing, newTag])
                      setTagInput('')
                    }}>+</button>
                </div>
              </div>
            )}
            {!isAgentOrAdmin && ticket.tags && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Etiquetas</p>
                <div className="flex flex-wrap gap-1.5">
                  {ticket.tags.split(',').filter(Boolean).map((tag) => (
                    <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{tag.trim()}</span>
                  ))}
                </div>
              </div>
            )}

            <Detail
              label="Creado"
              value={fmtDT(ticket.created_at)}
            />
            {ticket.closed_at && (
              <Detail
                label="Cerrado"
                value={fmtDT(ticket.closed_at)}
              />
            )}
          </div>

          {/* Tiempo trabajado */}
          {isAgentOrAdmin && !itMode && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Clock size={14} className="text-gray-400" />
                  Tiempo trabajado
                  {timeLogs.length > 0 && (
                    <span className="text-xs font-normal text-gray-400">
                      — {Math.floor(timeLogs.reduce((a, l) => a + l.minutes, 0) / 60)}h {timeLogs.reduce((a, l) => a + l.minutes, 0) % 60}m total
                    </span>
                  )}
                </h3>
                <button onClick={() => setShowTimeForm((v) => !v)}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium">
                  <Plus size={12} /> Agregar
                </button>
              </div>
              {showTimeForm && (
                <form onSubmit={handleAddTimeLog} className="mb-3 p-3 bg-gray-50 rounded-lg space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="label">Horas</label>
                      <input type="number" min="0" className="input text-sm" value={timeLogForm.hours}
                        onChange={(e) => setTimeLogForm((f) => ({ ...f, hours: e.target.value }))}
                        placeholder="0" style={{ fontSize: '16px' }} />
                    </div>
                    <div className="flex-1">
                      <label className="label">Minutos</label>
                      <input type="number" min="0" max="59" className="input text-sm" value={timeLogForm.minutes}
                        onChange={(e) => setTimeLogForm((f) => ({ ...f, minutes: e.target.value }))}
                        placeholder="0" style={{ fontSize: '16px' }} />
                    </div>
                  </div>
                  <div>
                    <label className="label">Descripción</label>
                    <input className="input text-sm" value={timeLogForm.description}
                      onChange={(e) => setTimeLogForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="¿Qué hiciste?" style={{ fontSize: '16px' }} />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={savingTimeLog} className="btn-primary text-xs px-3 py-1.5">
                      {savingTimeLog ? 'Guardando...' : 'Guardar'}
                    </button>
                    <button type="button" onClick={() => setShowTimeForm(false)} className="btn-secondary text-xs px-3 py-1.5">Cancelar</button>
                  </div>
                </form>
              )}
              {timeLogs.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">Sin registros de tiempo</p>
              ) : (
                <div className="space-y-2">
                  {timeLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2 group">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-700">
                            {Math.floor(log.minutes / 60) > 0 ? `${Math.floor(log.minutes / 60)}h ` : ''}{log.minutes % 60 > 0 ? `${log.minutes % 60}m` : ''}
                          </span>
                          <span className="text-xs text-gray-400">{log.user?.name}</span>
                        </div>
                        {log.description && <p className="text-xs text-gray-500 truncate">{log.description}</p>}
                        <p className="text-xs text-gray-300">{fmtD(log.created_at)}</p>
                      </div>
                      {(log.user?.id === user?.id || user?.role === 'admin' || user?.role === 'supervisor') && (
                        <button onClick={() => handleDeleteTimeLog(log.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-400 transition-all">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tickets relacionados */}
          {isAgentOrAdmin && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <GitBranch size={14} className="text-gray-400" />
                  Tickets relacionados
                </h3>
                <button
                  onClick={() => setShowLinkModal(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium"
                >
                  <Link2 size={12} /> {ticket.parent_id ? 'Cambiar' : 'Vincular'}
                </button>
              </div>

              {/* Ticket primario */}
              {ticket.parent && (
                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-1">Ticket primario</p>
                  <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-100 rounded-lg">
                    <button
                      onClick={() => navigate(`/tickets/${ticket.parent.id}`)}
                      className="flex-1 text-left min-w-0"
                    >
                      <p className="text-xs font-semibold text-blue-700">#{ticket.parent.id}</p>
                      <p className="text-xs text-blue-600 truncate">{ticket.parent.title}</p>
                    </button>
                    <button onClick={handleUnlink} className="p-1 rounded hover:bg-blue-200 text-blue-400 hover:text-red-500 flex-shrink-0" title="Desvincular">
                      <Unlink size={13} />
                    </button>
                  </div>
                </div>
              )}

              {/* Tickets hijos */}
              {ticket.children?.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-1">Tickets vinculados ({ticket.children.length})</p>
                  <div className="space-y-1">
                    {ticket.children.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => navigate(`/tickets/${c.id}`)}
                        className="w-full flex items-center gap-2 p-2 rounded-lg border border-gray-100 hover:bg-gray-50 text-left transition-colors"
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.status_rel?.color || '#6B7280' }} />
                        <span className="text-xs text-gray-500 font-mono flex-shrink-0">#{c.id}</span>
                        <span className="text-xs text-gray-800 truncate flex-1">{c.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!ticket.parent && ticket.children?.length === 0 && (
                <p className="text-xs text-gray-400">Sin tickets relacionados</p>
              )}

            </div>
          )}

          {/* Cotizaciones y Facturas */}
          {isAgentOrAdmin && !itMode && (
            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <FileText size={14} className="text-gray-400" />
                Documentos
              </h3>

              {/* Cotizaciones */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-gray-500">Cotizaciones</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate(`/quotes?action=new&ticket_id=${id}`)}
                      className="text-xs text-green-600 hover:text-green-800 flex items-center gap-0.5 font-medium"
                    >
                      <Plus size={11} /> Crear
                    </button>
                    <button
                      onClick={() => { setLinkDocType('quote'); setLinkDocSearch(''); setLinkDocResults([]); setShowLinkDocModal(true) }}
                      className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-0.5 font-medium"
                    >
                      <Plus size={11} /> Vincular
                    </button>
                  </div>
                </div>
                {linkedQuotes.length === 0
                  ? <p className="text-xs text-gray-400 italic">Ninguna</p>
                  : linkedQuotes.map(q => (
                    <div key={q.id} className="flex items-center gap-1.5 py-1.5 border-b border-gray-50 last:border-0">
                      <button onClick={() => navigate('/quotes', { state: { selectQuoteId: q.id } })} className="flex-1 min-w-0 text-left">
                        <p className="text-xs font-semibold text-gray-800">{q.quote_number || `#${q.id}`}</p>
                        <p className="text-xs text-gray-400 truncate">{q.total ? `$${q.total}` : ''}{q.total && q.status ? ' · ' : ''}{q.status}</p>
                      </button>
                      <button onClick={() => handleUnlinkDoc(q.id, 'quote')} className="p-0.5 rounded text-gray-300 hover:text-red-500 flex-shrink-0" title="Desvincular">
                        <X size={12} />
                      </button>
                    </div>
                  ))
                }
              </div>

              {/* Facturas */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-gray-500">Facturas</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate(`/facturas?action=new&ticket_id=${id}`)}
                      className="text-xs text-green-600 hover:text-green-800 flex items-center gap-0.5 font-medium"
                    >
                      <Plus size={11} /> Crear
                    </button>
                    <button
                      onClick={() => { setLinkDocType('invoice'); setLinkDocSearch(''); setLinkDocResults([]); setShowLinkDocModal(true) }}
                      className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-0.5 font-medium"
                    >
                      <Plus size={11} /> Vincular
                    </button>
                  </div>
                </div>
                {linkedInvoices.length === 0
                  ? <p className="text-xs text-gray-400 italic">Ninguna</p>
                  : linkedInvoices.map(inv => (
                    <div key={inv.id} className="flex items-center gap-1.5 py-1.5 border-b border-gray-50 last:border-0">
                      <button onClick={() => navigate('/facturas', { state: { selectInvoiceId: inv.id } })} className="flex-1 min-w-0 text-left">
                        <p className="text-xs font-semibold text-gray-800">{inv.invoice_number || `#${inv.id}`}</p>
                        <p className="text-xs text-gray-400 truncate">{inv.total ? `$${inv.total}` : ''}{inv.total && inv.status ? ' · ' : ''}{inv.status}</p>
                      </button>
                      <button onClick={() => handleUnlinkDoc(inv.id, 'invoice')} className="p-0.5 rounded text-gray-300 hover:text-red-500 flex-shrink-0" title="Desvincular">
                        <X size={12} />
                      </button>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {/* SLA */}
          <SlaCard ticket={ticket} />

          {/* Google Calendar — Visitas */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Visitas</h3>
              {ticket.visits?.length > 0 && (
                <span className="text-xs text-gray-400">{ticket.visits.length}/10</span>
              )}
            </div>

            {ticket.visits?.length > 0 && (
              <div className="space-y-2 mb-3">
                {ticket.visits.map((v, idx) => {
                  const isCancelled = v.status === 'cancelled'
                  const showCosto = (user?.role === 'admin' || user?.role === 'supervisor') && !isCancelled && idx < 5
                  return (
                  <div key={v.id} className={`p-2.5 border rounded-lg ${isCancelled ? 'bg-red-50 border-red-100 opacity-70' : 'bg-green-50 border-green-100'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <p className={`text-xs font-semibold ${isCancelled ? 'text-red-500 line-through' : 'text-green-700'}`}>Visita {idx + 1}</p>
                          {isCancelled && <span className="text-xs text-red-400">(cancelada)</span>}
                          {v.is_remote && !isCancelled && (
                            <span className="inline-flex items-center gap-0.5 text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded px-1.5 py-0.5 font-medium">
                              📡 Remoto
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600">
                          {fmtD(v.scheduled_at)}
                          {' · '}
                          {fmtTime(v.scheduled_at)}
                          {v.duration_minutes
                            ? (() => { const base = toUTC(v.scheduled_at).getTime(); return ` → ${fmtTime(new Date(base + v.duration_minutes * 60000).toISOString())}` })()
                            : ''}
                        </p>
                        {v.notes && <p className="text-xs text-gray-400 truncate mt-0.5">{v.notes}</p>}
                        {showCosto && (
                          <div className="mt-1.5 flex items-center gap-1">
                            <span className="text-xs text-gray-400">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Costo visita"
                              className="text-xs border border-green-200 rounded px-1.5 py-0.5 w-28 bg-white focus:outline-none focus:border-green-400"
                              defaultValue={v.costo ?? ''}
                              key={`costo-${v.id}-${v.costo}`}
                              onBlur={(e) => handleCostoBlur(v.id, e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {v.calendar_event_link ? (
                          <a href={v.calendar_event_link} target="_blank" rel="noopener noreferrer"
                            className="p-1 rounded text-gray-400 hover:text-blue-600" title="Ver en Google Calendar">
                            <ExternalLink size={13} />
                          </a>
                        ) : !isCancelled && isAgentOrAdmin && (
                          <button onClick={() => handlePushToGoogle(v.id)}
                            className="p-1 rounded text-gray-400 hover:text-green-600" title="Enviar a Google Calendar">
                            <Calendar size={13} />
                          </button>
                        )}
                        {isAgentOrAdmin && !isCancelled && (
                          <button onClick={() => openReschedule(v)}
                            className="p-1 rounded text-gray-300 hover:text-amber-500" title="Reagendar">
                            <RefreshCw size={13} />
                          </button>
                        )}
                        {isAgentOrAdmin && !isCancelled && (
                          <button onClick={() => handleCancelVisit(v.id)} disabled={cancelling === v.id}
                            className="p-1 rounded text-gray-300 hover:text-orange-500 disabled:opacity-50" title="Cancelar visita">
                            <XCircle size={13} />
                          </button>
                        )}
                        {isAgentOrAdmin && (
                          <button onClick={() => handleDeleteVisit(v.id)}
                            className="p-1 rounded text-gray-300 hover:text-red-500" title="Eliminar visita">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}

            {isAgentOrAdmin && (
              <button
                onClick={() => setShowCalendarModal(true)}
                disabled={ticket.visits?.length >= 10}
                className="btn-secondary w-full flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Calendar size={14} />
                {ticket.visits?.length >= 10 ? 'Límite de visitas alcanzado' : 'Agendar visita'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modal Vincular ticket */}
      {/* Reagendar visita modal */}
      {rescheduleVisit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <RefreshCw size={16} /> Reagendar visita
              </h3>
              <button onClick={() => setRescheduleVisit(null)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">Fecha *</label>
                <input type="date" className="input w-full" value={rescheduleForm.date}
                  onChange={(e) => setRescheduleForm((f) => ({ ...f, date: e.target.value }))} style={{fontSize:'16px'}} />
              </div>
              <div>
                <label className="label">Hora *</label>
                <div className="flex gap-2">
                  <select className="input flex-1" value={rescheduleForm.hour}
                    onChange={(e) => setRescheduleForm((f) => ({ ...f, hour: e.target.value }))} style={{fontSize:'16px'}}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                    ))}
                  </select>
                  <select className="input flex-1" value={rescheduleForm.minute}
                    onChange={(e) => setRescheduleForm((f) => ({ ...f, minute: e.target.value }))} style={{fontSize:'16px'}}>
                    {['00','05','10','15','20','25','30','35','40','45','50','55'].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <select className="input w-24" value={rescheduleForm.ampm}
                    onChange={(e) => setRescheduleForm((f) => ({ ...f, ampm: e.target.value }))} style={{fontSize:'16px'}}>
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Duración (minutos)</label>
                <div className="flex gap-2 flex-wrap">
                  {[30, 60, 90, 120, 180, 240].map((m) => (
                    <button key={m} type="button"
                      onClick={() => setRescheduleForm((f) => ({ ...f, duration_minutes: m }))}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${rescheduleForm.duration_minutes === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                      {m < 60 ? `${m} min` : `${m / 60}h${m % 60 ? ` ${m % 60}m` : ''}`}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rescheduleForm.is_remote}
                  onChange={(e) => setRescheduleForm((f) => ({ ...f, is_remote: e.target.checked }))}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-sm text-gray-700 font-medium">Visita remota</span>
              </label>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t">
              <button onClick={() => setRescheduleVisit(null)} className="btn-secondary">Cancelar</button>
              <button onClick={handleReschedule} disabled={!rescheduleForm.date || rescheduling}
                className="btn-primary flex items-center gap-2 disabled:opacity-60">
                <RefreshCw size={14} />
                {rescheduling ? 'Guardando...' : 'Reagendar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLinkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Link2 size={16} /> Vincular a ticket primario
              </h3>
              <button onClick={() => { setShowLinkModal(false); setLinkSearch(''); setLinkResults([]) }}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-500">Busca el ticket al que quieres vincular este ticket como subordinado.</p>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input pl-9"
                  placeholder="Buscar por título o #ID..."
                  value={linkSearch}
                  onChange={(e) => searchLinkTickets(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {linkLoading && <p className="text-sm text-gray-400 text-center py-4">Buscando...</p>}
                {!linkLoading && linkSearch && linkResults.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">Sin resultados</p>
                )}
                {!linkLoading && !linkSearch && (
                  <p className="text-sm text-gray-400 text-center py-4">Escribe para buscar tickets</p>
                )}
                {linkResults.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleLink(t.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50 text-left transition-colors"
                  >
                    <span className="text-xs font-mono text-gray-400 flex-shrink-0">#{t.id}</span>
                    <span className="flex-1 text-sm font-medium text-gray-900 truncate">{t.title}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{t.client?.name}</span>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.status_rel?.color || '#6B7280' }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Vincular cotización/factura */}
      {showLinkDocModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <FileText size={16} />
                Vincular {linkDocType === 'quote' ? 'cotización' : 'factura'}
              </h3>
              <button onClick={() => { setShowLinkDocModal(false); setLinkDocSearch(''); setLinkDocResults([]) }}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input pl-9"
                  placeholder={linkDocType === 'quote' ? 'Buscar por número, cliente, asunto...' : 'Buscar por número, cliente...'}
                  value={linkDocSearch}
                  onChange={(e) => searchLinkDocs(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {linkDocLoading && <p className="text-sm text-gray-400 text-center py-4">Buscando...</p>}
                {!linkDocLoading && linkDocSearch && linkDocResults.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">Sin resultados</p>
                )}
                {!linkDocLoading && !linkDocSearch && (
                  <p className="text-sm text-gray-400 text-center py-4">Escribe para buscar</p>
                )}
                {linkDocResults.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => handleLinkDoc(doc.id)}
                    className="w-full flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50 text-left transition-colors"
                  >
                    <span className="text-xs font-mono text-gray-500 flex-shrink-0 mt-0.5">
                      {linkDocType === 'quote' ? (doc.quote_number || `#${doc.id}`) : (doc.invoice_number || `#${doc.id}`)}
                    </span>
                    <div className="flex-1 min-w-0">
                      {linkDocType === 'quote' && doc.title && (
                        <p className="text-sm font-semibold text-gray-900 truncate">{doc.title}</p>
                      )}
                      <p className={`truncate ${linkDocType === 'quote' && doc.title ? 'text-xs text-gray-500' : 'text-sm font-medium text-gray-900'}`}>
                        {doc.client_name || '—'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {doc.total && <span className="text-xs text-gray-500">${doc.total}</span>}
                      <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">{doc.status}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Marcar como Resuelto */}
      {showResolveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <CheckCircle size={16} className="text-green-600" /> Marcar como Resuelto
              </h3>
              <button onClick={() => setShowResolveModal(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-500">Puedes agregar notas de resolución opcionales antes de cerrar el ticket.</p>
              <div>
                <label className="label">Notas de resolución <span className="text-gray-400 font-normal">(opcional)</span></label>
                <textarea
                  className="input h-28 resize-none"
                  style={{ fontSize: '16px' }}
                  placeholder="Describe cómo se resolvió el problema..."
                  value={resolveNotes}
                  onChange={(e) => setResolveNotes(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t">
              <button onClick={() => setShowResolveModal(false)} className="btn-secondary">Cancelar</button>
              <button
                onClick={handleResolve}
                disabled={resolving}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
              >
                <CheckCircle size={14} />
                {resolving ? 'Guardando...' : 'Marcar como Resuelto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Calendar */}
      {showCalendarModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
              <h3 className="font-semibold text-gray-900">
                {ticket.visits?.length > 0 ? `Agregar visita ${ticket.visits.length + 1}` : 'Agendar visita'}
              </h3>
              <button onClick={() => { setShowCalendarModal(false); setConflicts([]) }}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Preview formato */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs font-semibold text-blue-700 mb-1">Formato del evento en Google Calendar:</p>
                <p className="text-xs text-blue-600 font-mono break-all">
                  Ticket #{id} · {ticket.client?.name}{ticket.client?.company ? ` (${ticket.client.company})` : ''} · {calendarForm.location || 'Ubicación'} · {calendarForm.subject || 'Asunto'}
                </p>
              </div>

              {/* ── Fecha ── */}
              <div>
                <label className="label">Fecha *</label>
                <input
                  type="date"
                  className="input"
                  value={calendarForm.date}
                  onChange={(e) => updateCalendarForm({ date: e.target.value })}
                  required
                />
              </div>

              {/* ── Hora en formato 12h ── */}
              <div>
                <label className="label">Hora *</label>
                <div className="flex gap-2">
                  <select
                    className="input flex-1"
                    value={calendarForm.hour}
                    onChange={(e) => updateCalendarForm({ hour: e.target.value })}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                    ))}
                  </select>
                  <select
                    className="input flex-1"
                    value={calendarForm.minute}
                    onChange={(e) => updateCalendarForm({ minute: e.target.value })}
                  >
                    {['00','05','10','15','20','25','30','35','40','45','50','55'].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <select
                    className="input w-24"
                    value={calendarForm.ampm}
                    onChange={(e) => updateCalendarForm({ ampm: e.target.value })}
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </div>

              {/* After-hours warning */}
              {(() => {
                let h = parseInt(calendarForm.hour, 10)
                if (calendarForm.ampm === 'PM' && h !== 12) h += 12
                if (calendarForm.ampm === 'AM' && h === 12) h = 0
                return h >= 18 ? (
                  <p className="flex items-center gap-1 text-xs text-amber-600">
                    <AlertTriangle size={12} /> Fuera de horario laboral
                  </p>
                ) : null
              })()}

              {/* ── Duración / Hora de fin ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Duración de la visita</label>
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => updateCalendarForm({ endMode: 'duration' })}
                      className={`px-3 py-1 text-xs font-medium transition-colors ${
                        calendarForm.endMode === 'duration'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-500 hover:bg-gray-50 active:bg-gray-100'
                      }`}
                    >
                      Duración
                    </button>
                    <button
                      type="button"
                      onClick={() => updateCalendarForm({ endMode: 'endtime' })}
                      className={`px-3 py-1 text-xs font-medium transition-colors border-l border-gray-200 ${
                        calendarForm.endMode === 'endtime'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-500 hover:bg-gray-50 active:bg-gray-100'
                      }`}
                    >
                      Hora de fin
                    </button>
                  </div>
                </div>

                {calendarForm.endMode === 'duration' ? (
                  <div className="flex gap-2 flex-wrap">
                    {[30, 60, 90, 120, 180, 240].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateCalendarForm({ duration_minutes: m })}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                          parseInt(calendarForm.duration_minutes) === m
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                        }`}
                      >
                        {m < 60 ? `${m} min` : `${m / 60}h${m % 60 ? ` ${m % 60}m` : ''}`}
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <select
                        className="input flex-1"
                        value={calendarForm.endHour}
                        onChange={(e) => updateCalendarForm({ endHour: e.target.value })}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                          <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                        ))}
                      </select>
                      <select
                        className="input flex-1"
                        value={calendarForm.endMinute}
                        onChange={(e) => updateCalendarForm({ endMinute: e.target.value })}
                      >
                        {['00','05','10','15','20','25','30','35','40','45','50','55'].map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <select
                        className="input w-24"
                        value={calendarForm.endAmpm}
                        onChange={(e) => updateCalendarForm({ endAmpm: e.target.value })}
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                    </div>
                    {calendarForm.date && (() => {
                      const mins = getEffectiveDuration()
                      return mins > 0
                        ? <p className="text-xs text-gray-400 mt-1.5">Duración: {mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`}</p>
                        : <p className="text-xs text-red-400 mt-1.5">La hora de fin debe ser posterior a la hora de inicio</p>
                    })()}
                  </>
                )}
              </div>

              {/* ── Alerta de conflictos ── */}
              {checkingConflicts && (
                <p className="text-xs text-gray-400">Verificando disponibilidad...</p>
              )}
              {!checkingConflicts && conflicts.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm">
                    <AlertTriangle size={15} />
                    {conflicts.length === 1 ? 'Choque de horario detectado' : `${conflicts.length} choques de horario detectados`}
                  </div>
                  {conflicts.map((c) => {
                    const start = toUTC(c.scheduled_at)
                    const end = new Date(start.getTime() + c.duration_minutes * 60000)
                    return (
                      <div key={c.ticket_id} className="text-xs text-amber-800 bg-amber-100 rounded px-2 py-1.5">
                        <span className="font-medium">Ticket #{c.ticket_id}</span> — {c.title}<br />
                        <span className="text-amber-600">{fmtD(start.toISOString())} · {fmtTime(start.toISOString())} – {fmtTime(end.toISOString())} · {c.agent}</span>
                      </div>
                    )
                  })}
                  <p className="text-xs text-amber-600">Puedes continuar, pero habrá solapamiento con los tickets anteriores.</p>
                </div>
              )}
              {!checkingConflicts && conflicts.length === 0 && calendarForm.date && (
                <p className="text-xs text-green-600">✓ Sin conflictos de horario</p>
              )}

              {/* ── Ubicación y Asunto ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Ubicación</label>
                  <input
                    className="input"
                    placeholder="Ej: Oficina Central"
                    value={calendarForm.location}
                    onChange={(e) => setCalendarForm((f) => ({ ...f, location: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Asunto</label>
                  <input
                    className="input"
                    placeholder="Ej: Revisión de equipo"
                    value={calendarForm.subject}
                    onChange={(e) => setCalendarForm((f) => ({ ...f, subject: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="label">CCO — Copia oculta <span className="text-gray-400 font-normal">(notificación de visita)</span></label>
                <input
                  type="email"
                  className="input"
                  value={calendarForm.bcc_email}
                  onChange={(e) => setCalendarForm((f) => ({ ...f, bcc_email: e.target.value }))}
                  placeholder="correo@ejemplo.com"
                  style={{ fontSize: '16px' }}
                />
              </div>

              <div>
                <label className="label">Notas adicionales</label>
                <textarea
                  className="input h-16 resize-none"
                  value={calendarForm.notes}
                  onChange={(e) => setCalendarForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={calendarForm.is_remote}
                  onChange={(e) => setCalendarForm((f) => ({ ...f, is_remote: e.target.checked }))}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-sm text-gray-700 font-medium">Visita remota</span>
                <span className="text-xs text-gray-400">(no presencial)</span>
              </label>

              <p className="text-xs text-gray-400">
                Requiere Google Calendar conectado. Si no está conectado se abrirá la ventana de autorización.
              </p>
            </div>

            <div className="flex justify-end gap-3 p-5 border-t flex-shrink-0">
              <button onClick={() => { setShowCalendarModal(false); setConflicts([]) }} className="btn-secondary">
                Cancelar
              </button>
              <button
                onClick={handleCalendarEvent}
                disabled={!calendarForm.date || creatingEvent}
                className="btn-primary flex items-center gap-2 disabled:opacity-60"
              >
                <Calendar size={14} />
                {creatingEvent ? 'Agendando...' : 'Agendar visita'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visor de imagen adjunta (sin descargar) */}
      {lightbox && (() => {
        const n = lightbox.list.length
        const cur = lightbox.list[lightbox.idx] || lightbox.list[0]
        const src = attImgMap[cur.id]
        const go = (delta) => setLightbox((l) => l && { ...l, idx: (l.idx + delta + n) % n })
        return (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setLightbox(null)}
          {...lightboxSwipe}
        >
          {n > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); go(-1) }}
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 p-2 bg-white/10 hover:bg-white/25 rounded-full text-white z-10"
              title="Anterior (←)"
            >
              <ChevronLeft size={28} />
            </button>
          )}
          {n > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); go(1) }}
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 p-2 bg-white/10 hover:bg-white/25 rounded-full text-white z-10"
              title="Siguiente (→)"
            >
              <ChevronRight size={28} />
            </button>
          )}
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
            <button
              onClick={(e) => { e.stopPropagation(); downloadWithAuth(`/api/tickets/${id}/attachments/${cur.id}/download`, cur.name) }}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white"
              title="Descargar"
            >
              <Download size={20} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setLightbox(null) }}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white"
              title="Cerrar (Esc)"
            >
              <X size={20} />
            </button>
          </div>
          {src ? (
            <img
              src={src}
              alt={cur.name}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
          ) : (
            <div className="text-white/70 text-sm">Cargando imagen…</div>
          )}
          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-sm text-center max-w-[90%]">
            <span className="truncate inline-block max-w-full align-bottom">{cur.name}</span>
            {n > 1 && <span className="ml-2 text-white/60">· {lightbox.idx + 1} / {n}</span>}
          </p>
        </div>
        )
      })()}
    </div>
  )
}

function Detail({ label, value }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <div className="text-sm text-gray-900 font-medium">{value}</div>
    </div>
  )
}

function SlaCard({ ticket }) {
  const info = getSLAInfo(ticket)
  if (!info) return null

  const PRIORITY_LABELS = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' }
  const SLA_TOTAL = { critical: 240, high: 540, medium: 1620, low: 2700 }
  const total = SLA_TOTAL[ticket.priority] || 1620
  const used = info.paused
    ? (ticket.sla_elapsed_minutes || 0)
    : total - info.remaining_min
  const pct = Math.min(Math.round((used / total) * 100), 100)

  const { breached, paused, remaining_min, deadline, resolved } = info
  const warn = !breached && !paused && (remaining_min / total) < 0.20
  const barColor = breached ? '#EF4444' : (resolved && !breached) ? '#10B981' : paused ? '#9CA3AF' : warn ? '#F97316' : '#10B981'
  const badgeClass = breached
    ? 'bg-red-100 text-red-700'
    : (resolved && !breached)
    ? 'bg-green-100 text-green-700'
    : paused
    ? 'bg-gray-100 text-gray-500'
    : warn
    ? 'bg-orange-100 text-orange-700'
    : 'bg-green-100 text-green-700'

  return (
    <div className={`card space-y-3 ${warn ? 'ring-1 ring-orange-300' : breached ? 'ring-1 ring-red-300' : ''}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 text-sm">SLA</h3>
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold ${badgeClass}`}>
          {resolved && !breached && <>✓ Cumplido</>}
          {breached && <><AlertTriangle size={11} /> Vencido</>}
          {!resolved && paused && !breached && '⏸ Pausado'}
          {warn && <><span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" /> Vence en {fmtSlaRemaining(remaining_min)}</>}
          {!paused && !breached && !warn && <>✓ {fmtSlaRemaining(remaining_min)}</>}
        </span>
      </div>

      {/* Barra de progreso */}
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>

      {warn && !paused && (
        <p className="text-xs text-orange-600 font-medium flex items-center gap-1">
          <AlertTriangle size={11} /> Este ticket está próximo a vencer su SLA
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
        <div>
          <p className="text-gray-400">Prioridad</p>
          <p className="font-medium text-gray-700">{PRIORITY_LABELS[ticket.priority]}</p>
        </div>
        <div>
          <p className="text-gray-400">Vencimiento</p>
          <p className={`font-medium ${breached ? 'text-red-600' : warn ? 'text-orange-600' : 'text-gray-700'}`}>
            {fmtDT(deadline)}
          </p>
        </div>
      </div>

      {resolved && (
        <p className="text-xs text-green-600 italic">
          Ticket resuelto — el contador SLA está finalizado.
        </p>
      )}
      {paused && !resolved && (
        <p className="text-xs text-gray-400 italic">
          El contador está pausado. Se reanudará al cambiar el estado.
        </p>
      )}
    </div>
  )
}
