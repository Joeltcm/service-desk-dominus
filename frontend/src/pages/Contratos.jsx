import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTouchSwipe } from '../utils/useTouchSwipe'
import ClientAutocomplete from '../components/ClientAutocomplete'
import {
  getContracts, createContract, updateContract, deleteContract,
  getNextContractNumber, getContacts, getCompanies,
  createContact, createCompany, getPrinters,
} from '../services/api'
import {
  Plus, Search, X, Save, Pencil, Trash2, ArrowLeft,
  FileText, Calendar, Hash, UserPlus, Building2,
  Clock, AlertTriangle, CheckCircle2, Shield, Zap, Wrench,
  Printer as PrinterIcon, ChevronRight,
} from 'lucide-react'
import { fmtD } from '../utils/fmt'
import toast from 'react-hot-toast'
import { useUnsavedWarning } from '../hooks/useUnsavedWarning'

function getDaysInfo(endDate) {
  if (!endDate) return null
  const end = new Date(endDate + 'T12:00:00')
  const diffDays = Math.ceil((end - new Date()) / 86400000)
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

function ContractCountdownBanner({ endDate }) {
  const info = getDaysInfo(endDate)
  if (!info) return null
  if (info.expired) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-100">
        <AlertTriangle size={18} className="text-red-500 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-700">Contrato vencido</p>
          <p className="text-xs text-red-400">Venció hace {info.label} · {info.endDate.toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
        </div>
      </div>
    )
  }
  const color = info.diffDays <= 30 ? 'red' : info.diffDays <= 90 ? 'amber' : 'green'
  const styles = {
    red:   { wrap: 'bg-red-50 border-red-100',    icon: 'text-red-500',    title: 'text-red-700',    sub: 'text-red-400',    Icon: AlertTriangle },
    amber: { wrap: 'bg-amber-50 border-amber-100', icon: 'text-amber-500',  title: 'text-amber-700',  sub: 'text-amber-400',  Icon: Clock         },
    green: { wrap: 'bg-green-50 border-green-100', icon: 'text-green-500',  title: 'text-green-700',  sub: 'text-green-400',  Icon: CheckCircle2  },
  }
  const s = styles[color]
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${s.wrap}`}>
      <s.Icon size={18} className={`${s.icon} flex-shrink-0`} />
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${s.title}`}>{info.label} restantes</p>
        <p className={`text-xs ${s.sub}`}>Vence: {info.endDate.toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
      </div>
    </div>
  )
}

const STATUSES = ['Activo', 'Suspendido', 'Cancelado', 'Vencido']

const STATUS_STYLE = {
  Activo:     'bg-green-100 text-green-700',
  Suspendido: 'bg-amber-100 text-amber-700',
  Cancelado:  'bg-red-100 text-red-700',
  Vencido:    'bg-gray-100 text-gray-600',
}

const CONTRACT_TYPES = ['Soporte Mensual', 'Soporte por Horas', 'Mantenimiento Preventivo', 'Proyecto']

const CONTRACT_TYPE_STYLE = {
  'Soporte Mensual':          'bg-blue-100 text-blue-700',
  'Soporte por Horas':        'bg-purple-100 text-purple-700',
  'Mantenimiento Preventivo': 'bg-teal-100 text-teal-700',
  'Proyecto':                 'bg-orange-100 text-orange-700',
}

const CONTRACT_TYPE_ICON = {
  'Soporte Mensual':          Shield,
  'Soporte por Horas':        Clock,
  'Mantenimiento Preventivo': Wrench,
  'Proyecto':                 Zap,
}

const BILLING_CYCLES = ['Mensual', 'Trimestral', 'Anual', 'Único']

const RESPONSE_TIMES = ['2 horas', '4 horas', '8 horas', 'Día hábil siguiente', 'No aplica']

const COVERAGE_HOURS = ['L-V 8am–5pm', 'L-V 8am–5pm + Sábados', '24/7', 'No aplica']

