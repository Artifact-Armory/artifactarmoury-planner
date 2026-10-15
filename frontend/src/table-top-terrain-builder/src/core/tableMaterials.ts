// src/core/tableMaterials.ts
//
// Tileable PBR material for the table surface (wood / grass / sand / snow / stone).
//
// One tileable set per material is repeated across the table — never a unique asset
// per table size. Real CC0 PBR maps (albedo + normal + roughness + AO) load from the
// shared asset CDN when present; until those are dropped in, a lightweight procedural
// albedo keeps the picker fully functional. All four maps are wired when available.
//
// Real textures belong in the R2 bucket alongside the GLB catalogue (see TABLE_TEXTURES.md):
//   <ASSET_BASE>/textures/<id>/{albedo,normal,roughness,ao}.jpg
//
// Ground PAINT is separate: grass / dirt / sand paint uses bundled CC0 photographic
// maps (public/textures/ground, see sources.json there) and water is generated, so
// the overlay bake can run in a worker without touching the CDN. The base table
// surface keeps the R2 set above, so existing tables look exactly as they did.

import * as THREE from 'three'
import { assetLoadingManager } from '../scene/loadManager'
import type { PaintMap } from './paintmap'
import { groundCoverage } from './groundCoverage'

/** Physical size (metres) that one texture tile covers on the table. 1 ft ≈ 0.3048m. */
export const TEXTURE_TILE_SIZE = 0.3048

// Each worker has its own module state; DOM canvases remain the main-thread default.
let newPaintCanvas = (): HTMLCanvasElement => document.createElement('canvas')

const ASSET_BASE: string =
  (import.meta.env.VITE_ASSET_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export interface TableMaterialDef {
  id: string
  label: string
  /** Base tint — also the procedural-placeholder colour. */
  color: number
  roughness: number
  /** Per-pixel speckle strength for the procedural placeholder (0 = flat). */
  speckle: number
  /** When true, the procedural placeholder draws plank seams (wood). */
  planks?: boolean
  /** Set true once real CC0 maps exist at <ASSET_BASE>/textures/<id>/. */
  pbr?: boolean
}

export const TABLE_MATERIALS: TableMaterialDef[] = [
  // pbr:true → loads real CC0 maps from <ASSET_BASE>/textures/<id>/ when VITE_ASSET_BASE_URL
  // is set; otherwise falls back to the procedural placeholder automatically.
  { id: 'grass', label: 'Grass', color: 0x4a6b32, roughness: 0.95, speckle: 26, pbr: true },
  // Dirt has no R2 set; as a base surface it uses the bundled ground maps.
  { id: 'dirt',  label: 'Dirt',  color: 0x806348, roughness: 0.96, speckle: 20 },
  { id: 'sand',  label: 'Sand',  color: 0xc2a878, roughness: 0.9,  speckle: 16, pbr: true },
  // Generated ripples (colour + normal + gloss), no image files.
  { id: 'water', label: 'Water', color: 0x237f9f, roughness: 0.18, speckle: 0 },
  { id: 'snow',  label: 'Snow',  color: 0xdfe8f2, roughness: 0.6,  speckle: 10, pbr: true },
  { id: 'metal', label: 'Metal', color: 0x8a8f96, roughness: 0.5,  speckle: 8,  pbr: true },
  { id: 'wood',  label: 'Wood',  color: 0x6b4a2e, roughness: 0.7,  speckle: 12, planks: true },
  { id: 'stone', label: 'Stone', color: 0x6e7378, roughness: 0.85, speckle: 22 },
  { id: 'plain', label: 'Plain', color: 0x18212e, roughness: 0.95, speckle: 0 },
]

export function getTableMaterialDef(id: string): TableMaterialDef {
  return TABLE_MATERIALS.find((m) => m.id === id) ?? TABLE_MATERIALS[0]
}

// ---- procedural placeholder albedo (seamless, cached per material) ----
const procCanvasCache = new Map<string, HTMLCanvasElement>()
const procTextureCache = new Map<string, THREE.Texture>()

/** The seamless procedural tile as a raw canvas (cached). Used both as a Three
 *  texture source and, for the paint overlay, as a 2D fill pattern. */
export function getMaterialTileCanvas(id: string): HTMLCanvasElement {
  const cached = procCanvasCache.get(id)
  if (cached) return cached
  const def = getTableMaterialDef(id)

  const size = 256
  const canvas = newPaintCanvas()
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const base = new THREE.Color(def.color)
  ctx.fillStyle = `rgb(${(base.r * 255) | 0},${(base.g * 255) | 0},${(base.b * 255) | 0})`
  ctx.fillRect(0, 0, size, size)

  // speckle (wraps because each pixel is independent → seamless when tiled)
  if (def.speckle > 0) {
    const img = ctx.getImageData(0, 0, size, size)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * def.speckle
      d[i] = clamp(d[i] + n)
      d[i + 1] = clamp(d[i + 1] + n)
      d[i + 2] = clamp(d[i + 2] + n)
    }
    ctx.putImageData(img, 0, 0)
  }

  if (def.planks) {
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'
    ctx.lineWidth = 2
    for (let y = 0; y <= size; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke()
    }
  }

  procCanvasCache.set(id, canvas)
  return canvas
}

