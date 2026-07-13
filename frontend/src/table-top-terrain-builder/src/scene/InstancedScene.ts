// src/scene/InstancedScene.ts
//
// Renders all placed pieces with InstancedMesh: N copies of one asset = one draw
// call per sub-mesh, not N. Geometry/materials are shared from the template cache,
// so a unique GLB is only uploaded to the GPU once.
//
// Also owns selection/hover outlines, a placement "pop" animation, and instance
// picking. Selected pieces stay in their instanced batch (just lifted) with a
// glowing wire outline drawn over them — cheap, since only a few are ever selected.

import * as THREE from 'three'
import type { Asset } from '@core/assets'
import type { Instance } from '@state/store'
import { ensureTemplate, getResolvedTemplate, type AssetTemplate } from './loaders'
import { levelToY } from '@core/elevation'
import { watermarkedMaterial, disposeWatermarkMaterials } from './previewWatermark'

const LIFT = 0.012 // metres a selected piece floats above the table
const POP_MS = 180
const SELECT_GLOW = new THREE.Color(0x6cc4ff)
const HOVER_GLOW = new THREE.Color(0x8aa0b8)

const tmpQuat = new THREE.Quaternion()
const tmpQuatPitch = new THREE.Quaternion()
const tmpYAxis = new THREE.Vector3(0, 1, 0)
const tmpXAxis = new THREE.Vector3(1, 0, 0)
const tmpPos = new THREE.Vector3()
const tmpScale = new THREE.Vector3()
const tmpMat = new THREE.Matrix4()

export class InstancedScene {
  readonly group = new THREE.Group()

  private instances: Instance[] = []
  private assetsById = new Map<string, Asset>()
  private meshes: THREE.InstancedMesh[] = []
  /** assetId → ordered planner instance ids (instanceIndex → id). */
  private orderByAsset = new Map<string, string[]>()
  /** live transform overrides while dragging (not yet committed to store). */
  private liveOverride = new Map<string, { x: number; z: number; rotDeg: number }>()

  private selected = new Set<string>()
  private hovered: string | null = null
  private popStart = new Map<string, number>()
  private selectChangedAt = 0

  private outlineGroup = new THREE.Group()
  private outlines = new Map<string, THREE.LineSegments>()
  private hoverOutline: THREE.LineSegments | null = null

  private onNeedsTemplate: () => void
  /** Terrain height (m) at a world (x,z) — set by the stage so pieces ride the surface. */
  private heightAt: (x: number, z: number) => number = () => 0
  /** Whether an asset's placed pieces should show the "preview" watermark (unowned). */
  private shouldWatermark: (asset: Asset) => boolean = () => false

  constructor(onNeedsTemplate: () => void) {
    this.onNeedsTemplate = onNeedsTemplate
    this.group.add(this.outlineGroup)
  }

  /** Provide a terrain-height sampler; call refreshTransforms() after a change. */
  setHeightSampler(fn: (x: number, z: number) => number) {
    this.heightAt = fn
  }

  /** Set the predicate deciding which assets render with the preview watermark. */
  setWatermarkPredicate(fn: (asset: Asset) => boolean) {
    this.shouldWatermark = fn
  }

  /** Recompute instance matrices + outlines (e.g. after the terrain was sculpted). */
  refreshTransforms() {
    this.rebuildMatricesAndOutlines()
  }

  /** Structural sync: (re)build instanced meshes from the current instance set. */
  sync(instances: Instance[], assetsById: Map<string, Asset>) {
    this.instances = instances
    this.assetsById = assetsById
    this.rebuild()
  }

  /** Mark ids as newly placed so they pop in on the next frames. */
  markPopped(ids: string[]) {
    const now = performance.now()
    for (const id of ids) this.popStart.set(id, now)
  }

  setSelection(ids: Set<string>) {
    this.selected = new Set(ids)
    this.selectChangedAt = performance.now()
    this.rebuildMatricesAndOutlines()
  }

  setHover(id: string | null) {
    if (this.hovered === id) return
    this.hovered = id
    this.updateHoverOutline()
  }

  /** Live (uncommitted) transform during a drag. Pass null to clear an id. */
  setLiveTransform(id: string, t: { x: number; z: number; rotDeg: number } | null) {
    if (t) this.liveOverride.set(id, t)
    else this.liveOverride.delete(id)
    this.rebuildMatricesAndOutlines()
  }

  clearLive() {
    if (this.liveOverride.size === 0) return
    this.liveOverride.clear()
    this.rebuildMatricesAndOutlines()
  }

  /** Raycast placed meshes → planner instance id (or null). */
  pick(raycaster: THREE.Raycaster): string | null {
    const hits = raycaster.intersectObjects(this.meshes, false)
    if (!hits.length) return null
    const h = hits[0]
    const assetId = (h.object as THREE.InstancedMesh).userData.assetId as string
    const order = this.orderByAsset.get(assetId)
    if (!order || h.instanceId == null) return null
    return order[h.instanceId] ?? null
  }

