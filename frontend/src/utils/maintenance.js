// Lógica compartida del flujo de mantenimiento (solicitud pública y borrador tras login).

export const MAINT_TYPES = [
  { value: 'preventivo', label: 'Preventivo', desc: 'Revisión y mantenimiento periódico' },
  { value: 'correctivo', label: 'Correctivo', desc: 'Reparar una falla o avería' },
]

// Campos obligatorios de la solicitud (el correo de confirmación va al contacto).
export const MAINT_REQUIRED = [
  { key: 'contact_name', label: 'Nombre del contacto' },
  { key: 'contact_email', label: 'Correo' },
  { key: 'contact_phone', label: 'Teléfono' },
  { key: 'location', label: 'Ubicación' },
]

// Devuelve los nombres de los campos que faltan (lista vacía = válido).
export function missingMaintFields(draft) {
  const missing = MAINT_REQUIRED
    .filter((f) => !String(draft[f.key] || '').trim())
    .map((f) => f.label)
  const hasEquipment = (draft.equipment || []).some((e) => (e.description || '').trim())
  if (!hasEquipment) missing.push('Equipos de la flota')
  return missing
}

// Convierte el borrador en el payload de POST /tickets (categoría Mantenimiento).
export function buildMaintTicket(draft, { statusId, clientId }) {
  const equipment = (draft.equipment || [])
    .filter((e) => (e.description || '').trim())
    .map((e) => ({ type: e.description.trim(), qty: Number(e.qty) || 1 }))
  return {
    title: (draft.title || '').trim() || 'Mantenimiento',
    description: (draft.notes || '').trim(),
    priority: 'medium',
    status_id: statusId,
    client_id: clientId,
    category: 'Mantenimiento',
    location: (draft.location || '').trim(),
    maint_type: draft.maint_type || 'preventivo',
    maint_equipment: JSON.stringify(equipment),
    maint_requested_date: draft.requested_date || null,
    maint_contact_name: (draft.contact_name || '').trim(),
    maint_contact_email: (draft.contact_email || '').trim(),
    maint_contact_phone: (draft.contact_phone || '').trim(),
  }
}

// ── Fechas: el backend envía ISO sin zona (UTC). Se muestran en hora de Panamá. ──
export const parseIso = (iso) => new Date(/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + 'Z')

export const fmtPanama = (iso) => {
  if (!iso) return '—'
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Panama', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(parseIso(iso))
  const g = (t) => p.find((x) => x.type === t)?.value
  return `${g('day')}-${g('month')}-${g('year')} ${g('hour')}:${g('minute')}`
}

// ISO → valor de <input type="datetime-local"> en hora de Panamá.
export const toPanamaInput = (iso) => {
  if (!iso) return ''
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Panama', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(parseIso(iso))
  const g = (t) => p.find((x) => x.type === t)?.value
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}

// Minutos entre dos valores datetime-local (Panamá, UTC-5 fijo).
export const minutesBetween = (startLocal, endLocal) => {
  if (!startLocal || !endLocal) return null
  return Math.round((Date.parse(endLocal + ':00-05:00') - Date.parse(startLocal + ':00-05:00')) / 60000)
}

export const parseEquipment = (s) => { try { return JSON.parse(s || '[]') } catch { return [] } }
