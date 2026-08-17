import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    /*
     * Listen on all interfaces rather than Vite's default of `localhost`.
     *
     * On Windows, `localhost` resolves to the IPv6 loopback and Vite binds to
     * `::1` only. Testing on a real phone over USB uses
     * `adb reverse tcp:5173 tcp:5173`, and adb connects to `127.0.0.1` — IPv4 —
     * so the connection is refused before it reaches the app and the phone shows
     * "site can't be reached". The Express backend happens to work because it
     * binds dual-stack (`::`), which is why only the frontend failed.
     *
     * Binding here rather than passing `--host` so phone testing works from the
     * normal `npm run dev`, with nothing extra to remember. It also enables
     * same-Wi-Fi testing via the LAN address, though the camera needs HTTPS on
     * anything that is not localhost.
     */
    host: true,
  },
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
