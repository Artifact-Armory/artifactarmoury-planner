// src/scene/InstancedScene.ts
//
// Renders all placed pieces with InstancedMesh: N copies of one asset = one draw
// call per sub-mesh, not N. Geometry/materials are shared from the template cache,
// so a unique GLB is only uploaded to the GPU once.
//
// Also owns a selection/hover ground glow, a placement "pop" animation, and
// instance picking. Selected pieces stay exactly where they rest (no lift) with
// a soft warm-blue glow disc under them — cheap, since only a few are ever
// selected, and it never occludes or reshapes the piece itself.

import * as THREE from 'three'
import type { Asset } from '@core/assets'
import type { Instance } from '@state/store'
import { ensureTemplate, getResolvedTemplate, type AssetTemplate } from './loaders'
import { levelToY } from '@core/elevation'

const POP_MS = 180
const SELECT_GLOW = new THREE.Color(0x5b9dff) // warm-leaning blue (vs. an icy cyan)
const HOVER_GLOW = new THREE.Color(0x8aa0b8)
const SELECT_GLOW_OPACITY = 0.45
const HOVER_GLOW_OPACITY = 0.22
const GLOW_LIFT = 0.003 // metres above the resting surface, just enough to avoid z-fighting

const tmpQuat = new THREE.Quaternion()
const tmpQuatPitch = new THREE.Quaternion()
const tmpYAxis = new THREE.Vector3(0, 1, 0)
const tmpXAxis = new THREE.Vector3(1, 0, 0)
const tmpPos = new THREE.Vector3()
const tmpScale = new THREE.Vector3()
const tmpMat = new THREE.Matrix4()

// A soft radial gradient (opaque centre → transparent edge), shared by every
// glow disc in the app. Built once lazily; never disposed (one small texture
// for the process lifetime).
let sharedGlowTexture: THREE.Texture | null = null
function getGlowTexture(): THREE.Texture {
  if (sharedGlowTexture) return sharedGlowTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.55, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  sharedGlowTexture = tex
  return tex
}

