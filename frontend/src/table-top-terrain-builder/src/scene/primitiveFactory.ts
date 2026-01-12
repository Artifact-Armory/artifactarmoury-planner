// src/scene/primitiveFactory.ts
import * as THREE from 'three'
import type { Asset } from '@core/assets'
import { loadGLTFScene, measureObjectAABB, deriveFootprint } from '@core/assets'
import { useAppStore } from '@state/store'

// Tints to show validity during placement (ThreeStage already calls setGhostValid)
const VALID_COLOR = 0x3fbf5a
const INVALID_COLOR = 0xe05757
const NEUTRAL_COLOR = 0x4da3ff

export function setGhostValid(obj: THREE.Object3D, valid: boolean) {
  obj.traverse((child) => {
    const m = (child as any).material as THREE.Material | undefined
    if (!m) return
    if ('color' in m) (m as any).color.setHex(valid ? VALID_COLOR : INVALID_COLOR)
    ;(m as any).opacity = 0.5
    ;(m as any).transparent = true
    if ('emissive' in m) (m as any).emissive?.setHex(0x000000)
  })
}

// Synchronous proxy right away, then swaps to model if available.
export function buildPlaceholderFor(asset: Asset): THREE.Object3D {
  // 1) Immediate proxy (box) using whatever AABB we know now (or a safe default)
  const aabb = asset.aabb ?? { x: 0.1, y: 0.1, z: 0.1 }
  const geo = new THREE.BoxGeometry(aabb.x, aabb.y, aabb.z)
  const mat = new THREE.MeshBasicMaterial({ color: NEUTRAL_COLOR, wireframe: true })
  const box = new THREE.Mesh(geo, mat)
  box.position.y = aabb.y / 2 // sit on ground
  const group = new THREE.Group()
  group.add(box)

  // 2) If a GLB is defined, load it and swap in once available
  if (asset.model) {
    loadGLTFScene(asset.model).then((scene) => {
      // measure and update asset metadata if missing/changed
      const measured = measureObjectAABB(scene)
      const store = useAppStore.getState()
      const gridSize = store.table.gridSize

      // Update the runtime asset object so occupancy uses the true size
      asset.aabb = { x: measured.x, y: measured.y, z: measured.z }
      asset.footprint = deriveFootprint({ x: measured.x, z: measured.z }, gridSize)

      // Clean proxy and insert model
      group.clear()
      const model = scene.clone(true)
      group.add(model)
    }).catch(() => {
      // If load fails, keep the proxy box
      console.warn(`Failed to load model for asset ${asset.id}: ${asset.model}`)
    })
  }

  // Ghosts/placed meshes share the same construction path here.
  return group
}