function makeProceduralTexture(def: TableMaterialDef): THREE.Texture {
  const cached = procTextureCache.get(def.id)
  if (cached) return cached
  const tex = new THREE.CanvasTexture(getMaterialTileCanvas(def.id))
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  procTextureCache.set(def.id, tex)
  return tex
}

function clamp(v: number) { return Math.max(0, Math.min(255, v)) }

// One shared loader (routed through the loading manager so textures count toward
// the startup loading bar) + a per-URL cache. Without the cache, switching
// surfaces or resizing the table re-downloaded and re-decoded these multi-MB
// PBR maps every time, which is what caused the lag.
const pbrLoader = new THREE.TextureLoader(assetLoadingManager)
const pbrTextureCache = new Map<string, THREE.Texture>()
const pendingReady = new Map<THREE.Texture, Array<() => void>>()

function loadPbrMap(url: string, srgb: boolean, onReady?: () => void): THREE.Texture {
  const cached = pbrTextureCache.get(url)
  if (cached) {
    if (onReady && cached.image) onReady()
    else if (onReady) pendingReady.set(cached, [...(pendingReady.get(cached) ?? []), onReady])
    return cached
  }

  const tex = pbrLoader.load(url, () => {
    for (const fn of pendingReady.get(tex) ?? []) fn()
    pendingReady.delete(tex)
  })
  if (onReady) pendingReady.set(tex, [onReady])
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  // Crisp texel filtering at grazing table angles; clamped to GPU max on upload.
  tex.anisotropy = 8
  pbrTextureCache.set(url, tex)
  return tex
}

/**
 * Build a tileable material for the current table. `repeat` is computed from the
 * table size so the texture tiles at a constant physical scale regardless of table
 * dimensions. Caller must set `geometry` uv2 = uv for the AO map to apply.
 */
export function buildTableMaterial(
  id: string,
  table: { width: number; height: number },
  /** Called when late-arriving bundled maps are swapped in (scene re-render). */
  onUpdate?: () => void,
): THREE.MeshStandardMaterial {
  if (BUNDLED_BASE.has(id)) return buildBundledMaterial(id, table, onUpdate)
  const def = getTableMaterialDef(id)
  const repeatX = Math.max(1, Math.round(table.width / TEXTURE_TILE_SIZE))
  const repeatY = Math.max(1, Math.round(table.height / TEXTURE_TILE_SIZE))

  const mat = new THREE.MeshStandardMaterial({
    color: def.pbr ? 0xffffff : def.color,
    roughness: def.roughness,
    metalness: 0,
    side: THREE.DoubleSide,
  })

  const apply = (t: THREE.Texture | null) => {
    if (t) t.repeat.set(repeatX, repeatY)
    return t
  }

  if (def.pbr && ASSET_BASE) {
    // Full CC0 PBR set served from the asset CDN, WebP-optimized (see
    // scripts/optimize-textures.ts): albedo/normal/arm, all .webp.
    // ARM = AO/Roughness/Metalness packed in R/G/B.
    const dir = `${ASSET_BASE}/textures/${def.id}`
    mat.map = apply(loadPbrMap(`${dir}/albedo.webp`, true))
    mat.normalMap = apply(loadPbrMap(`${dir}/normal.webp`, false))
    // One ARM map drives three channels: Three.js reads AO=R, Roughness=G, Metalness=B.
    // The ARM channels only take over once the map has actually arrived: metalness 1
    // with no map yet (or a failed fetch) is a fully metallic surface with no
    // environment to reflect, i.e. solid black, and on-demand rendering meant it
    // could stay that way indefinitely.
    const arm = apply(loadPbrMap(`${dir}/arm.webp`, false, () => {
      mat.roughness = 1 // let the ARM green channel fully drive roughness
      mat.metalness = 1 // …and blue channel drive metalness (≈0 for non-metal surfaces)
      mat.needsUpdate = true
    }))
    mat.aoMap = arm
    mat.roughnessMap = arm
    mat.metalnessMap = arm
  } else if (def.id !== 'plain') {
    // Procedural placeholder (albedo only; constant roughness).
    mat.map = apply(makeProceduralTexture(def))
  }
  mat.needsUpdate = true
  return mat
}


