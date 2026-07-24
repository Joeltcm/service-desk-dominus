import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import {
  getPrinters, createPrinter, updatePrinter, deletePrinter,
  getMeterReadings, createMeterReading, getContracts, importPrinters,
} from '../services/api'
import {
  Plus, Search, X, Save, Pencil, Trash2, ArrowLeft,
  Printer as PrinterIcon, ShieldCheck, ShieldAlert, Gauge, Hash,
  Clock, FileText, Upload, CheckCircle2, AlertTriangle, Loader2,
} from 'lucide-react'
import { fmtD } from '../utils/fmt'
import toast from 'react-hot-toast'
import { useUnsavedWarning } from '../hooks/useUnsavedWarning'

const OWNERSHIP_LABEL = { alquiler: 'Alquiler (activo propio)', cliente: 'Propiedad del cliente' }
const STATUSES = ['Activa', 'En reparacion', 'Baja']

const EMPTY_FORM = {
  brand: '',
  model: '',
  serial_number: '',
  ownership_type: 'cliente',
  contract_id: '',
  warranty_start_date: '',
  warranty_end_date: '',
  asset_id: '',
  ip_address: '',
  contact_name: '',
  location: '',
  status: 'Activa',
  notes: '',
}

const WARRANTY_DAYS = 365

function getDaysInfo(endDate) {
  if (!endDate) return null
  const end = new Date(endDate + 'T12:00:00')
  const diffMs = end - new Date()
  const diffDays = Math.ceil(diffMs / 86400000)
  const expired = diffDays <= 0
  const abs = Math.abs(diffDays)
  const years = Math.floor(abs / 365)
  const months = Math.floor((abs % 365) / 30)
  const days = abs % 30
  let label
  if (years > 0) label = `${years} año${years > 1 ? 's' : ''}${months > 0 ? ` ${months} mes${months > 1 ? 'es' : ''}` : ''}`
  else if (months > 0) label = `${months} mes${months > 1 ? 'es' : ''}${days > 0 ? ` ${days} día${days > 1 ? 's' : ''}` : ''}`
  else label = `${abs} día${abs !== 1 ? 's' : ''}`
  return { expired, diffDays, label, endDate: end }
}

