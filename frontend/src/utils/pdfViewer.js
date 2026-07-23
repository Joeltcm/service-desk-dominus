import { companyLogoSrc } from './branding'

const viewerFragment = () => `<style>
#pdf-bar{position:fixed;top:0;left:0;right:0;z-index:9999;background:#0f172a;
  padding:10px 20px;display:flex;align-items:center;justify-content:space-between;
  gap:10px;font-family:system-ui,sans-serif;box-shadow:0 2px 16px rgba(0,0,0,.5);flex-wrap:wrap}
#pdf-bar-left{display:flex;align-items:center;gap:10px}
#pdf-bar-logo{width:30px;height:30px;border-radius:6px;object-fit:cover;background:#1e3a5f}
#pdf-bar-title{color:#e2e8f0;font-size:13px;font-weight:600;letter-spacing:.2px}
#pdf-bar-hint{color:#64748b;font-size:11px;margin-top:1px}
#pdf-bar-sp{height:60px}
@media print{#pdf-bar,#pdf-bar-sp{display:none!important}}
@media(max-width:520px){#pdf-bar{padding:8px 12px}#pdf-bar-hint{display:none}#pdf-bar-sp{height:68px}}
</style>
<div id="pdf-bar">
  <div id="pdf-bar-left">
    <img id="pdf-bar-logo" src="${companyLogoSrc()}" alt="Logo" onerror="this.style.display='none'">
    <div>
      <div id="pdf-bar-title">Vista previa del documento</div>
      <div id="pdf-bar-hint">En el di&aacute;logo de impresi&oacute;n selecciona &ldquo;Guardar como PDF&rdquo;</div>
    </div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
    <button onclick="window.print()" style="background:#16a34a;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:700;min-height:44px;touch-action:manipulation;display:flex;align-items:center;gap:6px">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Guardar PDF
    </button>
    <button onclick="window.close()" style="background:#334155;color:#e2e8f0;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;min-height:44px;touch-action:manipulation">&times; Cerrar</button>
  </div>
</div>
<div id="pdf-bar-sp"></div>`

// Shared html2pdf options — scrollX/scrollY/windowWidth fix blank output on iOS Safari
const _HTML2PDF_OPTS = {
  margin: [14, 12, 14, 12],
  image: { type: 'jpeg', quality: 0.85 },
  html2canvas: { scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0, windowWidth: 794 },
  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
}

function _showBanner(msg) {
  const el = document.createElement('div')
  el.id = '__pdf-gen-banner'
  el.style.cssText =
    'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;' +
    'background:#0f172a;color:#e2e8f0;padding:13px 24px;border-radius:12px;' +
    'font-size:14px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.5);' +
    'font-family:system-ui,sans-serif;white-space:nowrap;pointer-events:none'
  el.textContent = msg
  document.body.appendChild(el)
  return el
}

/**
 * Builds an off-screen rendering container that iOS Safari will actually render.
 * Uses position:fixed at (0,0) so it's within the viewport (iOS skips truly off-screen elements),
 * covered by an opaque white overlay so the user doesn't see it.
 * Returns { container, cleanup }.
 */
function _buildPdfContainer(parsedDoc, { stripToolbar = false } = {}) {
  const styles = Array.from(parsedDoc.querySelectorAll('style'))
    .map(s => s.textContent).join('\n')

  // Overlay sits on top of the container, hiding it from the user while html2canvas renders it
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:9998;pointer-events:none'
  document.body.appendChild(overlay)

  const container = document.createElement('div')
  container.style.cssText =
    'position:fixed;left:0;top:0;width:794px;background:#fff;' +
    'color:#000;font-family:system-ui,sans-serif;font-size:13px;line-height:1.5;z-index:9997'

  if (styles) {
    const s = document.createElement('style')
    s.textContent = styles
    container.appendChild(s)
  }

  const bodyClone = parsedDoc.body.cloneNode(true)
  if (stripToolbar) {
    bodyClone.querySelector('#pdf-bar')?.remove()
    bodyClone.querySelector('#pdf-bar-sp')?.remove()
  }
  Array.from(bodyClone.childNodes).forEach(n => container.appendChild(document.importNode(n, true)))
  document.body.appendChild(container)

  return { container, cleanup: () => { overlay.remove(); container.remove() } }
}

