// src/scene/InstancedScene.ts
//
// Renders all placed pieces with InstancedMesh: N copies of one asset = one draw
// call per sub-mesh, not N. Geometry/materials are shared from the template cache,
// so a unique GLB is only uploaded to the GPU once.
//
// Each sub-mesh also has one InstancedMesh per planner LOD (meshExtras.ts), and
// every frame each placed piece is drawn by the coarsest level whose geometric
// error projects to under LOD_MAX_ERROR_PX — a fraction of a pixel, so the switch
// cannot be seen. Pieces close to the camera always draw the full mesh.
//
// Also owns a selection/hover glow, a placement "pop" animation, and instance
// picking. Selected pieces stay exactly where they rest (no lift): a soft
// warm-blue glow disc pools under them, plus a thin rim of light hugging their
// actual silhouette (a scaled-up backface shell) — cheap, since only a few are
// ever selected, and neither occludes or reshapes the piece itself.

import * as THREE from 'three'
import type { Asset } from '@core/assets'
import type { Instance } from '@state/store'
import { ensureTemplate, getResolvedTemplate, subscribeMeshExtras, type AssetPart, type AssetTemplate } from './loaders'
import { LOD_MAX_ERROR_PX } from './meshExtras'
import { levelToY } from '@core/elevation'

const POP_MS = 180
const SELECT_GLOW = new THREE.Color(0x5b9dff) // warm-leaning blue (vs. an icy cyan)
const HOVER_GLOW = new THREE.Color(0x8aa0b8)
// Ground disc + rim shell together read stronger than either alone, so each is
// tuned down a little from what it'd use solo.
const SELECT_GLOW_OPACITY = 0.35
const HOVER_GLOW_OPACITY = 0.22
const GLOW_LIFT = 0.003 // metres above the resting surface, just enough to avoid z-fighting
const RIM_GLOW_OPACITY = 0.6
const RIM_GLOW_SCALE = 1.05 // how far the rim shell puffs out past the piece's own surface

const tmpQuat = new THREE.Quaternion()
const tmpQuatPitch = new THREE.Quaternion()
const tmpYAxis = new THREE.Vector3(0, 1, 0)
const tmpXAxis = new THREE.Vector3(1, 0, 0)
const tmpPos = new THREE.Vector3()
const tmpScale = new THREE.Vector3()
const tmpMat = new THREE.Matrix4()
const tmpInv = new THREE.Matrix4()
const tmpRay = new THREE.Ray()
const tmpSphere = new THREE.Sphere()
const tmpHit = new THREE.Vector3()
const tmpCentre = new THREE.Vector3()

/** Moving to a COARSER level needs this much margin under the limit, so a piece
 *  sitting right at a threshold doesn't flip levels on every frame. */
