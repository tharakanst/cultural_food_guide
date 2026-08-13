import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The app is a thin client over a live backend; a stale shell is never
      // useful, so new builds take effect without asking the user.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Cultural Food Guide',
        short_name: 'Food Guide',
        description:
          'Photograph a dish, menu or food label to see its ingredients, allergens and cultural context.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // Mirrors --color-accent / --color-bg in src/styles/tokens.css. A web
        // app manifest is JSON and cannot read CSS custom properties, so these
        // are the one unavoidable duplication of a colour value.
        theme_color: '#0b5394',
        background_color: '#ffffff',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // /api/analyze must never be served from a cache — an allergen answer
        // for a different photo is a safety problem, not a stale asset.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    // Vitest's default 'forks' pool fails to start a worker on Windows in this
    // project (the worker handshake times out and no tests run at all).
    // 'threads' is also the faster pool for jsdom component tests.
    pool: 'threads',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
})
