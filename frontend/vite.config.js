import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.VITE_BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // 'prompt' en vez de 'autoUpdate': el SW nuevo queda en espera hasta que
      // el usuario confirme desde el toast de actualización (src/utils/pwaUpdate.js).
      // Evita que un deploy le cambie el código bajo los pies a mitad de una tarea.
      registerType: 'prompt',
      includeAssets: ['logo.png', 'default-icon.png', 'push-handlers.js'],
      manifest: {
        name: 'Service Desk',
        short_name: 'Service Desk',
        description: 'Plataforma de Gestión Empresarial',
        theme_color: '#0c1428',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'es',
        scope: '/',
        start_url: '/',
        // Íconos dinámicos: reflejan el logo/ícono configurado en Ajustes, no un
        // asset horneado. Evita que la pestaña muestre el logo por defecto antes del login.
        // El backend siempre devuelve un PNG cuadrado de 512x512 (ver _squareify en
        // settings.py) — declarar un tamaño falso (ej. 192x192 sobre la misma URL) hace
        // que instaladores estrictos (macOS Safari/Chrome) descarten el ícono.
        icons: [
          { src: '/api/settings/pwa-icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/api/settings/pwa-icon', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Load push + notification handlers before Workbox initializes
        importScripts: ['push-handlers.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // No servir el index.html precacheado (cache-first) en navegaciones: eso hacía
        // que cambios de branding/deploy tardaran en verse. La navegación va network-first
        // (index.html siempre fresco), con caché solo como respaldo offline.
        navigateFallback: null,
        runtimeCaching: [
          {
            // Navegaciones (carga de página): red primero → index.html siempre al día;
            // si no hay red, cae al último index.html cacheado.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Auth, permissions and module config: never cache — must always reflect server state
            urlPattern: /\/api\/(auth|system\/modules|role-features|system\/company)\b/i,
            handler: 'NetworkOnly',
          },
          {
            // All other API calls: network-first with short timeout, cache only on network failure
            urlPattern: /^https:\/\/.*\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
