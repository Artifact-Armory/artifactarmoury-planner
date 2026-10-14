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
// Files over the ingest caps (500MB / 10.5M triangles) and non-mesh files (.chitubox,
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
import { createListingFromUpload, MAX_GALLERY_IMAGES, MAX_EXTRA_PARTS, MAX_COMPONENTS } from '../src/services/modelIngest/createListing'

const MAX_EXTRA_PARTS_LOCAL = MAX_EXTRA_PARTS
const MAX_COMPONENTS_LOCAL = MAX_COMPONENTS

// Ingest must go to the worker: this script exits as soon as the job is queued, and
// in-process ingest would also drag 1GB+ of meshes through this laptop.
process.env.MODEL_INGEST_WORKER_ENABLED = 'true'

// Wargame3D spells it both ways ("full assembly.stl" / "fullassembly.stl").
const PRIMARY_FILES = ['full assembly.stl', 'fullassembly.stl']
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
  /** 'vehicle' (default): full assembly + download-only kit. 'pack': loose placeable pieces. */
  layout?: 'vehicle' | 'pack' | 'collection'
  category?: string
  /** The file (relative to the folder) that leads the listing — for a vehicle, its planner preview. */
  primary?: string
  /** vehicle only: files (relative paths) that are separate placeable models (a gun, a crewman, a hedgehog). */
  placeable?: string[]
  /** collection only: subfolder name → its whole-model file, when it isn't "<subfolder>.stl". */
  mains?: Record<string, string>
  /** collection only: subfolder name → a planner-only preview file (e.g. a decimated copy of an
   *  assembly too big to upload). That model's print files are then all download-only. */
  previews?: Record<string, string>
  /** pack only: relative paths (or folder prefixes) that go in the ZIP but aren't placeable. */
  downloadOnly?: string[]
  /** pack only: the store image (relative path) to use as the thumbnail. */
  thumbnail?: string
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
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name.toLowerCase()) && !e.name.startsWith('_aa'))
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

interface PlannedPart { file: string; name: string; groupIndex: number; groupName: string | null; thumbnail?: string; downloadOnly?: boolean; display?: string }

const PRINT_ONLY = /supported|hollow/i
const isMesh = (f: string) => /\.(stl|obj|3mf)$/i.test(f)

/** Store images in the folder root: numbered shots first, then anything else. */
function storeImages(folder: string, skipped: Skipped[], cover?: string) {
  const images = listFiles(folder).filter((f) => IMAGE.test(f)).sort((a, b) => {
    const na = /^\d+\./.test(path.basename(a)), nb = /^\d+\./.test(path.basename(b))
    return na === nb ? natural(a, b) : na ? -1 : 1
  })
  if (cover) {
    const i = images.indexOf(path.join(folder, cover))
    if (i < 0) throw new Error(`thumbnail ${cover} not found`)
    images.unshift(...images.splice(i, 1))
  }
  if (images.length === 0) throw new Error('No store images found')
  for (const extra of images.slice(1 + MAX_GALLERY_IMAGES)) skipped.push({ file: path.relative(folder, extra), reason: `over the ${MAX_GALLERY_IMAGES}-image gallery limit` })
  return { thumbnail: images[0], gallery: images.slice(1, 1 + MAX_GALLERY_IMAGES) }
}

