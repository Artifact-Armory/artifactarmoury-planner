// src/scene/loaders.ts
//
// Shared, cached, Draco-capable GLB loading for the planner.
//
// - One GLTFLoader + DRACOLoader for the whole app (decoder self-hosted at /draco/).
// - Each unique GLB is fetched once; geometry/materials are shared across every
//   placed copy (the InstancedScene reuses these without re-uploading to the GPU).
// - Draco decoding runs on a worker (DRACOLoader spins up its own worker pool),
//   so it never blocks the main thread — keeps the existing Draco→GLB pipeline working.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import type { Asset } from '@core/assets'
import { assetLoadingManager } from './loadManager'
import { computeFootprintBitmap, setFootprintBitmap } from '@core/footprintMask'

// One decoder + loader shared process-wide.
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')
dracoLoader.setDecoderConfig({ type: 'wasm' }) // prefer the shipped wasm decoder (asm.js falls back automatically)

// Route model loads through the shared manager so GLBs count toward the
// initial loading bar (see loadManager.ts).
const gltfLoader = new GLTFLoader(assetLoadingManager)
gltfLoader.setDRACOLoader(dracoLoader)

// Preview GLBs are fetched through the signed /preview.glb endpoint. For a
// published model that's anonymous; for an artist's own *draft* the endpoint needs
// the JWT to authorise the owner. The header is sent to our API only — the browser
// strips it on the cross-origin 302 to R2 (which authorises via the signed query).
function applyAuthHeader() {
  try {
    const token = localStorage.getItem('terrain_builder_token')
    // setRequestHeader is inherited from THREE.Loader (not in the local jsm typings).
    if (token) (gltfLoader as any).setRequestHeader({ Authorization: `Bearer ${token}` })
  } catch { /* no localStorage (SSR/test) — anonymous is fine for public models */ }
}
applyAuthHeader()

// Relative model paths (dev manifest) resolve against the asset CDN when configured.
const ASSET_BASE = (import.meta.env.VITE_ASSET_BASE_URL || '').replace(/\/$/, '')
function resolveAssetUrl(p: string): string {
  if (/^https?:\/\//.test(p)) return p
  return ASSET_BASE ? `${ASSET_BASE}/${p.replace(/^\/+/, '')}` : p
}

/** A single drawable part of an asset, flattened out of the GLB hierarchy. */
export interface AssetPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  /** Local transform of this mesh relative to the base-aligned asset origin. */
  matrix: THREE.Matrix4
}

export interface AssetTemplate {
  /** Flattened meshes for instancing. */
  parts: AssetPart[]
  /** Measured size in metres (x = width, y = height, z = depth). */
  aabb: { x: number; y: number; z: number }
  /** A base-aligned, cloneable scene (used to build the placement ghost). */
  scene: THREE.Group
  /** True when this is the synthetic fallback box (model missing/failed). */
  fallback: boolean
}

const templateCache = new Map<string, Promise<AssetTemplate>>()

// ---------------------------------------------------------------------------
// Byte-level download progress.
//
// The loading gate used to count *finished* models, which on a busy table reads
// as 0% for several seconds and then jumps to done: every GLB is requested at
// once, so they all land together at the end. Bytes are what the viewer is
// actually waiting for, so they're what the bar should show.
// ---------------------------------------------------------------------------
interface ByteProgress { loaded: number; total: number }
const bytesByUrl = new Map<string, ByteProgress & { startedAt: number }>()
const byteListeners = new Set<() => void>()

function emitBytes() {
  for (const fn of byteListeners) fn()
}

/** Notified whenever a GLB download reports progress. Returns an unsubscribe. */
export function subscribeGlbBytes(fn: () => void): () => void {
  byteListeners.add(fn)
  return () => { byteListeners.delete(fn) }
}