const LOD_HYSTERESIS = 0.8

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
  /** assetId → [part][level] instanced meshes; level 0 is the full mesh. Each mesh
   *  draws only the pieces currently at its level (`count`), listed in
   *  `userData.slots` (slot → planner instance id). */
  private meshesByAsset = new Map<string, THREE.InstancedMesh[][]>()
  /** assetId → ordered planner instance ids. */
  private orderByAsset = new Map<string, string[]>()
  /** instance id → LOD level per part, as last drawn (the hysteresis needs it). */
  private levelById = new Map<string, number[]>()
  /** Camera + drawing-buffer height the LOD choice is made for. */
  private view: { camera: THREE.PerspectiveCamera; heightPx: number } | null = null
  private unsubscribeExtras: () => void
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
  // Rim shells: one mesh per template part per selected instance, reusing that
  // part's real geometry (so the halo follows the piece's actual silhouette,
  // not a generic box) scaled up slightly and drawn back-face-only.
  private rimGlows = new Map<string, THREE.Mesh[]>()
  private rimMat = new THREE.MeshBasicMaterial({
    color: SELECT_GLOW, transparent: true, opacity: RIM_GLOW_OPACITY,
    blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
  })

  private onNeedsTemplate: () => void
  /** Terrain height (m) at a world (x,z) — set by the stage so pieces ride the surface. */
  private heightAt: (x: number, z: number) => number = () => 0
  constructor(onNeedsTemplate: () => void) {
    this.onNeedsTemplate = onNeedsTemplate
    this.group.add(this.glowGroup)
    // LODs arrive after their template; rebuilding adds the per-level meshes. The
    // callback is already coalesced to one rebuild per frame by the stage.
    this.unsubscribeExtras = subscribeMeshExtras(() => this.onNeedsTemplate())
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

  /**
   * Raycast placed meshes → planner instance id (or null).
   *
   * Parts with a BVH (meshExtras.ts) are tested through it, one instance at a
   * time after a bounding-sphere reject; parts still waiting for theirs fall back
   * to three's brute-force InstancedMesh raycast. The nearest hit of either wins.
   */
  pick(raycaster: THREE.Raycaster): string | null {
    let best: string | null = null
    let bestDist = Infinity
    const instById = new Map(this.instances.map((i) => [i.id, i]))
    const bruteForce: THREE.InstancedMesh[] = []

    for (const [assetId, perPart] of this.meshesByAsset) {
      const asset = this.assetsById.get(assetId)
      const template = asset ? getResolvedTemplate(asset) : null
      if (!template) continue
      const order = this.orderByAsset.get(assetId) ?? []
      perPart.forEach((levels, partIdx) => {
        const part = template.parts[partIdx]
        if (!part) return
        if (!part.pick) {
          for (const im of levels) if (im.count > 0) bruteForce.push(im)
          return
        }
        if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere()
        for (const id of order) {
          const inst = instById.get(id)
          if (!inst) continue
          this.composeMatrix(inst, part.matrix, tmpMat, template.aabb)
          tmpSphere.copy(part.geometry.boundingSphere!).applyMatrix4(tmpMat)
          if (!raycaster.ray.intersectsSphere(tmpSphere)) continue
          tmpRay.copy(raycaster.ray).applyMatrix4(tmpInv.copy(tmpMat).invert())
          const hit = part.pick.bvh.raycastFirst(tmpRay, THREE.DoubleSide)
          if (!hit) continue
          const dist = tmpHit.copy(hit.point).applyMatrix4(tmpMat).distanceTo(raycaster.ray.origin)
          if (dist < raycaster.near || dist > raycaster.far) continue
          if (dist < bestDist) {
            bestDist = dist
            best = id
          }
        }
      })
    }

    if (bruteForce.length) {
      const h = raycaster.intersectObjects(bruteForce, false)[0]
      if (h && h.distance < bestDist && h.instanceId != null) {
        best = ((h.object as THREE.InstancedMesh).userData.slots as string[])[h.instanceId] ?? best
      }
    }
    return best
  }

  /**
   * Re-choose each piece's LOD level for this view. Cheap (a distance per piece
   * per part); only rewrites instance matrices when some level actually changed.
   * `heightPx` is the drawing buffer's height at FULL resolution — not the reduced
   * one used while the camera moves, or pieces would switch level mid-orbit.
   */
  updateLod(camera: THREE.PerspectiveCamera, heightPx: number): void {
    this.view = { camera, heightPx }
    let changed = false
    const instById = new Map(this.instances.map((i) => [i.id, i]))
    for (const [assetId, perPart] of this.meshesByAsset) {
      const asset = this.assetsById.get(assetId)
      const template = asset ? getResolvedTemplate(asset) : null
      if (!template) continue
      for (const id of this.orderByAsset.get(assetId) ?? []) {
        const inst = instById.get(id)
        if (!inst) continue
        const prev = this.levelById.get(id)
        perPart.forEach((levels, partIdx) => {
          const part = template.parts[partIdx]
          if (!part || changed) return
          const level = Math.min(this.chooseLevel(inst, part, prev?.[partIdx] ?? 0, template.aabb), levels.length - 1)
          if (level !== (prev?.[partIdx] ?? 0)) changed = true
        })
        if (changed) break
      }
      if (changed) break
    }
    if (changed) this.writeMatrices()
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
    this.unsubscribeExtras()
    this.disposeMeshes()
    this.selectGlowMat.dispose()
    this.hoverGlowMat.dispose()
    this.rimMat.dispose()
    // The glow texture/geometry, and every part geometry a rim shell reuses,
    // are owned elsewhere (shared singletons / the template cache) — not
    // disposed here.
  }

  // ---- internals ----------------------------------------------------------

  private disposeMeshes() {
    for (const m of this.meshes) {
      this.group.remove(m)
      m.dispose()
    }
    this.meshes = []
    this.meshesByAsset.clear()
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
      // One InstancedMesh per (part, level), each sized for every copy: any piece
      // can sit at any level. They share the part's vertex buffer, so the extra
      // levels cost index buffers and instance matrices, not geometry uploads.
      this.meshesByAsset.set(assetId, template.parts.map((part, partIdx) =>
        [part.geometry, ...part.lods.map((l) => l.geometry)].map((geometry, level) => {
          const im = new THREE.InstancedMesh(geometry, part.material, list.length)
          im.userData = { assetId, partIdx, level, slots: [] as string[] }
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
          im.frustumCulled = false
          im.count = 0
          this.group.add(im)
          this.meshes.push(im)
          return im
        }),
      ))
    }
    // Forget levels for pieces that no longer exist.
    const live = new Set(this.instances.map((i) => i.id))
    for (const id of this.levelById.keys()) if (!live.has(id)) this.levelById.delete(id)
    this.writeMatrices()
    this.rebuildSelectGlows()
  }

  private composeMatrix(inst: Instance, partMatrix: THREE.Matrix4, out: THREE.Matrix4, aabb?: { x: number; y: number; z: number }, extraScale = 1) {
    const t = this.liveOverride.get(inst.id)
    const x = t ? t.x : inst.position.x
    const z = t ? t.z : inst.position.z
    const rotDeg = t ? t.rotDeg : inst.rotationDeg

    let scale = extraScale
    const pop = this.popStart.get(inst.id)
    if (pop != null) {
      const k = Math.min(1, (performance.now() - pop) / POP_MS)
      scale *= 0.6 + 0.4 * easeOutBack(k)
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

  /**
   * The coarsest LOD level of `part` whose error projects to under the pixel
   * limit for this piece, given the level it was drawn at last time. Level 0 (the
   * full mesh) whenever there's no view yet or the part has no LODs.
   */
  private chooseLevel(inst: Instance, part: AssetPart, prev: number, aabb: { x: number; y: number; z: number }): number {
    if (!this.view || part.lods.length === 0) return 0
    const { camera, heightPx } = this.view
    // Distance to the nearest point of the piece's bounding sphere: conservative,
    // so the near side of a large piece is never under-detailed.
    const t = this.liveOverride.get(inst.id)
    const x = t ? t.x : inst.position.x
    const z = t ? t.z : inst.position.z
    const baseY = levelToY(inst.level ?? 0) + this.heightAt(x, z)
    tmpCentre.set(x, baseY + aabb.y / 2, z)
    const radius = 0.5 * Math.hypot(aabb.x, aabb.y, aabb.z)
    const d = Math.max(camera.near, camera.position.distanceTo(tmpCentre) - radius)
    const pxPerMetre = heightPx / (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    for (let level = part.lods.length; level >= 1; level--) {
      const limit = level > prev ? LOD_MAX_ERROR_PX * LOD_HYSTERESIS : LOD_MAX_ERROR_PX
      if (part.lods[level - 1].error * pxPerMetre <= limit) return level
    }
    return 0
  }

  private writeMatrices() {
    // For each asset and part, bucket its pieces by LOD level and pack each
    // level's InstancedMesh with just the pieces it draws.
    const instById = new Map(this.instances.map((i) => [i.id, i]))
    for (const [assetId, perPart] of this.meshesByAsset) {
      const asset = this.assetsById.get(assetId)
      const template = asset ? getResolvedTemplate(asset) : null
      if (!template) continue
      const order = this.orderByAsset.get(assetId) ?? []
      perPart.forEach((levels, partIdx) => {
        const part = template.parts[partIdx]
        if (!part) return
        for (const im of levels) {
          im.count = 0
          ;(im.userData.slots as string[]).length = 0
        }
        for (const id of order) {
          const inst = instById.get(id)
          if (!inst) continue
          const chosen = this.levelById.get(id) ?? []
          const level = Math.min(this.chooseLevel(inst, part, chosen[partIdx] ?? 0, template.aabb), levels.length - 1)
          chosen[partIdx] = level
          this.levelById.set(id, chosen)
          const im = levels[level]
          this.composeMatrix(inst, part.matrix, tmpMat, template.aabb)
          im.setMatrixAt(im.count, tmpMat)
          ;(im.userData.slots as string[]).push(id)
          im.count++
        }
        for (const im of levels) {
          im.visible = im.count > 0
          im.instanceMatrix.needsUpdate = true
          im.computeBoundingSphere()
        }
      })
    }
  }

  private rebuildMatricesAndGlows() {
    this.writeMatrices()
    this.rebuildSelectGlows()
  }

  private rebuildSelectGlows() {
    // remove stale ground discs
    for (const [id, mesh] of this.selectGlows) {
      if (!this.selected.has(id)) {
        this.glowGroup.remove(mesh)
        this.selectGlows.delete(id)
      }
    }
    // remove stale rim shells
    for (const [id, meshes] of this.rimGlows) {
      if (!this.selected.has(id)) {
        for (const m of meshes) this.glowGroup.remove(m)
        this.rimGlows.delete(id)
      }
    }
    const instById = new Map(this.instances.map((i) => [i.id, i]))
    for (const id of this.selected) {
      const inst = instById.get(id)
      if (!inst) continue

      let disc = this.selectGlows.get(id)
      if (!disc) {
        disc = this.makeGlow(this.selectGlowMat)
        this.selectGlows.set(id, disc)
        this.glowGroup.add(disc)
      }
      this.positionGlow(disc, inst)

      this.updateRimShell(id, inst)
    }
  }

  /** Build/update the rim shell for one selected instance: one backface-only
   *  mesh per template part, reusing that part's real geometry so the halo
   *  traces the piece's actual silhouette instead of a generic box. */
  private updateRimShell(id: string, inst: Instance) {
    const asset = this.assetsById.get(inst.assetId)
    const template = asset ? getResolvedTemplate(asset) : null
    if (!template) return // not loaded yet — the piece itself isn't visible either

    let shells = this.rimGlows.get(id)
    if (!shells || shells.length !== template.parts.length) {
      if (shells) for (const m of shells) this.glowGroup.remove(m)
      shells = template.parts.map((part) => {
        const m = new THREE.Mesh(part.geometry, this.rimMat)
        m.matrixAutoUpdate = false
        m.renderOrder = 998
        this.glowGroup.add(m)
        return m
      })
      this.rimGlows.set(id, shells)
    }
    template.parts.forEach((part, i) => {
      this.composeMatrix(inst, part.matrix, tmpMat, template.aabb, RIM_GLOW_SCALE)
      shells![i].matrix.copy(tmpMat)
    })
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
