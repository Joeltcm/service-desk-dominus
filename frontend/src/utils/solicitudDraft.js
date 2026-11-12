// Borrador de solicitud por tipo (ticket, pedido, mantenimiento).
// Se guarda mientras el usuario escribe y se borra solo cuando el envío tiene éxito,
// así un fallo o una recarga no hacen perder lo capturado.
// Nota: las fotos son archivos y no se guardan en el borrador.

const key = (tipo) => `solicitud-borrador:${tipo}`

export function loadSolicitudDraft(tipo) {
  try {
    const raw = localStorage.getItem(key(tipo))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveSolicitudDraft(tipo, data) {
  try {
    localStorage.setItem(key(tipo), JSON.stringify({ ...data, savedAt: new Date().toISOString() }))
  } catch { /* almacenamiento lleno o bloqueado: el formulario sigue funcionando */ }
}

export function clearSolicitudDraft(tipo) {
  try { localStorage.removeItem(key(tipo)) } catch { /* noop */ }
}

// Convierte el borrador de "pendingRequest" (mismo formato que buildDraft) al formato del formulario.
export function draftFromPending(p) {
  if (!p) return null
  if (p.type === 'mantenimiento') {
    return {
      title: p.title || '',
      notes: p.notes || '',
      lines: (p.equipment && p.equipment.length) ? p.equipment.map((e) => ({ description: e.description ?? e.type ?? '', qty: e.qty || 1 })) : null,
      maintType: p.maint_type || 'preventivo',
      requestedDate: p.requested_date || '',
      contactName: p.contact_name || '',
      contactEmail: p.contact_email || '',
      contactPhone: p.contact_phone || '',
      location: p.location || '',
    }
  }
  let lines = null
  if (p.items) {
    try { lines = JSON.parse(p.items).map((l) => ({ description: l.description || '', qty: l.qty || 1 })) } catch { lines = null }
  }
  return { title: p.title || '', notes: p.notes || '', lines }
}
