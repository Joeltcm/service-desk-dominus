import { useState, useRef, useEffect } from 'react'

const FIELD_FILTER = {
  name:    (item, q) => item.name?.toLowerCase().includes(q) || item.company?.toLowerCase().includes(q) || item.email?.toLowerCase().includes(q),
  ruc:     (item, q) => item.ruc?.toLowerCase().includes(q),
  email:   (item, q) => item.email?.toLowerCase().includes(q),
  phone:   (item, q) => item.phone?.toLowerCase().includes(q),
  address: (item, q) => item.address?.toLowerCase().includes(q) || item.company?.toLowerCase().includes(q),
}

export default function ClientAutocomplete({
  value = '',
  onChange,
  onSelect,
  contacts = [],
  companies = [],
  suppliers = [],
  field = 'name',
  label,
  labelClassName = 'label',
  inputClassName = 'input',
  placeholder,
  required,
  type = 'text',
}) {
  const [open, setOpen] = useState(false)
  const [dropStyle, setDropStyle] = useState({})
  const wrapRef = useRef(null)
  const q = value.trim().toLowerCase()
  const filter = FIELD_FILTER[field] || FIELD_FILTER.name

  const suggestions = q.length < 1 ? [] : [
    ...suppliers
      .filter((s) => filter(s, q))
      .slice(0, 4)
      .map((s) => ({ _type: 'supplier', ...s, sub: [s.contact_name, s.email].filter(Boolean).join(' · ') })),
    ...companies
      .filter((co) => filter(co, q))
      .slice(0, 4)
      .map((co) => ({ _type: 'company', ...co, sub: [co.ruc, co.email].filter(Boolean).join(' · ') })),
    ...contacts
      .filter((c) => filter(c, q))
      .slice(0, 4)
      .map((c) => ({ _type: 'contact', ...c, sub: [c.company, c.email].filter(Boolean).join(' · ') })),
  ].slice(0, 8)

  const updateDropStyle = () => {
    if (!wrapRef.current) return
    const rect = wrapRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const flipUp = spaceBelow < 220
    setDropStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
      ...(flipUp
        ? { bottom: window.innerHeight - rect.top + 2 }
        : { top: rect.bottom + 2 }),
    })
  }

  useEffect(() => {
    if (!open) return
    updateDropStyle()
    window.addEventListener('scroll', updateDropStyle, true)
    window.addEventListener('resize', updateDropStyle)
    return () => {
      window.removeEventListener('scroll', updateDropStyle, true)
      window.removeEventListener('resize', updateDropStyle)
    }
  }, [open, value])

  return (
    <div className="relative" ref={wrapRef}>
      {label && <label className={labelClassName}>{label}</label>}
      <input
        type={type}
        className={inputClassName}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        // Delay so a click on a suggestion (onMouseDown -> onSelect) fires before
        // blur closes the dropdown; closing immediately would swallow the click.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        style={{ fontSize: '16px' }}
      />
      {open && suggestions.length > 0 && (
        <ul style={dropStyle} className="bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden max-h-60 overflow-y-auto">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={() => { onSelect(s); setOpen(false) }}
                className="w-full text-left px-3 py-2.5 hover:bg-blue-50 active:bg-blue-100 transition-colors flex items-start gap-2.5"
              >
                <span className={`mt-0.5 flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${
                  s._type === 'supplier' ? 'bg-amber-100 text-amber-700' :
                  s._type === 'company'  ? 'bg-indigo-100 text-indigo-600' :
                                           'bg-blue-100 text-blue-600'
                }`}>
                  {s._type === 'supplier' ? 'Proveedor' : s._type === 'company' ? 'Empresa' : 'Contacto'}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                  {s.sub && <p className="text-xs text-gray-400 truncate">{s.sub}</p>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
