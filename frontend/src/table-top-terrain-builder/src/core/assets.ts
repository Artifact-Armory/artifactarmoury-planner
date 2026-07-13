// src/core/assets.ts
import { z } from 'zod'
import manifest from '@data/assets.manifest.json'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { browseApi } from '@/api/endpoints/browse'
import { modelsApi } from '@/api/endpoints/models'
import { assetUrl, previewGlbUrl, previewPartGlbUrl } from '@/api/transformers'

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
  // Owning artist's user id (API models only) — used to gate placing another
  // artist's model on a showcase behind a collaboration request.
  artistId: z.string().optional(),
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
  // Artist-baked default tilt (pitch about X, degrees) applied when the piece is
  // first placed, so a model authored "lying down" stands upright automatically.
  defaultPitchDeg: z.number().optional(),
  // API models come from STLs authored in millimetres, so their GLB is ~1000x
  // too big for the metre-scaled scene. When set, the loader uniformly rescales
  // the GLB to the real-world `aabb` (dev-manifest GLBs are already in metres).
  scaleToFit: z.boolean().optional(),
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
export const DEFAULT_GRID_SIZE = 0.3048

/**
 * Load the asset catalogue from the backend browse API.
 * Maps TerrainModel records to the Asset type the planner expects.
 * Falls back to local manifest if the API is unreachable.
 */
export async function loadAssetsFromAPI(filter?: { terms?: string }): Promise<Asset[]> {
  // A comma-separated `facetSlug:termPath` selection (model class + facet filters),
  // forwarded to the same browse endpoint the marketplace uses.
  const hasFilter = Boolean(filter?.terms)
  try {
    const response = await browseApi.searchModels({
      limit: 200,
      sortBy: 'recent',
      terms: filter?.terms,
    })
    const models = response.models

    if (!models.length) {
      // With an active filter this is a genuine "no matches" — don't substitute the
      // local demo assets. Only seed the manifest on an unfiltered empty catalogue.
      return hasFilter ? [] : loadAssets()
    }

    const mapped = models
      // Only single-STL models with a GLB preview. Multi-part "set" models are
      // surfaced via their individually-placeable parts (see loadSetsFromAPI).
      .filter((m) => m.glbUrl && (m.partCount ?? 1) === 1)
      .map((m) => modelToAsset(m))
      .filter((a): a is Asset => a !== null)

    // Make these resolvable by getAssetById (used by the scene's ghost +
    // placement code), otherwise a palette model can't be placed on the table.
    registerAssets(mapped)
    return mapped
  } catch {
    // API unreachable (dev without backend running) — use local manifest, unless a
    // filter is active (then an empty list is the honest answer).
    console.warn('[planner] API unavailable, falling back to local asset manifest')
    return hasFilter ? [] : loadAssets()
  }
}

/**
 * Map an API model record (dimensions in mm) to a placeable planner Asset, or
 * null if it has no GLB / isn't a single-part model. Shared by the catalogue,
 * the artist's own-models loader, and the by-id resolver.
 */
function modelToAsset(m: {
  id: string; name: string; tags?: string[]; glbUrl?: string; thumbnailUrl?: string
  width?: number | null; depth?: number | null; height?: number | null
  basePrice?: number; fulfillmentType?: 'stl' | 'print'; artistName?: string; artistId?: string; partCount?: number
  category?: string; defaultPitchDeg?: number
}): Asset | null {
  if (!m.glbUrl || (m.partCount ?? 1) !== 1) return null
  const wM = m.width != null ? m.width / 1000 : 0.15
  const dM = m.depth != null ? m.depth / 1000 : 0.15
  const hM = m.height != null ? m.height / 1000 : 0.15
  const aabb = { x: wM, z: dM, y: hM }
  return {
    id: m.id,
    name: m.name,
    tags: m.tags ?? [],
    aabb,
    footprint: deriveFootprint(aabb, DEFAULT_GRID_SIZE),
    rotationStepDeg: 90,
    price: m.basePrice ?? 0,
    fulfillment: m.fulfillmentType ?? 'print',
    artistName: m.artistName,
    artistId: m.artistId,
    category: m.category, // palette grouping heading (buildings / vehicles / …)
    model: m.glbUrl,
    thumbnail: m.thumbnailUrl,
    scaleToFit: true, // GLB is in mm; rescale to the metre aabb above
    defaultPitchDeg: m.defaultPitchDeg || undefined,
  } satisfies Asset
}

