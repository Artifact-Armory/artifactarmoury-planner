// src/core/assets.ts
import { z } from 'zod'
import manifest from '@data/assets.manifest.json'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { browseApi } from '@/api/endpoints/browse'

export const AssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tags: z.array(z.string()).default([]),
  aabb: z.object({
    x: z.number().positive(),
    z: z.number().positive(),
    y: z.number().positive(),
  }),
  footprint: z.object({
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  rotationStepDeg: z.number().int().positive().default(90),
  price: z.number().optional(),
  fulfillment: z.enum(['stl', 'print']).default('print'),
  sku: z.string().optional(),
  artistName: z.string().optional(),
  category: z.string().optional(),   // palette grouping, e.g. "Elevation"
  // Modular height-tile metadata (absent for ordinary props/buildings).
  elevation: z.object({
    // Vertical levels this tile contributes to the surface (full block = 2, half = 1).
    heightUnits: z.number().int().nonnegative(),
    // Ramp tiles render as a wedge rising toward `dir` and connect adjacent levels.
    ramp: z.object({ dir: z.enum(['N', 'S', 'E', 'W']) }).optional(),
  }).optional(),
  model: z.string().optional(),      // /assets/models/foo.glb
  thumbnail: z.string().optional(),  // optional thumbnail
})

export const AssetManifestSchema = z.object({
  assets: z.array(AssetSchema),
})

export type Asset = z.infer<typeof AssetSchema>

function validateManifest() {
  const parsed = AssetManifestSchema.safeParse(manifest)
  if (!parsed.success) {
    console.error('Asset manifest invalid:', parsed.error.format())
    throw new Error('Asset manifest invalid (see console for details)')
  }
  return parsed.data.assets
}

let _assets: Asset[] | null = null
let _byId: Map<string, Asset> | null = null

export function loadAssets(): Asset[] {
  if (_assets) return _assets
  _assets = validateManifest()
  _byId = new Map(_assets.map(a => [a.id, a]))
  return _assets
}

export function getAssetById(id: string): Asset | undefined {
  if (!_byId) loadAssets()
  return _byId!.get(id)
}

/**
 * Merge extra assets (e.g. the marketplace catalogue from the API) into the
 * by-id lookup so getAssetById resolves them too. Without this, an API-only
 * model can be selected in the palette but has no ghost and can't be placed,
 * because the scene's placement code resolves assets via getAssetById.
 * Local manifest entries (used by the starter layout) are kept.
 */
export function registerAssets(assets: Asset[]): void {
  if (!_byId) loadAssets() // seed the manifest entries first
  for (const a of assets) _byId!.set(a.id, a)
}

export function searchAssets(query: string): Asset[] {
  const q = query.trim().toLowerCase()
  const list = loadAssets()
  if (!q) return list
  return list.filter(a =>
    a.name.toLowerCase().includes(q) ||
    a.id.toLowerCase().includes(q) ||
    a.tags.some(t => t.toLowerCase().includes(q))
  )
}

// ---------- GLB cache + measurement ----------
const gltfCache = new Map<string, Promise<THREE.Group>>()

export function loadGLTFScene(url: string): Promise<THREE.Group> {
  if (!gltfCache.has(url)) {
    const loader = new GLTFLoader()
    const p = new Promise<THREE.Group>((resolve, reject) => {
      loader.load(url, (gltf) => {
        const root = gltf.scene
        root.updateMatrixWorld(true)
        // Compute bbox and shift so the base sits at y=0
        const bbox = new THREE.Box3().setFromObject(root)
        const size = new THREE.Vector3()
        bbox.getSize(size)
        const min = bbox.min
        // Lower the model so its base touches ground (y=0)
        const baseShift = -min.y
        if (baseShift !== 0) {
          const g = new THREE.Group()
          g.add(root)
          root.position.y += baseShift
          g.updateMatrixWorld(true)
          resolve(g)
        } else {
          resolve(root as THREE.Group)
        }
      }, undefined, reject)
    })
    gltfCache.set(url, p)
  }
  return gltfCache.get(url)!
}

export function measureObjectAABB(obj: THREE.Object3D) {
  const bbox = new THREE.Box3().setFromObject(obj)
  const size = new THREE.Vector3()
  bbox.getSize(size)
  return { x: size.x, y: size.y, z: size.z }
}

// Given aabb + gridSize → grid cell footprint
export function deriveFootprint(aabb: {x:number; z:number}, gridSize: number) {
  const cols = Math.max(1, Math.round(aabb.x / gridSize))
  const rows = Math.max(1, Math.round(aabb.z / gridSize))
  return { cols, rows }
}

// Default grid size in metres (1 inch ≈ 0.0254m, 1 ft = 0.3048m)
const DEFAULT_GRID_SIZE = 0.3048

/**
 * Load the asset catalogue from the backend browse API.
 * Maps TerrainModel records to the Asset type the planner expects.
 * Falls back to local manifest if the API is unreachable.
 */
export async function loadAssetsFromAPI(): Promise<Asset[]> {
  try {
    const response = await browseApi.searchModels({ limit: 200, sortBy: 'recent' })
    const models = response.models

    if (!models.length) {
      // API reachable but no published models — return local dev assets
      return loadAssets()
    }

    const mapped = models
      .filter((m) => m.glbUrl) // only include models with a GLB preview
      .map((m) => {
        // Backend stores dimensions in mm; planner needs metres
        const wM = m.width != null ? m.width / 1000 : 0.15
        const dM = m.depth != null ? m.depth / 1000 : 0.15
        const hM = m.height != null ? m.height / 1000 : 0.15

        const aabb = { x: wM, z: dM, y: hM }
        const footprint = deriveFootprint(aabb, DEFAULT_GRID_SIZE)

        return {
          id: m.id,
          name: m.name,
          tags: m.tags ?? [],
          aabb,
          footprint,
          rotationStepDeg: 90,
          price: m.basePrice ?? 0,
          fulfillment: m.fulfillmentType ?? 'print',
          artistName: m.artistName,
          model: m.glbUrl,
          thumbnail: m.thumbnailUrl,
        } satisfies Asset
      })

    // Make these resolvable by getAssetById (used by the scene's ghost +
    // placement code), otherwise a palette model can't be placed on the table.
    registerAssets(mapped)
    return mapped
  } catch {
    // API unreachable (dev without backend running) — use local manifest
    console.warn('[planner] API unavailable, falling back to local asset manifest')
    return loadAssets()
  }
}