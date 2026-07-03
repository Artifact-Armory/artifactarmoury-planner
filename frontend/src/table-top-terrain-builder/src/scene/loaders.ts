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
 * Uniformly rescale an object so its bounding box fits the target real-world
 * size (metres), preserving aspect ratio. Used for API models whose GLB is in
 * millimetres (~1000x too large for the metre-scaled scene).
 */
function fitToAABB(root: THREE.Object3D, target: { x: number; y: number; z: number }): void {
  root.updateMatrixWorld(true)
  const size = new THREE.Vector3()
  new THREE.Box3().setFromObject(root).getSize(size)
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) return
  const s = Math.min(target.x / size.x, target.y / size.y, target.z / size.z)
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

  const p = new Promise<AssetTemplate>((resolve) => {
    gltfLoader.load(
      resolveAssetUrl(asset.model!),
      (gltf) => {
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
      undefined,
      () => {
        console.warn(`[planner] failed to load model for "${asset.id}" (${asset.model}); using box fallback`)
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
