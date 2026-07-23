const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

// Con registerType: 'prompt', el SW nuevo se instala pero se queda en estado
// "waiting" hasta que le mandamos { type: 'SKIP_WAITING' }. Este helper detecta
// ese estado y avisa vía callback para que la UI pueda pedir confirmación.
export function watchForUpdates(registration, onUpdateAvailable) {
  if (!registration || !('serviceWorker' in navigator)) return

  // Ya había una actualización esperando (p. ej. se instaló mientras la pestaña estaba cerrada)
  if (registration.waiting && navigator.serviceWorker.controller) {
    onUpdateAvailable(registration.waiting)
  }

  registration.addEventListener('updatefound', () => {
    const newWorker = registration.installing
    if (!newWorker) return
    newWorker.addEventListener('statechange', () => {
      // navigator.serviceWorker.controller solo existe si ya había una versión activa:
      // así distinguimos "primera instalación" (no avisar) de "actualización" (avisar)
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        onUpdateAvailable(newWorker)
      }
    })
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