// A pack (stowage, markers, barricades, bunkers…) has no single assembly: every
// loose piece is placeable on its own. Root files are one named model, each
// top-level subfolder another; anything pre-supported or hollowed is a print
// plate / print variant and goes in the ZIP only.
function planPack(folder: string, info: ListingInfo) {
  const skipped: Skipped[] = []
  const rel = (f: string) => path.relative(folder, f)
  type Entry = { file: string; name: string; downloadOnly: boolean }
  const groups: Array<{ name: string; entries: Entry[] }> = []

  const collect = (dir: string, label: string | null, entries: Entry[], deep: boolean) => {
    for (const f of listFiles(dir).sort(natural)) {
      if (!isMesh(f)) continue
      const problem = meshProblem(f)
      if (problem) { skipped.push({ file: rel(f), reason: problem }); continue }
      const listed = (info.downloadOnly ?? []).some((d) => rel(f) === path.normalize(d) || rel(f).startsWith(path.normalize(d) + path.sep))
      entries.push({ file: f, name: label ? `${label} - ${stem(f)}` : stem(f), downloadOnly: listed || PRINT_ONLY.test(rel(f)) })
    }
    if (!deep) return
    for (const sub of listDirs(dir).sort(natural)) {
      const name = path.basename(sub)
      collect(sub, label ? `${label} - ${name}` : name, entries, true)
    }
  }

  const root: Entry[] = []
  collect(folder, null, root, false)
  for (const dir of listDirs(folder).sort(natural)) {
    // A SUPPORTED/HOLLOWED folder at the top belongs to the root model.
    if (PRINT_ONLY.test(path.basename(dir))) { collect(dir, path.basename(dir), root, true); continue }
    const entries: Entry[] = []
    collect(dir, null, entries, true)
    if (entries.length) groups.push({ name: path.basename(dir), entries })
  }
  if (root.length) groups.unshift({ name: info.name, entries: root })
  if (groups.length > 1 + MAX_COMPONENTS_LOCAL) throw new Error(`${groups.length} named models — over the ${1 + MAX_COMPONENTS_LOCAL} limit`)

  const all = groups.flatMap((g, gi) => g.entries.map((e) => ({ ...e, gi })))
  const wanted = info.primary ? path.join(folder, info.primary) : null
  const primaryEntry = (wanted && all.find((e) => e.file === wanted)) || all.find((e) => !e.downloadOnly)
  if (!primaryEntry) throw new Error('No placeable mesh found')
  if (primaryEntry.gi !== 0) groups.unshift(groups.splice(primaryEntry.gi, 1)[0])

  const parts: PlannedPart[] = []
  groups.forEach((g, gi) => {
    for (const e of g.entries) {
      if (e.file === primaryEntry.file) continue
      parts.push({ file: e.file, name: e.name, groupIndex: gi, groupName: groups.length > 1 ? g.name : null, downloadOnly: e.downloadOnly })
    }
  })
  if (parts.length > MAX_EXTRA_PARTS_LOCAL) throw new Error(`${parts.length + 1} files — over the ${MAX_EXTRA_PARTS_LOCAL + 1}-file limit`)

  const { thumbnail, gallery } = storeImages(folder, skipped, info.thumbnail)
  return {
    primary: primaryEntry.file,
    primaryName: stem(primaryEntry.file),
    vehicleName: groups.length > 1 ? groups[0].name : null,
    parts, thumbnail, gallery, skipped,
  }
}

// A collection (17 bunkers, bridges + towers…) is several finished structures
// sold together. Each top-level subfolder is one named model: its whole-model
// STL ("bunker 3/bunker 3.stl") is the placeable piece, and every split,
// hollowed or supported variant beside it is download-only.
function planCollection(folder: string, info: ListingInfo) {
  const skipped: Skipped[] = []
  const rel = (f: string) => path.relative(folder, f)
  const dirs = listDirs(folder).sort(natural)
  if (dirs.length > 1 + MAX_COMPONENTS_LOCAL) throw new Error(`${dirs.length} named models — over the ${1 + MAX_COMPONENTS_LOCAL} limit`)

  const models: Array<{ name: string; main: string; rest: string[]; thumb?: string; preview?: string }> = []
  for (const dir of dirs) {
    const name = path.basename(dir)
    const meshes: string[] = []
    const walk = (d: string) => {
      for (const f of listFiles(d).sort(natural)) {
        if (!isMesh(f)) continue
        const problem = meshProblem(f)
        if (problem) skipped.push({ file: rel(f), reason: problem })
        else meshes.push(f)
      }
      for (const sub of listDirs(d).sort(natural)) walk(sub)
    }
    walk(dir)
    const own = (f: string) => path.dirname(f) === dir && !PRINT_ONLY.test(path.basename(f))
    const preview = info.previews?.[name] ? path.join(dir, info.previews[name]) : undefined
    if (preview) {
      const problem = !fs.existsSync(preview) ? 'not found' : meshProblem(preview)
      if (problem) throw new Error(`preview ${path.relative(folder, preview)}: ${problem}`)
    }
    const main = preview ? meshes[0]
      : info.mains?.[name] ? path.join(dir, info.mains[name])
      : meshes.find((f) => own(f) && stem(f).toLowerCase() === name.toLowerCase())
        ?? meshes.filter(own).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]
    if (!main || !meshes.includes(main)) { skipped.push({ file: name, reason: 'no whole-model STL found (not imported)' }); continue }
    const thumb = listFiles(dir).filter((f) => IMAGE.test(f) && !/explode/i.test(f)).sort(natural)[0]
    models.push({ name, main, rest: meshes.filter((f) => f !== main), thumb, preview })
  }
  const display = (n: string) => n.charAt(0).toUpperCase() + n.slice(1)
  for (const m of models) {
    ;(m as any).folder = m.name
    m.name = display(m.name)
  }
  if (models.length === 0) throw new Error('No models found')

  const parts: PlannedPart[] = []
  models.forEach((m, gi) => {
    if (gi > 0) parts.push({ file: m.main, name: m.preview ? stem(m.main) : m.name, groupIndex: gi, groupName: m.name, thumbnail: m.thumb, display: m.preview })
    for (const f of m.rest) {
      const sub = path.relative(path.join(folder, (m as any).folder), path.dirname(f))
      const label = sub ? `${sub.split(path.sep).join(' - ')} - ${stem(f)}` : stem(f)
      parts.push({ file: f, name: label, groupIndex: gi, groupName: m.name, downloadOnly: true })
    }
  })
  if (parts.length > MAX_EXTRA_PARTS_LOCAL) throw new Error(`${parts.length + 1} files — over the ${MAX_EXTRA_PARTS_LOCAL + 1}-file limit`)

  // Store images: the folder's own shots, then each model's first shot.
  const rootImages = listFiles(folder).filter((f) => IMAGE.test(f)).sort(natural)
  const modelThumbs = models.map((m) => m.thumb).filter((f): f is string => !!f)
  const images = [...rootImages, ...modelThumbs.filter((f) => !rootImages.some((r) => fs.statSync(r).size === fs.statSync(f).size))]
  if (images.length === 0) throw new Error('No store images found')
  for (const extra of images.slice(1 + MAX_GALLERY_IMAGES)) skipped.push({ file: rel(extra), reason: `over the ${MAX_GALLERY_IMAGES}-image gallery limit` })
  return {
    primary: models[0].main,
    vehicleName: models[0].name,
    primaryThumb: models[0].thumb,
    primaryDisplay: models[0].preview,
    parts, thumbnail: images[0], gallery: images.slice(1, 1 + MAX_GALLERY_IMAGES), skipped,
  }
}