// On mobile: render HTML off-screen and download as PDF via html2pdf.js (html2canvas + jsPDF).
// Returns a Promise (truthy value), so callers' `if (!ok)` checks won't fire false positives.
function _downloadMobilePdf(html, filename = 'documento.pdf') {
  return (async () => {
    const banner = _showBanner('⏳ Generando PDF…')
    const parsedDoc = new DOMParser().parseFromString(html, 'text/html')
    const { container, cleanup } = _buildPdfContainer(parsedDoc, { stripToolbar: true })

    try {
      const { default: html2pdf } = await import('html2pdf.js')
      await html2pdf().set({ ..._HTML2PDF_OPTS, filename }).from(container).save()
    } catch (err) {
      console.error('[pdfViewer] Error al generar PDF:', err)
      alert('Error al generar el PDF. Por favor intenta de nuevo.')
    } finally {
      banner.remove()
      cleanup()
    }
  })()
}

function openBlob(html) {
  const pw = window.open('', '_blank')
  if (!pw) return false
  pw.document.open()
  pw.document.write(html)
  pw.document.close()
  return true
}

/**
 * Opens a PDF window from a body HTML fragment.
 * All platforms use document.write into a new window (avoids blob URL service-worker
 * interception and html2pdf.js compatibility issues on mobile).
 * The viewer toolbar's "Guardar PDF" button calls window.print() which on
 * iOS/Android triggers the native Print → Save as PDF flow.
 * autoprint=true → auto-triggers print dialog after render.
 * autoprint=false → shows viewer toolbar with manual print button.
 */
export function openPdfWindow(title, bodyHtml, { autoprint = false, extraCss = '' } = {}) {
  const BASE_CSS = `*{box-sizing:border-box}body{margin:0;background:#f1f5f9;font-family:system-ui,sans-serif}@page{size:A4;margin:0}@media print{body{padding:14mm 12mm;background:white}}${extraCss}`

  if (autoprint) {
    const pw = window.open('', '_blank', 'width=900,height=700')
    if (!pw) return false
    pw.document.open()
    // window.print() runs from INSIDE the popup so iOS prints the popup content,
    // not the parent page. afterprint closes the popup on all platforms.
    pw.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=794"><title>${title}</title>
<style>${BASE_CSS}</style></head><body>${bodyHtml}<script>setTimeout(function(){window.print();window.addEventListener('afterprint',function(){window.close()},{once:true})},500)<\/script></body></html>`)
    pw.document.close()
    pw.focus()
    return true
  }

  return openBlob(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=794"><title>${title}</title>
<style>${BASE_CSS}</style></head><body>${viewerFragment()}<div id="pdf-main">${bodyHtml}</div></body></html>`)
}