/** The signed-in artist's own placeable models (incl. drafts) for "My items". */
export interface PlannerMyModel {
  id: string; name: string; thumbnail?: string; price: number; status: string
}

/**
 * Load the artist's own models (incl. unpublished drafts), register them so they
 * can be placed, and return a lightweight list for the palette. Non-artists / guests
 * get an empty list (the endpoint 401/403s).
 */
export async function loadMyModelsForPlanner(): Promise<PlannerMyModel[]> {
  try {
    const models = await modelsApi.getMyPlannerModels()
    const assets = models.map((m) => modelToAsset(m)).filter((a): a is Asset => a !== null)
    registerAssets(assets)
    return models
      .filter((m) => m.glbUrl && (m.partCount ?? 1) === 1)
      .map((m) => ({
        id: m.id,
        name: m.name,
        thumbnail: m.thumbnailUrl,
        price: m.basePrice ?? 0,
        status: (m as { status?: string }).status ?? 'draft',
      }))
  } catch {
    return []
  }
}

/**
 * Resolve models by id (publish-agnostic) and register any that aren't already
 * known, so a table renders every placed piece — including an artist's
 * unpublished models. Skips non-uuid ids (e.g. set "part:<id>" refs).
 */
export async function resolveAssetsByIds(ids: string[]): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => id && !id.startsWith('part:') && !getAssetById(id))
  if (missing.length === 0) return
  try {
    const models = await modelsApi.resolvePlannerAssets(missing)
    const assets = models.map((m) => modelToAsset(m)).filter((a): a is Asset => a !== null)
    registerAssets(assets)
  } catch {
    /* best-effort — unresolved ids just fall back to a placeholder box */
  }
}

// A multi-part "set": each part is a placeable asset, grouped under the set.
export interface PlannerSetData {
  id: string          // the parent model id (purchase/ownership unit)
  name: string
  thumbnail?: string
  price: number
  artistId: string
  partAssetIds: string[]
}

/**
 * Load published multi-part ("set") models and register each of their parts as
 * an individually-placeable asset. Returns the set groupings + the part assets
 * (kept off the flat catalogue so they only appear under their set tile).
 */
export async function loadSetsFromAPI(): Promise<{ sets: PlannerSetData[]; partAssets: Asset[] }> {
  try {
    const apiSets = await modelsApi.getSets()
    const partAssets: Asset[] = []
    const sets: PlannerSetData[] = []

    for (const s of apiSets) {
      const partAssetIds: string[] = []
      for (const part of s.parts) {
        if (!part.hasGlb) continue
        // The primary part's asset id IS the model id; extras get a namespaced id.
        const assetId = part.isPrimary ? s.id : `part:${part.id}`
        const wM = part.width != null ? part.width / 1000 : 0.15
        const dM = part.depth != null ? part.depth / 1000 : 0.15
        const hM = part.height != null ? part.height / 1000 : 0.15
        const aabb = { x: wM, z: dM, y: hM }
        partAssets.push({
          id: assetId,
          name: `${s.name} — ${part.name}`,
          tags: [],
          aabb,
          footprint: deriveFootprint(aabb, DEFAULT_GRID_SIZE),
          rotationStepDeg: 90,
          // A set is one purchase: only the primary part carries the price so the
          // planner's "Your build" total counts the set once (not per part).
          price: assetId === s.id ? s.price : 0,
          fulfillment: 'stl',
          artistId: s.artistId,
          model: part.isPrimary ? previewGlbUrl(s.id) : previewPartGlbUrl(part.id),
          thumbnail: assetUrl(s.thumbnailPath ?? undefined),
          scaleToFit: true,
          defaultPitchDeg: s.defaultPitchDeg || undefined,
        } satisfies Asset)
        partAssetIds.push(assetId)
      }
      if (partAssetIds.length === 0) continue
      sets.push({
        id: s.id,
        name: s.name,
        thumbnail: assetUrl(s.thumbnailPath ?? undefined),
        price: s.price,
        artistId: s.artistId,
        partAssetIds,
      })
    }

    // Resolvable by the scene for ghost/placement, like catalogue assets.
    registerAssets(partAssets)
    return { sets, partAssets }
  } catch {
    return { sets: [], partAssets: [] }
  }
}