function planFolder(folder: string, info: ListingInfo) {
  const skipped: Skipped[] = []
  const rel = (f: string) => path.relative(folder, f)

  const primary = info.primary
    ? path.join(folder, info.primary)
    : PRIMARY_FILES.map((f) => path.join(folder, f)).find((f) => fs.existsSync(f))
      ?? listFiles(folder).find((f) => /full ?assembly\.stl$/i.test(path.basename(f)))
  if (!primary || !fs.existsSync(primary)) throw new Error(`No "${info.primary ?? PRIMARY_FILES[0]}" in ${folder}`)
  const placeable = new Set((info.placeable ?? []).map((f) => path.join(folder, f)))
  for (const f of placeable) if (!fs.existsSync(f)) throw new Error(`placeable file not found: ${path.relative(folder, f)}`)
  const extraModels: PlannedPart[] = []
  const primaryProblem = meshProblem(primary)
  if (primaryProblem) throw new Error(`${path.basename(primary)}: ${primaryProblem}`)

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
    if (placeable.has(file)) {
      extraModels.push({ file, name: stem(file), groupIndex: -1, groupName: stem(file) })
    } else if (crew && !SUPPORTED.test(file)) {
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
    if (crew) {
      for (const sub of listDirs(dir)) skipped.push({ file: rel(sub), reason: 'nested folder (not imported)' })
      continue
    }
    // Deeper folders ("option without blade/HOLLOWED", "Waterline/option 1/SUPPORTED")
    // are still part of the kit: every level goes into the ZIP, labelled by its path.
    const walk = (d: string, label: string) => {
      for (const sub of listDirs(d).sort(natural)) {
        const subLabel = `${label} - ${path.basename(sub)}`
        for (const f of listFiles(sub).sort(natural)) consider(f, `${subLabel} - ${stem(f)}`, false)
        walk(sub, subLabel)
      }
    }
    walk(dir, dirName)
  }
  crewParts.forEach((p) => { p.groupName = crewName })
  if (crewParts[0] && crewThumb) crewParts[0].thumbnail = crewThumb
  // Each placeable extra is its own named model, numbered after the crew.
  const firstExtra = crewParts.length ? 2 : 1
  extraModels.forEach((p, i) => { p.groupIndex = firstExtra + i })

  // Store images: numbered shots first, then anything else (explode.png).
  const images = listFiles(folder).filter((f) => IMAGE.test(f)).sort((a, b) => {
    const na = /^\d+\./.test(path.basename(a)), nb = /^\d+\./.test(path.basename(b))
    return na === nb ? natural(a, b) : na ? -1 : 1
  })
  if (images.length === 0) throw new Error('No store images found')
  const thumbnail = images[0]
  const gallery = images.slice(1, 1 + MAX_GALLERY_IMAGES)
  for (const extra of images.slice(1 + MAX_GALLERY_IMAGES)) skipped.push({ file: rel(extra), reason: `over the ${MAX_GALLERY_IMAGES}-image gallery limit` })

  return { primary, vehicleName, parts: [...vehicleParts, ...crewParts, ...extraModels], thumbnail, gallery, skipped }
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

  const pack = info.layout === 'pack' || info.layout === 'collection'
  const plan: { primary: string; vehicleName: string | null; primaryThumb?: string; primaryDisplay?: string; parts: PlannedPart[]; thumbnail: string; gallery: string[]; skipped: Skipped[] } =
    info.layout === 'collection' ? planCollection(folder, info) : info.layout === 'pack' ? planPack(folder, info) : planFolder(folder, info)
  const mb = (f: string) => `${(fs.statSync(f).size / 1048576).toFixed(1)}MB`
  console.log(`
=== ${info.name} — £${info.price.toFixed(2)} ===`)
  console.log(`  primary${pack ? '' : ' + planner preview'}: ${path.relative(folder, plan.primary)} (${mb(plan.primary)})`)
  const groupCount = Math.max(0, ...plan.parts.map((p) => p.groupIndex)) + 1
  for (let g = 0; g < groupCount; g++) {
    const ps = plan.parts.filter((p) => p.groupIndex === g)
    if (ps.length === 0) continue
    console.log(`  [${ps[0].groupName ?? info.name}]`)
    for (const p of ps) {
      const where = (pack ? (p.downloadOnly ? 'download-only' : 'placeable') : (g === 0 ? 'download-only' : 'placeable')) + (p.display ? ` (planner preview: ${path.relative(folder, p.display)})` : '')
      console.log(`    ${p.name} (${mb(p.file)}) ${where}${p.thumbnail ? ` thumb=${path.basename(p.thumbnail)}` : ''}`)
    }
  }
  console.log(`  thumbnail: ${path.basename(plan.thumbnail)}; gallery: ${plan.gallery.map((g) => path.basename(g)).join(', ') || 'none'}`)
  for (const s of plan.skipped) console.log(`  SKIPPED ${s.file}: ${s.reason}`)
  const uploads = [plan.primary, ...(pack ? [] : [plan.primary]), ...plan.parts.map((p) => p.file)]
  const total = uploads.reduce((n, f) => n + fs.statSync(f).size, 0)
  const placeable = pack ? 1 + plan.parts.filter((p) => !p.downloadOnly).length : null
  console.log(`  ${plan.parts.length + 1} files${placeable != null ? ` (${placeable} placeable)` : ''}, ${(total / 1048576).toFixed(0)}MB to upload`)
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

  console.log(`  uploading ${path.basename(plan.primary)}${pack ? '' : ' (twice: print file + preview)'}…`)
  const rawKey = await putMesh(plan.primary)
  const displayRawKey = plan.primaryDisplay ? await putMesh(plan.primaryDisplay) : pack ? undefined : await putMesh(plan.primary)

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
      downloadOnly: p.downloadOnly === true,
      // A planner-only preview for this named model; the component's other files become download-only.
      ...(p.display ? { isPresupported: true, displayRawKey: await putMesh(p.display) } : {}),
    })
  }

  const model = await createListingFromUpload(artistId, {
    rawKey,
    filename: path.basename(plan.primary),
    name: info.name,
    description: info.description,
    category: info.category ?? 'vehicles',
    tags: info.tags ?? [],
    basePrice: info.price,
    thumbnailKey,
    primaryThumbnailKey: plan.primaryThumb ? await putImage(plan.primaryThumb, 'thumbnails') : undefined,
    galleryKeys,
    parts,
    terms: info.terms ?? DEFAULT_TERMS,
    license: 'personal',
    printerType: info.printerType ?? 'both',
    primaryGroupName: plan.vehicleName,
    // "Preview" in CreateModel.tsx: the assembled tank stands in for its parts.
    // A pack has no preview file: each piece is its own placeable asset.
    ...(displayRawKey ? { isPresupported: true, displayRawKey, displayFilename: path.basename(plan.primaryDisplay ?? plan.primary) } : {}),
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