  /** Bounding box of the given ids (or all placed pieces if omitted). */
  getBox(ids?: Set<string>): THREE.Box3 {
    const box = new THREE.Box3()
    for (const inst of this.instances) {
      if (ids && !ids.has(inst.id)) continue
      const asset = this.assetsById.get(inst.assetId)
      if (!asset) continue
      const t = this.liveOverride.get(inst.id)
      const x = t ? t.x : inst.position.x
      const z = t ? t.z : inst.position.z
      const a = asset.aabb ?? { x: 0.1, y: 0.1, z: 0.1 }
      const r = Math.max(a.x, a.z) / 2
      const baseY = levelToY(inst.level ?? 0) + this.heightAt(x, z)
      box.expandByPoint(new THREE.Vector3(x - r, baseY, z - r))
      box.expandByPoint(new THREE.Vector3(x + r, baseY + a.y, z + r))
    }
    return box
  }

  /** Advance pop/selection animations. Returns true while still animating. */
  update(): boolean {
    const now = performance.now()
    let animating = false

    // pop-in animation requires re-writing affected matrices
    if (this.popStart.size) {
      for (const [id, start] of this.popStart) {
        if (now - start >= POP_MS) this.popStart.delete(id)
        else animating = true
      }
      this.writeMatrices()
    }

    // selection outline entrance pulse (settles, so the scene can go idle)
    if (this.selected.size && now - this.selectChangedAt < 600) {
      const t = (now - this.selectChangedAt) / 600
      const pulse = 0.5 + 0.5 * Math.cos(t * Math.PI * 3) * (1 - t)
      for (const line of this.outlines.values()) {
        const m = line.material as THREE.LineBasicMaterial
        m.color.copy(SELECT_GLOW).multiplyScalar(0.7 + 0.6 * pulse)
      }
      animating = true
    }
    return animating
  }

  dispose() {
    this.disposeMeshes()
    this.outlines.forEach((o) => o.geometry.dispose())
    this.hoverOutline?.geometry.dispose()
    disposeWatermarkMaterials()
  }

  // ---- internals ----------------------------------------------------------

  private disposeMeshes() {
    for (const m of this.meshes) {
      this.group.remove(m)
      m.dispose()
    }
    this.meshes = []
  }

  private rebuild() {
    this.disposeMeshes()
    this.orderByAsset.clear()

    // group instances by asset
    const byAsset = new Map<string, Instance[]>()
    for (const inst of this.instances) {
      if (!byAsset.has(inst.assetId)) byAsset.set(inst.assetId, [])
      byAsset.get(inst.assetId)!.push(inst)
    }

    for (const [assetId, list] of byAsset) {
      const asset = this.assetsById.get(assetId)
      if (!asset) continue
      this.orderByAsset.set(assetId, list.map((i) => i.id))

      const template = getResolvedTemplate(asset)
      if (!template) {
        // Not loaded yet: kick off the load, re-sync when ready.
        ensureTemplate(asset).then(() => this.onNeedsTemplate())
        continue
      }
      // Unowned marketplace pieces show a visible "preview" watermark blended over
      // the model surface (the template's shared material is never mutated).
      const watermark = this.shouldWatermark(asset)
      for (const part of template.parts) {
        const material = watermark ? watermarkedMaterial(part.material) : part.material
        const im = new THREE.InstancedMesh(part.geometry, material, list.length)
        im.userData.assetId = assetId
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        im.frustumCulled = false
        this.group.add(im)
        this.meshes.push(im)
      }
    }
    this.writeMatrices()
    this.rebuildOutlines()
  }

  private composeMatrix(inst: Instance, partMatrix: THREE.Matrix4, out: THREE.Matrix4, aabb?: { x: number; y: number; z: number }) {
    const t = this.liveOverride.get(inst.id)
    const x = t ? t.x : inst.position.x
    const z = t ? t.z : inst.position.z
    const rotDeg = t ? t.rotDeg : inst.rotationDeg
    const lift = this.selected.has(inst.id) ? LIFT : 0

    let scale = 1
    const pop = this.popStart.get(inst.id)
    if (pop != null) {
      const k = Math.min(1, (performance.now() - pop) / POP_MS)
      scale = 0.6 + 0.4 * easeOutBack(k)
    }

    // yaw about Y, then tilt (pitch) about the model's local X so a piece can be
    // stood upright / laid flat. Pivot is the base-centre (base sits on the table).
    tmpQuat.setFromAxisAngle(tmpYAxis, THREE.MathUtils.degToRad(rotDeg))
    const pitchDeg = inst.pitchDeg ?? 0
    // When a piece is tilted, its base-aligned geometry (y ∈ [0, H]) rotates about
    // the base-centre and its lowest point drops below the table — re-ground it so
    // the tilted model still rests on the surface instead of sinking through the floor.
    let groundOffset = 0
    if (pitchDeg) {
      tmpQuatPitch.setFromAxisAngle(tmpXAxis, THREE.MathUtils.degToRad(pitchDeg))
      tmpQuat.multiply(tmpQuatPitch)
      if (aabb) {
        // Yaw about Y preserves world-Y, so only the pitch drives how far the box
        // dips. Lowest corner Y = min(0, H·cosθ) − (D/2)·|sinθ|; lift by its negative.
        const th = THREE.MathUtils.degToRad(pitchDeg)
        const cos = Math.cos(th)
        const sin = Math.sin(th)
        const minY = Math.min(0, aabb.y * cos) - (aabb.z / 2) * Math.abs(sin)
        groundOffset = -minY
      }
    }
    tmpPos.set(x, levelToY(inst.level ?? 0) + lift + this.heightAt(x, z) + groundOffset, z)
    tmpScale.set(scale, scale, scale)
    out.compose(tmpPos, tmpQuat, tmpScale).multiply(partMatrix)
  }

