// src/core/assets.ts
import { z } from 'zod'
import manifest from '@data/assets.manifest.json'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'

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
  sku: z.string().optional(),
  model: z.string().optional(),      // /assets/models/foo.glb
  thumbnail: z.string().optional(),  // optional thumbnail
  assetLibraryId: z.string().optional(),
  sourceModelId: z.string().optional(),
  artistName: z.string().optional(),
  previewUrl: z.string().optional(),
  modelBottomOffset: z.number().optional(), // Y offset to place model bottom at table surface
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
      loader.load(
        url,
        (gltf) => {
          try {
            const root = gltf.scene
            root.updateMatrixWorld(true)
            const container = new THREE.Group()
            container.add(root)

            // Compute bbox and shift so the base sits at y=0
            const bbox = new THREE.Box3().setFromObject(root)
            const min = bbox.min
            const baseShift = -min.y
            if (baseShift !== 0) {
              root.position.y += baseShift
            }

            container.updateMatrixWorld(true)
            console.log(`✓ GLB loaded successfully: ${url}`)
            resolve(container)
          } catch (error) {
            console.error(`✗ Error processing GLB: ${url}`, error)
            reject(error)
          }
        },
        (progress) => {
          console.log(`Loading GLB: ${url} - ${Math.round((progress.loaded / progress.total) * 100)}%`)
        },
        (error) => {
          console.error(`✗ Failed to load GLB: ${url}`, error)
          reject(error)
        }
      )
    })
    gltfCache.set(url, p)
  }
  return gltfCache.get(url)!
}

export function measureObjectAABB(obj: THREE.Object3D) {
  const bbox = new THREE.Box3().setFromObject(obj)
  const size = new THREE.Vector3()
  bbox.getSize(size)
  return {
    x: size.x,
    y: size.y,
    z: size.z,
    minY: bbox.min.y, // Bottom Y position of the model
  }
}

// Given aabb + gridSize → grid cell footprint
export function deriveFootprint(aabb: {x:number; z:number}, gridSize: number) {
  const cols = Math.max(1, Math.round(aabb.x / gridSize))
  const rows = Math.max(1, Math.round(aabb.z / gridSize))
  return { cols, rows }
}
