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

import * as THREE from 'three'
import { assetLoadingManager } from '../scene/loadManager'
import type { PaintMap } from './paintmap'

/** Physical size (metres) that one texture tile covers on the table. 1 ft ≈ 0.3048m. */
export const TEXTURE_TILE_SIZE = 0.3048

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
  { id: 'sand',  label: 'Sand',  color: 0xc2a878, roughness: 0.9,  speckle: 16, pbr: true },
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
  const canvas = document.createElement('canvas')
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

function loadPbrMap(url: string, srgb: boolean): THREE.Texture {
  const cached = pbrTextureCache.get(url)
  if (cached) return cached

  const tex = pbrLoader.load(url)
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
export function buildTableMaterial(id: string, table: { width: number; height: number }): THREE.MeshStandardMaterial {
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
    const arm = apply(loadPbrMap(`${dir}/arm.webp`, false))
    mat.aoMap = arm
    mat.roughnessMap = arm
    mat.metalnessMap = arm
    mat.roughness = 1 // let the ARM green channel fully drive roughness
    mat.metalness = 1 // …and blue channel drive metalness (≈0 for non-metal surfaces)
  } else if (def.id !== 'plain') {
    // Procedural placeholder (albedo only; constant roughness).
    mat.map = apply(makeProceduralTexture(def))
  }
  mat.needsUpdate = true
  return mat
}

// ---- paint overlay ---------------------------------------------------------
//
// The painted ground is drawn as a transparent texture that sits just above the
// surface. Painted cells are filled with the chosen material's tiling pattern;
// everywhere else stays transparent so the base material shows through.

/** Longest-edge resolution of the baked overlay canvas. */
const OVERLAY_MAX = 1024

/**
 * Bake a paint map into an RGBA canvas covering the whole table (uv 0..1).
 * Painted cells get their material's seamless tile; unpainted cells are clear.
 * `into` reuses an existing canvas (so the CanvasTexture can just flag an update).
 */
export function bakePaintOverlayCanvas(
  pm: PaintMap,
  table: { width: number; height: number },
  into?: HTMLCanvasElement,
): HTMLCanvasElement {
  const aspect = table.height / table.width
  const w = OVERLAY_MAX
  const h = Math.max(1, Math.round(OVERLAY_MAX * aspect))
  const canvas = into ?? document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)

  // One tiling pattern per palette material, scaled so a tile covers the same
  // physical size (TEXTURE_TILE_SIZE) it does on the base surface.
  const tilePx = (w * (TEXTURE_TILE_SIZE / table.width)) / 256
  const patterns = pm.palette.map((id) => {
    const p = ctx.createPattern(getMaterialTileCanvas(id), 'repeat')
    if (p && typeof (p as any).setTransform === 'function') {
      ;(p as any).setTransform(new DOMMatrix().scale(tilePx))
    }
    return p
  })

  const cw = w / pm.cols
  const ch = h / pm.rows
  for (let j = 0; j < pm.rows; j++) {
    for (let i = 0; i < pm.cols; i++) {
      const idx = pm.cells[j * pm.cols + i]
      if (!idx) continue
      const pat = patterns[idx - 1]
      if (!pat) continue
      ctx.fillStyle = pat
      // +1px overlap avoids hairline seams between same-material cells.
      ctx.fillRect(Math.floor(i * cw), Math.floor(j * ch), Math.ceil(cw) + 1, Math.ceil(ch) + 1)
    }
  }
  return canvas
}

/** A texture wrapping the baked overlay canvas, oriented to match terrain uv. */
export function makePaintOverlayTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.flipY = false // terrain/grid uv has v increasing with world +Z (canvas top→bottom)
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