// A flat unit circle, laid on the XZ plane (facing +Y), reused by every glow
// disc — only each mesh's own scale/position varies.
let sharedGlowGeometry: THREE.CircleGeometry | null = null
function getGlowGeometry(): THREE.CircleGeometry {
  if (!sharedGlowGeometry) sharedGlowGeometry = new THREE.CircleGeometry(1, 40)
  return sharedGlowGeometry
}

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

  private glowGroup = new THREE.Group()
  private selectGlows = new Map<string, THREE.Mesh>()
  private hoverGlow: THREE.Mesh | null = null
  private selectGlowMat = new THREE.MeshBasicMaterial({
    map: getGlowTexture(), color: SELECT_GLOW, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: SELECT_GLOW_OPACITY,
  })
  private hoverGlowMat = new THREE.MeshBasicMaterial({
    map: getGlowTexture(), color: HOVER_GLOW, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: HOVER_GLOW_OPACITY,
  })

  private onNeedsTemplate: () => void
  /** Terrain height (m) at a world (x,z) — set by the stage so pieces ride the surface. */
  private heightAt: (x: number, z: number) => number = () => 0
  constructor(onNeedsTemplate: () => void) {
    this.onNeedsTemplate = onNeedsTemplate
    this.group.add(this.glowGroup)
  }

  /** Provide a terrain-height sampler; call refreshTransforms() after a change. */
  setHeightSampler(fn: (x: number, z: number) => number) {
    this.heightAt = fn
  }

  /** Recompute instance matrices + glow discs (e.g. after the terrain was sculpted). */
  refreshTransforms() {
    this.rebuildMatricesAndGlows()
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
    this.rebuildMatricesAndGlows()
  }

  setHover(id: string | null) {
    if (this.hovered === id) return
    this.hovered = id
    this.updateHoverGlow()
  }

  /** Live (uncommitted) transform during a drag. Pass null to clear an id. */
  setLiveTransform(id: string, t: { x: number; z: number; rotDeg: number } | null) {
    if (t) this.liveOverride.set(id, t)
    else this.liveOverride.delete(id)
    this.rebuildMatricesAndGlows()
  }

  clearLive() {
    if (this.liveOverride.size === 0) return
    this.liveOverride.clear()
    this.rebuildMatricesAndGlows()
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

    // selection glow entrance pulse (settles to a steady soft glow, so the
    // scene can go idle instead of animating forever).
    if (this.selected.size && now - this.selectChangedAt < 600) {
      const t = (now - this.selectChangedAt) / 600
      const pulse = 0.5 + 0.5 * Math.cos(t * Math.PI * 3) * (1 - t)
      this.selectGlowMat.opacity = SELECT_GLOW_OPACITY * (0.7 + 0.6 * pulse)
      animating = true
    } else if (this.selectGlowMat.opacity !== SELECT_GLOW_OPACITY) {
      this.selectGlowMat.opacity = SELECT_GLOW_OPACITY
    }
    return animating
  }

  dispose() {
    this.disposeMeshes()
    this.selectGlowMat.dispose()
    this.hoverGlowMat.dispose()
    // The glow texture/geometry are shared app-wide singletons — not disposed here.
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
      for (const part of template.parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length)
        im.userData.assetId = assetId
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        im.frustumCulled = false
        this.group.add(im)
        this.meshes.push(im)
      }
    }
    this.writeMatrices()
    this.rebuildSelectGlows()
  }

  private composeMatrix(inst: Instance, partMatrix: THREE.Matrix4, out: THREE.Matrix4, aabb?: { x: number; y: number; z: number }) {
    const t = this.liveOverride.get(inst.id)
    const x = t ? t.x : inst.position.x
    const z = t ? t.z : inst.position.z
    const rotDeg = t ? t.rotDeg : inst.rotationDeg

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
    tmpPos.set(x, levelToY(inst.level ?? 0) + this.heightAt(x, z) + groundOffset, z)
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

  private rebuildMatricesAndGlows() {
    this.writeMatrices()
    this.rebuildSelectGlows()
  }

  private rebuildSelectGlows() {
    // remove stale
    for (const [id, mesh] of this.selectGlows) {
      if (!this.selected.has(id)) {
        this.glowGroup.remove(mesh)
        this.selectGlows.delete(id)
      }
    }
    const instById = new Map(this.instances.map((i) => [i.id, i]))
    for (const id of this.selected) {
      const inst = instById.get(id)
      if (!inst) continue
      let mesh = this.selectGlows.get(id)
      if (!mesh) {
        mesh = this.makeGlow(this.selectGlowMat)
        this.selectGlows.set(id, mesh)
        this.glowGroup.add(mesh)
      }
      this.positionGlow(mesh, inst)
    }
  }

  private updateHoverGlow() {
    if (this.hoverGlow) {
      this.glowGroup.remove(this.hoverGlow)
      this.hoverGlow = null
    }
    if (!this.hovered || this.selected.has(this.hovered)) return
    const inst = this.instances.find((i) => i.id === this.hovered)
    if (!inst) return
    this.hoverGlow = this.makeGlow(this.hoverGlowMat)
    this.glowGroup.add(this.hoverGlow)
    this.positionGlow(this.hoverGlow, inst)
  }

  /** A flat glow disc lying on the ground under a piece — no crisp box edges,
   *  no lift; it just marks the footprint the piece is actually resting on. */
  private makeGlow(material: THREE.MeshBasicMaterial): THREE.Mesh {
    const mesh = new THREE.Mesh(getGlowGeometry(), material)
    mesh.rotation.x = -Math.PI / 2
    mesh.renderOrder = 999
    return mesh
  }

  private positionGlow(mesh: THREE.Mesh, inst: Instance) {
    const asset = this.assetsById.get(inst.assetId)
    const a = asset?.aabb ?? { x: 0.1, y: 0.1, z: 0.1 }
    const t = this.liveOverride.get(inst.id)
    const x = t ? t.x : inst.position.x
    const z = t ? t.z : inst.position.z
    const radius = Math.max(a.x, a.z) / 2 * 1.2 + 0.015
    mesh.scale.setScalar(radius)
    mesh.position.set(x, levelToY(inst.level ?? 0) + GLOW_LIFT + this.heightAt(x, z), z)
  }
}

function easeOutBack(x: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

export type { AssetTemplate }
