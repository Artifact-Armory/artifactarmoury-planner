import { z } from 'zod'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { useAppStore } from '../state/store'

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
  model: z.string().optional(),
  thumbnail: z.string().optional(),
  creatorName: z.string().optional(),
  creatorAvatar: z.string().optional(),
  verifiedCreator: z.boolean().optional(),
  description: z.string().optional(),
  license: z.string().optional(),
  previewImages: z.array(z.string()).optional(),
  triangleCount: z.number().optional(),
  fileFormats: z.array(z.string()).optional(),
  printSettings: z.record(z.any()).optional(),
})

export type Asset = z.infer<typeof AssetSchema>

const gltfCache = new Map<string, Promise<THREE.Group>>()

export function getAssetById(id: string): Asset | undefined {
  const assets = useAppStore.getState().assets
  return assets.find((asset) => asset.id === id)
}

export function loadGLTFScene(url: string): Promise<THREE.Group> {
  if (!gltfCache.has(url)) {
    const loader = new GLTFLoader()
    const promise = new Promise<THREE.Group>((resolve, reject) => {
      loader.load(url, (gltf) => {
        const root = gltf.scene
        root.updateMatrixWorld(true)
        const bbox = new THREE.Box3().setFromObject(root)
        const min = bbox.min
        const baseShift = -min.y
        if (baseShift !== 0) {
          root.position.y += baseShift
        }
        const group = new THREE.Group()
        group.add(root)
        group.updateMatrixWorld(true)
        resolve(group)
      }, undefined, reject)
    })
    gltfCache.set(url, promise)
  }
  return gltfCache.get(url)!
}

export function measureObjectAABB(obj: THREE.Object3D) {
  const bbox = new THREE.Box3().setFromObject(obj)
  const size = new THREE.Vector3()
  bbox.getSize(size)
  return { x: size.x, y: size.y, z: size.z }
}

export function deriveFootprint(aabb: { x: number; z: number }, gridSize: number) {
  const cols = Math.max(1, Math.round(aabb.x / gridSize))
  const rows = Math.max(1, Math.round(aabb.z / gridSize))
  return { cols, rows }
}