// ---- ground paint maps -------------------------------------------------------
//
// Painted ground is drawn as three transparent overlay maps (colour, normal,
// roughness) baked through the SAME soft coverage masks, so the channels stay
// aligned at every blend. Grass / dirt / sand use bundled CC0 photographs
// (public/textures/ground); water is generated; every other material falls back
// to its procedural tile with a flat normal and constant roughness.

const GROUND_IDS = ['grass', 'dirt', 'sand'] as const
/** Base-surface ids drawn from the bundled/generated maps (no R2 set exists). */
const BUNDLED_BASE = new Set(['dirt', 'water'])
export type GroundChannel = 'albedo' | 'normal' | 'roughness'
const CHANNELS: GroundChannel[] = ['albedo', 'normal', 'roughness']

const workerSources = new Map<string, ImageBitmap>()
export type PaintSource = { id: string; channel: GroundChannel; image: ImageBitmap }

/** Worker side: use OffscreenCanvas and the bitmaps the main thread decoded. */
export function configurePaintWorker(sources: PaintSource[]) {
  newPaintCanvas = () => new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement
  for (const source of sources) workerSources.set(`${source.id}/${source.channel}`, source.image)
}

/** Decode every material × channel once, for transfer to the paint worker. */
export async function preparePaintSources(): Promise<PaintSource[]> {
  await preloadGroundTextures()
  return Promise.all(TABLE_MATERIALS.flatMap((material) => CHANNELS.map(async (channel) => ({
    id: material.id, channel, image: await createImageBitmap(materialSource(material.id, channel)),
  }))))
}

// Deliberately NOT routed through assetLoadingManager: these load lazily the
// first time a table has paint, and must not raise the planner's blocking
// loading overlay mid-session.
const images = new Map<string, HTMLImageElement>()
let preload: Promise<void> | undefined
export function preloadGroundTextures(): Promise<void> {
  if (!preload) {
    const loader = new THREE.ImageLoader()
    preload = Promise.all(GROUND_IDS.flatMap((id) => CHANNELS.map(async (channel) => {
      const key = `${id}/${channel}`
      try {
        images.set(key, await loader.loadAsync(`/textures/ground/${key}.jpg`))
      } catch {
        console.warn(`Ground texture unavailable: ${key}; using fallback`)
      }
    }))).then(() => undefined)
  }
  return preload
}

const fallbackMaps = new Map<string, HTMLCanvasElement>()
const gradedSources = new Map<string, HTMLCanvasElement>()

/** Seamless water ripples: matching colour, normal and gloss at every edge. */
function waterSource(channel: GroundChannel): HTMLCanvasElement {
  const cached = gradedSources.get(`water/${channel}`)
  if (cached) return cached
  const size = 256, tau = Math.PI * 2
  const canvas = newPaintCanvas()
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size
    // Integer wave numbers keep every term periodic over the tile.
    const a = tau * (3 * u + 2 * v), b = tau * (7 * u - 5 * v), c = tau * (13 * u + 11 * v)
    const height = 0.55 * Math.sin(a) + 0.25 * Math.sin(b) + 0.2 * Math.sin(c)
    const offset = (y * size + x) * 4
    if (channel === 'normal') {
      const nx = -0.09 * (1.65 * Math.cos(a) + 1.75 * Math.cos(b) + 2.6 * Math.cos(c))
      const ny = -0.09 * (1.1 * Math.cos(a) - 1.25 * Math.cos(b) + 2.2 * Math.cos(c))
      const length = Math.hypot(nx, ny, 1)
      pixels.data[offset] = (nx / length * 0.5 + 0.5) * 255
      pixels.data[offset + 1] = (ny / length * 0.5 + 0.5) * 255
      pixels.data[offset + 2] = (1 / length * 0.5 + 0.5) * 255
    } else if (channel === 'roughness') {
      pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = 46 + height * 6
    } else {
      const shimmer = 1 + height * 0.1
      pixels.data[offset] = 35 * shimmer
      pixels.data[offset + 1] = 127 * shimmer
      pixels.data[offset + 2] = 159 * shimmer
    }
    pixels.data[offset + 3] = 255
  }
  ctx.putImageData(pixels, 0, 0)
  gradedSources.set(`water/${channel}`, canvas)
  return canvas
}

