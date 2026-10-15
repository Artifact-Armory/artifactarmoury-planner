// Bundles scripts/terrain.test.ts with esbuild (resolving the app's path
// aliases) and runs it in Node. Usage: npm run test:terrain
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const planner = resolve(root, 'src/table-top-terrain-builder/src')
await mkdir(resolve(root, '.test-output'), { recursive: true })
await build({
  entryPoints: [resolve(root, 'scripts/terrain.test.ts')],
  outfile: resolve(root, '.test-output/terrain.test.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  alias: {
    '@core': resolve(planner, 'core'),
    '@scene': resolve(planner, 'scene'),
    '@state': resolve(planner, 'state'),
    '@data': resolve(planner, 'data'),
    '@ui': resolve(planner, 'ui'),
    '@': resolve(root, 'src'),
  },
  define: { 'import.meta.env': '{"DEV":false}' },
  logLevel: 'warning',
})
await import('../.test-output/terrain.test.mjs')
