// backend/scripts/import-wargame3d.ts
//
// Lists one Wargame3D model folder on an artist's account, the same way the
// artist's own upload form would (via createListingFromUpload), without anyone
// clicking through CreateModel.tsx for each of their ~1,000 models.
//
// Run it linked to the POSTGRES service (DATABASE_PUBLIC_URL); the R2 keys come
// from backend/.env:
//
//   railway run npm run import:wargame3d -- "<model folder>" --artist-email <email> --dry-run
//   railway run npm run import:wargame3d -- "<model folder>" --artist-email <email>
//
// Several folders at once: pass a parent folder with --batch and every subfolder
// that has an aa-listing.json is imported in turn.
//
// THE FOLDER CONVENTION (what Wargame3D sends):
//   full assembly.stl        the assembled vehicle — primary file AND planner preview
//   *.stl, turret/, HOLLOWED/, SUPPORTED/, option without stowage/ ...
//                            download-only parts in the ZIP (not placeable)
//   3 Tankmen/ (crew folder) its own named model; each unsupported figure is
//                            placeable, the SUPPORTED file goes in the ZIP only
//   1.png 2.png ...          store images, in number order: 1 = thumbnail
//   refs/                    the designer's reference photos — never uploaded
//   aa-listing.json          name / description / price (written per model, since
//                            MyMiniFactory blocks scripted fetches)
//
// Files over the ingest caps (250MB / 5M triangles) and non-mesh files (.chitubox,
// .rtf) are skipped and reported, never silently dropped.
//
// The listing is created as a DRAFT. The worker builds its previews; publish it from
// My Models (or the admin) once it reads "ready".

import './script-env'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { db } from '../src/db'
import { uploadObject, isR2Enabled } from '../src/services/r2'
import { contentTypeFor } from '../src/services/storage'
import { MAX_MODEL_FILE_BYTES } from '../src/services/meshConvert'
import { MAX_INGEST_TRIANGLES } from '../src/services/fileProcessor'
import { createListingFromUpload, MAX_GALLERY_IMAGES } from '../src/services/modelIngest/createListing'

// Ingest must go to the worker: this script exits as soon as the job is queued, and
// in-process ingest would also drag 1GB+ of meshes through this laptop.
process.env.MODEL_INGEST_WORKER_ENABLED = 'true'

const PRIMARY_FILE = 'full assembly.stl'
const SKIP_DIRS = new Set(['refs'])
const CREW_DIR = /tankm[ae]n|crew|figures?/i
const SUPPORTED = /supported/i
const IMAGE = /\.(png|jpe?g|webp)$/i
const IMAGE_MAX_PX = 1600

interface ListingInfo {
  name: string
  description: string
  price: number
  tags?: string[]
  terms?: string[]
  printerType?: 'fdm' | 'resin' | 'both'
}

// Sensible defaults for a WW2 tank; aa-listing.json can override `terms`.
const DEFAULT_TERMS = [
  'model-class:vehicles',
  'vehicle-type:armour-and-fighting-vehicles/tanks',
  'setting-era:historical/world-war-two',
  'scale:28mm',
  'condition:pristine-and-new-build',
  'print-files:process/fdm-and-resin',
  'print-files:supports/pre-supported-resin',
  'print-files:files/stl',
  'features:construction/multi-part-kit',
  'features:construction/hollowed',
  'features:extras-included/alternate-parts',
  'licence:personal-use',
]

type Skipped = { file: string; reason: string }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(dir, e.name))
}

function listDirs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name.toLowerCase()))
    .map((e) => path.join(dir, e.name))
}

/** Natural sort, so 10.png comes after 9.png. */
const natural = (a: string, b: string) =>
  path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' })

/** Triangle count from a binary STL header; null for ASCII (the worker checks those). */
function stlTriangles(file: string): number | null {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(84)
    fs.readSync(fd, head, 0, 84, 0)
    const n = head.readUInt32LE(80)
    return fs.statSync(file).size === 84 + n * 50 ? n : null
  } finally {
    fs.closeSync(fd)
  }
}

/** Why this mesh can't be ingested, or null if it's fine. */
function meshProblem(file: string): string | null {
  if (!/\.(stl|obj|3mf)$/i.test(file)) return 'not an STL/OBJ/3MF file'
  const bytes = fs.statSync(file).size
  if (bytes > MAX_MODEL_FILE_BYTES) return `${(bytes / 1048576).toFixed(0)}MB is over the ${MAX_MODEL_FILE_BYTES / 1048576}MB limit`
  const tris = /\.stl$/i.test(file) ? stlTriangles(file) : null
  if (tris != null && tris > MAX_INGEST_TRIANGLES) return `${(tris / 1e6).toFixed(2)}M triangles is over the ${MAX_INGEST_TRIANGLES / 1e6}M limit`
  return null
}

