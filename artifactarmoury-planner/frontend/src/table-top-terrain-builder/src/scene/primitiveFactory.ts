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

  // Create an invisible hitbox for raycasting (synchronously)
  // This ensures the hitbox is always available for selection
  const hitboxGeo = new THREE.BoxGeometry(aabb.x, aabb.y, aabb.z)
  const hitboxMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    wireframe: false
  })
  const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat)
  hitbox.position.y = aabb.y / 2 // same position as placeholder
  hitbox.userData.isHitbox = true
  group.add(hitbox)

  // 2) If a GLB is defined, load it and swap in once available
  if (asset.model) {
    loadGLTFScene(asset.model).then((scene) => {
      try {
        // measure the loaded geometry
        const measured = measureObjectAABB(scene)
        const store = useAppStore.getState()
        const gridSize = store.table.gridSize

        // Scale the model to match the expected dimensions
        // The GLB might be in a different scale than expected
        const currentAabb = asset.aabb ?? { x: 0.15, y: 0.15, z: 0.15 }

        console.log(`Expected dimensions: x=${currentAabb.x.toFixed(4)}, y=${currentAabb.y.toFixed(4)}, z=${currentAabb.z.toFixed(4)}`)
        console.log(`Measured dimensions: x=${measured.x.toFixed(4)}, y=${measured.y.toFixed(4)}, z=${measured.z.toFixed(4)}`)

        // Calculate scale factors to match expected dimensions
        const scaleX = measured.x > 0 ? currentAabb.x / measured.x : 1
        const scaleY = measured.y > 0 ? currentAabb.y / measured.y : 1
        const scaleZ = measured.z > 0 ? currentAabb.z / measured.z : 1

        console.log(`Scale factors: x=${scaleX.toFixed(4)}, y=${scaleY.toFixed(4)}, z=${scaleZ.toFixed(4)}`)

        // Store scale factors on the asset for later use (applied in ThreeStage)
        ;(asset as any).modelScale = { x: scaleX, y: scaleY, z: scaleZ }

        // Keep the original asset dimensions (don't overwrite with measured)
        // asset.aabb stays as is
        // asset.footprint stays as is

        // Clean proxy and insert model
        console.log(`✓ Clearing placeholder and adding model for asset ${asset.id}`)
        group.clear()
        const model = scene.clone(true)
        console.log(`✓ Model cloned, children count: ${model.children.length}`)

        // Debug: check model visibility and materials
        let meshCount = 0
        model.traverse((child: any) => {
          if (child.isMesh) {
            meshCount++
            console.log(`  - Mesh #${meshCount}: ${child.name}`)
            console.log(`    - Visible: ${child.visible}`)
            console.log(`    - Position: x=${child.position.x}, y=${child.position.y}, z=${child.position.z}`)
            console.log(`    - Scale: x=${child.scale.x}, y=${child.scale.y}, z=${child.scale.z}`)

            if (child.geometry) {
              console.log(`    - Geometry: ${child.geometry.type}, vertices: ${child.geometry.attributes.position?.count ?? 'N/A'}`)
            }

            if (child.material) {
              console.log(`    - Material type: ${child.material.type}`)
              console.log(`    - Material visible: ${child.material.visible}`)
              console.log(`    - Material side: ${child.material.side}`)

              // Force material to be visible
              child.material.visible = true
              child.material.side = THREE.DoubleSide

              if (child.material.color) {
                console.log(`    - Color: #${child.material.color.getHexString()}`)
              }
              if (child.material.map) {
                console.log(`    - Has texture map`)
              }
              if (child.material.emissive) {
                console.log(`    - Emissive: #${child.material.emissive.getHexString()}`)
              }
            }

            // Force visibility
            child.visible = true
          }
        })
        console.log(`  - Total meshes found: ${meshCount}`)

        // Calculate the bounding box of the model BEFORE centering
        const bbox = new THREE.Box3().setFromObject(model)
        const center = bbox.getCenter(new THREE.Vector3())
        const bottomY = bbox.min.y
        const height = bbox.max.y - bbox.min.y

        // Store the bottom offset so we can position the model correctly on the table
        // After centering, the model's bottom will be at: -height/2
        // So we need to offset by height/2 to place the bottom at Y=0
        ;(asset as any).modelBottomOffset = height / 2

        // Center the model geometry within the group
        // Offset the model so its center is at the group's origin
        model.position.sub(center)

        group.add(model)
        console.log(`✓ Model added to group, group now has ${group.children.length} children`)
        console.log(`✓ Model centered at group origin`)
        console.log(`✓ Model height: ${height.toFixed(4)}, bottom offset: ${(height / 2).toFixed(4)}`)
        console.log(`✓ Model placed for asset ${asset.id}:`, { measured, footprint: asset.footprint })
      } catch (error) {
        console.error(`✗ Error placing model for asset ${asset.id}:`, error)
      }
    }).catch((error) => {
      // If load fails, keep the proxy box
      console.error(`✗ Failed to load model for asset ${asset.id}: ${asset.model}`, error)
    })
  }

  // Ghosts/placed meshes share the same construction path here.
  return group
}
