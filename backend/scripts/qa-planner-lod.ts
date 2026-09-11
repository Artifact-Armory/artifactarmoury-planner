/**
 * ACCEPTANCE TEST FOR THE PLANNER LOD — looks at the real models, in the real
 * product's lighting, before a backfill rather than after one.
 *
 * WHY THIS EXISTS
 * ---------------
 * The LOD tier shipped once at a 50,000-triangle budget, was backfilled across the
 * whole catalogue, and visibly destroyed it: carved wall panels collapsed into
 * smooth lumpy blobs with spikes through them, roof tiles and window frames gone.
 * It was rolled back the same day.
 *
 * It got through QA because file sizes and triangle counts WERE validated against
 * the real catalogue, while APPEARANCE was validated only against four substitute
 * models from a different artist — none of which exercised the combination that
 * broke (dense architectural detail that simplifies readily). A `--limit 1` smoke
 * test then confirmed the pipeline RAN without anyone checking that the output
 * LOOKED right.
 *
 * Aggregate pixel metrics would not have caught it either: the previous session
 * measured "under 0.01% of pixels differ at 2 m" on models that were fine, and a
 * melted roof covers the same pixels at the same average brightness as the roof it
 * replaced. So the number this reports is EDGE LOSS — the share of the proxy's
 * Sobel edge energy, inside the model's own silhouette, that the LOD fails to
 * reproduce. Carved detail collapsing into a smooth blob is precisely a loss of
 * edge energy, and that is the failure mode being guarded against.
 *
 * It still writes the images. The number is a filter for which ones to look at,
 * never a substitute for looking.
 *
 * WHAT IT DOES
 * ------------
 *   1. Downloads the PRODUCTION proxies for a published set (no auth needed —
 *      `?variant=preview` is what every buyer already gets).
 *   2. Builds LOD candidates from them with the SHIPPED buildPlannerLod, at each
 *      requested error bound.
 *   3. Renders proxy and candidate through blender/render_lod_compare.py at the
 *      three planner camera distances, in the planner's own lighting and lens.
 *   4. Reports edge loss per part, worst first, and exits non-zero if any part at
 *      the 0.3 m inspection distance is over the threshold.
 *
 * The production proxy is Draco-compressed and post-processed rather than a raw
 * bake, so a candidate built here is not byte-identical to what the worker would
 * produce — but it is the same geometry going through the same transforms, which
 * is what a budget decision turns on. Numbers came out within 0.2% of the real
 * bakes when checked against the shipped 50k figures.
 *
 * usage:
 *   npm run qa:lod -- --set "South East Asian village"
 *   npm run qa:lod -- --set "Gothic church" --error 0.0002,0.0005 --max-edge-loss 10
 *   npm run qa:lod -- --glb path/to/proxy.glb           (a local file, no API)
 *
 * Needs Blender (BLENDER_PATH, or on PATH). Without it, the measurement still
 * runs and the render step is skipped with a warning — which is exactly the
 * half-a-test that caused the incident, so it says so loudly.
 */
import { promises as fsp } from 'fs'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { buildPlannerLod } from '../src/services/proxyBake/lod'
import { loadBakeConfig } from '../src/services/proxyBake/config'

const importESM = new Function('s', 'return import(s)') as <T = any>(s: string) => Promise<T>

const API = process.env.QA_LOD_API || 'https://api.artifactarmoury.com'
const BLENDER_PATH = process.env.BLENDER_PATH || 'blender'
const RENDER_SCRIPT = path.resolve(process.cwd(), 'blender/render_lod_compare.py')

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const arg = (name: string, dflt?: string) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const setName = arg('set')
const localGlbs = argv.flatMap((a, i) => (a === '--glb' && argv[i + 1] ? [argv[i + 1]] : []))
const errors = (arg('error') ?? String(loadBakeConfig().plannerLodSimplifyError))
  .split(',')
  .map(Number)
const maxEdgeLoss = Number(arg('max-edge-loss', '12'))
const px = Number(arg('px', '1600'))
const outRoot = arg('out') ?? path.join(os.tmpdir(), 'qa-planner-lod')

// ---------------------------------------------------------------------------
// image comparison
// ---------------------------------------------------------------------------
interface Diff {
  pctChanged: number
  edgeLoss: number
}

async function luminance(file: string) {
  const sharpMod: any = await importESM('sharp')
  const sharp = sharpMod.default ?? sharpMod
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const n = info.width * info.height
  const L = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    L[i] = (0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2]) / 255
  }
  return { L, w: info.width as number, h: info.height as number }
}

/** Sobel gradient magnitude — the "how much detail is here" field. */
function sobel(L: Float32Array, w: number, h: number) {
  const g = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1]
      const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1]
      g[i] = Math.hypot(gx, gy)
    }
  }
  return g
}

