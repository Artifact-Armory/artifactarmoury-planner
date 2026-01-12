import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.VITE_HOST || '127.0.0.1',
    port: Number(process.env.VITE_PORT ?? '6080'),
    strictPort: false,
    proxy: {
      '/api': {
        target:
          process.env.VITE_API_PROXY_TARGET ||
          process.env.VITE_API_BASE_URL ||
          'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    host: process.env.VITE_HOST || '127.0.0.1',
    port: Number(process.env.VITE_PREVIEW_PORT ?? '6180'),
    strictPort: false,
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
  build: {
    // ========================================================================
    // OUTPUT CONFIGURATION
    // ========================================================================
    outDir: 'dist',
    assetsDir: 'assets',

    // ========================================================================
    // MINIFICATION & OPTIMIZATION
    // ========================================================================
    minify: 'esbuild',
    target: 'esnext',

    // ========================================================================
    // ROLLUP OPTIONS FOR CODE SPLITTING
    // ========================================================================
    rollupOptions: {
      output: {
        // Optimize chunk naming for better caching
        chunkFileNames: 'assets/chunks/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',

        // ====================================================================
        // MANUAL CHUNKS - STRATEGIC CODE SPLITTING
        // ====================================================================
        manualChunks: (id) => {
          // Vendor chunks - separate large dependencies
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router-dom/')) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/@tanstack/react-query/')) {
            return 'vendor-query'
          }
          if (id.includes('node_modules/react-hook-form/') || id.includes('node_modules/zod/')) {
            return 'vendor-forms'
          }
          if (id.includes('node_modules/lucide-react/') || id.includes('node_modules/react-hot-toast/')) {
            return 'vendor-ui'
          }
          if (id.includes('node_modules/@stripe/')) {
            return 'vendor-stripe'
          }
          if (id.includes('node_modules/axios/')) {
            return 'vendor-http'
          }
          if (id.includes('node_modules/zustand/')) {
            return 'vendor-state'
          }

          // Three.js - separate chunk for 3D rendering
          if (id.includes('node_modules/three/')) {
            return 'three-bundle'
          }

          // Application chunks - split by feature/route
          if (id.includes('src/table-top-terrain-builder')) {
            return 'terrain-builder'
          }
          if (id.includes('src/pages/auth')) {
            return 'pages-auth'
          }
          if (id.includes('src/pages/dashboard') || id.includes('src/pages/artist')) {
            return 'pages-dashboard'
          }
          if (id.includes('src/pages/Browse') || id.includes('src/pages/Category') ||
              id.includes('src/pages/Tag') || id.includes('src/pages/ArtistsList') ||
              id.includes('src/pages/ArtistProfile')) {
            return 'pages-browse'
          }
          if (id.includes('src/pages/ModelDetails') || id.includes('src/pages/GlobalLibrary') ||
              id.includes('src/pages/TableLibrary')) {
            return 'pages-models'
          }
          if (id.includes('src/pages/PublicTables') || id.includes('src/pages/TableDetails')) {
            return 'pages-tables'
          }
          if (id.includes('src/pages/Checkout')) {
            return 'pages-checkout'
          }
          if (id.includes('src/pages/admin')) {
            return 'pages-admin'
          }
          if (id.includes('src/pages/legal')) {
            return 'pages-legal'
          }
          if (id.includes('src/components/common') || id.includes('src/components/layout')) {
            return 'components-common'
          }
          if (id.includes('src/components/models')) {
            return 'components-models'
          }
          if (id.includes('src/components/cart')) {
            return 'components-cart'
          }
          if (id.includes('src/components/artists')) {
            return 'components-artists'
          }
          if (id.includes('src/components/auth')) {
            return 'components-auth'
          }
          if (id.includes('src/components/ui')) {
            return 'components-ui'
          }
          if (id.includes('src/components/VirtualTable')) {
            return 'components-table'
          }
          if (id.includes('src/api')) {
            return 'api-client'
          }
          if (id.includes('src/store')) {
            return 'store'
          }
          if (id.includes('src/utils')) {
            return 'utils'
          }
          if (id.includes('src/hooks')) {
            return 'hooks'
          }
        },
      },
    },

    // ========================================================================
    // CHUNK SIZE WARNINGS
    // ========================================================================
    chunkSizeWarningLimit: 1000, // 1MB warning threshold

    // ========================================================================
    // SOURCE MAPS FOR PRODUCTION DEBUGGING
    // ========================================================================
    sourcemap: process.env.VITE_SOURCEMAP === 'true',

    // ========================================================================
    // CSS CODE SPLITTING
    // ========================================================================
    cssCodeSplit: true,

    // ========================================================================
    // LIBRARY MODE (if needed for component library)
    // ========================================================================
    // lib: {
    //   entry: resolve(rootDir, 'src/index.ts'),
    //   name: 'ArtifactArmoury',
    //   fileName: (format) => `artifact-armoury.${format}.js`,
    // },

    // ========================================================================
    // TERSER OPTIONS (if using terser instead of esbuild)
    // ========================================================================
    // terserOptions: {
    //   compress: {
    //     drop_console: true,
    //     drop_debugger: true,
    //   },
    // },
  },
})
