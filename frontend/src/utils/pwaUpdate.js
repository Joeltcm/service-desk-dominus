const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

// Con registerType: 'prompt', el SW nuevo se instala pero se queda en estado
// "waiting" hasta que le mandamos { type: 'SKIP_WAITING' }. Este helper detecta
// ese estado y avisa vía callback para que la UI pueda pedir confirmación.
export function watchForUpdates(registration, onUpdateAvailable) {
  if (!registration || !('serviceWorker' in navigator)) return

  // Dedupe: solo avisamos una vez por worker nuevo (evita toast doble si el mismo
  // update lo detectan dos ramas a la vez).
  let notified = false
  const notify = (worker) => {
    if (notified || !worker) return
    notified = true
    onUpdateAvailable(worker)
  }

  // navigator.serviceWorker.controller solo existe si ya había una versión activa:
  // así distinguimos "primera instalación" (no avisar) de "actualización" (avisar).
  const trackWorker = (worker) => {
    if (!worker) return
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      notify(worker)
      return
    }
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        notify(worker)
      }
    })
  }

  // 1) Ya había una actualización esperando (se instaló con la pestaña cerrada)
  if (registration.waiting && navigator.serviceWorker.controller) {
    notify(registration.waiting)
  }
  // 2) Ya hay una instalándose ahora mismo — cubre la carrera en que el SW nuevo se
  //    descubrió durante register(), antes de enganchar el listener 'updatefound'.
  if (registration.installing) {
    trackWorker(registration.installing)
  }
  // 3) Cualquier actualización que se descubra de aquí en adelante.
  registration.addEventListener('updatefound', () => {
    trackWorker(registration.installing)
  })

  const checkForUpdate = () => registration.update().catch(() => {})
  setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
}

export function applyUpdate(worker) {
  return new Promise((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
    worker.postMessage({ type: 'SKIP_WAITING' })
  })
}
