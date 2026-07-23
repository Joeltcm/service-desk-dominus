import { showConfirm } from '../utils/confirm'
import { companyLogoSrc } from '../utils/branding'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { openPdfWindow, sharePdfFromHtml } from '../utils/pdfViewer'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import ClientAutocomplete from '../components/ClientAutocomplete'
import { useFormGuard } from '../context/UnsavedChangesContext'
import {
  getLetters, createLetter, updateLetter, deleteLetter, getNextLetterNumber,
  sendLetterEmail, getCompanySettings, getContacts, getCompanies,
} from '../services/api'
import {
  Plus, Search, X, Save, FileText, Mail, Trash2, Printer,
  ChevronLeft, User, MapPin, AlignLeft, PenLine, Send, Share2,
} from 'lucide-react'
import { fmtD } from '../utils/fmt'
import toast from 'react-hot-toast'
import { useUnsavedWarning } from '../hooks/useUnsavedWarning'

const TYPES = ['Informativa', 'Reclamo', 'Autorización', 'Comunicado', 'Oferta', 'Otro']
const STATUSES = ['Borrador', 'Enviada', 'Archivada']

const STATUS_STYLE = {
  Borrador:  'bg-gray-100 text-gray-600',
  Enviada:   'bg-blue-100 text-blue-700',
  Archivada: 'bg-slate-100 text-slate-500',
}

const EMPTY_FORM = {
  letter_number: '',
  letter_type: 'Informativa',
  status: 'Borrador',
  date: new Date().toISOString().split('T')[0],
  recipient_name: '',
  recipient_company: '',
  recipient_ruc: '',
  recipient_address: '',
  recipient_email: '',
  attention_to: '',
  subject: '',
  body: '',
  signer_name: '',
  signer_title: '',
  notes: '',
}

// ── PDF template ───────────────────────────────────────
export function buildLetterHTML(letter, company, origin) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

  let dateStr = ''
  if (letter.date) {
    const d = new Date(letter.date + 'T12:00:00')
    dateStr = `Panamá, ${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`
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

  const bodyHtml = esc(letter.body || '').replace(/\n/g, '<br>')

  return `<div style="font-family:Arial,sans-serif;font-size:11pt;color:#111;max-width:720px;margin:0 auto;padding:24px 32px">

  <!-- Letterhead -->
  <div style="display:flex;align-items:center;border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:20px;gap:14px">
    <img src="${companyLogoSrc(origin)}" alt="Logo" style="width:56px;height:56px;object-fit:contain;border-radius:8px">
    <div style="flex:1">
      <div style="font-size:18pt;font-weight:bold;color:#1e3a5f">${esc(coName)}</div>
      <div style="font-size:9pt;color:#555;margin-top:2px">${esc(coAddress)}${coRuc ? ` · RUC: ${esc(coRuc)}` : ''}</div>
      ${coPhone || coEmail ? `<div style="font-size:9pt;color:#555">${[coPhone && `Tel: ${esc(coPhone)}`, coEmail && esc(coEmail)].filter(Boolean).join(' · ')}</div>` : ''}
    </div>
    <div style="text-align:right;min-width:110px">
      <div style="font-size:8.5pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase;letter-spacing:0.5px">${esc(letter.letter_type || 'Carta')}</div>
      <div style="font-size:9pt;font-family:monospace;color:#444;margin-top:3px">${esc(letter.letter_number || '')}</div>
    </div>
  </div>

  <!-- Date -->
  <div style="text-align:right;font-size:10pt;color:#444;margin-bottom:24px">${esc(dateStr)}</div>

  <!-- Recipient -->
  ${letter.recipient_name || letter.recipient_company ? `<div style="margin-bottom:20px;font-size:10pt;line-height:1.6">
    ${letter.recipient_name    ? `<div style="font-weight:600">${esc(letter.recipient_name)}</div>` : ''}
    ${letter.recipient_company ? `<div>${esc(letter.recipient_company)}${letter.recipient_ruc ? ` · RUC: ${esc(letter.recipient_ruc)}` : ''}</div>` : ''}
    ${letter.recipient_address ? `<div style="color:#555">${esc(letter.recipient_address)}</div>` : ''}
    ${letter.recipient_email   ? `<div style="color:#555">${esc(letter.recipient_email)}</div>` : ''}
  </div>` : ''}

  <!-- Attention -->
  ${letter.attention_to ? `<div style="margin-bottom:16px;font-size:10pt">Att. <strong>${esc(letter.attention_to)}</strong></div>` : ''}

  <!-- Subject -->
  ${letter.subject ? `<div style="font-weight:bold;font-size:11pt;margin-bottom:20px;text-decoration:underline">Asunto: ${esc(letter.subject)}</div>` : ''}

  <!-- Body -->
  <div style="font-size:10.5pt;line-height:1.85;color:#1a1a1a;white-space:pre-wrap;margin-bottom:32px">${bodyHtml}</div>

  <!-- Signature -->
  <div style="margin-top:40px;font-size:10pt">
    <div style="color:#555">Atentamente,</div>
    <div style="margin-top:36px;border-top:1px solid #999;width:220px;padding-top:6px">
      <div style="font-weight:bold">${esc(letter.signer_name || coName)}</div>
      ${letter.signer_title ? `<div style="color:#555;font-size:9.5pt">${esc(letter.signer_title)}</div>` : ''}
      <div style="color:#555;font-size:9.5pt">${esc(coName)}</div>
    </div>
  </div>

  <!-- Footer -->
  <div style="margin-top:40px;padding-top:8px;border-top:1px solid #ddd;font-size:7.5pt;color:#999;text-align:center">
    ${footerParts.join(' · ')}
  </div>
</div>`
}