/**
 * Download progress for every GLB whose fetch STARTED at or after `since`,
 * expressed in whole-model units: a file 40% downloaded contributes 0.4, a
 * finished one contributes 1.
 *
 * A finished download counts in full here even though decoding it (Draco, on a
 * worker) hasn't produced a usable template yet — otherwise the caller's bar
 * runs backwards every time a file lands, in the gap before its decode
 * finishes. A response with no Content-Length can't report a fraction and
 * contributes 0; the caller's own count of finished models covers it.
 */
export function glbUnitsSince(since: number): number {
  let units = 0
  for (const e of bytesByUrl.values()) {
    if (e.startedAt < since || e.total <= 0) continue
    units += Math.min(1, e.loaded / e.total)
  }
  return units
}

/**
 * How many bytes a specific set of assets' GLBs actually weigh, and how many of
 * them couldn't say.
 *
 * This is what "is this table heavy?" should be asking. Counting distinct models
 * was only ever a stand-in for download size, and it stopped tracking it the
 * moment the planner LOD landed (migration 064): a re-baked model costs roughly a
 * third of what it used to, but only once it HAS been re-baked, so during a
 * catalogue backfill two tables with the same model count can differ several-fold
 * in weight. Bytes distinguish them; a count cannot.
 *
 * `unknown` counts assets with a size we don't have — a response with no
 * Content-Length, or one that simply hasn't started downloading yet — so the
 * caller can tell "genuinely light" from "not measured", and fall back rather than
 * treating an unmeasured table as a small one.
 *
 * Takes asset MODEL paths (`Asset.model`) and resolves them the same way
 * loadAssetTemplate does, so the keys match what the loader recorded.
 */
export function glbBytesFor(models: Iterable<string>): { bytes: number; unknown: number } {
  let bytes = 0
  let unknown = 0
  for (const model of models) {
    const e = bytesByUrl.get(resolveAssetUrl(model))
    // `total` is 0 until the first lengthComputable progress event; settleBytes
    // backfills it from `loaded` on completion, so a finished download always has
    // a figure even when the server sent no Content-Length.
    if (!e || e.total <= 0) unknown++
    else bytes += Math.min(e.loaded, e.total)
  }
  return { bytes, unknown }
}

/**
 * Centre an object in X/Z and sit its base on y=0, so the asset's footprint
 * centre matches the instance position the occupancy grid uses.
 */
function baseAlign(root: THREE.Object3D): { x: number; y: number; z: number } {
  root.updateMatrixWorld(true)
  const bbox = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  bbox.getSize(size)
  bbox.getCenter(center)
  // shift so centre.x/z → 0 and min.y → 0
  root.position.x += -center.x
  root.position.z += -center.z
  root.position.y += -bbox.min.y
  root.updateMatrixWorld(true)
  return { x: size.x, y: size.y, z: size.z }
}

/**
 * Uniformly rescale an object so it matches the target real-world size (metres).
 * Used for API models whose GLB is authored in millimetres (~1000x too large for
 * the metre-scaled scene).
 *
 * The scale is derived from the HEIGHT axis alone, not a min-over-all-axes fit.
 * The preview proxy carries an embossed anti-theft watermark wrapped around the
 * model's bottom edge; its letters protrude slightly in X/Z, which inflates the
 * measured footprint. A min-over-all-axes fit would then shrink the WHOLE model
 * (height included) to swallow that protrusion, so a rendered piece ends up shorter
 * than the DB height that stacking (surfaceUnits → aabb.y) trusts — leaving a gap
 * between stacked pieces. The watermark never exceeds the model's height by
 * construction (it hugs the base, clamped to the lower half of the wall — see
 * blender/bake_proxy.py emboss_watermark), so Y is the invariant axis: GLB height
 * and DB height match, giving the exact mm→m ratio.
 */