/** Source image for one material channel (photo, generated, or fallback). */
function materialSource(id: string, channel: GroundChannel): HTMLImageElement | HTMLCanvasElement | ImageBitmap {
  const prepared = workerSources.get(`${id}/${channel}`)
  if (prepared) return prepared
  if (id === 'water') return waterSource(channel)
  const image = images.get(`${id}/${channel}`)
  if (image && id === 'sand' && channel === 'albedo') {
    const cached = gradedSources.get('sand/albedo')
    if (cached) return cached
    const canvas = newPaintCanvas()
    canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    for (let k = 0; k < pixels.data.length; k += 4) {
      // Warm the (grey, aerial) beach photo toward a yellow-orange sand without
      // flattening its ripple/grain variation.
      pixels.data[k] = clamp(pixels.data[k] * 1.48)
      pixels.data[k + 1] = clamp(pixels.data[k + 1] * 1.16)
      pixels.data[k + 2] = clamp(pixels.data[k + 2] * 0.62)
    }
    ctx.putImageData(pixels, 0, 0)
    gradedSources.set('sand/albedo', canvas)
    return canvas
  }
  if (image) return image
  if (channel === 'albedo') return getMaterialTileCanvas(id)
  const key = `${id}/${channel}`
  const cached = fallbackMaps.get(key)
  if (cached) return cached
  const canvas = newPaintCanvas()
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d')!
  const roughness = Math.round(getTableMaterialDef(id).roughness * 255)
  ctx.fillStyle = channel === 'normal' ? 'rgb(128,128,255)' : `rgb(${roughness},${roughness},${roughness})`
  ctx.fillRect(0, 0, 1, 1)
  fallbackMaps.set(key, canvas)
  return canvas
}

/** Base surface for a material with no R2 set (dirt, water), at the paint's world scale. */
function buildBundledMaterial(id: string, table: { width: number; height: number }, onUpdate?: () => void): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide })
  const maps = CHANNELS.map((channel) => {
    const texture = new THREE.Texture(materialSource(id, channel))
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(table.width / TEXTURE_TILE_SIZE, table.height / TEXTURE_TILE_SIZE)
    texture.colorSpace = channel === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.anisotropy = 8
    texture.needsUpdate = true
    return texture
  })
  ;[material.map, material.normalMap, material.roughnessMap] = maps
  material.normalScale.set(0.65, 0.65)
  if ((GROUND_IDS as readonly string[]).includes(id)) {
    // Photos arrive after the first frame; swap them in place when they do.
    void preloadGroundTextures().then(() => {
      CHANNELS.forEach((channel, c) => {
        maps[c].image = materialSource(id, channel)
        maps[c].needsUpdate = true
      })
      onUpdate?.()
    })
  }
  material.addEventListener('dispose', () => maps.forEach((texture) => texture.dispose()))
  return material
}

export type PaintOverlayCanvases = Record<GroundChannel, HTMLCanvasElement>
export type PaintOverlayTextures = Record<GroundChannel, THREE.CanvasTexture>

export function emptyPaintOverlayMaps(): PaintOverlayCanvases {
  return Object.fromEntries(CHANNELS.map((channel) => [channel, newPaintCanvas()])) as PaintOverlayCanvases
}

// Scratch canvases are reused per output set, so a bake allocates nothing new.
const paintScratch = new WeakMap<PaintOverlayCanvases, {
  mask: HTMLCanvasElement; filtered: HTMLCanvasElement; layer: HTMLCanvasElement; coverage: ImageData
}>()