function getWarrantyInfo(startDate, endDate) {
  if (endDate) return getDaysInfo(endDate)
  if (!startDate) return null
  const start = new Date(startDate + 'T12:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + WARRANTY_DAYS)
  return getDaysInfo(end.toISOString().split('T')[0])
}

function CountdownCard({ label, icon: Icon, info, colorOverride }) {
  if (!info) return null
  const color = colorOverride || (
    info.expired ? 'red' :
    info.diffDays <= 30 ? 'amber' :
    info.diffDays <= 90 ? 'yellow' : 'green'
  )
  const styles = {
    red:    { card: 'bg-red-50 border-red-100',    text: 'text-red-700',    sub: 'text-red-400',    icon: 'text-red-400'    },
    amber:  { card: 'bg-amber-50 border-amber-100', text: 'text-amber-700',  sub: 'text-amber-400',  icon: 'text-amber-400'  },
    yellow: { card: 'bg-yellow-50 border-yellow-100', text: 'text-yellow-700', sub: 'text-yellow-500', icon: 'text-yellow-400' },
    green:  { card: 'bg-green-50 border-green-100', text: 'text-green-700',  sub: 'text-green-400',  icon: 'text-green-400'  },
  }
  const s = styles[color]
  return (
    <div className={`card ${s.card} flex items-center gap-3`}>
      <div className={`flex-shrink-0 ${s.icon}`}><Icon size={22} /></div>
      <div className="min-w-0">
        <p className={`text-xs font-semibold uppercase tracking-wide ${s.sub}`}>{label}</p>
        {info.expired
          ? <p className={`text-sm font-bold ${s.text}`}>Vencido hace {info.label}</p>
          : <p className={`text-sm font-bold ${s.text}`}>{info.label} restantes</p>
        }
        <p className={`text-xs ${s.sub}`}>
          Vence: {info.endDate.toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' })}
        </p>
      </div>
    </div>
  )
}

function WarrantyBadge({ startDate, endDate }) {
  const info = getWarrantyInfo(startDate, endDate)
  if (!info) return null
  if (info.expired) {
    return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700"><ShieldAlert size={11} /> Garantía vencida</span>
  }
  const soon = info.diffDays <= 30
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${soon ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
      <ShieldCheck size={11} /> Garantía: {info.label} restantes
    </span>
  )
}

function OwnershipBadge({ type }) {
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${type === 'alquiler' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
      {OWNERSHIP_LABEL[type] || type}
    </span>
  )
}

function ClientBadge({ name }) {
  if (!name) return null
  return (
    <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700 truncate max-w-[160px]">
      {name}
    </span>
  )
}

function MeterReadings({ printerId }) {
  const [readings, setReadings] = useState([])
  const [form, setForm] = useState({ reading_date: new Date().toISOString().split('T')[0], bw_count: '', color_count: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    getMeterReadings(printerId).then(r => setReadings(r.data)).catch(() => {})
  }, [printerId])

  useEffect(() => { load() }, [load])

  const handleAdd = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createMeterReading(printerId, {
        ...form,
        bw_count: Number(form.bw_count) || 0,
        color_count: Number(form.color_count) || 0,
      })
      toast.success('Lectura registrada')
      setForm(f => ({ ...f, bw_count: '', color_count: '', notes: '' }))
      load()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error registrando lectura')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5"><Gauge size={11} /> Lecturas de contador</p>
      <form onSubmit={handleAdd} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
        <div>
          <label className="label">Fecha</label>
          <input type="date" className="input text-sm" value={form.reading_date} onChange={e => setForm(f => ({ ...f, reading_date: e.target.value }))} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">B/N</label>
          <input type="number" min="0" className="input text-sm" value={form.bw_count} onChange={e => setForm(f => ({ ...f, bw_count: e.target.value }))} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Color</label>
          <input type="number" min="0" className="input text-sm" value={form.color_count} onChange={e => setForm(f => ({ ...f, color_count: e.target.value }))} style={{ fontSize: '16px' }} />
        </div>
        <button type="submit" disabled={saving} className="btn-primary text-sm py-2 disabled:opacity-50">
          {saving ? 'Guardando...' : 'Registrar'}
        </button>
      </form>

      {readings.length === 0 ? (
        <p className="text-xs text-gray-400">Sin lecturas registradas todavía.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {readings.map(r => (
            <div key={r.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-gray-600">{fmtD(r.reading_date)}</span>
              <span className="text-gray-500">B/N: <span className="font-medium text-gray-800">{r.bw_count}</span> · Color: <span className="font-medium text-gray-800">{r.color_count}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PrinterDetail({ printer, contractsById, onEdit, onDelete }) {
  const contract = printer.contract_id ? contractsById[printer.contract_id] : null
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className="w-14 h-14 rounded-xl bg-sky-50 flex items-center justify-center flex-shrink-0">
            <PrinterIcon size={26} className="text-sky-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-mono text-gray-400 flex items-center gap-1"><Hash size={9} />{printer.serial_number || `#${printer.id}`}</p>
            <h2 className="text-lg font-bold text-gray-900 mt-0.5 leading-tight">{printer.brand} {printer.model}</h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <OwnershipBadge type={printer.ownership_type} />
              <WarrantyBadge startDate={printer.warranty_start_date} endDate={printer.warranty_end_date} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={onEdit} className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            <Pencil size={13} /> <span className="hidden sm:inline">Editar</span>
          </button>
          <button onClick={onDelete} className="p-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card space-y-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Contrato</p>
          {contract ? (
            <p className="text-sm text-gray-700">{contract.contract_number} — {contract.client_name}</p>
          ) : (
            <p className="text-xs text-gray-400">Sin contrato asignado</p>
          )}
          {printer.asset_id && (
            <p className="text-xs text-gray-500">N° Activo: <span className="font-semibold font-mono text-gray-700">{printer.asset_id}</span></p>
          )}
        </div>
        <div className="card space-y-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ubicación</p>
          <p className="text-sm text-gray-700">{printer.location || '—'}</p>
          {printer.ip_address && (
            <p className="text-xs text-gray-500 font-mono">IP: <span className="font-semibold text-gray-700">{printer.ip_address}</span></p>
          )}
          {printer.contact_name && (
            <p className="text-xs text-gray-500">Contacto: <span className="font-medium text-gray-700">{printer.contact_name}</span></p>
          )}
          <p className="text-xs text-gray-500">Estado: <span className="font-medium">{printer.status}</span></p>
        </div>
      </div>

      {((printer.warranty_start_date || printer.warranty_end_date) || contract?.end_date) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(printer.warranty_start_date || printer.warranty_end_date) && (
            <CountdownCard label="Garantía del equipo" icon={ShieldCheck} info={getWarrantyInfo(printer.warranty_start_date, printer.warranty_end_date)} />
          )}
          {contract?.end_date && (
            <CountdownCard label="Vigencia del contrato" icon={FileText} info={getDaysInfo(contract.end_date)} />
          )}
        </div>
      ) : null}

      <MeterReadings printerId={printer.id} />

      {printer.notes && (
        <div className="card bg-amber-50 border-amber-100">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Notas</p>
          <p className="text-sm text-amber-800 whitespace-pre-wrap">{printer.notes}</p>
        </div>
      )}
    </div>
  )
}

function calcWarrantyEnd(startDate, years) {
  if (!startDate || !years) return ''
  const d = new Date(startDate + 'T12:00:00')
  d.setFullYear(d.getFullYear() + years)
  return d.toISOString().split('T')[0]
}

function inferYears(startDate, endDate) {
  if (!startDate || !endDate) return 1
  const diff = Math.round((new Date(endDate) - new Date(startDate)) / (365.25 * 86400000))
  return [1, 2, 3].includes(diff) ? diff : 1
}

function PrinterForm({ initial, contracts, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY_FORM)
  const [warrantyYears, setWarrantyYears] = useState(
    () => inferYears(initial?.warranty_start_date, initial?.warranty_end_date)
  )
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleWarrantyStart = (val) => {
    const end = calcWarrantyEnd(val, warrantyYears)
    setForm(f => ({ ...f, warranty_start_date: val, warranty_end_date: end }))
  }

  const handleWarrantyYears = (years) => {
    setWarrantyYears(years)
    const end = calcWarrantyEnd(form.warranty_start_date, years)
    set('warranty_end_date', end)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = {
      ...form,
      contract_id: form.contract_id ? Number(form.contract_id) : null,
      warranty_start_date: form.warranty_start_date || null,
      warranty_end_date: form.warranty_end_date || null,
    }
    onSave(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between -mb-1">
        <h2 className="font-bold text-gray-900">{initial?.id ? 'Editar impresora' : 'Nueva impresora'}</h2>
        <button type="button" onClick={onCancel}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
      </div>

      <div className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Marca</label>
          <input className="input" value={form.brand} onChange={e => set('brand', e.target.value)} placeholder="HP, Brother, Epson..." style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Modelo</label>
          <input className="input" value={form.model} onChange={e => set('model', e.target.value)} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">N° de serie</label>
          <input className="input font-mono" value={form.serial_number} onChange={e => set('serial_number', e.target.value)} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">N° de activo</label>
          <input className="input font-mono" value={form.asset_id || ''} onChange={e => set('asset_id', e.target.value)} placeholder="A0084" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Estado</label>
          <select className="input" value={form.status} onChange={e => set('status', e.target.value)} style={{ fontSize: '16px' }}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="card space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Propiedad y contrato</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Tipo de propiedad</label>
            <select className="input" value={form.ownership_type} onChange={e => set('ownership_type', e.target.value)} style={{ fontSize: '16px' }}>
              <option value="cliente">Propiedad del cliente</option>
              <option value="alquiler">Alquiler (activo propio)</option>
            </select>
          </div>
          <div>
            <label className="label">Contrato MPS</label>
            <select className="input" value={form.contract_id || ''} onChange={e => set('contract_id', e.target.value)} style={{ fontSize: '16px' }}>
              <option value="">— Sin contrato —</option>
              {contracts.map(c => <option key={c.id} value={c.id}>{c.contract_number} — {c.client_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Inicio de garantía</label>
            <input type="date" className="input" value={form.warranty_start_date || ''} onChange={e => handleWarrantyStart(e.target.value)} style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="label">Duración de garantía</label>
            <select className="input" value={warrantyYears} onChange={e => handleWarrantyYears(Number(e.target.value))} style={{ fontSize: '16px' }}>
              <option value={1}>1 año</option>
              <option value={2}>2 años</option>
              <option value={3}>3 años</option>
            </select>
            {form.warranty_end_date && (
              <p className="text-xs text-gray-400 mt-1">
                Vence: {new Date(form.warranty_end_date + 'T12:00:00').toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Ubicación</label>
          <input className="input" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Oficina, piso, departamento..." style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Dirección IP</label>
          <input className="input font-mono" value={form.ip_address || ''} onChange={e => set('ip_address', e.target.value)} placeholder="192.168.1.10" style={{ fontSize: '16px' }} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Contacto</label>
          <input className="input" value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)} placeholder="Nombre de la persona de contacto" style={{ fontSize: '16px' }} />
        </div>
      </div>

      <div className="card">
        <label className="label">Notas</label>
        <textarea className="input resize-none" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} style={{ fontSize: '16px' }} />
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

const ACTION_STYLE = {
  create: { label: 'Nueva', cls: 'bg-emerald-100 text-emerald-700' },
  update: { label: 'Actualiza', cls: 'bg-sky-100 text-sky-700' },
  skip:   { label: 'Omitida', cls: 'bg-gray-100 text-gray-500' },
}

function ImportModal({ onClose, onDone }) {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)   // resultado del dry-run (preview)
  const [committing, setCommitting] = useState(false)
  const swipe = useTouchSwipe({ onSwipeDown: onClose })

  const runPreview = async (f) => {
    setFile(f); setResult(null); setLoading(true)
    try {
      const r = await importPrinters(f, true)
      setResult(r.data)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'No se pudo leer el archivo')
      setFile(null)
    } finally { setLoading(false) }
  }

  const commit = async () => {
    if (!file) return
    setCommitting(true)
    try {
      const r = await importPrinters(file, false)
      const c = r.data.counts
      toast.success(`Importadas: ${c.create} nuevas, ${c.update} actualizadas`)
      onDone()
      onClose()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al importar')
    } finally { setCommitting(false) }
  }

  const c = result?.counts
  const willWrite = c ? c.create + c.update : 0
  const skipped = c ? c.skip_no_contract + c.skip_no_serial + c.duplicate_in_file : 0

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div {...swipe} onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-2xl md:rounded-2xl rounded-t-2xl shadow-xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Upload size={18} className="text-sky-500" /> Importar flota
          </h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto">
          {!result && (
            <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-10 px-4 cursor-pointer transition-colors ${loading ? 'border-sky-300 bg-sky-50' : 'border-gray-200 hover:border-sky-300 hover:bg-sky-50/50'}`}>
              {loading ? <Loader2 size={26} className="text-sky-500 animate-spin" /> : <Upload size={26} className="text-gray-400" />}
              <span className="text-sm font-medium text-gray-700">{loading ? 'Leyendo archivo…' : 'Selecciona el archivo CSV'}</span>
              <span className="text-xs text-gray-400">Se empareja por N. de Contrato; garantía = inicio + 1 año</span>
              <input type="file" accept=".csv,text/csv" className="hidden" disabled={loading}
                onChange={e => { const f = e.target.files?.[0]; if (f) runPreview(f) }} />
            </label>
          )}

          {result && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3">
                  <p className="text-2xl font-bold text-emerald-700 tabular-nums">{c.create}</p>
                  <p className="text-xs text-emerald-600 font-medium">Nuevas</p>
                </div>
                <div className="rounded-lg bg-sky-50 border border-sky-100 p-3">
                  <p className="text-2xl font-bold text-sky-700 tabular-nums">{c.update}</p>
                  <p className="text-xs text-sky-600 font-medium">Actualizar</p>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
                  <p className="text-2xl font-bold text-amber-700 tabular-nums">{skipped}</p>
                  <p className="text-xs text-amber-600 font-medium">Omitidas</p>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                  <p className="text-2xl font-bold text-gray-700 tabular-nums">{c.retired}</p>
                  <p className="text-xs text-gray-500 font-medium">De baja</p>
                </div>
              </div>

              {(c.skip_no_contract > 0 || c.skip_no_serial > 0 || c.duplicate_in_file > 0) && (
                <div className="text-xs bg-amber-50/60 border border-amber-100 rounded-lg p-3 text-amber-700 flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>
                    {c.skip_no_contract > 0 && <>{c.skip_no_contract} sin contrato en el sistema. </>}
                    {c.skip_no_serial > 0 && <>{c.skip_no_serial} sin número de serie. </>}
                    {c.duplicate_in_file > 0 && <>{c.duplicate_in_file} series repetidas en el archivo. </>}
                    Estas no se importarán.
                  </span>
                </div>
              )}

              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500 sticky top-0">
                      <tr>
                        <th className="text-left font-semibold px-3 py-2">Serie</th>
                        <th className="text-left font-semibold px-3 py-2">Modelo</th>
                        <th className="text-left font-semibold px-3 py-2">Contrato</th>
                        <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Garantía fin</th>
                        <th className="text-left font-semibold px-3 py-2">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {result.preview.slice(0, 300).map((row, i) => {
                        const a = ACTION_STYLE[row.action] || ACTION_STYLE.skip
                        return (
                          <tr key={i} className={row.action === 'skip' ? 'opacity-60' : ''}>
                            <td className="px-3 py-1.5 font-mono text-gray-700">{row.serial || '—'}</td>
                            <td className="px-3 py-1.5 text-gray-600">{row.model || '—'}</td>
                            <td className="px-3 py-1.5 text-gray-600">{row.contract_number || '—'}</td>
                            <td className="px-3 py-1.5 text-gray-600 tabular-nums">{row.warranty_end || '—'}</td>
                            <td className="px-3 py-1.5">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${a.cls}`} title={row.reason || ''}>
                                {a.label}{row.status === 'Baja' && row.action !== 'skip' ? ' · Baja' : ''}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {result.preview.length > 300 && (
                  <p className="text-[11px] text-gray-400 px-3 py-1.5 bg-gray-50">Mostrando 300 de {result.preview.length} filas.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {result && (
          <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-gray-100 flex-shrink-0">
            <button onClick={() => { setResult(null); setFile(null) }} className="px-4 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
              Otro archivo
            </button>
            <button onClick={commit} disabled={committing || willWrite === 0}
              className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5 disabled:opacity-50">
              {committing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {committing ? 'Importando…' : `Confirmar (${willWrite})`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Impresoras() {
  const navigate = useNavigate()
  const { ref: urlRef } = useParams()
  const [printers, setPrinters] = useState([])
  const [contracts, setContracts] = useState([])
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const { skip: skipWarning } = useUnsavedWarning(editing)
  const detailSwipe = useTouchSwipe({ onSwipeRight: () => { setMobileDetailOpen(false); navigate(-1) } })
  const [search, setSearch] = useState('')
  const [filterOwnership, setFilterOwnership] = useState('')
  const [filterContractType, setFilterContractType] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(() => {
    getPrinters().then(r => setPrinters(r.data)).catch(() => toast.error('Error cargando impresoras'))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { getContracts().then(r => setContracts(r.data)).catch(() => {}) }, [])

  const contractsById = Object.fromEntries(contracts.map(c => [c.id, c]))

  useEffect(() => {
    if (!urlRef) { if (selected) { setSelected(null); setMobileDetailOpen(false) } return }
    if (printers.length === 0) return
    if (selected?.id === Number(urlRef)) return
    const found = printers.find((p) => p.id === Number(urlRef))
    if (found) { setSelected(found); setEditing(false); setMobileDetailOpen(true) }
  }, [urlRef, printers]) // eslint-disable-line

  const filtered = printers.filter(p => {
    const q = search.toLowerCase()
    const contract = contractsById[p.contract_id]
    const match = !q || [
      p.serial_number, p.asset_id, p.brand, p.model, p.location,
      p.ip_address, p.contact_name, p.notes,
      contract?.contract_number, contract?.client_name, contract?.client_company,
    ].some(v => v?.toLowerCase().includes(q))
    const matchOwnership = !filterOwnership || p.ownership_type === filterOwnership
    const contractType = contractsById[p.contract_id]?.contract_type || 'MPS'
    const matchContractType = !filterContractType || contractType === filterContractType
    return match && matchOwnership && matchContractType
  })

  const handleNew = () => {
    setIsNew(true)
    setEditing(true)
    setMobileDetailOpen(true)
    setSelected({})
  }

  const handleSave = async (payload) => {
    setSaving(true)
    try {
      let saved
      if (isNew) {
        saved = await createPrinter(payload).then(r => r.data)
        toast.success('Impresora creada')
      } else {
        saved = await updatePrinter(selected.id, payload).then(r => r.data)
        toast.success('Impresora guardada')
      }
      setSelected(saved)
      setPrinters(prev => isNew ? [saved, ...prev] : prev.map(p => p.id === saved.id ? saved : p))
      setEditing(false)
      setIsNew(false)
      navigate('/impresoras/' + saved.id, { replace: true })
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error guardando impresora')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected || !confirm(`¿Eliminar impresora ${selected.serial_number || selected.id}?`)) return
    try {
      await deletePrinter(selected.id)
      setPrinters(prev => prev.filter(p => p.id !== selected.id))
      setSelected(null)
      setMobileDetailOpen(false)
      navigate('/impresoras', { replace: true })
      toast.success('Impresora eliminada')
    } catch { toast.error('Error eliminando') }
  }

  const cancelEdit = () => {
    setEditing(false)
    setIsNew(false)
    if (isNew) { setSelected(null); setMobileDetailOpen(false); navigate('/impresoras', { replace: true }) }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className={`${mobileDetailOpen ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-gray-200 bg-white flex-shrink-0`}>
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Flota</h1>
              <p className="text-xs text-sky-500 font-medium mt-0.5">{filtered.length} impresora{filtered.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setImportOpen(true)} title="Importar flota desde CSV"
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                <Upload size={15} /> <span className="hidden sm:inline">Importar</span>
              </button>
              <button onClick={handleNew} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
                <Plus size={15} /> Nueva
              </button>
            </div>
          </div>
        </div>
        {importOpen && <ImportModal onClose={() => setImportOpen(false)} onDone={load} />}

        <div className="px-4 py-3 space-y-2 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-8 w-full text-sm" placeholder="Buscar marca, modelo, serie..." value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: '16px' }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select className="input text-sm" value={filterContractType} onChange={e => setFilterContractType(e.target.value)} style={{ fontSize: '16px' }}>
              <option value="">Todos los tipos</option>
              <option value="MPS">MPS</option>
              <option value="Soporte">Soporte</option>
            </select>
            <select className="input text-sm" value={filterOwnership} onChange={e => setFilterOwnership(e.target.value)} style={{ fontSize: '16px' }}>
              <option value="">Todas las propiedades</option>
              <option value="alquiler">Alquiler</option>
              <option value="cliente">Propiedad del cliente</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-sky-50 flex items-center justify-center mb-4">
                <PrinterIcon size={28} className="text-sky-300" />
              </div>
              <p className="text-sm font-medium text-gray-400">Sin impresoras</p>
              <p className="text-xs text-gray-300 mt-1">Usa "Nueva" para registrar la primera</p>
            </div>
          ) : filtered.map(p => (
            <button
              key={p.id}
              onClick={() => { setSelected(p); setEditing(false); setMobileDetailOpen(true); navigate('/impresoras/' + p.id) }}
              className={`w-full flex items-start gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left ${selected?.id === p.id ? 'bg-sky-50 border-l-2 border-l-sky-500' : ''}`}
            >
              <div className="w-9 h-9 rounded-lg bg-sky-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <PrinterIcon size={16} className="text-sky-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{p.brand} {p.model}</p>
                <p className="text-xs text-gray-400 truncate font-mono">{p.serial_number || `#${p.id}`}{p.asset_id ? ` · ${p.asset_id}` : ''}</p>
                {p.ip_address && <p className="text-xs text-gray-300 font-mono">{p.ip_address}</p>}
                <div className="flex flex-wrap gap-1 mt-1">
                  <OwnershipBadge type={p.ownership_type} />
                  {contractsById[p.contract_id] && (
                    <ClientBadge name={`${contractsById[p.contract_id].contract_type} - ${contractsById[p.contract_id].client_company || contractsById[p.contract_id].client_name || ''}`} />
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className={`${mobileDetailOpen ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-y-auto overscroll-contain min-h-0 bg-gray-50`} {...detailSwipe}>
        {mobileDetailOpen && (
          <button onClick={() => { if (editing && !window.confirm('Hay cambios sin guardar. ¿Descartar?')) return; skipWarning(); cancelEdit(); setMobileDetailOpen(false); navigate(-1) }} className="md:hidden flex items-center gap-2 text-sm text-gray-500 px-4 py-3 border-b border-gray-100 bg-white">
            <ArrowLeft size={16} /> Volver
          </button>
        )}

        {editing ? (
          <PrinterForm
            initial={isNew ? EMPTY_FORM : selected}
            contracts={contracts}
            onSave={handleSave}
            onCancel={cancelEdit}
            saving={saving}
          />
        ) : selected && selected.id ? (
          <PrinterDetail printer={selected} contractsById={contractsById} onEdit={() => { setIsNew(false); setEditing(true) }} onDelete={handleDelete} />
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-center px-4">
            <div className="w-20 h-20 rounded-2xl bg-sky-50 flex items-center justify-center mb-4">
              <PrinterIcon size={36} className="text-sky-200" />
            </div>
            <p className="text-sm font-medium text-gray-400">Selecciona una impresora</p>
            <p className="text-xs text-gray-300 mt-1">o crea una nueva con el botón "Nueva"</p>
          </div>
        )}
      </div>
    </div>
  )
}