/**
 * Rescale an mm-authored GLB to the model's real-world size (`target`, metres).
 *
 * DERIVED FROM THE FOOTPRINT, NEVER THE HEIGHT — and that is not a style choice.
 *
 * `target` comes from the DB dims, which are measured on the PRINT file. The mesh
 * being scaled is the baked proxy (or the LOD derived from it), and the bake's
 * poison pill DELETES THE BASE FACES — that is what makes a ripped preview
 * unprintable, so it is load-bearing and not going away. The proxy is therefore
 * genuinely shorter than the model it represents, while its footprint is untouched.
 *
 * Normalising by height took that missing base and inflated the whole piece to
 * cover it. Measured across the 28 parts of a real showcase set: every *top* piece
 * matched its DB height exactly and scaled x1.0000, while every *bottom* and *mid*
 * had lost base faces and was scaled up by 4.4% to 11.9% — a 12% relative size
 * difference between parts of the same building, which is why roofs stopped sitting
 * on the storeys beneath them. Worse, `surfaceUnits` in core/elevation.ts places the
 * next storey using the TRUE DB height, so the piece was drawn ~10% taller than the
 * height the planner had already reserved for it.
 *
 * X and Z survive the bake intact (they matched the DB width/depth within 0.03% on
 * all 28 parts), so they are the honest axes to scale from. Averaging the two rather
 * than picking one halves the effect of any single-axis noise. Height is kept only
 * as a fallback for a degenerate footprint, where it is better than nothing.
 */
function fitToAABB(root: THREE.Object3D, target: { x: number; y: number; z: number }): void {
  root.updateMatrixWorld(true)
  const size = new THREE.Vector3()
  new THREE.Box3().setFromObject(root).getSize(size)
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) return
  const ratios: number[] = []
  if (target.x > 0) ratios.push(target.x / size.x)
  if (target.z > 0) ratios.push(target.z / size.z)
  const s = ratios.length
    ? ratios.reduce((a, b) => a + b, 0) / ratios.length
    : target.y / size.y
  if (Number.isFinite(s) && s > 0) {
    root.scale.multiplyScalar(s)
    root.updateMatrixWorld(true)
  }
}

/** Project all triangles to XZ (metres, bbox-centered) and rasterize a footprint bitmap. */
function footprintBitmapFromParts(parts: AssetPart[], aabb: { x: number; y: number; z: number }): Uint8Array {
  const xz: number[] = []
  const v = new THREE.Vector3()
  for (const part of parts) {
    const pos = part.geometry.getAttribute('position') as THREE.BufferAttribute
    if (!pos) continue
    const index = part.geometry.getIndex()
    const count = index ? index.count : pos.count
    for (let i = 0; i < count; i++) {
      const vi = index ? index.getX(i) : i
      v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(part.matrix)
      xz.push(v.x, v.z)
    }
  }
  return computeFootprintBitmap(new Float32Array(xz), aabb.x / 2, aabb.z / 2)
}

function flatten(root: THREE.Object3D): AssetPart[] {
  const parts: AssetPart[] = []
  root.updateMatrixWorld(true)
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if ((mesh as any).isMesh && mesh.geometry) {
      parts.push({
        geometry: mesh.geometry,
        material: mesh.material,
        matrix: mesh.matrixWorld.clone(),
      })
    }
  })
  return parts
}

/** Triangular-prism ramp rising along +Z (low edge at -Z, high edge at +Z). Base at y=0. */
function rampGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const x = w / 2, z = d / 2
  // A,B low-bottom(-z) ; C,D high-bottom(+z) ; E,F high-top(+z)
  const A = [-x, 0, -z], B = [x, 0, -z], C = [x, 0, z], D = [-x, 0, z]
  const E = [-x, h, z], F = [x, h, z]
  const tri = (...p: number[][]) => p.flat()
  const verts = [
    ...tri(A, C, B), ...tri(A, D, C),   // bottom
    ...tri(A, B, F), ...tri(A, F, E),   // slope (top)
    ...tri(D, E, F), ...tri(D, F, C),   // high vertical back (+z)
    ...tri(A, E, D),                    // left side (-x)
    ...tri(B, C, F),                    // right side (+x)
  ]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  g.computeVertexNormals()
  return g
}