export async function downloadPedidoPDF(d, items, co, logoUrl, filename = 'pedido.pdf') {
  const banner = _showBanner('⏳ Generando PDF…')
  try {
    const { default: jsPDF } = await import('jspdf')

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const W = doc.internal.pageSize.getWidth()
    const M = 14
    const CW = W - M * 2

    const navy  = [30, 58, 95]
    const gray6 = [107, 114, 128]
    const gray2 = [229, 231, 235]
    const bgRow = [248, 249, 251]
    const white = [255, 255, 255]

    const rgb = (arr) => ({ r: arr[0], g: arr[1], b: arr[2] })
    const setFill  = (arr) => doc.setFillColor(arr[0], arr[1], arr[2])
    const setDraw  = (arr) => doc.setDrawColor(arr[0], arr[1], arr[2])
    const setColor = (arr) => doc.setTextColor(arr[0], arr[1], arr[2])

    const fmtMoney = (n) => `$${Number(n || 0).toFixed(2)}`
    const fmtD = (iso) => {
      if (!iso) return ''
      try { return new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('es-PA', { day:'2-digit', month:'short', year:'numeric' }) } catch { return iso }
    }
    const calcTotals = () => {
      const sub = items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0), 0)
      const itbms = d.itbms_enabled ? sub * 0.07 : 0
      return { sub, itbms, total: sub + itbms }
    }

    const coName    = co.company_name    || 'Service Desk'
    const coAddress = co.company_address || 'Panamá'
    const coRuc     = co.company_ruc     || ''

    // ── Logo ──────────────────────────────────────────────────
    let logoLoaded = false
    try {
      const resp = await fetch(logoUrl)
      if (resp.ok) {
        const blob = await resp.blob()
        const dataUrl = await new Promise((res) => {
          const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob)
        })
        const ext = (blob.type.split('/')[1] || 'png').toUpperCase().replace('JPEG','JPG')
        doc.addImage(dataUrl, ext, M, M, 16, 16)
        logoLoaded = true
      }
    } catch (_) {}

    // ── Header ────────────────────────────────────────────────
    const logoRight = logoLoaded ? M + 20 : M
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); setColor(navy)
    doc.text(coName, logoRight, M + 5)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setColor(gray6)
    doc.text(coAddress, logoRight, M + 10)
    if (coRuc) doc.text(`RUC: ${coRuc}`, logoRight, M + 14)

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setColor(navy)
    doc.text('PEDIDO', W - M, M + 5, { align: 'right' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setColor([68, 68, 68])
    doc.text(`N° ${d.dispatch_number || d.id}`, W - M, M + 11, { align: 'right' })

    const divY = M + 20
    setDraw(navy); doc.setLineWidth(0.7)
    doc.line(M, divY, W - M, divY)

    // ── Metadata grid ─────────────────────────────────────────
    let y = divY + 6
    const meta = [
      d.client_name    && ['Cliente',   d.client_name],
      d.client_ruc     && ['RUC',       d.client_ruc],
      d.client_address && ['Dirección', d.client_address],
      d.date           && ['Fecha',     fmtD(d.date)],
      d.delivery_date  && ['Entrega',   fmtD(d.delivery_date)],
                          ['Estado',    d.status],
    ].filter(Boolean)

    const cols = 3
    const cellW = CW / cols
    const cellH = 10
    meta.forEach((pair, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x  = M + col * cellW
      const cy = y + row * (cellH + 2)
      setFill(bgRow); setDraw(gray2); doc.setLineWidth(0.3)
      doc.roundedRect(x, cy, cellW - 1, cellH, 1.5, 1.5, 'FD')
      doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); setColor(gray6)
      doc.text(pair[0].toUpperCase(), x + 3, cy + 3.5)
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor([17, 17, 17])
      doc.text(doc.splitTextToSize(String(pair[1]), cellW - 6)[0], x + 3, cy + 7.5)
    })

    const metaRows = Math.ceil(meta.length / cols)
    y += metaRows * (cellH + 2) + 4

    // ── Items table (manual) ──────────────────────────────────
    const tableItems = items.filter((it) => it.description?.trim())
    const tHead = ['#', 'Descripción', 'Cant.', 'Precio unit.', 'Subtotal']
    const tBody = tableItems.map((it, i) => {
      const line = (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0)
      return [String(i + 1), it.description || '', String(it.qty || ''), fmtMoney(it.unit_price), fmtMoney(line)]
    })
    const colW   = [8, CW - 76, 16, 26, 26]
    const rowH   = 7
    const cPad   = 2.5
    const hAligns = ['center', 'left', 'center', 'right', 'right']

    const _tx = (ci, cx) => hAligns[ci] === 'center' ? cx + colW[ci] / 2
                           : hAligns[ci] === 'right'  ? cx + colW[ci] - cPad
                           : cx + cPad

    // Header row
    setFill(navy); let cx = M
    colW.forEach(w => { doc.rect(cx, y, w, rowH, 'F'); cx += w })
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setColor(white)
    cx = M
    tHead.forEach((cell, ci) => {
      doc.text(cell, _tx(ci, cx), y + 4.8, { align: hAligns[ci] })
      cx += colW[ci]
    })
    y += rowH

    // Body rows
    let tableEndY = y
    tBody.forEach((row, ri) => {
      setFill(ri % 2 === 1 ? bgRow : white); setDraw(gray2); doc.setLineWidth(0.3)
      cx = M; colW.forEach(w => { doc.rect(cx, y, w, rowH, 'FD'); cx += w })
      doc.setFontSize(9); setColor([17, 17, 17])
      cx = M
      row.forEach((cell, ci) => {
        doc.setFont('helvetica', ci === 4 ? 'bold' : 'normal')
        doc.text(String(cell ?? ''), _tx(ci, cx), y + 5, { align: hAligns[ci] })
        cx += colW[ci]
      })
      y += rowH
      tableEndY = y
    })

    // ── Totals ────────────────────────────────────────────────
    const { sub, itbms, total } = calcTotals()
    const totY = tableEndY + 4
    const tW   = 60
    const tX   = W - M - tW

    const drawTotal = (label, val, by, bold, textColor, bg) => {
      setFill(bg); setDraw(gray2); doc.setLineWidth(0.3)
      doc.rect(tX, by, tW, 7, 'FD')
      doc.setFontSize(9); doc.setFont('helvetica', bold ? 'bold' : 'normal'); setColor(textColor)
      doc.text(label, tX + 3, by + 4.8)
      doc.text(val, tX + tW - 3, by + 4.8, { align: 'right' })
    }
    drawTotal('Subtotal', fmtMoney(sub), totY, false, [17,17,17], bgRow)
    let nextY = totY + 7
    if (d.itbms_enabled) {
      drawTotal('ITBMS 7%', fmtMoney(itbms), nextY, false, [180,83,9], [255,251,235])
      nextY += 7
    }
    drawTotal('TOTAL', fmtMoney(total), nextY, true, white, navy)

    // ── Notes ─────────────────────────────────────────────────
    if (d.notes) {
      const nY = nextY + 12
      setFill(bgRow); setDraw(gray2); doc.setLineWidth(0.3)
      const noteLines = doc.splitTextToSize(d.notes, CW - 6)
      doc.rect(M, nY, CW, 6 + noteLines.length * 4.5, 'FD')
      doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); setColor([68,68,68])
      doc.text('OBSERVACIONES:', M + 3, nY + 4.5)
      doc.setFont('helvetica', 'normal'); setColor([17,17,17])
      doc.text(noteLines, M + 3, nY + 9)
    }

    // ── Signatures ────────────────────────────────────────────
    const sigY = doc.internal.pageSize.getHeight() - 30
    setDraw(gray2); doc.setLineWidth(0.4)
    const half = CW / 2 - 8
    doc.line(M, sigY, M + half, sigY)
    doc.line(M + half + 16, sigY, W - M, sigY)
    doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); setColor([51,51,51])
    doc.text('Firma del Responsable', M + half / 2, sigY + 4, { align: 'center' })
    doc.text('Firma del Receptor', M + half + 16 + half / 2, sigY + 4, { align: 'center' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setColor(gray6)
    doc.text(coName, M + half / 2, sigY + 8, { align: 'center' })
    if (d.client_name) doc.text(d.client_name, M + half + 16 + half / 2, sigY + 8, { align: 'center' })

    // ── Footer ────────────────────────────────────────────────
    const fY = doc.internal.pageSize.getHeight() - 8
    setDraw(gray2); doc.setLineWidth(0.3)
    doc.line(M, fY - 3, W - M, fY - 3)
    doc.setFontSize(7); setColor([170,170,170])
    doc.text(`${coName} • ${coAddress}${coRuc ? ` • RUC: ${coRuc}` : ''} • N° ${d.dispatch_number || d.id}`, W / 2, fY, { align: 'center' })

    doc.save(filename)
  } catch (err) {
    console.error('[pdfViewer] Error al generar PDF:', err)
  } finally {
    banner.remove()
  }
}

