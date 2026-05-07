import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',   // auto-actualiza el SW sin reinstalar
      injectRegister: 'auto',

      manifest: {
        name: 'MaisonTech App',
        short_name: 'MaisonTech',
        description: 'Sistema de Gestión y Recaudación de Máquinas',
        theme_color: '#4f46e5',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },

      workbox: {
        // Permitir bundles > 2 MB en precache
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB
        // Forzar nuevo SW en cada build cambiando el additionalManifestEntries
        additionalManifestEntries: [
          { url: '/', revision: Date.now().toString() },
        ],
        skipWaiting: true,
        clientsClaim: true,
        // Network-first para la API → cambios en el backend se ven de inmediato
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Leaflet tiles → CacheFirst (no cambian)
          {
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
