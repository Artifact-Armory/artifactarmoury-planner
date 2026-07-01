// src/scene/ghost.ts
//
// The translucent placement preview that follows the cursor. Built from the same
// cached GLB template as the real piece (so it reads as the actual model), with a
// green/red tint for placeable/blocked.

import * as THREE from 'three'
import type { Asset } from '@core/assets'
import { ensureTemplate, getResolvedTemplate } from './loaders'

const VALID = new THREE.Color(0x44d07a)
const INVALID = new THREE.Color(0xe05757)

export class Ghost {
  readonly group = new THREE.Group()
  private asset: Asset | null = null
  private material: THREE.MeshStandardMaterial
  private rotDeg = 0
  private onReady: () => void

  constructor(onReady: () => void) {
    this.onReady = onReady
    this.group.visible = false
    this.material = new THREE.MeshStandardMaterial({
      color: VALID,
      emissive: VALID.clone().multiplyScalar(0.25),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      roughness: 0.6,
      metalness: 0,
    })
  }

  setAsset(asset: Asset | null) {
    this.asset = asset
    this.clearChildren()
    this.rotDeg = 0
    if (!asset) {
      this.group.visible = false
      return
    }
    const template = getResolvedTemplate(asset)
    if (template) {
      this.build(template.scene)
    } else {
      // show a quick box stand-in until the model resolves
      const a = asset.aabb ?? { x: 0.1, y: 0.1, z: 0.1 }
      const box = new THREE.Mesh(new THREE.BoxGeometry(a.x, a.y, a.z), this.material)
      box.position.y = a.y / 2
      this.group.add(box)
      ensureTemplate(asset).then(() => {
        if (this.asset === asset) {
          this.clearChildren()
          const t = getResolvedTemplate(asset)
          if (t) this.build(t.scene)
          this.onReady()
        }
      })
    }
    this.group.visible = true
  }

  private build(scene: THREE.Group) {
    const clone = scene.clone(true)
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh
      if ((mesh as any).isMesh) mesh.material = this.material
    })
    this.group.add(clone)
  }

  setTransform(x: number, z: number, rotDeg: number, y = 0) {
    this.rotDeg = rotDeg
    this.group.position.set(x, y, z)
    this.group.rotation.y = THREE.MathUtils.degToRad(rotDeg)
  }

  get rotation() {
    return this.rotDeg
  }

  setValid(valid: boolean) {
    const c = valid ? VALID : INVALID
    this.material.color.copy(c)
    this.material.emissive.copy(c).multiplyScalar(0.25)
  }

  get visible() {
    return this.group.visible
  }

  private clearChildren() {
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      this.group.remove(this.group.children[i])
    }
  }
}
