import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

// Standalone copy of the planner's Vite config (see frontend/vite.config.ts).
// Different dev port on purpose so this can run alongside the real site's
// `npm run dev` (port 3000) without a clash.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3100,
    // The production backend's CORS allowlist only includes the real site
    // origins, so a browser request straight from localhost:3100 would be
    // rejected (see .env). Proxying server-side avoids CORS entirely — the
    // browser only ever talks to this dev server.
    proxy: {
      '/api': {
        target: 'https://api.artifactarmoury.com',
        changeOrigin: true,
      },
      '/cdn': {
        target: 'https://assets.artifactplanner.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cdn/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src'),
      '@core': resolve(rootDir, 'src/table-top-terrain-builder/src/core'),
      '@scene': resolve(rootDir, 'src/table-top-terrain-builder/src/scene'),
      '@state': resolve(rootDir, 'src/table-top-terrain-builder/src/state'),
      '@data': resolve(rootDir, 'src/table-top-terrain-builder/src/data'),
      '@ui': resolve(rootDir, 'src/table-top-terrain-builder/src/ui'),
    },
  },
})
