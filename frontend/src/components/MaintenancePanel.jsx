import React, { useEffect, useMemo, useState } from 'react'
import { Wrench, FileText, Download, Send, Save, Camera, Eye, CheckSquare, Square, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { getMaintReport, saveMaintReport, emailMaintReport, getAttachments, uploadAttachment } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import SignaturePad from './SignaturePad'
import { buildMaintReportDocument, checklistFor, fetchImageMap } from '../utils/maintReport'
import { openPdfViewerFromHtml, sharePdfFromFullHtml, generatePdfBase64 } from '../utils/pdfViewer'
import { MAINT_TYPES, fmtPanama, parseEquipment } from '../utils/maintenance'
import { useMaintFeatures, featureOn } from '../utils/maintFeatures'

// Miniatura de un adjunto: <img> no envía el token, así que se descarga con fetch.
function AuthThumb({ ticketId, attId, alt }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let url
    const token = localStorage.getItem('token') || sessionStorage.getItem('token')
    fetch(`/api/tickets/${ticketId}/attachments/${attId}/download`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b) { url = URL.createObjectURL(b); setSrc(url) } })
      .catch(() => {})
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [ticketId, attId])
  if (!src) return <div className="w-full h-20 bg-gray-100 animate-pulse" />
  return <img src={src} alt={alt} className="w-full h-20 object-cover" />
}

const isImage = (a) => (a.content_type || '').startsWith('image/')