const stem = (file: string) => path.basename(file).replace(/\.[^.]+$/, '')

interface PlannedPart { file: string; name: string; groupIndex: number; groupName: string | null; thumbnail?: string }

function planFolder(folder: string, info: ListingInfo) {
  const skipped: Skipped[] = []
  const rel = (f: string) => path.relative(folder, f)

  const primary = path.join(folder, PRIMARY_FILE)
  if (!fs.existsSync(primary)) throw new Error(`No "${PRIMARY_FILE}" in ${folder}`)
  const primaryProblem = meshProblem(primary)
  if (primaryProblem) throw new Error(`${PRIMARY_FILE}: ${primaryProblem}`)

  // Component 0 is the vehicle; its preview is the full assembly, so every other
  // file in it is download-only. A crew folder becomes component 1.
  const vehicleName = info.name.replace(/\s*\+.*$/, '').trim() || info.name
  const vehicleParts: PlannedPart[] = []
  const crewParts: PlannedPart[] = []
  let crewName: string | null = null
  let crewThumb: string | undefined

  const consider = (file: string, label: string, crew: boolean) => {
    if (file === primary) return
    if (IMAGE.test(file) || /\.(rtf|txt|pdf|md|json)$/i.test(file)) return
    const problem = meshProblem(file)
    if (problem) { skipped.push({ file: rel(file), reason: problem }); return }
    if (crew && !SUPPORTED.test(file)) {
      crewParts.push({ file, name: stem(file), groupIndex: 1, groupName: crewName })
    } else {
      vehicleParts.push({ file, name: label, groupIndex: 0, groupName: vehicleName })
    }
  }

  for (const f of listFiles(folder).sort(natural)) consider(f, stem(f), false)
  for (const dir of listDirs(folder).sort(natural)) {
    const dirName = path.basename(dir)
    const crew = CREW_DIR.test(dirName)
    if (crew) {
      crewName = dirName
      crewThumb = listFiles(dir).filter((f) => IMAGE.test(f)).sort(natural)[0]
    }
    for (const f of listFiles(dir).sort(natural)) consider(f, stem(f).startsWith(dirName) ? stem(f) : `${dirName} - ${stem(f)}`, crew)
    for (const sub of listDirs(dir)) skipped.push({ file: rel(sub), reason: 'nested folder (not imported)' })
  }
  crewParts.forEach((p) => { p.groupName = crewName })
  if (crewParts[0] && crewThumb) crewParts[0].thumbnail = crewThumb

  // Store images: numbered shots first, then anything else (explode.png).
  const images = listFiles(folder).filter((f) => IMAGE.test(f)).sort((a, b) => {
    const na = /^\d+\./.test(path.basename(a)), nb = /^\d+\./.test(path.basename(b))
    return na === nb ? natural(a, b) : na ? -1 : 1
  })
  if (images.length === 0) throw new Error('No store images found')
  const thumbnail = images[0]
  const gallery = images.slice(1, 1 + MAX_GALLERY_IMAGES)
  for (const extra of images.slice(1 + MAX_GALLERY_IMAGES)) skipped.push({ file: rel(extra), reason: `over the ${MAX_GALLERY_IMAGES}-image gallery limit` })

  return { primary, vehicleName, parts: [...vehicleParts, ...crewParts], thumbnail, gallery, skipped }
}

async function putMesh(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase()
  const key = `raw/${crypto.randomBytes(16).toString('hex')}${ext}`
  await uploadObject(key, fs.readFileSync(file), contentTypeFor(file))
  return key
}