/**
 * Bake a paint map into the three overlay channels covering the whole table
 * (uv 0..1). `maxSize` is the longest edge in px. `into` reuses existing canvases.
 * Texture repeats are fixed in world space (TEXTURE_TILE_SIZE), independent of
 * the bake resolution and the table size.
 */
export function bakePaintOverlayMaps(
  pm: PaintMap, table: { width: number; height: number }, into?: PaintOverlayCanvases, maxSize = 2048,
): PaintOverlayCanvases {
  const aspect = table.height / table.width
  const w = Math.max(1, Math.round(maxSize / Math.max(1, aspect)))
  const h = Math.max(1, Math.round(w * aspect))
  const canvases = into ?? emptyPaintOverlayMaps()
  const contexts = CHANNELS.map((channel) => {
    const canvas = canvases[channel]
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    const ctx = canvas.getContext('2d')!
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, w, h)
    return ctx
  })
  let scratch = paintScratch.get(canvases)
  if (!scratch || scratch.mask.width !== pm.cols || scratch.mask.height !== pm.rows) {
    const mask = newPaintCanvas()
    mask.width = pm.cols; mask.height = pm.rows
    scratch = { mask, filtered: newPaintCanvas(), layer: newPaintCanvas(), coverage: mask.getContext('2d')!.createImageData(pm.cols, pm.rows) }
    paintScratch.set(canvases, scratch)
  }
  const { mask, filtered, layer, coverage } = scratch
  const maskCtx = mask.getContext('2d')!
  for (const canvas of [filtered, layer]) {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  }
  const filteredCtx = filtered.getContext('2d')!
  const layerCtx = layer.getContext('2d')!
  const weights = groundCoverage(pm, table)
  for (const [index, alpha] of weights) {
    if (!index) continue
    const id = pm.palette[index - 1]
    if (!id) continue
    for (let k = 0; k < alpha.length; k++) {
      const offset = k * 4
      coverage.data[offset] = coverage.data[offset + 1] = coverage.data[offset + 2] = 255
      coverage.data[offset + 3] = alpha[k]
    }
    maskCtx.putImageData(coverage, 0, 0)
    // Upscale the cell mask with a ~6 mm feather so edges read as natural blends.
    filteredCtx.clearRect(0, 0, w, h)
    filteredCtx.imageSmoothingEnabled = true
    filteredCtx.filter = `blur(${Math.max(0.5, w / table.width * 0.006)}px)`
    filteredCtx.drawImage(mask, 0, 0, w, h)
    filteredCtx.filter = 'none'
    for (let c = 0; c < CHANNELS.length; c++) {
      const source = materialSource(id, CHANNELS[c])
      const pattern = layerCtx.createPattern(source, 'repeat')!
      pattern.setTransform(new DOMMatrix().scale(
        w * TEXTURE_TILE_SIZE / table.width / source.width,
        h * TEXTURE_TILE_SIZE / table.height / source.height,
      ))
      layerCtx.globalCompositeOperation = 'source-over'
      layerCtx.clearRect(0, 0, w, h)
      layerCtx.fillStyle = pattern
      layerCtx.fillRect(0, 0, w, h)
      layerCtx.globalCompositeOperation = 'destination-in'
      layerCtx.drawImage(filtered, 0, 0)
      // Coverage weights partition each pixel, so adding the layers is a blend.
      contexts[c].globalCompositeOperation = 'lighter'
      contexts[c].drawImage(layer, 0, 0)
    }
  }
  contexts.forEach((ctx) => { ctx.globalCompositeOperation = 'source-over' })
  return canvases
}

/** Textures wrapping the baked overlay canvases, oriented to match terrain uv. */
export function makePaintOverlayTextures(canvases: PaintOverlayCanvases): PaintOverlayTextures {
  return Object.fromEntries(CHANNELS.map((channel) => {
    const texture = new THREE.CanvasTexture(canvases[channel])
    texture.colorSpace = channel === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.flipY = false // terrain uv has v increasing with world +Z (canvas top→bottom)
    texture.anisotropy = 8
    texture.userData.width = canvases[channel].width
    texture.userData.height = canvases[channel].height
    return [channel, texture]
  })) as PaintOverlayTextures
}