async function compare(refPng: string, candPng: string): Promise<Diff> {
  const a = await luminance(refPng)
  const b = await luminance(candPng)
  if (a.w !== b.w || a.h !== b.h) throw new Error('render size mismatch')
  const { w, h } = a
  const ga = sobel(a.L, w, h)
  const gb = sobel(b.L, w, h)
  // Mask to the MODEL, not the whole frame. Diluting by background is how "under
  // 0.01% of pixels differ" got reported for a mesh that had visibly melted. The
  // backdrop is a smooth vertical gradient, so a per-row median estimates it well.
  const rowMedian = new Float32Array(h)
  for (let y = 0; y < h; y++) {
    const row = Array.from(a.L.subarray(y * w, y * w + w)).sort((p, q) => p - q)
    rowMedian[y] = row[row.length >> 1]
  }
  let fg = 0
  let changed = 0
  let refEdge = 0
  let keptEdge = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const isFg =
        Math.abs(a.L[i] - rowMedian[y]) > 0.02 || Math.abs(b.L[i] - rowMedian[y]) > 0.02
      if (!isFg) continue
      fg++
      if (Math.abs(a.L[i] - b.L[i]) > 8 / 255) changed++
      refEdge += ga[i]
      keptEdge += Math.min(ga[i], gb[i])
    }
  }
  return {
    pctChanged: fg ? (100 * changed) / fg : 0,
    edgeLoss: refEdge ? 100 * (1 - keptEdge / refEdge) : 0,
  }
}

// ---------------------------------------------------------------------------
// production proxies
// ---------------------------------------------------------------------------
interface Part {
  id: string
  name: string
  isPrimary: boolean
  groupIndex: number
}

async function fetchSetParts(name: string): Promise<Part[]> {
  const res = await fetch(`${API}/api/models/sets`)
  if (!res.ok) throw new Error(`GET /api/models/sets -> ${res.status}`)
  const body: any = await res.json()
  const set = (body.sets ?? []).find((s: any) => s.name === name)
  if (!set) {
    const names = (body.sets ?? []).map((s: any) => s.name).join(', ')
    throw new Error(`no published set named "${name}". Available: ${names}`)
  }
  return set.parts.map((p: any) => ({
    id: p.id,
    name: p.name,
    isPrimary: !!p.is_primary,
    groupIndex: p.group_index,
  }))
}

/** The primary part IS the model row, so it lives on the model route, not the
 *  parts route — asking for it under /parts/:id is a 404. */
function proxyUrl(part: Part) {
  const base = part.isPrimary
    ? `${API}/api/models/${part.id}/preview.glb`
    : `${API}/api/models/parts/${part.id}/preview.glb`
  return `${base}?variant=preview`
}

