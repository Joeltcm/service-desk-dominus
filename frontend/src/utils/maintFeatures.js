import { useEffect, useState } from 'react'
import { getMaintFeatures, getPublicMaintFeatures } from '../services/api'

// Interruptores del módulo de mantenimiento (los cambia el superadmin en /system).
// Se piden una sola vez por sesión de página; si falla la lectura, todo queda activo.
let staffCache = null
let publicCache = null

export function loadMaintFeatures() {
  if (!staffCache) staffCache = getMaintFeatures().then((r) => r.data.features).catch(() => null)
  return staffCache
}

export function resetMaintFeatures() { staffCache = null }

// Hook: devuelve el mapa de interruptores (vacío mientras carga). Una función es activa salvo que sea false.
export function useMaintFeatures({ publicOnly = false } = {}) {
  const [features, setFeatures] = useState(null)
  useEffect(() => {
    let alive = true
    let p
    if (publicOnly) {
      if (!publicCache) publicCache = getPublicMaintFeatures().then((r) => r.data).catch(() => null)
      p = publicCache
    } else {
      p = loadMaintFeatures()
    }
    p.then((v) => { if (alive) setFeatures(v || {}) })
    return () => { alive = false }
  }, [publicOnly])
  return features || {}
}

export const featureOn = (features, key) => features?.[key] !== false
