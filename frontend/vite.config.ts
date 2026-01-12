import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
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