async function download(part: Part, dir: string, index: number) {
  const res = await fetch(proxyUrl(part))
  if (!res.ok) throw new Error(`${part.name} (${part.id}) -> ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const safe = part.name.replace(/[^a-z0-9_]/gi, '_')
  const file = path.join(dir, `${String(index).padStart(2, '0')}-g${part.groupIndex}-${safe}.glb`)
  await fsp.writeFile(file, buf)
  return file
}

// ---------------------------------------------------------------------------
// blender
// ---------------------------------------------------------------------------
function runBlender(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(BLENDER_PATH, ['-b', '-P', RENDER_SCRIPT, '--', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', () => resolve(false))
    child.on('close', (code) => {
      if (code !== 0) console.error(out.split('\n').slice(-15).join('\n'))
      resolve(code === 0)
    })
  })
}

async function blenderAvailable() {
  return new Promise<boolean>((resolve) => {
    const child = spawn(BLENDER_PATH, ['--version'], { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
interface Row {
  part: string
  error: number
  proxyTris: number
  tris: number
  proxyBytes: number
  bytes: number
  skipped: boolean
  note?: string
  diffs: Record<string, Diff>
}

async function main() {
  if (!setName && localGlbs.length === 0) {
    throw new Error('usage: npm run qa:lod -- --set "<set name>" | --glb <file.glb>')
  }
  const cfg = loadBakeConfig()
  const work = outRoot
  const proxyDir = path.join(work, 'proxy')
  await fsp.mkdir(proxyDir, { recursive: true })

  let proxies: string[]
  if (localGlbs.length) {
    proxies = localGlbs.map((p) => path.resolve(p))
  } else {
    const parts = await fetchSetParts(setName!)
    console.log(`Downloading ${parts.length} production proxies for "${setName}" ...`)
    proxies = []
    for (const [i, part] of parts.entries()) proxies.push(await download(part, proxyDir, i))
  }

  const hasBlender = await blenderAvailable()
  if (!hasBlender) {
    console.warn(
      `\n!! Blender not found (BLENDER_PATH=${BLENDER_PATH}). Sizes and triangle counts\n` +
        `!! will be reported, but NOTHING WILL BE LOOKED AT — which is exactly the gap\n` +
        `!! that shipped a visibly broken LOD to the whole catalogue. Do not treat a\n` +
        `!! run without renders as a pass.\n`,
    )
  }

  const rows: Row[] = []
  for (const proxy of proxies) {
    const label = path.basename(proxy, '.glb')
    const proxyBytes = (await fsp.stat(proxy)).size
    for (const error of errors) {
      const candDir = path.join(work, 'cand')
      await fsp.mkdir(candDir, { recursive: true })
      const cand = path.join(candDir, `${label}__e${error}.glb`)
      const res = await buildPlannerLod(
        proxy,
        cand,
        { ...cfg, plannerLodSimplifyError: error },
        proxyBytes,
      )
      const row: Row = {
        part: label,
        error,
        proxyTris: res.sourceTriangles,
        tris: res.triangles,
        proxyBytes,
        bytes: res.bytes,
        skipped: res.skipped,
        note: res.note,
        diffs: {},
      }
      if (!res.skipped && hasBlender) {
        const renderDir = path.join(work, 'render', `${label}__e${error}`)
        const ok = await runBlender([
          '--glb', proxy,
          '--glb', cand,
          '--out', renderDir,
          '--px', String(px),
          '--dist', [cfg.plannerMinCameraDistanceM, cfg.plannerTypicalCameraDistanceM].join(','),
        ])
        if (ok) {
          for (const d of [cfg.plannerMinCameraDistanceM, cfg.plannerTypicalCameraDistanceM]) {
            const tag = `d${String(d).replace('.', 'p')}`
            const ref = path.join(renderDir, `${label}__${tag}.png`)
            const c = path.join(renderDir, `${path.basename(cand, '.glb')}__${tag}.png`)
            if (fs.existsSync(ref) && fs.existsSync(c)) row.diffs[`${d}m`] = await compare(ref, c)
          }
        }
      }
      rows.push(row)
      const d03 = row.diffs[`${cfg.plannerMinCameraDistanceM}m`]
      console.log(
        `  ${label.padEnd(26)} e=${String(error).padEnd(7)} ` +
          (res.skipped
            ? 'SKIPPED — ' + (res.note ?? '')
            : `${String(res.triangles).padStart(7)} tris ` +
              `(${(res.triangleReduction * 100).toFixed(0).padStart(2)}% cut)  ` +
              `${(res.bytes / 1024).toFixed(0).padStart(5)} KB ` +
              `(${(res.byteReduction * 100).toFixed(0)}% smaller)` +
              (d03 ? `   edge loss ${d03.edgeLoss.toFixed(1)}%` : '')),
      )
    }
  }

  // ---- summary -----------------------------------------------------------
  const kept = rows.filter((r) => !r.skipped)
  const pB = rows.reduce((a, r) => a + r.proxyBytes, 0)
  const lB = rows.reduce((a, r) => a + (r.skipped ? r.proxyBytes : r.bytes), 0)
  const pT = rows.reduce((a, r) => a + r.proxyTris, 0)
  const lT = rows.reduce((a, r) => a + (r.skipped ? r.proxyTris : r.tris), 0)
  console.log(`\n${rows.length} candidates, ${kept.length} worth shipping`)
  console.log(
    `  triangles ${pT.toLocaleString()} -> ${lT.toLocaleString()} (${((1 - lT / pT) * 100).toFixed(1)}% cut)`,
  )
  console.log(
    `  download  ${(pB / 1048576).toFixed(2)} MB -> ${(lB / 1048576).toFixed(2)} MB ` +
      `(${((1 - lB / pB) * 100).toFixed(1)}% smaller)`,
  )

  const key = `${loadBakeConfig().plannerMinCameraDistanceM}m`
  const scored = kept.filter((r) => r.diffs[key]).sort((a, b) => b.diffs[key].edgeLoss - a.diffs[key].edgeLoss)
  if (scored.length) {
    console.log(`\nEdge loss at ${key} (worst first) — renders in ${path.join(work, 'render')}`)
    for (const r of scored) {
      const d = r.diffs[key]
      const flag = d.edgeLoss > maxEdgeLoss ? '  <-- OVER THRESHOLD, LOOK AT THIS' : ''
      console.log(
        `  ${r.part.padEnd(26)} e=${String(r.error).padEnd(7)} ` +
          `edge loss ${d.edgeLoss.toFixed(1).padStart(5)}%  changed ${d.pctChanged.toFixed(2).padStart(5)}%${flag}`,
      )
    }
    const over = scored.filter((r) => r.diffs[key].edgeLoss > maxEdgeLoss)
    console.log(
      `\n  range ${Math.min(...scored.map((r) => r.diffs[key].edgeLoss)).toFixed(1)}-` +
        `${Math.max(...scored.map((r) => r.diffs[key].edgeLoss)).toFixed(1)}%, ` +
        `threshold ${maxEdgeLoss}%`,
    )
    console.log(
      '\n  NOW OPEN THE IMAGES. This number ranks candidates; it does not approve them.\n',
    )
    if (over.length) process.exitCode = 1
  } else if (hasBlender) {
    console.log('\nNo renders were produced — treat this run as unverified.')
    process.exitCode = 1
  } else {
    process.exitCode = 1
  }

  await fsp.writeFile(path.join(work, 'qa-planner-lod.json'), JSON.stringify(rows, null, 1))
  console.log(`Full results: ${path.join(work, 'qa-planner-lod.json')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