function fallbackTemplate(asset: Asset): AssetTemplate {
  const aabb = asset.aabb ?? { x: 0.1, y: 0.1, z: 0.1 }
  const isRamp = !!asset.elevation?.ramp
  const isTile = (asset.elevation?.heightUnits ?? 0) > 0
  const color = isTile ? 0x6b7f57 : 0x4a5a70 // earthy for elevation, slate for prop boxes
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 })
  const scene = new THREE.Group()

  if (isRamp) {
    const geo = rampGeometry(aabb.x, aabb.y, aabb.z) // base already at y=0
    scene.add(new THREE.Mesh(geo, mat))
    return { parts: [{ geometry: geo, material: mat, matrix: new THREE.Matrix4() }], aabb, scene, fallback: true }
  }

  const geo = new THREE.BoxGeometry(aabb.x, aabb.y, aabb.z)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = aabb.y / 2
  scene.add(mesh)
  const m = new THREE.Matrix4().makeTranslation(0, aabb.y / 2, 0)
  return { parts: [{ geometry: geo, material: mat, matrix: m }], aabb, scene, fallback: true }
}

/** Load (once) and cache an asset's instancing template. */
export function loadAssetTemplate(asset: Asset): Promise<AssetTemplate> {
  const key = asset.model ?? `__fallback__${asset.id}`
  const cached = templateCache.get(key)
  if (cached) return cached

  if (!asset.model) {
    const p = Promise.resolve(fallbackTemplate(asset))
    templateCache.set(key, p)
    return p
  }

  const url = resolveAssetUrl(asset.model!)
  const p = new Promise<AssetTemplate>((resolve) => {
    applyAuthHeader() // pick up a token acquired after this module first loaded
    const startedAt = Date.now()
    bytesByUrl.set(url, { loaded: 0, total: 0, startedAt })
    const settleBytes = () => {
      const e = bytesByUrl.get(url)
      // Mark it complete even when the response had no Content-Length, so a
      // finished download never holds the bar back.
      if (e) bytesByUrl.set(url, { ...e, total: Math.max(e.total, e.loaded), loaded: Math.max(e.total, e.loaded) })
      emitBytes()
    }
    gltfLoader.load(
      url,
      (gltf) => {
        settleBytes()
        const root = gltf.scene
        if (asset.scaleToFit && asset.aabb) fitToAABB(root, asset.aabb)
        const aabb = baseAlign(root)
        const parts = flatten(root)
        if (parts.length === 0) {
          resolve(fallbackTemplate(asset))
          return
        }
        // Rasterize the real top-down silhouette so placement/stacking uses the
        // model's actual footprint, not its bounding-box square.
        try { setFootprintBitmap(asset.id, footprintBitmapFromParts(parts, aabb)) } catch { /* keep rectangle fallback */ }
        resolve({ parts, aabb, scene: root as THREE.Group, fallback: false })
      },
      (e) => {
        if (!e.lengthComputable) return
        const cur = bytesByUrl.get(url)
        bytesByUrl.set(url, { loaded: e.loaded, total: e.total, startedAt: cur?.startedAt ?? Date.now() })
        emitBytes()
      },
      () => {
        console.warn(`[planner] failed to load model for "${asset.id}" (${asset.model}); using box fallback`)
        bytesByUrl.delete(url) // a failed download shouldn't pin the bar short of 100%
        emitBytes()
        resolve(fallbackTemplate(asset))
      },
    )
  })
  templateCache.set(key, p)
  return p
}

/** Synchronously return a template if it's already cached (resolved), else null. */
const resolved = new Map<string, AssetTemplate>()
export function getResolvedTemplate(asset: Asset): AssetTemplate | null {
  const key = asset.model ?? `__fallback__${asset.id}`
  return resolved.get(key) ?? null
}

/** Kick off a load and record the resolved template for synchronous access. */
export function ensureTemplate(asset: Asset): Promise<AssetTemplate> {
  const key = asset.model ?? `__fallback__${asset.id}`
  return loadAssetTemplate(asset).then((t) => {
    resolved.set(key, t)
    return t
  })
}