const EMPTY_FORM = {
  contract_number: '',
  client_name: '',
  client_company: '',
  client_ruc: '',
  status: 'Activo',
  contract_type: 'Soporte Mensual',
  start_date: new Date().toISOString().split('T')[0],
  end_date: '',
  billing_cycle: 'Mensual',
  monthly_base_fee: '',
  service_scope: '',
  response_time: '',
  coverage_hours: '',
  included_hours: 0,
  included_visits: 0,
  notes: '',
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function TypeBadge({ type }) {
  const t = type || 'Soporte Mensual'
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${CONTRACT_TYPE_STYLE[t] || 'bg-gray-100 text-gray-600'}`}>
      {t}
    </span>
  )
}

function InfoRow({ label, value }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-start gap-2">
      <p className="text-xs text-gray-400 w-28 flex-shrink-0 pt-0.5">{label}</p>
      <p className="text-sm text-gray-800 font-medium flex-1">{value}</p>
    </div>
  )
}

function ContractPrinters({ contractId }) {
  const navigate = useNavigate()
  const [printers, setPrinters] = useState(null)
  useEffect(() => {
    let alive = true
    getPrinters({ contract_id: contractId })
      .then(r => { if (alive) setPrinters(r.data) })
      .catch(() => { if (alive) setPrinters([]) })
    return () => { alive = false }
  }, [contractId])

  if (printers === null) return null
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
          <PrinterIcon size={13} /> Impresoras del contrato
        </p>
        <span className="text-xs font-medium text-sky-500">{printers.length}</span>
      </div>
      {printers.length === 0 ? (
        <p className="text-xs text-gray-400">Sin impresoras asignadas a este contrato.</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {printers.map(p => (
            <button key={p.id} onClick={() => navigate('/impresoras/' + p.id)}
              className="w-full flex items-center gap-2 py-2 text-left hover:bg-gray-50 -mx-1 px-1 rounded transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800 font-medium truncate">
                  {p.model || 'Impresora'} <span className="font-mono text-xs text-gray-400">{p.serial_number}</span>
                </p>
                {p.location && <p className="text-xs text-gray-500 truncate">{p.location}</p>}
              </div>
              {p.status === 'Baja' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 flex-shrink-0">Baja</span>}
              <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ContractDetail({ contract, onEdit, onDelete }) {
  const TypeIcon = CONTRACT_TYPE_ICON[contract.contract_type] || Shield
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className="w-14 h-14 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
            <TypeIcon size={26} className="text-blue-500" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-mono text-gray-400">{contract.contract_number}</p>
            <h2 className="text-lg font-bold text-gray-900 mt-0.5 leading-tight">{contract.client_name || contract.client_company || 'Sin cliente'}</h2>
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              <TypeBadge type={contract.contract_type} />
              <StatusBadge status={contract.status} />
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

      <ContractCountdownBanner endDate={contract.end_date} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Cliente */}
        <div className="card space-y-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Cliente</p>
          {contract.client_name && <p className="text-sm font-medium text-gray-800">{contract.client_name}</p>}
          {contract.client_company && <p className="text-sm text-gray-700">{contract.client_company}</p>}
          {contract.client_ruc && <p className="text-xs text-gray-500">RUC: {contract.client_ruc}</p>}
        </div>

        {/* Vigencia y facturación */}
        <div className="card space-y-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Vigencia y facturación</p>
          <InfoRow label="Inicio" value={fmtD(contract.start_date)} />
          {contract.end_date && <InfoRow label="Fin" value={fmtD(contract.end_date)} />}
          <InfoRow label="Ciclo" value={contract.billing_cycle} />
          {contract.monthly_base_fee && (
            <InfoRow label={contract.billing_cycle === 'Único' ? 'Monto' : 'Cuota'} value={`$${contract.monthly_base_fee}`} />
          )}
        </div>

        {/* SLA y cobertura */}
        <div className="card space-y-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">SLA y cobertura</p>
          <InfoRow label="Tiempo de respuesta" value={contract.response_time} />
          <InfoRow label="Horario de atención" value={contract.coverage_hours} />
          {contract.included_hours > 0 && <InfoRow label="Horas incluidas" value={`${contract.included_hours} h / período`} />}
          {contract.included_visits > 0 && <InfoRow label="Visitas incluidas" value={`${contract.included_visits} / período`} />}
        </div>

        {/* Alcance del servicio */}
        {contract.service_scope && (
          <div className="card space-y-1.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Alcance del servicio</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{contract.service_scope}</p>
          </div>
        )}
      </div>

      {contract.notes && (
        <div className="card bg-amber-50 border-amber-100">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Notas</p>
          <p className="text-sm text-amber-800 whitespace-pre-wrap">{contract.notes}</p>
        </div>
      )}

      <ContractPrinters contractId={contract.id} />

      <p className="text-xs text-gray-300 text-right">Creado: {fmtD(contract.created_at)}</p>
    </div>
  )
}

function ContractForm({ initial, contacts, companies, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY_FORM)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const [contactHint, setContactHint] = useState(null)
  const [extraContacts, setExtraContacts] = useState([])
  const [extraCompanies, setExtraCompanies] = useState([])
  const allContacts = [...extraContacts, ...contacts]
  const allCompanies = [...extraCompanies, ...companies]
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ name: '', company: '', ruc: '', email: '', phone: '' })
  const [savingContact, setSavingContact] = useState(false)
  const [companyDrop, setCompanyDrop] = useState([])
  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [companyForm, setCompanyForm] = useState({ name: '', ruc: '', email: '', phone: '' })
  const [savingCompany, setSavingCompany] = useState(false)

  const fillFromName = (c) => {
    if (c._type === 'company') {
      setForm(f => ({ ...f, client_company: c.name, client_ruc: c.ruc || f.client_ruc }))
      setContactHint(null)
    } else {
      setForm(f => ({ ...f, client_name: c.name, client_ruc: c.ruc || f.client_ruc }))
      setContactHint(c.company ? { company: c.company, ruc: c.ruc } : null)
    }
  }
  const fillFromCompany = (c) => {
    const name = c._type === 'company' ? c.name : (c.company || c.name)
    setForm(f => ({ ...f, client_company: name, client_ruc: c.ruc || f.client_ruc }))
  }
  const fillFromRuc = (c) => {
    setForm(f => ({
      ...f,
      client_name: c.name || f.client_name,
      client_company: c._type === 'company' ? c.name : (c.company || f.client_company),
      client_ruc: c.ruc || f.client_ruc,
    }))
  }

  const handleCreateContact = async (e) => {
    e.preventDefault()
    if (!contactForm.name.trim()) return
    setSavingContact(true)
    try {
      const res = await createContact({ name: contactForm.name, company: contactForm.company || null, ruc: contactForm.ruc || null, email: contactForm.email || null, phone: contactForm.phone || null })
      const c = res.data
      setExtraContacts(prev => [c, ...prev])
      setForm(f => ({ ...f, client_name: c.name, client_ruc: c.ruc || f.client_ruc }))
      if (c.company) setContactHint({ company: c.company, ruc: c.ruc })
      setShowContactModal(false)
      setContactForm({ name: '', company: '', ruc: '', email: '', phone: '' })
      toast.success(`Contacto "${c.name}" creado`)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error creando contacto')
    } finally { setSavingContact(false) }
  }

  const handleCreateCompany = async (e) => {
    e.preventDefault()
    if (!companyForm.name.trim()) return
    setSavingCompany(true)
    try {
      const res = await createCompany({ name: companyForm.name, ruc: companyForm.ruc || null, email: companyForm.email || null, phone: companyForm.phone || null })
      const co = res.data
      setExtraCompanies(prev => [co, ...prev])
      setForm(f => ({ ...f, client_company: co.name, client_ruc: co.ruc || f.client_ruc }))
      setShowCompanyModal(false)
      setCompanyForm({ name: '', ruc: '', email: '', phone: '' })
      toast.success(`Empresa "${co.name}" creada`)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error creando empresa')
    } finally { setSavingCompany(false) }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.client_name?.trim() && !form.client_company?.trim()) return toast.error('Ingresa al menos el nombre del cliente o la empresa')
    onSave({
      ...form,
      end_date: form.end_date || null,
      monthly_base_fee: form.monthly_base_fee || null,
      service_scope: form.service_scope || null,
      response_time: form.response_time || null,
      coverage_hours: form.coverage_hours || null,
      included_hours: Number(form.included_hours) || 0,
      included_visits: Number(form.included_visits) || 0,
    })
  }

  const isHourly = form.contract_type === 'Soporte por Horas'
  const isProject = form.contract_type === 'Proyecto'

  return (
    <>
    <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between -mb-1">
        <h2 className="font-bold text-gray-900">{initial?.id ? 'Editar contrato' : 'Nuevo contrato'}</h2>
        <button type="button" onClick={onCancel}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
      </div>

      {/* Identificación */}
      <div className="card grid grid-cols-2 gap-3">
        <div>
          <label className="label">N° Contrato</label>
          <input className="input font-mono" value={form.contract_number} onChange={e => set('contract_number', e.target.value)} placeholder="CONT-0001" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Estado</label>
          <select className="input" value={form.status} onChange={e => set('status', e.target.value)} style={{ fontSize: '16px' }}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Tipo de contrato</label>
          <select className="input" value={form.contract_type || 'Soporte Mensual'} onChange={e => set('contract_type', e.target.value)} style={{ fontSize: '16px' }}>
            {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Cliente */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Cliente</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => { setContactForm({ name: form.client_name, company: form.client_company, ruc: '', email: '', phone: '' }); setShowContactModal(true) }} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
              <UserPlus size={12} /> Nuevo contacto
            </button>
            <span className="text-gray-200">|</span>
            <button type="button" onClick={() => { setCompanyForm({ name: form.client_company, ruc: form.client_ruc, email: '', phone: '' }); setShowCompanyModal(true) }} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium">
              <Building2 size={12} /> Nueva empresa
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <ClientAutocomplete field="name" label="Nombre del contacto" value={form.client_name} onChange={v => { set('client_name', v); setContactHint(null) }} onSelect={fillFromName} contacts={allContacts} companies={allCompanies} placeholder="Buscar o escribir nombre..." />
          </div>
          {contactHint && (
            <div className="sm:col-span-2 flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-lg">
              <Building2 size={11} className="flex-shrink-0" />
              <span>Empresa del contacto: <strong>{contactHint.company}</strong></span>
              <button type="button" onClick={() => { setForm(f => ({ ...f, client_company: contactHint.company, client_ruc: contactHint.ruc || f.client_ruc })); setContactHint(null) }} className="ml-auto text-indigo-600 hover:text-indigo-800 font-semibold whitespace-nowrap">Usar →</button>
            </div>
          )}
          <div>
            <ClientAutocomplete field="name" label="Empresa" value={form.client_company} onChange={v => { set('client_company', v); setContactHint(null) }} onSelect={fillFromCompany} contacts={[]} companies={allCompanies} placeholder="Empresa del cliente" />
          </div>
          <div>
            <ClientAutocomplete field="ruc" label="RUC" value={form.client_ruc} onChange={v => set('client_ruc', v)} onSelect={fillFromRuc} contacts={allContacts} companies={allCompanies} placeholder="RUC del cliente" />
          </div>
        </div>
      </div>

      {/* Vigencia y facturación */}
      <div className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
        <p className="col-span-full text-xs font-semibold text-gray-400 uppercase tracking-wide">Vigencia y facturación</p>
        <div>
          <label className="label">Fecha de inicio</label>
          <input type="date" className="input" value={form.start_date} onChange={e => set('start_date', e.target.value)} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Fecha de fin {isProject ? '' : '(renovación)'}</label>
          <input type="date" className="input" value={form.end_date} onChange={e => set('end_date', e.target.value)} style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="label">Ciclo de facturación</label>
          <select className="input" value={form.billing_cycle} onChange={e => set('billing_cycle', e.target.value)} style={{ fontSize: '16px' }}>
            {BILLING_CYCLES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{isProject ? 'Monto del proyecto' : 'Cuota'} {isHourly ? '(por hora)' : ''}</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input className="input pl-6" value={form.monthly_base_fee || ''} onChange={e => set('monthly_base_fee', e.target.value)} placeholder="0.00" style={{ fontSize: '16px' }} />
          </div>
        </div>
      </div>

      {/* SLA y cobertura */}
      <div className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
        <p className="col-span-full text-xs font-semibold text-gray-400 uppercase tracking-wide">SLA y cobertura</p>
        <div>
          <label className="label">Tiempo de respuesta</label>
          <select className="input" value={form.response_time || ''} onChange={e => set('response_time', e.target.value)} style={{ fontSize: '16px' }}>
            <option value="">Sin definir</option>
            {RESPONSE_TIMES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Horario de atención</label>
          <select className="input" value={form.coverage_hours || ''} onChange={e => set('coverage_hours', e.target.value)} style={{ fontSize: '16px' }}>
            <option value="">Sin definir</option>
            {COVERAGE_HOURS.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
        {!isProject && (
          <>
            <div>
              <label className="label">Horas incluidas / período</label>
              <input type="number" min="0" className="input" value={form.included_hours} onChange={e => set('included_hours', e.target.value)} style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="label">Visitas incluidas / período</label>
              <input type="number" min="0" className="input" value={form.included_visits} onChange={e => set('included_visits', e.target.value)} style={{ fontSize: '16px' }} />
            </div>
          </>
        )}
      </div>

      {/* Alcance */}
      <div className="card">
        <label className="label">Alcance del servicio</label>
        <textarea className="input resize-none" rows={3} value={form.service_scope || ''} onChange={e => set('service_scope', e.target.value)} placeholder="Equipos cubiertos, ubicaciones, exclusiones, condiciones especiales..." style={{ fontSize: '16px' }} />
      </div>

      {/* Notas */}
      <div className="card">
        <label className="label">Notas internas</label>
        <textarea className="input resize-none" rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} style={{ fontSize: '16px' }} />
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

    {/* Modal nuevo contacto */}
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
                <label className="label">Nombre *</label>
                <input className="input" value={contactForm.name} onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))} placeholder="Nombre completo" required autoFocus style={{ fontSize: '16px' }} />
              </div>
              <div className="relative">
                <label className="label">Empresa</label>
                <input className="input" value={contactForm.company}
                  onChange={e => { const v = e.target.value; setContactForm(f => ({ ...f, company: v })); setCompanyDrop(v.trim() ? allCompanies.filter(co => co.name.toLowerCase().includes(v.toLowerCase())) : []) }}
                  onBlur={() => setTimeout(() => setCompanyDrop([]), 150)}
                  placeholder="Empresa" style={{ fontSize: '16px' }} autoComplete="off" />
                {companyDrop.length > 0 && (
                  <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {companyDrop.map(co => (
                      <li key={co.id} onMouseDown={() => { setContactForm(f => ({ ...f, company: co.name, ruc: co.ruc || f.ruc })); setCompanyDrop([]) }} className="px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm">
                        <span className="font-medium">{co.name}</span>
                        {co.ruc && <span className="text-gray-400 ml-2 text-xs">RUC: {co.ruc}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <label className="label">RUC</label>
                <input className="input" value={contactForm.ruc} onChange={e => setContactForm(f => ({ ...f, ruc: e.target.value }))} placeholder="RUC" style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={contactForm.email} onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} placeholder="correo@cliente.com" style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="label">Teléfono</label>
                <input className="input" value={contactForm.phone} onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))} placeholder="+507 0000-0000" style={{ fontSize: '16px' }} />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={() => setShowContactModal(false)} className="btn-secondary">Cancelar</button>
              <button type="submit" disabled={savingContact || !contactForm.name.trim()} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                <UserPlus size={14} />{savingContact ? 'Guardando...' : 'Crear contacto'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}

    {/* Modal nueva empresa */}
    {showCompanyModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
          <div className="flex items-center justify-between p-5 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Building2 size={16} className="text-indigo-600" />Nueva empresa</h3>
            <button onClick={() => setShowCompanyModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
          </div>
          <form onSubmit={handleCreateCompany} className="p-5 space-y-3">
            <div>
              <label className="label">Nombre *</label>
              <input className="input" value={companyForm.name} onChange={e => setCompanyForm(f => ({ ...f, name: e.target.value }))} placeholder="Nombre de la empresa" required autoFocus style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="label">RUC</label>
              <input className="input" value={companyForm.ruc} onChange={e => setCompanyForm(f => ({ ...f, ruc: e.target.value }))} placeholder="RUC" style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={companyForm.email} onChange={e => setCompanyForm(f => ({ ...f, email: e.target.value }))} placeholder="correo@empresa.com" style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="label">Teléfono</label>
              <input className="input" value={companyForm.phone} onChange={e => setCompanyForm(f => ({ ...f, phone: e.target.value }))} placeholder="+507 0000-0000" style={{ fontSize: '16px' }} />
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={() => setShowCompanyModal(false)} className="btn-secondary">Cancelar</button>
              <button type="submit" disabled={savingCompany || !companyForm.name.trim()} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                <Building2 size={14} />{savingCompany ? 'Guardando...' : 'Crear empresa'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
    </>
  )
}

export default function Contratos() {
  const navigate = useNavigate()
  const { ref: urlRef } = useParams()
  const [contracts, setContracts] = useState([])
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const { skip: skipWarning } = useUnsavedWarning(editing)
  const detailSwipe = useTouchSwipe({ onSwipeRight: () => { setMobileDetailOpen(false); navigate(-1) } })
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [contacts, setContacts] = useState([])
  const [companies, setCompanies] = useState([])

  const load = useCallback(() => {
    getContracts().then(r => setContracts(r.data)).catch(() => toast.error('Error cargando contratos'))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!urlRef) { if (selected) { setSelected(null); setMobileDetailOpen(false) } return }
    if (contracts.length === 0) return
    if (selected?.contract_number === urlRef) return
    const found = contracts.find((c) => c.contract_number === urlRef)
    if (found) { setSelected(found); setEditing(false); setMobileDetailOpen(true) }
  }, [urlRef, contracts]) // eslint-disable-line

  useEffect(() => {
    Promise.allSettled([getContacts(), getCompanies()]).then(([conr, compr]) => {
      if (conr.status === 'fulfilled') setContacts(conr.value.data)
      if (compr.status === 'fulfilled') setCompanies(compr.value.data)
    })
  }, [])

  const filtered = contracts.filter(c => {
    const q = search.toLowerCase()
    const match = !q || [c.contract_number, c.client_name, c.client_company, c.client_ruc].some(v => v?.toLowerCase().includes(q))
    const matchStatus = !filterStatus || c.status === filterStatus
    const matchType = !filterType || c.contract_type === filterType
    return match && matchStatus && matchType
  })

  const handleNew = async () => {
    const num = await getNextContractNumber().then(r => r.data.number).catch(() => 'CONT-0001')
    setIsNew(true)
    setEditing(true)
    setMobileDetailOpen(true)
    setSelected({ contract_number: num })
  }

  const handleSave = async (payload) => {
    setSaving(true)
    try {
      let saved
      if (isNew) {
        saved = await createContract(payload).then(r => r.data)
        toast.success('Contrato creado')
      } else {
        saved = await updateContract(selected.id, payload).then(r => r.data)
        toast.success('Contrato guardado')
      }
      setSelected(saved)
      setContracts(prev => isNew ? [saved, ...prev] : prev.map(c => c.id === saved.id ? saved : c))
      setEditing(false)
      setIsNew(false)
      navigate('/contratos/' + saved.contract_number, { replace: true })
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error guardando contrato')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected || !confirm(`¿Eliminar contrato ${selected.contract_number}?`)) return
    try {
      await deleteContract(selected.id)
      setContracts(prev => prev.filter(c => c.id !== selected.id))
      setSelected(null)
      setMobileDetailOpen(false)
      navigate('/contratos', { replace: true })
      toast.success('Contrato eliminado')
    } catch { toast.error('Error eliminando') }
  }

  const cancelEdit = () => {
    setEditing(false)
    setIsNew(false)
    if (isNew) { setSelected(null); setMobileDetailOpen(false); navigate('/contratos', { replace: true }) }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Lista */}
      <div className={`${mobileDetailOpen ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-gray-200 bg-white flex-shrink-0`}>
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Contratos</h1>
              <p className="text-xs text-blue-500 font-medium mt-0.5">{filtered.length} contrato{filtered.length !== 1 ? 's' : ''}</p>
            </div>
            <button onClick={handleNew} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
              <Plus size={15} /> Nuevo
            </button>
          </div>
        </div>

        <div className="px-4 py-3 space-y-2 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-8 w-full text-sm" placeholder="Buscar contrato, cliente, RUC..." value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: '16px' }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select className="input text-sm" value={filterType} onChange={e => setFilterType(e.target.value)} style={{ fontSize: '16px' }}>
              <option value="">Todos los tipos</option>
              {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="input text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ fontSize: '16px' }}>
              <option value="">Todos los estados</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
                <FileText size={28} className="text-blue-300" />
              </div>
              <p className="text-sm font-medium text-gray-400">Sin contratos</p>
              <p className="text-xs text-gray-300 mt-1">Usa "Nuevo" para registrar el primero</p>
            </div>
          ) : filtered.map(c => {
            const TypeIcon = CONTRACT_TYPE_ICON[c.contract_type] || Shield
            return (
              <button
                key={c.id}
                onClick={() => { setSelected(c); setEditing(false); setMobileDetailOpen(true); navigate('/contratos/' + c.contract_number) }}
                className={`w-full flex items-start gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left ${selected?.id === c.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}
              >
                <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <TypeIcon size={16} className="text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-gray-400 flex items-center gap-1"><Hash size={9} />{c.contract_number}</p>
                  <p className="text-sm font-medium text-gray-900 truncate">{c.client_name || c.client_company || 'Sin cliente'}</p>
                  {c.client_company && c.client_name && <p className="text-xs text-gray-400 truncate">{c.client_company}</p>}
                  {(() => {
                    const info = getDaysInfo(c.end_date)
                    if (!info) return null
                    const color = info.expired ? 'text-red-500' : info.diffDays <= 30 ? 'text-amber-500' : info.diffDays <= 90 ? 'text-yellow-600' : 'text-green-600'
                    return <p className={`text-xs font-medium mt-0.5 ${color}`}>{info.expired ? `Vencido hace ${info.label}` : `${info.label} restantes`}</p>
                  })()}
                </div>
                <div className="flex-shrink-0 pt-0.5 flex flex-col items-end gap-1">
                  <TypeBadge type={c.contract_type} />
                  <StatusBadge status={c.status} />
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Detalle / Formulario */}
      <div className={`${mobileDetailOpen ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-y-auto overscroll-contain min-h-0 bg-gray-50`} {...detailSwipe}>
        {mobileDetailOpen && (
          <button onClick={() => { if (editing && !window.confirm('Hay cambios sin guardar. ¿Descartar?')) return; skipWarning(); cancelEdit(); setMobileDetailOpen(false); navigate(-1) }} className="md:hidden flex items-center gap-2 text-sm text-gray-500 px-4 py-3 border-b border-gray-100 bg-white">
            <ArrowLeft size={16} /> Volver
          </button>
        )}

        {editing ? (
          <ContractForm
            initial={isNew ? { ...EMPTY_FORM, contract_number: selected?.contract_number || '' } : selected}
            contacts={contacts}
            companies={companies}
            onSave={handleSave}
            onCancel={cancelEdit}
            saving={saving}
          />
        ) : selected && selected.id ? (
          <ContractDetail contract={selected} onEdit={() => { setIsNew(false); setEditing(true) }} onDelete={handleDelete} />
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-center px-4">
            <div className="w-20 h-20 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
              <FileText size={36} className="text-blue-200" />
            </div>
            <p className="text-sm font-medium text-gray-400">Selecciona un contrato</p>
            <p className="text-xs text-gray-300 mt-1">o crea uno nuevo con el botón "Nuevo"</p>
          </div>
        )}
      </div>
    </div>
  )
}