/**
 * Generates a PDF from a body HTML fragment and shares it via the Web Share API.
 * Falls back to triggering a file download if sharing is not supported.
 * Returns true if the share sheet was opened, false on fallback or error.
 */
export async function sharePdfFromHtml(title, bodyHtml, filename = 'documento.pdf') {
  const BASE_CSS = `*{box-sizing:border-box}body{margin:0;background:#fff;font-family:system-ui,sans-serif}@page{size:A4;margin:0}@media print{body{padding:14mm 12mm}}`
  const parsedDoc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>${bodyHtml}</body></html>`,
    'text/html'
  )
  const { container, cleanup } = _buildPdfContainer(parsedDoc)

  try {
    const { default: html2pdf } = await import('html2pdf.js')
    const pdfBlob = await html2pdf().set({ ..._HTML2PDF_OPTS, filename }).from(container).outputPdf('blob')
    const file = new File([pdfBlob], filename, { type: 'application/pdf' })

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title, files: [file] })
      return true
    }
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    return false
  } catch (err) {
    if (err.name !== 'AbortError') console.error('[pdfViewer] Error al compartir PDF:', err)
    return false
  } finally {
    cleanup()
  }
}

/**
 * Generates a PDF from a body HTML fragment and returns it as a base64 string.
 * Used to attach the frontend-generated PDF to email requests.
 * Returns null on failure (caller should send email without attachment).
 */
export async function generatePdfBase64(bodyHtml, filename = 'documento.pdf') {
  const BASE_CSS = `*{box-sizing:border-box}body{margin:0;background:#fff}@page{size:A4;margin:0}@media print{body{padding:14mm 12mm}}`
  const parsedDoc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>${bodyHtml}</body></html>`,
    'text/html'
  )
  const { container, cleanup } = _buildPdfContainer(parsedDoc)
  try {
    const { default: html2pdf } = await import('html2pdf.js')
    const dataUri = await html2pdf().set({ ..._HTML2PDF_OPTS, filename }).from(container).outputPdf('datauristring')
    return dataUri.split(',')[1] ?? null
  } catch (err) {
    console.error('[pdfViewer] Error al generar PDF base64:', err)
    return null
  } finally {
    cleanup()
  }
}

/**
 * Like sharePdfFromHtml but accepts a complete HTML document string (e.g. from buildReportHTML).
 * Strips viewer toolbar elements before rendering to avoid them appearing in the PDF.
 */
export async function sharePdfFromFullHtml(title, fullHtml, filename = 'documento.pdf') {
  const parsedDoc = new DOMParser().parseFromString(fullHtml, 'text/html')
  const { container, cleanup } = _buildPdfContainer(parsedDoc, { stripToolbar: true })

  try {
    const { default: html2pdf } = await import('html2pdf.js')
    const pdfBlob = await html2pdf().set({ ..._HTML2PDF_OPTS, filename }).from(container).outputPdf('blob')
    const file = new File([pdfBlob], filename, { type: 'application/pdf' })

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title, files: [file] })
      return true
    }
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    return false
  } catch (err) {
    if (err.name !== 'AbortError') console.error('[pdfViewer] Error al compartir:', err)
    return false
  } finally {
    cleanup()
  }
}

/**
 * Writes a PDF viewer into an already-open window (e.g. one pre-opened in sync context on iOS).
 * Returns false if the window is null or closed.
 */
export function writePdfViewerToWindow(win, fullHtml) {
  if (!win || win.closed) return false
  const htmlWithViewer = fullHtml
    .replace(/<body([^>]*)>/, `<body$1>\n${viewerFragment()}\n<div id="pdf-main">`)
    .replace(/<\/body>/, '</div></body>')
  win.document.open()
  win.document.write(htmlWithViewer)
  win.document.close()
  win.focus()
  return true
}

/**
 * Opens a PDF viewer from a fully-built HTML string (e.g. TicketDetail).
 * All platforms use document.write into a new window.
 * Injects the viewer toolbar into the existing <body>.
 */
export function openPdfViewerFromHtml(fullHtml, { autoprint = false, delay = 400 } = {}) {
  if (autoprint) {
    const pw = window.open('', '_blank', 'width=850,height=700')
    if (!pw) return false
    pw.document.open()
    pw.document.write(fullHtml)
    pw.document.close()
    pw.focus()
    setTimeout(() => { pw.print(); pw.close() }, delay)
    return true
  }

  const htmlWithViewer = fullHtml
    .replace(/<body([^>]*)>/, `<body$1>\n${viewerFragment()}\n<div id="pdf-main">`)
    .replace(/<\/body>/, '</div></body>')
  return openBlob(htmlWithViewer)
}