// Panel de mantenimiento en el detalle del ticket: datos del servicio + informe técnico.
// Staff: edita informe, checklist, fotos y firma; genera PDF y lo envía al cliente.
// Cliente: descarga su informe cuando ya existe.
export default function MaintenancePanel({ ticket, onChanged }) {
  const { isAgentOrAdmin } = useAuth()
  const { company_name } = useCompany()
  const staff = isAgentOrAdmin
  const mf = useMaintFeatures()
  const reportOn = featureOn(mf, 'tech_report')
  const checklistOn = featureOn(mf, 'checklist')
  const signatureOn = featureOn(mf, 'client_signature')

  const [report, setReport] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [form, setForm] = useState({ work_done: '', observations: '', recommendations: '', checklist: [], client_sign_name: '' })
  const [signature, setSignature] = useState(null)
  const [includePhoto, setIncludePhoto] = useState({})
  const [busy, setBusy] = useState(null) // 'save' | 'preview' | 'download' | 'email' | 'upload'
  const [dirty, setDirty] = useState(false)

  const load = () => {
    getMaintReport(ticket.id).then((r) => {
      setReport(r.data)
      setForm({
        work_done: r.data.work_done || '',
        observations: r.data.observations || '',
        recommendations: r.data.recommendations || '',
        checklist: checklistFor(r.data),
        client_sign_name: r.data.client_sign_name || r.data.contact?.name || '',
      })
      setSignature(r.data.client_signature || null)
      setDirty(false)
    }).catch(() => {})
    getAttachments(ticket.id).then((r) => setAttachments((r.data || []).filter(isImage))).catch(() => {})
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ticket.id])

  const tipo = useMemo(() => MAINT_TYPES.find((m) => m.value === (ticket.maint_type || '').toLowerCase())?.label, [ticket.maint_type])
  const equipos = parseEquipment(ticket.maint_equipment)
  const hasFolio = !!report?.folio && reportOn
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true) }

  // ── Guardar informe (asigna folio la primera vez) ──
  const save = async () => {
    setBusy('save')
    try {
      const r = await saveMaintReport(ticket.id, {
        work_done: form.work_done,
        observations: form.observations,
        recommendations: form.recommendations,
        checklist: checklistOn ? JSON.stringify(form.checklist) : null,
        client_signature: signatureOn && signature && signature !== report?.client_signature ? signature : null,
        client_sign_name: form.client_sign_name || null,
      })
      setReport(r.data)
      setSignature(r.data.client_signature || null)
      setDirty(false)
      toast.success(`Informe guardado · ${r.data.folio}`)
      onChanged?.()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error al guardar el informe')
    } finally { setBusy(null) }
  }

  // ── PDF: arma el documento con fotos seleccionadas ──
  const buildDoc = async () => {
    const chosen = attachments.filter((a) => includePhoto[a.id] !== false)
    const map = await fetchImageMap(ticket.id, chosen)
    const photos = chosen.filter((a) => map[a.id]).map((a) => ({ name: a.original_name, dataUrl: map[a.id] }))
    return buildMaintReportDocument({ report: { ...report, title: ticket.title, id: ticket.id, maint_type: ticket.maint_type, equipment: equipos, location: ticket.location }, photos, company: company_name || 'Dominus Tech' })
  }

  const ensureSaved = () => {
    if (!hasFolio || dirty) { toast.error('Guarda el informe antes de generar el PDF'); return false }
    return true
  }

  const preview = async () => {
    if (!ensureSaved()) return
    setBusy('preview')
    try {
      const doc = await buildDoc()
      // Si el navegador bloquea la ventana emergente, se descarga el PDF en su lugar.
      const opened = openPdfViewerFromHtml(doc.fullHtml)
      if (!opened) {
        toast('El navegador bloqueó la vista previa. Descargando el informe…')
        await sharePdfFromFullHtml(doc.title, doc.fullHtml, doc.filename)
      }
    } catch { toast.error('No se pudo generar la vista previa') }
    finally { setBusy(null) }
  }

  const download = async () => {
    if (!ensureSaved()) return
    setBusy('download')
    try { const doc = await buildDoc(); await sharePdfFromFullHtml(doc.title, doc.fullHtml, doc.filename) }
    catch { toast.error('No se pudo generar el PDF') }
    finally { setBusy(null) }
  }

  const sendToClient = async () => {
    if (!ensureSaved()) return
    if (!ticket.maint_contact_email) return toast.error('El mantenimiento no tiene correo de contacto')
    setBusy('email')
    try {
      const doc = await buildDoc()
      const b64 = await generatePdfBase64(doc.bodyHtml, doc.filename)
      if (!b64) throw new Error('pdf')
      const r = await emailMaintReport(ticket.id, b64)
      toast.success(r.data?.message || 'Informe enviado al contacto')
      onChanged?.()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'No se pudo enviar el informe')
    } finally { setBusy(null) }
  }

  // ── Fotos: se suben como adjuntos del ticket ──
  const onPickPhotos = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setBusy('upload')
    try {
      for (const f of files) await uploadAttachment(ticket.id, f)
      toast.success(`${files.length} foto(s) adjuntada(s)`)
      getAttachments(ticket.id).then((r) => setAttachments((r.data || []).filter(isImage)))
    } catch { toast.error('Error al subir las fotos') }
    finally { setBusy(null) }
  }

  const toggleTask = (i) => set('checklist', form.checklist.map((c, idx) => (idx === i ? { ...c, done: !c.done } : c)))

  const range = ticket.maint_confirmed_start
    ? `${fmtPanama(ticket.maint_confirmed_start)} → ${fmtPanama(ticket.maint_confirmed_end)}`
    : 'Pendiente de confirmar'

  return (
    <div className="card space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2"><Wrench size={14} className="text-teal-600" /> Mantenimiento{tipo ? ` · ${tipo}` : ''}</h2>
          <p className="text-sm text-gray-600 mt-1">{range}</p>
        </div>
        {hasFolio && <span className="text-xs px-2.5 py-1 rounded-full border border-teal-200 bg-teal-50 text-teal-700 font-semibold">{report.folio}</span>}
      </div>

      {equipos.length > 0 && (
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Flota</p>
          <ul className="text-sm text-gray-700 space-y-0.5">
            {equipos.map((e, i) => <li key={i} className="flex justify-between"><span>{e.type}</span><span className="font-semibold">× {e.qty}</span></li>)}
          </ul>
        </div>
      )}

      {/* ── Vista del cliente: solo descarga ── */}
      {!staff && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-gray-600">{hasFolio ? 'Tu informe técnico ya está disponible.' : 'El informe técnico estará disponible al completar el servicio.'}</p>
          {hasFolio && reportOn && (
            <div className="flex gap-2">
              <button onClick={preview} disabled={!!busy} className="btn-secondary text-sm flex items-center gap-1.5"><Eye size={14} /> Ver</button>
              <button onClick={download} disabled={!!busy} className="btn-primary text-sm flex items-center gap-1.5"><Download size={14} /> Descargar PDF</button>
            </div>
          )}
        </div>
      )}

      {/* ── Vista del técnico/staff: editor del informe ── */}
      {staff && !reportOn && <p className="text-sm text-gray-400">El informe técnico está desactivado en la configuración del sistema.</p>}
      {staff && reportOn && report && (
        <>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Trabajo realizado</label>
              <textarea className="input w-full h-24 resize-none" value={form.work_done} onChange={(e) => set('work_done', e.target.value)} style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Observaciones</label>
              <textarea className="input w-full h-20 resize-none" value={form.observations} onChange={(e) => set('observations', e.target.value)} style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Recomendaciones</label>
              <textarea className="input w-full h-20 resize-none" value={form.recommendations} onChange={(e) => set('recommendations', e.target.value)} style={{ fontSize: '16px' }} />
            </div>
          </div>

          {checklistOn && <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Checklist</p>
            <div className="space-y-1.5">
              {form.checklist.map((c, i) => (
                <button key={i} type="button" onClick={() => toggleTask(i)} className="w-full flex items-center gap-2 text-left text-sm text-gray-700 hover:bg-gray-50 rounded-md px-2 py-1.5">
                  {c.done ? <CheckSquare size={16} className="text-teal-600 flex-shrink-0" /> : <Square size={16} className="text-gray-300 flex-shrink-0" />}
                  <span className={c.done ? 'line-through text-gray-400' : ''}>{c.task}</span>
                </button>
              ))}
            </div>
          </div>}

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-600">Fotos del informe</p>
              <label className="btn-secondary text-xs flex items-center gap-1.5 cursor-pointer">
                {busy === 'upload' ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} Adjuntar fotos
                <input type="file" accept="image/*" multiple className="hidden" onChange={onPickPhotos} disabled={!!busy} />
              </label>
            </div>
            {attachments.length === 0 && <p className="text-xs text-gray-400">Adjunta fotos del trabajo para incluirlas en el informe.</p>}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {attachments.map((a) => {
                const on = includePhoto[a.id] !== false
                return (
                  <label key={a.id} className={`relative rounded-lg overflow-hidden border-2 cursor-pointer ${on ? 'border-teal-500' : 'border-gray-200 opacity-60'}`}>
                    <AuthThumb ticketId={ticket.id} attId={a.id} alt={a.original_name} />
                    <input type="checkbox" className="absolute top-1 left-1 accent-teal-600" checked={on}
                      onChange={(e) => setIncludePhoto((m) => ({ ...m, [a.id]: e.target.checked }))} />
                  </label>
                )
              })}
            </div>
          </div>

          {signatureOn && <div className="border-t border-gray-100 pt-4 space-y-3">
            <p className="text-xs font-medium text-gray-600">Conformidad del cliente</p>
            <SignaturePad value={signature} onChange={(v) => { setSignature(v); setDirty(true) }} />
            <input className="input w-full" placeholder="Nombre de quien firma" value={form.client_sign_name} onChange={(e) => set('client_sign_name', e.target.value)} style={{ fontSize: '16px' }} />
          </div>}

          <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
            <button onClick={save} disabled={!!busy || !dirty} className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50">
              {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar informe
            </button>
            <button onClick={preview} disabled={!!busy || !hasFolio} className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-50">
              {busy === 'preview' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Informe técnico
            </button>
            <button onClick={download} disabled={!!busy || !hasFolio} className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-50">
              {busy === 'download' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Descargar PDF
            </button>
            <button onClick={sendToClient} disabled={!!busy || !hasFolio} className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-50">
              {busy === 'email' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Enviar al cliente
            </button>
          </div>
          {dirty && <p className="text-xs text-amber-600">Hay cambios sin guardar. Guarda el informe para generar el PDF.</p>}
        </>
      )}
    </div>
  )
}
