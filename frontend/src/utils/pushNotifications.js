import api from '../services/api'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    return reg
  } catch {
    return null
  }
}

async function swReady(timeoutMs = 8000) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('El service worker tardó demasiado en activarse')), timeoutMs)
    ),
  ])
}

export async function subscribeToPush() {
  const reg = await swReady()
  const { data } = await api.get('/push/vapid-public-key')
  const applicationServerKey = urlBase64ToUint8Array(data.public_key)
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
  const json = sub.toJSON()
  await api.post('/push/subscribe', {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  })
  return sub
}

export async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const json = sub.toJSON()
  await api.post('/push/unsubscribe', {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  })
  await sub.unsubscribe()
}

export async function getPushSubscription() {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.ready
    return reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function ensurePushSubscribed() {
  if (!isPushSupported()) return
  if (Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    if (existing) return  // already subscribed
    // subscription was lost (e.g. browser cleared it) — re-subscribe silently
    await subscribeToPush()
  } catch {
    // silent — don't interrupt the user
  }
}