  private writeMatrices() {
    // For each asset, walk its instanced meshes (parts) and its ordered instances.
    const partCountByAsset = new Map<string, number>()
    for (const im of this.meshes) {
      const assetId = im.userData.assetId as string
      partCountByAsset.set(assetId, (partCountByAsset.get(assetId) ?? 0) + 1)
    }
    // Group meshes by asset preserving part order
    const meshesByAsset = new Map<string, THREE.InstancedMesh[]>()
    for (const im of this.meshes) {
      const assetId = im.userData.assetId as string
      if (!meshesByAsset.has(assetId)) meshesByAsset.set(assetId, [])
      meshesByAsset.get(assetId)!.push(im)
    }

    for (const [assetId, ims] of meshesByAsset) {
      const asset = this.assetsById.get(assetId)
      const template = asset ? getResolvedTemplate(asset) : null
      if (!template) continue
      const order = this.orderByAsset.get(assetId) ?? []
      const instById = new Map(this.instances.map((i) => [i.id, i]))
      ims.forEach((im, partIdx) => {
        const part = template.parts[partIdx]
        if (!part) return
        order.forEach((id, instIdx) => {
          const inst = instById.get(id)
          if (!inst) return
          this.composeMatrix(inst, part.matrix, tmpMat, template.aabb)
          im.setMatrixAt(instIdx, tmpMat)
        })
        im.instanceMatrix.needsUpdate = true
        im.computeBoundingSphere()
      })
    }
  }

  private rebuildMatricesAndOutlines() {
    this.writeMatrices()
    this.rebuildOutlines()
  }

  private rebuildOutlines() {
    // remove stale
    for (const [id, line] of this.outlines) {
      if (!this.selected.has(id)) {
        this.outlineGroup.remove(line)
        line.geometry.dispose()
        this.outlines.delete(id)
      }
    }
    const instById = new Map(this.instances.map((i) => [i.id, i]))
    for (const id of this.selected) {
      const inst = instById.get(id)
      if (!inst) continue
      let line = this.outlines.get(id)
      if (!line) {
        line = this.makeOutline(inst, SELECT_GLOW)
        this.outlines.set(id, line)
        this.outlineGroup.add(line)
      }
      this.positionOutline(line, inst, LIFT)
    }
  }

  private updateHoverOutline() {
    if (this.hoverOutline) {
      this.outlineGroup.remove(this.hoverOutline)
      this.hoverOutline.geometry.dispose()
      this.hoverOutline = null
    }
    if (!this.hovered || this.selected.has(this.hovered)) return
    const inst = this.instances.find((i) => i.id === this.hovered)
    if (!inst) return
    this.hoverOutline = this.makeOutline(inst, HOVER_GLOW)
    this.outlineGroup.add(this.hoverOutline)
    this.positionOutline(this.hoverOutline, inst, 0)
  }

  private makeOutline(inst: Instance, color: THREE.Color): THREE.LineSegments {
    const asset = this.assetsById.get(inst.assetId)
    const a = asset?.aabb ?? { x: 0.1, y: 0.1, z: 0.1 }
    const box = new THREE.BoxGeometry(a.x * 1.04, a.y * 1.04, a.z * 1.04)
    const edges = new THREE.EdgesGeometry(box)
    box.dispose()
    const mat = new THREE.LineBasicMaterial({ color: color.clone(), transparent: true, depthTest: false })
    const line = new THREE.LineSegments(edges, mat)
    line.renderOrder = 999
    return line
  }

  private positionOutline(line: THREE.LineSegments, inst: Instance, lift: number) {
    const asset = this.assetsById.get(inst.assetId)
    const a = asset?.aabb ?? { x: 0.1, y: 0.1, z: 0.1 }
    const t = this.liveOverride.get(inst.id)
    const x = t ? t.x : inst.position.x
    const z = t ? t.z : inst.position.z
    const rotDeg = t ? t.rotDeg : inst.rotationDeg
    line.position.set(x, levelToY(inst.level ?? 0) + a.y / 2 + lift + this.heightAt(x, z), z)
    line.rotation.y = THREE.MathUtils.degToRad(rotDeg)
  }
}

function easeOutBack(x: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

export type { AssetTemplate }
