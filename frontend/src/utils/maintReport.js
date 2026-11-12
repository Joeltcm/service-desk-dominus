// Informe técnico de mantenimiento: un solo documento HTML (branding Dominus Tech)
// que sirve para vista previa, descarga y adjunto del correo al cliente.
import { companyLogoSrc } from './branding'
import { fmtPanama, parseEquipment, MAINT_TYPES } from './maintenance'

export const DEFAULT_CHECKLIST = {
  preventivo: [
    'Limpieza general de equipos',
    'Revisión de funcionamiento',
    'Verificación eléctrica y conexiones',
    'Actualización de software / firmware',
    'Prueba de operación final',
  ],
  correctivo: [
    'Diagnóstico de la falla',
    'Reparación o reemplazo realizado',
    'Prueba de funcionamiento',
  ],
}

// Checklist guardado, o la plantilla por tipo de mantenimiento si aún no hay.
export function checklistFor(report) {
  if (Array.isArray(report.checklist) && report.checklist.length) return report.checklist
  const tpl = DEFAULT_CHECKLIST[(report.maint_type || '').toLowerCase()] || DEFAULT_CHECKLIST.preventivo
  return tpl.map((task) => ({ task, done: false }))
}

// Descarga las fotos (adjuntos de imagen) como data URL para incrustarlas en el informe.
export async function fetchImageMap(ticketId, attachments) {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token')
  const map = {}
  for (const a of attachments) {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/attachments/${a.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) continue
      const blob = await res.blob()
      map[a.id] = await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.readAsDataURL(blob)
      })
    } catch { /* foto omitida si falla la descarga */ }
  }
  return map
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('-') : '—')
const nl2br = (s) => (s ? esc(s).replace(/\n/g, '<br>') : '<span style="color:#94a3b8">—</span>')

const CSS = `
  *{box-sizing:border-box} body{margin:0;background:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1e293b;font-size:12px;line-height:1.5}
  .page{padding:28px 32px;max-width:820px;margin:0 auto}
  .head{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #0d9488;padding-bottom:12px;margin-bottom:18px}
  .brand{display:flex;align-items:center;gap:10px}
  .brand img{width:42px;height:42px;border-radius:8px;object-fit:cover}
  .brand b{font-size:15px;color:#0f172a;display:block}
  .brand span{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
  .folio{text-align:right}
  .folio b{display:block;font-size:16px;color:#0d9488}
  .folio span{font-size:10px;color:#64748b}
  h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#0d9488;margin:18px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  table{width:100%;border-collapse:collapse}
  td{padding:6px 8px;vertical-align:top;border-bottom:1px solid #f1f5f9}
  td.k{width:30%;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:8px}
  .chk{display:flex;align-items:center;gap:8px;padding:3px 0}
  .mark{width:16px;height:16px;border:1.5px solid #94a3b8;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}
  .mark.on{background:#0d9488;border-color:#0d9488;color:#fff}
  .photos{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .photo{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;page-break-inside:avoid}
  .photo img{width:100%;height:200px;object-fit:cover;display:block}
  .photo p{margin:0;padding:6px 8px;font-size:10px;color:#64748b}
  .sign{display:flex;gap:18px;align-items:flex-end}
  .sign img{height:90px;border-bottom:1px solid #94a3b8;max-width:280px}
  .foot{margin-top:22px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between}
  @page{size:A4;margin:0}
  @media print{ .page{padding:14mm 12mm} }
`

