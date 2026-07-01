// backend/scripts/upload-to-r2.ts
//
// Upload a local directory of static assets (GLBs, thumbnails, textures) to the R2
// bucket, preserving relative paths under an optional key prefix. Sets immutable
// cache headers and correct Content-Type so Cloudflare serves them efficiently.
//
// Usage:
//   npm run upload:r2 -- <localDir> [keyPrefix] [--force]
//
// Examples:
//   npm run upload:r2 -- ../frontend/public/assets/models models
//   npm run upload:r2 -- ./textures textures --force
//
// Requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
// R2_PUBLIC_BASE_URL in the environment (e.g. backend/.env).

import 'dotenv/config'
import { promises as fs } from 'fs'
import path from 'path'
import { isR2Enabled, uploadObject, objectExists, publicUrl } from '../src/services/r2'
import { contentTypeFor } from '../src/services/storage'

async function walk(dir: string, base: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, base, acc)
    else acc.push(path.relative(base, full))
  }
  return acc
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const positional = args.filter((a) => !a.startsWith('--'))
  const localDir = positional[0]
  const prefix = (positional[1] ?? '').replace(/^\/+|\/+$/g, '')

  if (!localDir) {
    console.error('Usage: npm run upload:r2 -- <localDir> [keyPrefix] [--force]')
    process.exit(1)
  }
  if (!isR2Enabled()) {
    console.error('R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL.')
    process.exit(1)
  }

  const root = path.resolve(localDir)
  const files = await walk(root, root)
  console.log(`Uploading ${files.length} file(s) from ${root} → r2://${prefix || '(root)'}\n`)

  let uploaded = 0, skipped = 0, failed = 0
  for (const rel of files) {
    const key = [prefix, rel.split(path.sep).join('/')].filter(Boolean).join('/')
    try {
      if (!force && (await objectExists(key))) {
        console.log(`  skip   ${key} (exists)`)
        skipped++
        continue
      }
      const body = await fs.readFile(path.join(root, rel))
      await uploadObject(key, body, contentTypeFor(rel), { immutable: true })
      console.log(`  upload ${key}  →  ${publicUrl(key)}`)
      uploaded++
    } catch (error) {
      console.error(`  FAIL   ${key}:`, (error as Error).message)
      failed++
    }
  }

  console.log(`\nDone: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed.`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