async function putImage(file: string, prefix: 'thumbnails' | 'images'): Promise<string> {
  const webp = await sharp(file)
    .resize({ width: IMAGE_MAX_PX, height: IMAGE_MAX_PX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer()
  const key = `${prefix}/${crypto.randomBytes(16).toString('hex')}.webp`
  await uploadObject(key, webp, 'image/webp')
  return key
}

async function importFolder(folder: string, artistId: string, dryRun: boolean) {
  const infoPath = path.join(folder, 'aa-listing.json')
  if (!fs.existsSync(infoPath)) throw new Error(`No aa-listing.json in ${folder}`)
  const info: ListingInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'))
  if (!info.name || !info.description || !(info.price > 0)) throw new Error('aa-listing.json needs name, description and price')

  const plan = planFolder(folder, info)
  const mb = (f: string) => `${(fs.statSync(f).size / 1048576).toFixed(1)}MB`
  console.log(`\n=== ${info.name} — £${info.price.toFixed(2)} ===`)
  console.log(`  primary + planner preview: ${PRIMARY_FILE} (${mb(plan.primary)})`)
  for (const g of [0, 1]) {
    const ps = plan.parts.filter((p) => p.groupIndex === g)
    if (ps.length === 0) continue
    console.log(`  [${ps[0].groupName}] ${g === 0 ? 'download-only' : 'placeable'}:`)
    for (const p of ps) console.log(`    ${p.name} (${mb(p.file)})${p.thumbnail ? ` thumb=${path.basename(p.thumbnail)}` : ''}`)
  }
  console.log(`  thumbnail: ${path.basename(plan.thumbnail)}; gallery: ${plan.gallery.map((g) => path.basename(g)).join(', ') || 'none'}`)
  for (const s of plan.skipped) console.log(`  SKIPPED ${s.file}: ${s.reason}`)
  const total = [plan.primary, plan.primary, ...plan.parts.map((p) => p.file)].reduce((n, f) => n + fs.statSync(f).size, 0)
  console.log(`  ${plan.parts.length + 1} files, ${(total / 1048576).toFixed(0)}MB to upload`)
  if (dryRun) return

  const existing = await db.query('SELECT id FROM models WHERE artist_id = $1 AND name = $2 AND deleted_at IS NULL', [artistId, info.name])
  if (existing.rows.length > 0) {
    console.log(`  Already listed (model ${existing.rows[0].id}) — skipping. Delete it first to re-import.`)
    return
  }

  console.log('  uploading images…')
  const thumbnailKey = await putImage(plan.thumbnail, 'thumbnails')
  const galleryKeys: string[] = []
  for (const g of plan.gallery) galleryKeys.push(await putImage(g, 'images'))

  console.log(`  uploading ${PRIMARY_FILE} (twice: print file + preview)…`)
  const rawKey = await putMesh(plan.primary)
  const displayRawKey = await putMesh(plan.primary)

  const parts = []
  for (let i = 0; i < plan.parts.length; i++) {
    const p = plan.parts[i]
    console.log(`  uploading ${i + 1}/${plan.parts.length}: ${p.name}`)
    parts.push({
      rawKey: await putMesh(p.file),
      filename: path.basename(p.file),
      name: p.name,
      groupIndex: p.groupIndex,
      groupName: p.groupName,
      thumbnailKey: p.thumbnail ? await putImage(p.thumbnail, 'thumbnails') : undefined,
    })
  }

  const model = await createListingFromUpload(artistId, {
    rawKey,
    filename: PRIMARY_FILE,
    name: info.name,
    description: info.description,
    category: 'vehicles',
    tags: info.tags ?? [],
    basePrice: info.price,
    thumbnailKey,
    galleryKeys,
    parts,
    terms: info.terms ?? DEFAULT_TERMS,
    license: 'personal',
    printerType: info.printerType ?? 'both',
    primaryGroupName: plan.vehicleName,
    // "Preview" in CreateModel.tsx: the assembled tank stands in for its parts.
    isPresupported: true,
    displayRawKey,
    displayFilename: PRIMARY_FILE,
  })
  console.log(`  ✓ created draft ${model.id} — queued for the ingest worker`)
}

async function main() {
  const target = process.argv[2]
  const email = arg('--artist-email')
  const dryRun = process.argv.includes('--dry-run')
  const batch = process.argv.includes('--batch')
  if (!target || !email) {
    console.error('Usage: npm run import:wargame3d -- "<folder>" --artist-email <email> [--batch] [--dry-run]')
    process.exit(1)
  }
  if (!dryRun && !isR2Enabled()) throw new Error('R2 is not configured (R2_* missing from backend/.env)')

  let artistId: string
  if (dryRun && process.env.DB_MOCK === 'true') {
    // Local dry run with no database: just show the plan.
    artistId = 'dry-run'
    console.log('DRY RUN against the mock DB: artist not checked, nothing uploaded')
  } else {
    const artist = await db.query('SELECT id, role, display_name FROM users WHERE lower(email) = lower($1)', [email])
    if (artist.rows.length === 0) throw new Error(`No account with email ${email}`)
    if (artist.rows[0].role !== 'artist') throw new Error(`${email} is a ${artist.rows[0].role}, not an artist`)
    artistId = artist.rows[0].id
    console.log(`Artist: ${artist.rows[0].display_name} (${artistId})${dryRun ? ' — DRY RUN, nothing uploaded' : ''}`)
  }

  const folders = batch
    ? listDirs(target).filter((d) => fs.existsSync(path.join(d, 'aa-listing.json'))).sort(natural)
    : [target]
  let failed = 0
  for (const folder of folders) {
    try {
      await importFolder(folder, artistId, dryRun)
    } catch (err: any) {
      failed++
      console.error(`  ✗ ${path.basename(folder)}: ${err?.message ?? err}`)
    }
  }
  console.log(`\nDone: ${folders.length - failed} ok, ${failed} failed.`)
  await db.end?.()
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