// ── Component ───────────────────────────────────────────
export default function Letters() {
  const navigate = useNavigate()
  const { ref: urlRef } = useParams()
  const [letters, setLettersList] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const { skip: skipWarning } = useUnsavedWarning(isDirty)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const detailSwipe = useTouchSwipe({ onSwipeRight: () => { setMobileDetailOpen(false); navigate(-1) } })
  const [activeTab, setActiveTab] = useState('editor') // 'editor' | 'preview'
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [company, setCompany] = useState(null)
  const [contacts, setContacts] = useState([])
  const [companies, setCompanies] = useState([])
  const [clientQuery, setClientQuery] = useState('')
  const [form, setForm] = useState({ ...EMPTY_FORM })

  useFormGuard(isDirty)

  const load = useCallback(() => {
    setLoading(true)
    getLetters()
      .then((r) => setLettersList(r.data))
      .catch(() => toast.error('Error cargando cartas'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!urlRef) { if (selected) { setSelected(null); setMobileDetailOpen(false) } return }
    if (letters.length === 0) return
    if (selected?.letter_number === urlRef) return
    const found = letters.find((l) => l.letter_number === urlRef)
    if (found) { setSelected(found); setEditing(false); setIsDirty(false); setMobileDetailOpen(true); setActiveTab('editor') }
  }, [urlRef, letters]) // eslint-disable-line

  useEffect(() => {
    Promise.allSettled([getCompanySettings(), getContacts(), getCompanies()])
      .then(([cr, conr, compr]) => {
        if (cr.status === 'fulfilled') setCompany(cr.value.data)
        if (conr.status === 'fulfilled') setContacts(conr.value.data)
        if (compr.status === 'fulfilled') setCompanies(compr.value.data)
      })
  }, [])

  const filtered = letters.filter((l) => {
    const q = search.toLowerCase()
    const matchSearch = !q || [l.letter_number, l.subject, l.recipient_name, l.recipient_company].some(
      (v) => v?.toLowerCase().includes(q)
    )
    const matchStatus = !statusFilter || l.status === statusFilter
    return matchSearch && matchStatus
  })

  const openNew = async () => {
    const num = await getNextLetterNumber().then((r) => r.data.number).catch(() => 'CARTA-0001')
    setForm({ ...EMPTY_FORM, letter_number: num, date: new Date().toISOString().split('T')[0] })
    setClientQuery('')
    setIsNew(true)
    setEditing(true)
    setSelected(null)
    setIsDirty(false)
    setActiveTab('editor')
    setMobileDetailOpen(true)
  }

  const openEdit = (letter) => {
    setForm({
      letter_number: letter.letter_number || '',
      letter_type: letter.letter_type || 'Informativa',
      status: letter.status || 'Borrador',
      date: letter.date || new Date().toISOString().split('T')[0],
      recipient_name: letter.recipient_name || '',
      recipient_company: letter.recipient_company || '',
      recipient_ruc: letter.recipient_ruc || '',
      recipient_address: letter.recipient_address || '',
      recipient_email: letter.recipient_email || '',
      attention_to: letter.attention_to || '',
      subject: letter.subject || '',
      body: letter.body || '',
      signer_name: letter.signer_name || '',
      signer_title: letter.signer_title || '',
      notes: letter.notes || '',
    })
    setClientQuery(letter.recipient_name || '')
    setEditing(true)
    setIsDirty(false)
    setActiveTab('editor')
  }

  const handleSelectRecipient = (c) => {
    setClientQuery(c.name || '')
    setIsDirty(true)
    setForm((f) => ({
      ...f,
      recipient_name: c.name || f.recipient_name,
      recipient_company: c.company || (c._type === 'company' ? c.name : f.recipient_company),
      recipient_ruc: c.ruc || f.recipient_ruc,
      recipient_address: c.address || f.recipient_address,
      recipient_email: c.email || f.recipient_email,
    }))
  }

  const handleSave = async () => {
    if (!form.subject?.trim() && !form.body?.trim()) {
      toast.error('Ingresa al menos un asunto o contenido')
      return
    }
    setSaving(true)
    try {
      let saved
      if (isNew) {
        saved = await createLetter(form).then((r) => r.data)
        setLettersList((prev) => [saved, ...prev])
        toast.success('Carta creada')
      } else {
        saved = await updateLetter(selected.id, form).then((r) => r.data)
        setLettersList((prev) => prev.map((l) => (l.id === saved.id ? saved : l)))
        toast.success('Carta guardada')
      }
      setSelected(saved)
      setIsNew(false)
      setEditing(false)
      setIsDirty(false)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error guardando carta')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected || !await showConfirm(`¿Eliminar carta ${selected.letter_number}?`)) return
    try {
      await deleteLetter(selected.id)
      setLettersList((prev) => prev.filter((l) => l.id !== selected.id))
      setSelected(null)
      setEditing(false)
      setMobileDetailOpen(false)
      navigate('/cartas', { replace: true })
      toast.success('Carta eliminada')
    } catch {
      toast.error('Error eliminando carta')
    }
  }

  const handlePrint = () => {
    const letterData = editing ? { ...selected, ...form } : selected
    if (!letterData) return
    const origin = window.location.origin + (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
    openPdfWindow(
      `Carta ${letterData.letter_number || ''}`,
      buildLetterHTML(letterData, company, origin),
      { autoprint: false },
    )
  }

  const handleShare = async () => {
    const letterData = editing ? { ...selected, ...form } : selected
    if (!letterData) return
    const origin = window.location.origin + (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
    const filename = `Carta-${letterData.letter_number || letterData.id || 'documento'}.pdf`
    await sharePdfFromHtml(`Carta ${letterData.letter_number || ''}`, buildLetterHTML(letterData, company, origin), filename)
  }

  const openEmail = () => {
    setEmailTo(selected?.recipient_email || '')
    setEmailSubject(`Carta: ${selected?.subject || selected?.letter_number || 'Comunicado'}`)
    setEmailOpen(true)
  }

  const handleSendEmail = async (e) => {
    e.preventDefault()
    setEmailSending(true)
    try {
      await sendLetterEmail(selected.id, { email: emailTo, subject: emailSubject })
      setLettersList((prev) => prev.map((l) => (l.id === selected.id ? { ...l, status: 'Enviada' } : l)))
      setSelected((s) => ({ ...s, status: 'Enviada' }))
      setEmailOpen(false)
      toast.success('Carta enviada por correo')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error enviando correo')
    } finally {
      setEmailSending(false)
    }
  }

  const cancelEdit = async () => {
    if (isDirty && !await showConfirm('Tienes cambios sin guardar. ¿Descartar?')) return
    setIsDirty(false)
    setEditing(false)
    if (isNew) { setSelected(null); setMobileDetailOpen(false); navigate('/cartas', { replace: true }) }
  }

  const fld = (key) => ({
    value: form[key],
    onChange: (e) => { setIsDirty(true); setForm((f) => ({ ...f, [key]: e.target.value })) },
  })

  // ── Preview HTML for inline tab ──────────────────────
  const previewHtml = () => {
    const data = editing ? { ...selected, ...form } : selected
    if (!data) return ''
    const origin = window.location.origin + (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
    return buildLetterHTML(data, company, origin)
  }

  // ── Render ───────────────────────────────────────────
  const showDetail = selected || isNew

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* List panel */}
      <div className={`flex flex-col bg-white border-r border-gray-200 ${showDetail && mobileDetailOpen ? 'hidden md:flex' : 'flex'} md:w-80 lg:w-96 w-full flex-shrink-0`}>
        <div className="flex-shrink-0 p-3 border-b border-gray-100 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-8 py-1.5 text-sm" placeholder="Buscar cartas..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ fontSize: '16px' }} />
            </div>
            <button onClick={openNew} className="btn-primary flex items-center gap-1.5 text-sm whitespace-nowrap px-3 py-1.5">
              <Plus size={14} /> Nueva carta
            </button>
          </div>
          <div className="flex gap-1.5">
            {['', ...STATUSES].map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {s || 'Todas'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Cargando...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              {search || statusFilter ? 'No hay resultados.' : 'No hay cartas. Crea la primera.'}
            </div>
          ) : filtered.map((l) => (
            <button key={l.id} onClick={async () => {
              if (isDirty && !await showConfirm('Tienes cambios sin guardar. ¿Descartar?')) return
              setSelected(l); setEditing(false); setIsDirty(false); setMobileDetailOpen(true); setActiveTab('editor'); navigate('/cartas/' + l.letter_number)
            }}
              className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${selected?.id === l.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-gray-400">{l.letter_number}</p>
                  <p className="text-sm font-semibold text-gray-900 truncate mt-0.5">{l.subject || l.letter_type || 'Sin asunto'}</p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{l.recipient_name || l.recipient_company || '—'}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[l.status] || 'bg-gray-100 text-gray-600'}`}>{l.status}</span>
                  <span className="text-xs text-gray-400">{fmtD(l.date)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail / Editor panel */}
      {showDetail && (
        <div className={`flex flex-col flex-1 min-w-0 ${!mobileDetailOpen ? 'hidden md:flex' : 'flex'}`} {...detailSwipe}>
          {/* Top bar */}
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-white border-b border-gray-200 flex-wrap">
            <button onClick={async () => { if (isDirty && !await showConfirm('¿Descartar cambios?')) return; skipWarning(); setIsDirty(false); setEditing(false); setMobileDetailOpen(false); navigate(-1) }}
              className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
              <ChevronLeft size={18} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {isNew ? 'Nueva carta' : (selected?.letter_number || 'Carta')}
              </p>
              {!isNew && selected && (
                <p className="text-xs text-gray-400">{selected.letter_type} · {fmtD(selected.date)}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {editing ? (
                <>
                  <button onClick={cancelEdit} className="btn-secondary text-sm py-1.5 px-3">Cancelar</button>
                  <button onClick={handleSave} disabled={saving} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
                    <Save size={14} />{saving ? 'Guardando...' : 'Guardar'}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={handlePrint} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5">
                    <Printer size={14} /> Exportar PDF
                  </button>
                  <button onClick={handleShare} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors">
                    <Share2 size={14} /> Compartir
                  </button>
                  {selected?.recipient_email && (
                    <button onClick={openEmail} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5">
                      <Mail size={14} /> Enviar
                    </button>
                  )}
                  <button onClick={() => openEdit(selected)} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
                    <PenLine size={14} /> Editar
                  </button>
                  <button onClick={handleDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex-shrink-0 border-b border-gray-200 bg-white px-4 flex gap-0">
            {['editor', 'preview'].map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {tab === 'editor' ? 'Editor' : 'Vista previa'}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
            {activeTab === 'preview' ? (
              <div className="p-4 bg-gray-50 min-h-full flex flex-col gap-3">
                <div className="flex justify-end gap-2">
                  <button onClick={handlePrint} className="btn-primary text-sm py-1.5 px-4 flex items-center gap-2">
                    <Printer size={14} /> Exportar PDF
                  </button>
                  <button onClick={handleShare} className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors">
                    <Share2 size={14} /> Compartir
                  </button>
                </div>
                <div className="bg-white shadow-sm rounded-lg overflow-hidden"
                  dangerouslySetInnerHTML={{ __html: previewHtml() }} />
              </div>
            ) : editing ? (
              <div className="p-4 space-y-4 max-w-2xl">
                {/* Header fields */}
                <div className="card space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700">Datos de la carta</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="label">Número</label>
                      <input className="input" style={{ fontSize: '16px' }} {...fld('letter_number')} />
                    </div>
                    <div>
                      <label className="label">Tipo</label>
                      <select className="input" style={{ fontSize: '16px' }} {...fld('letter_type')}>
                        {TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Fecha</label>
                      <input type="date" className="input" style={{ fontSize: '16px' }} {...fld('date')} />
                    </div>
                  </div>
                </div>

                {/* Recipient */}
                <div className="card space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <User size={14} className="text-gray-400" /> Destinatario
                  </h3>
                  <ClientAutocomplete
                    field="name"
                    label="Nombre"
                    value={clientQuery}
                    onChange={(v) => { setClientQuery(v); setIsDirty(true); setForm((f) => ({ ...f, recipient_name: v })) }}
                    onSelect={handleSelectRecipient}
                    contacts={contacts}
                    companies={companies}
                    placeholder="Nombre o razón social..."
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="label">Empresa</label>
                      <input className="input" style={{ fontSize: '16px' }} {...fld('recipient_company')} placeholder="Empresa u organización" />
                    </div>
                    <div>
                      <label className="label">RUC</label>
                      <input className="input" style={{ fontSize: '16px' }} {...fld('recipient_ruc')} placeholder="RUC" />
                    </div>
                    <div>
                      <label className="label">Email</label>
                      <input type="email" className="input" style={{ fontSize: '16px' }} {...fld('recipient_email')} placeholder="correo@destinatario.com" />
                    </div>
                    <div>
                      <label className="label">Atención a</label>
                      <input className="input" style={{ fontSize: '16px' }} {...fld('attention_to')} placeholder="Nombre del responsable" />
                    </div>
                  </div>
                  <div>
                    <label className="label">Dirección</label>
                    <input className="input" style={{ fontSize: '16px' }} {...fld('recipient_address')} placeholder="Dirección postal" />
                  </div>
                </div>

                {/* Content */}
                <div className="card space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <AlignLeft size={14} className="text-gray-400" /> Contenido
                  </h3>
                  <div>
                    <label className="label">Asunto</label>
                    <input className="input" style={{ fontSize: '16px' }} {...fld('subject')} placeholder="Asunto de la carta" />
                  </div>
                  <div>
                    <label className="label">Cuerpo de la carta</label>
                    <textarea
                      className="input resize-none"
                      style={{ fontSize: '16px', minHeight: '200px' }}
                      rows={12}
                      {...fld('body')}
                      placeholder="Estimado/a [nombre],

Escriba aquí el contenido de la carta..."
                    />
                  </div>
                </div>

                {/* Signature */}
                <div className="card space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <PenLine size={14} className="text-gray-400" /> Firma
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="label">Nombre del firmante</label>
                      <input className="input" style={{ fontSize: '16px' }} {...fld('signer_name')} placeholder="Nombre completo" />
                    </div>
                    <div>
                      <label className="label">Cargo / Título</label>
                      <input className="input" style={{ fontSize: '16px' }} {...fld('signer_title')} placeholder="Gerente, Director, etc." />
                    </div>
                  </div>
                </div>

                {/* Internal notes */}
                <div className="card space-y-2">
                  <label className="label">Notas internas</label>
                  <textarea className="input resize-none" style={{ fontSize: '16px' }} rows={3} {...fld('notes')} placeholder="Notas privadas (no aparecen en la carta)" />
                </div>
              </div>
            ) : selected ? (
              /* View mode */
              <div className="p-4 space-y-4 max-w-2xl">
                <div className="card space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-xs text-gray-400 block">Número</span><span className="font-mono font-medium">{selected.letter_number || '—'}</span></div>
                    <div><span className="text-xs text-gray-400 block">Tipo</span><span>{selected.letter_type || '—'}</span></div>
                    <div><span className="text-xs text-gray-400 block">Fecha</span><span>{fmtD(selected.date) || '—'}</span></div>
                    <div><span className="text-xs text-gray-400 block">Estado</span>
                      <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[selected.status] || ''}`}>{selected.status}</span>
                    </div>
                  </div>
                </div>

                {(selected.recipient_name || selected.recipient_company) && (
                  <div className="card space-y-1.5 text-sm">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Destinatario</p>
                    {selected.recipient_name    && <p className="font-semibold">{selected.recipient_name}</p>}
                    {selected.recipient_company && <p className="text-gray-600">{selected.recipient_company}{selected.recipient_ruc ? ` · RUC: ${selected.recipient_ruc}` : ''}</p>}
                    {selected.recipient_address && <p className="text-gray-500 flex items-center gap-1"><MapPin size={12} />{selected.recipient_address}</p>}
                    {selected.recipient_email   && <p className="text-gray-500 flex items-center gap-1"><Mail size={12} />{selected.recipient_email}</p>}
                    {selected.attention_to      && <p className="text-gray-500">Att. {selected.attention_to}</p>}
                  </div>
                )}

                {selected.subject && (
                  <div className="card">
                    <p className="text-xs text-gray-400 mb-1">Asunto</p>
                    <p className="font-semibold text-sm">{selected.subject}</p>
                  </div>
                )}

                {selected.body && (
                  <div className="card">
                    <p className="text-xs text-gray-400 mb-2">Contenido</p>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{selected.body}</p>
                  </div>
                )}

                {(selected.signer_name || selected.signer_title) && (
                  <div className="card text-sm">
                    <p className="text-xs text-gray-400 mb-1">Firma</p>
                    {selected.signer_name  && <p className="font-semibold">{selected.signer_name}</p>}
                    {selected.signer_title && <p className="text-gray-500">{selected.signer_title}</p>}
                  </div>
                )}

                {selected.notes && (
                  <div className="card text-sm bg-amber-50 border-amber-200">
                    <p className="text-xs text-amber-600 mb-1 font-medium">Notas internas</p>
                    <p className="text-gray-700 whitespace-pre-wrap">{selected.notes}</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!showDetail && (
        <div className="hidden md:flex flex-1 items-center justify-center text-gray-400 flex-col gap-3">
          <FileText size={40} className="opacity-30" />
          <p className="text-sm">Selecciona una carta o crea una nueva</p>
        </div>
      )}

      {/* Email modal */}
      {emailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Mail size={16} className="text-blue-600" />Enviar carta por correo</h3>
              <button onClick={() => setEmailOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <form onSubmit={handleSendEmail} className="p-4 space-y-3">
              <div>
                <label className="label">Para</label>
                <input type="email" className="input" style={{ fontSize: '16px' }} value={emailTo} onChange={(e) => setEmailTo(e.target.value)} required placeholder="correo@destinatario.com" />
              </div>
              <div>
                <label className="label">Asunto</label>
                <input className="input" style={{ fontSize: '16px' }} value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setEmailOpen(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={emailSending} className="btn-primary flex items-center gap-2">
                  <Send size={14} />{emailSending ? 'Enviando...' : 'Enviar correo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