// Construye el documento. Devuelve { bodyHtml, fullHtml, title, filename }.
export function buildMaintReportDocument({ report, photos = [], company = 'Dominus Tech', logoUrl }) {
  const folio = report.folio || `Ticket-${report.id}`
  const tipo = MAINT_TYPES.find((m) => m.value === (report.maint_type || '').toLowerCase())?.label || 'Sin tipo'
  const equipos = (Array.isArray(report.equipment) ? report.equipment : parseEquipment(report.equipment))
  const checklist = checklistFor(report)
  const logo = logoUrl || companyLogoSrc(typeof window !== 'undefined' ? window.location.origin : '')
  const generado = fmtPanama(new Date().toISOString())

  const equipoRows = equipos.length
    ? equipos.map((e) => `<tr><td>${esc(e.type)}</td><td style="text-align:right;font-weight:600">× ${esc(e.qty)}</td></tr>`).join('')
    : '<tr><td colspan="2" style="color:#94a3b8">Sin detalle de equipos</td></tr>'

  const checkRows = checklist.map((c) =>
    `<div class="chk"><span class="mark ${c.done ? 'on' : ''}">${c.done ? '✓' : ''}</span>${esc(c.task)}</div>`
  ).join('')

  const photoBlock = photos.length
    ? `<div class="photos">${photos.map((p) => `<div class="photo"><img src="${p.dataUrl}" alt=""><p>${esc(p.name || '')}</p></div>`).join('')}</div>`
    : '<p style="color:#94a3b8">Sin fotos adjuntas.</p>'

  const signBlock = report.client_signature
    ? `<div class="sign"><img src="${report.client_signature}" alt="Firma"><div><b>${esc(report.client_sign_name || report.contact?.name || '')}</b><br><span style="color:#64748b;font-size:11px">Conformidad · ${esc(fmtPanama(report.client_sign_at))}</span></div></div>`
    : '<p style="color:#94a3b8">Sin firma de conformidad.</p>'

  const range = report.confirmed_start
    ? `${fmtPanama(report.confirmed_start)} → ${fmtPanama(report.confirmed_end)}`
    : '—'

  const bodyHtml = `
  <div class="page">
    <div class="head">
      <div class="brand">
        <img src="${logo}" alt="" onerror="this.style.display='none'">
        <div><b>${esc(company)}</b><span>Informe técnico de mantenimiento</span></div>
      </div>
      <div class="folio"><b>${esc(folio)}</b><span>Generado ${esc(generado)}</span></div>
    </div>

    <h2>Datos del servicio</h2>
    <table>
      <tr><td class="k">Cliente</td><td>${esc(report.client?.name)}${report.client?.company ? ` · ${esc(report.client.company)}` : ''}</td></tr>
      <tr><td class="k">Contacto</td><td>${esc(report.contact?.name || '—')} · ${esc(report.contact?.phone || '')} · ${esc(report.contact?.email || '')}</td></tr>
      <tr><td class="k">Ubicación</td><td>${esc(report.location || '—')}</td></tr>
      <tr><td class="k">Tipo</td><td>${esc(tipo)}</td></tr>
      <tr><td class="k">Atención</td><td>${esc(range)}</td></tr>
      <tr><td class="k">Técnico</td><td>${esc(report.technician || '—')}</td></tr>
      <tr><td class="k">Ticket</td><td>#${esc(report.id)} · ${esc(report.title || '')}</td></tr>
    </table>

    <h2>Flota de equipos</h2>
    <table>${equipoRows}</table>

    <h2>Trabajo realizado</h2>
    <div class="box">${nl2br(report.work_done)}</div>

    <h2>Observaciones</h2>
    <div class="box">${nl2br(report.observations)}</div>

    <h2>Recomendaciones</h2>
    <div class="box">${nl2br(report.recommendations)}</div>

    <h2>Checklist</h2>
    <div class="box">${checkRows}</div>

    <h2>Evidencia fotográfica</h2>
    ${photoBlock}

    <h2>Conformidad del cliente</h2>
    ${signBlock}

    <div class="foot"><span>${esc(company)} · ${esc(folio)}</span><span>Documento generado automáticamente</span></div>
  </div>`

  const fullHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(folio)}</title><style>${CSS}</style></head><body>${bodyHtml}</body></html>`
  return { bodyHtml: `<style>${CSS}</style>${bodyHtml}`, fullHtml, title: `Informe ${folio}`, filename: `${folio}.pdf` }
}
