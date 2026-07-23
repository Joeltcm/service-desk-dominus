import { formatInTimeZone } from 'date-fns-tz'
import { es } from 'date-fns/locale'

// ── Configuración mutable (se actualiza al inicio desde el backend) ──
const _saved = (() => {
  try { return JSON.parse(localStorage.getItem('fmtConfig') || '{}') } catch { return {} }
})()

let _TZ       = _saved.tz         || 'America/Panama'
let _DATE_FMT = _saved.dateFormat  || 'dd/MM/yyyy'
let _TIME_12  = _saved.time12 !== false  // default 12h

export function setFmtConfig({ tz, dateFormat, time12 } = {}) {
  if (tz)                  _TZ       = tz
  if (dateFormat)          _DATE_FMT = dateFormat
  if (time12 !== undefined) _TIME_12  = Boolean(time12)
  try {
    localStorage.setItem('fmtConfig', JSON.stringify({ tz: _TZ, dateFormat: _DATE_FMT, time12: _TIME_12 }))
  } catch {}
}

export function getFmtTz() { return _TZ }

function timePat() { return _TIME_12 ? 'hh:mm aa' : 'HH:mm' }

// Convierte cualquier valor de fecha/hora al instante UTC correcto:
// - Strings con offset (Z o ±HH:MM): se parsean directamente
// - Strings solo fecha (sin T): mediodía UTC para evitar cruce de día en cualquier zona
// - Datetime sin offset: se interpreta como hora local en la zona configurada
export function toUTC(value) {
  if (!value) return null
  const s = String(value)
  if (s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s)) return new Date(s)
  if (!s.includes('T')) return new Date(s + 'T12:00:00Z')
  // El backend siempre devuelve UTC sin sufijo Z — tratar como UTC directo
  return new Date(s + 'Z')
}

// dd/MM/yyyy hh:mm aa  → configurable según ajustes
export function fmtDT(value, pattern) {
  const d = toUTC(value)
  if (!d || isNaN(d)) return '—'
  return formatInTimeZone(d, _TZ, pattern || `${_DATE_FMT} ${timePat()}`)
}

// dd/MM/yyyy → formato de fecha configurable
export function fmtD(value, pattern) {
  const d = toUTC(value)
  if (!d || isNaN(d)) return '—'
  return formatInTimeZone(d, _TZ, pattern || _DATE_FMT, { locale: es })
}

// hh:mm aa → formato de hora configurable
export function fmtTime(value) {
  const d = toUTC(value)
  if (!d || isNaN(d)) return '—'
  return formatInTimeZone(d, _TZ, timePat())
}

// Etiquetas de hora para el calendario (7:00 AM / 07:00)
export function fmtHourLabel(h) {
  if (_TIME_12) {
    const ampm = h >= 12 ? 'PM' : 'AM'
    return `${h % 12 || 12}:00 ${ampm}`
  }
  return `${String(h).padStart(2, '0')}:00`
}
