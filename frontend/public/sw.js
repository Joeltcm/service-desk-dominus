// This file is intentionally minimal.
// In production, vite-plugin-pwa (generateSW mode) generates dist/sw.js via Workbox,
// which loads push-handlers.js via importScripts() for push notification support.
// This file is only used in development (vite dev server).

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload = { title: 'DG Solutions', body: '', url: '/' }
  try { payload = { ...payload, ...event.data.json() } } catch {}
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/logo.png',
      badge: '/logo.png',
      data: { url: payload.url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return clients.openWindow(url)
    })
  )
})
