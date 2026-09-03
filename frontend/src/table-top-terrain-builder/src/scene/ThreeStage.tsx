import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useAppStore, groupMembersOf } from '@state/store'
import { GridHelper } from './helpers'
import { getAssetById, type Asset } from '@core/assets'
import { BuilderCamera } from './BuilderCamera'
import { InstancedScene } from './InstancedScene'
import { Ghost } from './ghost'
import { RotateHandle } from './rotateHandle'
import { ensureTemplate } from './loaders'
import { subscribeLoading } from './loadManager'
import {
  worldToCell, aabbFootprint,
  inBounds, snapRotationForFootprint,
} from '@core/occupancy'
import { footprintCellsFor } from '@core/footprintMask'
import {
  surfaceTop, buildOccupied3D, collides3D, occupyUnitsAt, levelToY,
} from '@core/elevation'
import { buildTableMaterial, bakePaintOverlayCanvas, makePaintOverlayTexture } from '@core/tableMaterials'
import { buildTerrainGeometry, updateTerrainGeometry, heightmapFitsTable, sampleHeight, createHeightmap } from '@core/heightmap'
import { paintFitsTable, isBlank as paintIsBlank } from '@core/paintmap'

const DRAG_THRESHOLD = 4 // px before a press becomes a drag

// Alt+Arrow fine-nudge directions, in table world axes (X = width, Z = depth).
const ARROW_NUDGE: Record<string, { dx: number; dz: number }> = {
  ArrowUp: { dx: 0, dz: -1 },
  ArrowDown: { dx: 0, dz: 1 },
  ArrowLeft: { dx: -1, dz: 0 },
  ArrowRight: { dx: 1, dz: 0 },
}

// `touch` marks a press made with a finger. A finger has no second button and no
// wheel, so on touch a drag that would box-select on desktop pans the camera
// instead — tap still places/selects, via the same movement threshold.
type LeftDrag =
  | { kind: 'none' }
  | { kind: 'maybePlace'; x: number; y: number; touch: boolean }
  | { kind: 'maybe'; mode: 'piece' | 'box'; x: number; y: number; pieceId?: string; ground: THREE.Vector3 | null; additive: boolean; touch: boolean }
  | { kind: 'move'; startGround: THREE.Vector3; ids: string[]; orig: Map<string, { x: number; z: number }> }
  | { kind: 'box'; x: number; y: number; base: Set<string> }
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'rotate'; ids: string[]; center: { x: number; z: number }; initialAngleDeg: number; orig: Map<string, number> }

export function ThreeStage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [boxRect, setBoxRect] = useState<{ l: number; t: number; w: number; h: number } | null>(null)

  // Engine refs (live outside React's render cycle).
  const engine = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    cam: BuilderCamera
    inst: InstancedScene
    ghost: Ghost
    tableGroup: THREE.Group
    gridGroup: THREE.Group
    cellHi: THREE.Mesh
    raycaster: THREE.Raycaster
    ground: THREE.Plane
    requestRender: () => void
    ghostRot: number
    drag: LeftDrag
    hovered: string | null
    levelOverride: number | null   // manual placement level (PageUp/Down), null = auto-surface
    lastAutoLevel: number          // surface level under the cursor last frame
    lastPointer: { clientX: number; clientY: number } | null
    sculpting: boolean             // true while dragging a terrain brush
    strokeChanged: boolean         // any change during the current sculpt/paint stroke
    touchIds: Set<number>          // fingers currently down (2+ = camera gesture)
    gestureLatch: boolean          // a 2-finger gesture happened; ignore the trailing tap
  } | null>(null)

  useEffect(() => {
    const mount = mountRef.current!
    const store = useAppStore.getState

    // ---- renderer / scene / camera ----
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    // Adaptive resolution: full-res when settled, lower while the camera moves so a
    // heavy (print-resolution) mesh close to the camera doesn't tank the framerate.
    const FULL_DPR = Math.min(devicePixelRatio, 2)
    const LOW_DPR = Math.max(0.75, FULL_DPR * 0.55)
    renderer.setPixelRatio(FULL_DPR)
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setClearColor(0x0b0f14)
    mount.appendChild(renderer.domElement)
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.05, 500)

    // Ambient-ish base so no face goes fully black. Lift the ground colour a bit
    // (was near-black 0x202830) so undersides / shadowed faces keep some detail.
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x4a5260, 1.0))
    // Key light (main, one corner) …
    const dir = new THREE.DirectionalLight(0xffffff, 0.65)
    dir.position.set(3, 6, 2)
    scene.add(dir)
    // … plus a dimmer fill from the opposite side so the far side of models isn't
    // left in the dark. Roughly half the key's intensity keeps the key readable.
    const fill = new THREE.DirectionalLight(0xffffff, 0.3)
    fill.position.set(-4, 4, -3)
    scene.add(fill)
    // Gentle top-down bounce so flat tops read evenly regardless of camera angle.
    const top = new THREE.DirectionalLight(0xffffff, 0.2)
    top.position.set(0, 8, 0)
    scene.add(top)

    // ---- on-demand rendering ----
    let renderRequested = false
    let lowRes = false
    const requestRender = () => {
      if (renderRequested) return
      renderRequested = true
      requestAnimationFrame(renderLoop)
    }
    const renderLoop = () => {
      renderRequested = false
      const camMoving = cam.update()
      const sceneAnimating = inst.update()
      // Render at reduced resolution while the camera is in motion, then snap back
      // to full resolution for the settled frame (keeps interaction smooth without
      // any lasting quality loss).
      if (camMoving !== lowRes) {
        lowRes = camMoving
        renderer.setPixelRatio(camMoving ? LOW_DPR : FULL_DPR)
        renderer.setSize(mount.clientWidth, mount.clientHeight, false)
      }
      renderer.render(scene, camera)
      if (camMoving || sceneAnimating) requestRender()
    }

    // ---- camera ----
    const cam = new BuilderCamera(camera, renderer.domElement, requestRender, {
      minDistance: 0.3,
      maxDistance: 20,
    })

    // Terrain height (m) at a world (x,z) so placed pieces / the ghost ride the surface.
    const terrainHeightAt = (x: number, z: number) => {
      const s = store()
      return sampleHeight(s.heightmap, s.table, x, z)
    }

    // ---- instanced placed pieces ----
    const inst = new InstancedScene(() => {
      // a template finished loading — re-sync from current store
      const s = store()
      inst.sync(s.instances, new Map([...s.assets, ...s.setPartAssets].map(a => [a.id, a])))
      inst.setSelection(new Set(s.selectedInstanceIds))
      requestRender()
    })
    inst.setHeightSampler(terrainHeightAt)
    // NB: placed pieces render un-marked. The on-screen "PREVIEW" watermark that used
    // to be blended over unowned models was removed (2026-08-30) — the protection it
    // duplicated lives in the mesh itself: the bake emboss, the decimation, and the
    // stripped interior/underside faces that make a ripped proxy unprintable, plus the
    // per-buyer watermark in the STL header. A legible overlay on every unowned piece
    // made the planner look worse than the product it is selling, for no protection
    // the geometry wasn't already providing.
    scene.add(inst.group)

    // ---- ghost ----
    const ghost = new Ghost(requestRender)
    scene.add(ghost.group)

    // ---- free-rotate gizmo (two draggable arrows at the base of a single
    // selected piece) — hidden until syncRotateHandle() below shows it. ----
    const rotateHandle = new RotateHandle()
    scene.add(rotateHandle.group)

    // ---- table + grid + cell highlight ----
    const tableGroup = new THREE.Group()
    scene.add(tableGroup)
    const gridGroup = new THREE.Group()
    scene.add(gridGroup)

    const cellHi = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x44d07a, transparent: true, opacity: 0.18, depthWrite: false }),
    )
    cellHi.rotation.x = -Math.PI / 2
    cellHi.position.y = 0.002
    cellHi.visible = false
    scene.add(cellHi)

    // Terrain brush cursor ring (shown only in sculpt mode).
    const brushRing = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.0, 48),
      new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }),
    )
    brushRing.rotation.x = -Math.PI / 2
    brushRing.visible = false
    brushRing.renderOrder = 10
    scene.add(brushRing)

    // Deformable surface: the flat plane is swapped for a heightmap mesh once the
    // user starts sculpting (see buildTable / syncTerrain). A grid mesh is also used
    // (flat) when the surface is painted, so the overlay has known UVs.
    let terrainMesh: THREE.Mesh | null = null
    let terrainGeo: THREE.BufferGeometry | null = null
    // Painted-texture overlay: a transparent mesh sharing the surface geometry,
    // sitting a hair above it so the base material shows through unpainted areas.
    let paintMesh: THREE.Mesh | null = null
    let paintTex: THREE.CanvasTexture | null = null
    let paintCanvas: HTMLCanvasElement | null = null

    const raycaster = new THREE.Raycaster()
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

    engine.current = {
      renderer, scene, camera, cam, inst, ghost, tableGroup, gridGroup, cellHi,
      raycaster, ground, requestRender, ghostRot: 0, drag: { kind: 'none' }, hovered: null,
      levelOverride: null, lastAutoLevel: 0, lastPointer: null, sculpting: false, strokeChanged: false,
      touchIds: new Set(), gestureLatch: false,
    }

    // expose camera controls to the store (UI buttons / fitView)
    const tableBox = () => {
      const t = store().table
      return new THREE.Box3(
        new THREE.Vector3(-t.width / 2, 0, -t.height / 2),
        new THREE.Vector3(t.width / 2, 0.3, t.height / 2),
      )
    }
    useAppStore.getState().setCameraApi({
      frameTable: () => cam.frameBox(tableBox()),
      frameSelection: () => {
        const ids = new Set(store().selectedInstanceIds)
        const box = ids.size ? inst.getBox(ids) : tableBox()
        cam.frameBox(box.isEmpty() ? tableBox() : box)
      },
      home: () => cam.home(tableBox()),
    })
    // Engine actions the on-screen touch controls need (no keyboard on a tablet).
    useAppStore.getState().setStageApi({
      rotate: (dir) => rotateActive(dir),
      nudgeLevel: (delta) => nudgeLevel(delta),
    })

    buildTable()
    applySnapVisual()
    cam.home(tableBox())
    // Seed a baseline undo snapshot so the first placement/sculpt/paint is undoable.
    store().actions.ensureInitialHistory()
    requestRender()

    // ---- resize ----
    const onResize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      requestRender()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mount)

    // ---- helpers ----
    // Is the surface painted? (a fitting, non-blank paint map)
    function hasPaint(): boolean {
      const s = store()
      return paintFitsTable(s.paint, s.table) && !paintIsBlank(s.paint)
    }

    function buildTable() {
      const t = store().table
      const hm = store().heightmap
      const sculpted = !!(hm && heightmapFitsTable(hm, t))
      const painted = hasPaint()
      tableGroup.clear()
      terrainMesh = null
      terrainGeo = null
      paintMesh = null
      paintTex = null
      paintCanvas = null
      const mat = buildTableMaterial(store().tableMaterial, t)

      if (sculpted || painted) {
        // World-space grid mesh (Y up), known UVs 0..1 for the paint overlay. Uses
        // the height field when sculpted, otherwise a flat field.
        const field = sculpted ? hm! : createHeightmap(t)
        const geo = buildTerrainGeometry(field, t)
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.y = -0.004
        mesh.receiveShadow = true
        tableGroup.add(mesh)
        terrainMesh = mesh
        terrainGeo = geo

        if (painted) buildPaintOverlay(geo, mesh.position.y)
      } else {
        // Flat table.
        const geo = new THREE.PlaneGeometry(t.width, t.height)
        // AO map needs a 2nd UV set; PlaneGeometry only ships uv, so mirror it.
        geo.setAttribute('uv2', new THREE.BufferAttribute((geo.attributes.uv as THREE.BufferAttribute).array, 2))
        const plane = new THREE.Mesh(geo, mat)
        plane.rotation.x = -Math.PI / 2
        plane.position.y = -0.006
        plane.receiveShadow = true
        tableGroup.add(plane)
      }

      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(t.width, 0.02, t.height)),
        new THREE.LineBasicMaterial({ color: 0x35506e }),
      )
      tableGroup.add(border)

      gridGroup.clear()
      const grid = GridHelper(t.width, t.height, t.gridSize)
      gridGroup.add(grid)
      applySnapVisual()
    }

    // Build the transparent painted-texture overlay sharing the surface geometry.
    function buildPaintOverlay(geo: THREE.BufferGeometry, baseY: number) {
      const s = store()
      if (!paintFitsTable(s.paint, s.table)) return
      paintCanvas = bakePaintOverlayCanvas(s.paint, s.table)
      paintTex = makePaintOverlayTexture(paintCanvas)
      const mat = new THREE.MeshStandardMaterial({
        map: paintTex,
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
      const mesh = new THREE.Mesh(geo, mat) // shares geo → follows sculpt updates
      mesh.position.y = baseY + 0.0015
      mesh.renderOrder = 2
      mesh.receiveShadow = true
      tableGroup.add(mesh)
      paintMesh = mesh
    }

    // Re-sync the surface mesh after a sculpt (or when the heightmap appears/clears).
    function syncTerrain() {
      const s = store()
      const sculpted = !!(s.heightmap && heightmapFitsTable(s.heightmap, s.table))
      const painted = hasPaint()
      const needsGrid = sculpted || painted
      if (needsGrid !== !!terrainMesh) {
        buildTable() // switch between flat plane and grid mesh
      } else if (sculpted && terrainGeo && s.heightmap) {
        updateTerrainGeometry(terrainGeo, s.heightmap) // shared geo → overlay follows
      }
      requestRender()
    }

    // Re-bake the painted overlay after a paint stroke (or when it appears/clears).
    function syncPaint() {
      const painted = hasPaint()
      if (painted !== !!paintMesh) {
        buildTable() // add/remove the overlay (and switch flat plane ↔ grid mesh)
      } else if (painted && paintCanvas && paintTex) {
        bakePaintOverlayCanvas(store().paint!, store().table, paintCanvas)
        paintTex.needsUpdate = true
      }
      requestRender()
    }

    // Apply the active brush at the ground point under the cursor. Height tools
    // sculpt the field; paint/erase tools stamp the texture overlay. A changed dab
    // flags the stroke so pointer-up records one undo step.
    function sculptAt(e: { clientX: number; clientY: number }) {
      const gp = groundPoint(e)
      if (!gp) return
      const tool = store().terrainTool
      // Geometry/overlay updates via the terrainRev/paintRev store subscriptions.
      const changed = (tool === 'paint' || tool === 'erase')
        ? store().actions.paintTerrain(gp.x, gp.z)
        : store().actions.sculptTerrain(gp.x, gp.z)
      if (changed) engine.current!.strokeChanged = true
    }

    function updateBrushRing(e: { clientX: number; clientY: number }) {
      const s = store()
      const gp = s.terrainTool !== 'none' ? groundPoint(e) : null
      if (!gp) { if (brushRing.visible) { brushRing.visible = false; requestRender() } return }
      brushRing.position.set(gp.x, 0.03, gp.z)
      brushRing.scale.set(s.brushRadius, s.brushRadius, s.brushRadius)
      brushRing.visible = true
      requestRender()
    }

    function effSnap(): boolean {
      const s = store()
      return s.snapBaseline === 'snap' ? !s.altMomentary : s.altMomentary
    }

    function applySnapVisual() {
      const snap = effSnap()
      gridGroup.traverse((o) => {
        const m = (o as THREE.LineSegments).material as THREE.LineBasicMaterial | undefined
        if (m && 'opacity' in m) {
          m.transparent = true
          m.opacity = snap ? 1 : 0.18
        }
      })
      requestRender()
    }

    function ndc(e: { clientX: number; clientY: number }, out: THREE.Vector2) {
      const r = renderer.domElement.getBoundingClientRect()
      out.x = ((e.clientX - r.left) / r.width) * 2 - 1
      out.y = -((e.clientY - r.top) / r.height) * 2 + 1
      return out
    }
    const ndcTmp = new THREE.Vector2()
    function groundPoint(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
      raycaster.setFromCamera(ndc(e, ndcTmp), camera)
      const hit = new THREE.Vector3()
      return raycaster.ray.intersectPlane(ground, hit) ? hit : null
    }
    function pickPiece(e: { clientX: number; clientY: number }): string | null {
      raycaster.setFromCamera(ndc(e, ndcTmp), camera)
      return inst.pick(raycaster)
    }

    function snapWorld(x: number, z: number): { x: number; z: number } {
      const t = store().table
      const snap = effSnap()
      let nx = snap ? Math.round(x / t.gridSize) * t.gridSize : x
      let nz = snap ? Math.round(z / t.gridSize) * t.gridSize : z
      const hw = t.width / 2, hh = t.height / 2
      nx = THREE.MathUtils.clamp(nx, -hw, hw)
      nz = THREE.MathUtils.clamp(nz, -hh, hh)
      return { x: nx, z: nz }
    }

    function assetMap() {
      const s = store()
      // Include set-part assets — they're kept off the flat catalogue (s.assets) but
      // are placeable, so collision/stacking/rendering must resolve them too.
      return new Map([...s.assets, ...s.setPartAssets].map(a => [a.id, a]))
    }

    // Grid cells a footprint covers at the cursor.
    function ghostCells(asset: Asset, x: number, z: number, rotDeg: number) {
      const t = store().table
      const anchor = worldToCell(x, z, t)
      return footprintCellsFor(asset, anchor, snapRotationForFootprint(rotDeg), t.gridSize)
    }

    // Validity at a specific elevation level (3D occupancy: cell × level slab).
    function validAtLevel(asset: Asset, x: number, z: number, rotDeg: number, base: number, exclude: Set<string>): boolean {
      const t = store().table
      const cells = ghostCells(asset, x, z, rotDeg)
      if (!inBounds(cells, t)) return false
      if (!effSnap()) return true // free placement permits overlap
      const occ = buildOccupied3D(store().instances, assetMap(), t, exclude)
      return !collides3D(cells, base, occupyUnitsAt(asset, base), occ)
    }

    function setCursor(c: string) {
      renderer.domElement.style.cursor = c
    }

    function rotationStep(): number {
      return effSnap() ? 90 : 15
    }

    function updateGhost(e: { clientX: number; clientY: number }) {
      const eng = engine.current!
      eng.lastPointer = { clientX: e.clientX, clientY: e.clientY }
      const assetId = store().selectedAssetId
      if (!assetId) {
        cellHi.visible = false
        return
      }
      const asset = getAssetById(assetId)
      if (!asset) return
      const gp = groundPoint(e)
      if (!gp) return
      const { x, z } = snapWorld(gp.x, gp.z)

      // Sit on top of whatever occupies the target cell(s): the table (level 0) or
      // the top of any height tiles already there — unless the user pinned a level.
      const t = store().table
      const cells = ghostCells(asset, x, z, eng.ghostRot)
      const auto = surfaceTop(store().instances, assetMap(), t, cells)
      eng.lastAutoLevel = auto
      const base = eng.levelOverride != null ? eng.levelOverride : auto
      const y = levelToY(base) + terrainHeightAt(x, z)

      ghost.setTransform(x, z, eng.ghostRot, y)
      const valid = validAtLevel(asset, x, z, eng.ghostRot, base, new Set())
      ghost.setValid(valid)
      useAppStore.getState().setPlacement(base, eng.levelOverride != null)

      // occupied-cell highlight at the placement surface (snap mode only)
      if (effSnap()) {
        const fp = aabbFootprint(asset, snapRotationForFootprint(eng.ghostRot), t.gridSize)
        cellHi.scale.set(fp.cols * t.gridSize, fp.rows * t.gridSize, 1)
        cellHi.position.set(x, y + 0.002, z)
        ;(cellHi.material as THREE.MeshBasicMaterial).color.setHex(valid ? 0x44d07a : 0xe05757)
        cellHi.visible = true
      } else {
        cellHi.visible = false
      }
      requestRender()
    }

    // ---- left-button pointer state machine ----
    let lastGround: THREE.Vector3 | null = null
    function trackGround(e: PointerEvent) {
      lastGround = groundPoint(e)
    }

    // Abandon whatever left-button/finger drag is in flight (a second finger just
    // landed, so the camera owns the gesture now).
    function cancelDrag() {
      const eng = engine.current!
      if (eng.drag.kind === 'move') inst.clearLive()
      if (eng.drag.kind === 'rotate') { inst.clearLive(); rotateHandle.setActive(false) }
      if (eng.drag.kind === 'box') setBoxRect(null)
      eng.drag = { kind: 'none' }
      // A second finger also ends a terrain stroke — pointerup is swallowed while
      // the gesture latch is set, so close the undo step here or the brush would
      // stay "down" and keep sculpting after the pinch.
      if (eng.sculpting) {
        eng.sculpting = false
        if (eng.strokeChanged) { store().actions.commitHistory(); eng.strokeChanged = false }
      }
      requestRender()
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return // right/middle handled by BuilderCamera
      const eng = engine.current!
      const touch = e.pointerType === 'touch'
      if (touch) {
        eng.touchIds.add(e.pointerId)
        // Two fingers = camera gesture (pinch/twist/pitch). Drop any drag the first
        // finger started and let BuilderCamera have it.
        if (eng.touchIds.size >= 2) {
          eng.gestureLatch = true
          cancelDrag()
          return
        }
      }
      // View-only (a shopper inspecting an artist's table): tapping a placed model
      // selects it so its info + buy tile can show, but never moves/places it.
      // The camera still orbits on the right/middle mouse buttons.
      if (store().readOnly) {
        const pieceId = pickPiece(e)
        useAppStore.getState().setSelectedInstances(pieceId ? [pieceId] : [])
        inst.setSelection(new Set(useAppStore.getState().selectedInstanceIds))
        eng.drag = { kind: 'none' }
        requestRender()
        return
      }
      const s = store()

      // Terrain sculpt mode owns the left button: drag to sculpt, ignore placement.
      if (s.terrainTool !== 'none') {
        eng.sculpting = true
        eng.strokeChanged = false
        sculptAt(e)
        return
      }

      // Grabbing a free-rotate arrow takes priority over selecting/moving a piece.
      // The angle from the pivot to wherever was actually grabbed is the reference
      // the whole drag tracks — no need for the click to land exactly on the handle.
      if (rotateHandle.visible) {
        raycaster.setFromCamera(ndc(e, ndcTmp), camera)
        if (raycaster.intersectObjects(rotateHandle.pickables, false).length) {
          const ids = [...s.selectedInstanceIds]
          const gp = groundPoint(e)
          if (ids.length && gp) {
            const center = rotateHandle.center
            const initialAngleDeg = THREE.MathUtils.radToDeg(Math.atan2(gp.z - center.z, gp.x - center.x))
            const orig = new Map(ids.map((id) => [id, store().instances.find((i) => i.id === id)?.rotationDeg ?? 0]))
            eng.drag = { kind: 'rotate', ids, center, initialAngleDeg, orig }
            rotateHandle.setActive(true)
            setCursor('grabbing')
            requestRender()
            return
          }
        }
      }

      if (s.selectedAssetId) {
        eng.drag = { kind: 'maybePlace', x: e.clientX, y: e.clientY, touch }
        return
      }
      const pieceId = pickPiece(e)
      const gp = groundPoint(e)
      if (pieceId) {
        const additive = e.shiftKey
        const sel = new Set(s.selectedInstanceIds)
        // A fused piece always selects/toggles as its whole group, not just the
        // one clicked — that's what makes a stack move as one unit.
        const groupIds = groupMembersOf(s.instances, pieceId)
        if (additive) {
          const alreadyIn = groupIds.every(id => sel.has(id))
          if (alreadyIn) groupIds.forEach(id => sel.delete(id))
          else groupIds.forEach(id => sel.add(id))
          useAppStore.getState().setSelectedInstances([...sel])
        } else if (!sel.has(pieceId)) {
          useAppStore.getState().setSelectedInstances(groupIds)
        }
        inst.setSelection(new Set(useAppStore.getState().selectedInstanceIds))
        eng.drag = { kind: 'maybe', mode: 'piece', x: e.clientX, y: e.clientY, pieceId, ground: gp, additive, touch }
      } else {
        eng.drag = { kind: 'maybe', mode: 'box', x: e.clientX, y: e.clientY, ground: gp, additive: e.shiftKey, touch }
      }
      requestRender()
    }

    function onPointerMoveLeft(e: PointerEvent) {
      const eng = engine.current!
      // Two fingers down: the camera is driving, nothing here should react.
      if (eng.touchIds.size >= 2) return
      const overCanvas = e.target === renderer.domElement

      // One finger dragging empty table pans the view (touch has no middle button).
      if (eng.drag.kind === 'pan') {
        cam.panByScreenDelta(e.clientX - eng.drag.x, e.clientY - eng.drag.y)
        eng.drag = { kind: 'pan', x: e.clientX, y: e.clientY }
        return
      }

      // View-only (inspecting an artist's table): no ghost, no placement square, no
      // grab cursor — just a plain pointer over models to hint they're clickable.
      if (store().readOnly) {
        cellHi.visible = false
        if (overCanvas && e.buttons === 0) setCursor(pickPiece(e) ? 'pointer' : 'default')
        return
      }

      // Terrain sculpt mode: brush ring follows the cursor; drag paints the surface.
      if (store().terrainTool !== 'none') {
        if (overCanvas || eng.sculpting) updateBrushRing(e)
        if (eng.sculpting && (e.buttons & 1)) sculptAt(e)
        return
      }

      // ghost preview follows cursor whenever placing (only over the canvas)
      if (overCanvas && store().selectedAssetId && eng.drag.kind !== 'move' && eng.drag.kind !== 'box') {
        updateGhost(e)
      }

      const d = eng.drag
      // Placing on a tablet: a tap stamps the piece, but dragging pans instead of
      // doing nothing (on desktop this stays a no-op until the button is released).
      if (d.kind === 'maybePlace' && d.touch) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_THRESHOLD) {
          eng.drag = { kind: 'pan', x: e.clientX, y: e.clientY }
        }
        return
      }
      if (d.kind === 'maybe') {
        const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y)
        if (moved > DRAG_THRESHOLD) {
          if (d.mode === 'piece' && d.ground) {
            const ids = [...useAppStore.getState().selectedInstanceIds]
            const orig = new Map<string, { x: number; z: number }>()
            for (const id of ids) {
              const i = store().instances.find(ii => ii.id === id)
              if (i) orig.set(id, { x: i.position.x, z: i.position.z })
            }
            eng.drag = { kind: 'move', startGround: d.ground, ids, orig }
          } else if (d.mode === 'box') {
            // Finger on empty table -> pan. Mouse on empty table -> box-select.
            if (d.touch) {
              eng.drag = { kind: 'pan', x: e.clientX, y: e.clientY }
            } else {
              const base = d.additive ? new Set(useAppStore.getState().selectedInstanceIds) : new Set<string>()
              eng.drag = { kind: 'box', x: d.x, y: d.y, base }
            }
          }
        }
      }

      if (eng.drag.kind === 'move') {
        const gp = groundPoint(e)
        if (!gp) return
        const dx = gp.x - eng.drag.startGround.x
        const dz = gp.z - eng.drag.startGround.z
        for (const id of eng.drag.ids) {
          const o = eng.drag.orig.get(id)!
          const { x, z } = snapWorld(o.x + dx, o.z + dz)
          const i = store().instances.find(ii => ii.id === id)
          inst.setLiveTransform(id, { x, z, rotDeg: i?.rotationDeg ?? 0 })
        }
        setCursor('grabbing')
        requestRender()
      } else if (eng.drag.kind === 'rotate') {
        const gp = groundPoint(e)
        if (gp) {
          const { center, initialAngleDeg, orig } = eng.drag
          const angleNowDeg = THREE.MathUtils.radToDeg(Math.atan2(gp.z - center.z, gp.x - center.x))
          // The grabbed point tracks the cursor exactly: as the world angle to the
          // pivot increases by δ, the piece's yaw must decrease by δ to keep that
          // point under the cursor (rotationDeg follows the standard +Y-axis
          // right-hand convention, which runs the other way from atan2(z, x)).
          const delta = -(angleNowDeg - initialAngleDeg)
          for (const id of eng.drag.ids) {
            const rotDeg = normDeg((orig.get(id) ?? 0) + delta)
            const i = store().instances.find(ii => ii.id === id)
            if (i) inst.setLiveTransform(id, { x: i.position.x, z: i.position.z, rotDeg })
          }
        }
        setCursor('grabbing')
        requestRender()
      } else if (eng.drag.kind === 'box') {
        const l = Math.min(eng.drag.x, e.clientX)
        const t = Math.min(eng.drag.y, e.clientY)
        const w = Math.abs(e.clientX - eng.drag.x)
        const h = Math.abs(e.clientY - eng.drag.y)
        const rect = renderer.domElement.getBoundingClientRect()
        setBoxRect({ l: l - rect.left, t: t - rect.top, w, h })
        // select instances whose centre projects inside the rect
        const inRect = new Set(eng.drag.base)
        const v = new THREE.Vector3()
        for (const i of store().instances) {
          v.set(i.position.x, 0.05, i.position.z).project(camera)
          const sx = ((v.x + 1) / 2) * rect.width + rect.left
          const sy = ((-v.y + 1) / 2) * rect.height + rect.top
          if (sx >= Math.min(eng.drag.x, e.clientX) && sx <= Math.max(eng.drag.x, e.clientX) &&
              sy >= Math.min(eng.drag.y, e.clientY) && sy <= Math.max(eng.drag.y, e.clientY)) {
            inRect.add(i.id)
          }
        }
        useAppStore.getState().setSelectedInstances([...inRect])
        inst.setSelection(inRect)
        requestRender()
      } else if (overCanvas && !store().selectedAssetId && e.buttons === 0) {
        // hover highlight when idle — skip while any button is held (e.g. orbiting
        // the camera), since raycasting a high-poly mesh every move is expensive.
        if (rotateHandle.visible) {
          raycaster.setFromCamera(ndc(e, ndcTmp), camera)
          if (raycaster.intersectObjects(rotateHandle.pickables, false).length) {
            if (eng.hovered !== null) { eng.hovered = null; inst.setHover(null) }
            setCursor('grab')
            return
          }
        }
        const pid = pickPiece(e)
        if (pid !== eng.hovered) {
          eng.hovered = pid
          inst.setHover(pid)
          setCursor(pid ? 'grab' : 'default')
          requestRender()
        }
      }
    }

    function onPointerUpLeft(e: PointerEvent) {
      if (e.button !== 0) return
      const eng = engine.current!
      if (e.pointerType === 'touch') {
        eng.touchIds.delete(e.pointerId)
        // Lifting fingers after a pinch/twist must not register as a tap. The latch
        // clears only once the last finger is up.
        if (eng.gestureLatch) {
          if (eng.touchIds.size === 0) { eng.gestureLatch = false; eng.drag = { kind: 'none' } }
          return
        }
      }
      if (eng.sculpting) {
        eng.sculpting = false
        // Record the whole stroke as one undoable step (terrain + paint are in the
        // same timeline as placement).
        if (eng.strokeChanged) { store().actions.commitHistory(); eng.strokeChanged = false }
        return
      }
      const d = eng.drag
      eng.drag = { kind: 'none' }

      if (d.kind === 'pan') return
      if (d.kind === 'maybePlace') {
        const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y)
        if (moved <= DRAG_THRESHOLD) placeGhost(e)
        return
      }
      if (d.kind === 'maybe') {
        if (d.mode === 'box') {
          // plain click on empty table → clear selection
          if (!d.additive) {
            useAppStore.getState().setSelectedInstances([])
            inst.setSelection(new Set())
          }
        }
        requestRender()
        return
      }
      if (d.kind === 'move') {
        const gp = lastGround
        const patches: Array<{ id: string; patch: { position: { x: number; z: number } } }> = []
        if (gp) {
          const dx = gp.x - d.startGround.x
          const dz = gp.z - d.startGround.z
          for (const id of d.ids) {
            const o = d.orig.get(id)!
            const { x, z } = snapWorld(o.x + dx, o.z + dz)
            patches.push({ id, patch: { position: { x, z } } })
          }
        }
        useAppStore.getState().actions.updateInstances(patches)
        inst.clearLive()
        setCursor('grab')
        requestRender()
        return
      }
      if (d.kind === 'rotate') {
        const gp = lastGround
        const patches = d.ids.map((id) => {
          let rotDeg = d.orig.get(id) ?? 0
          if (gp) {
            const angleNowDeg = THREE.MathUtils.radToDeg(Math.atan2(gp.z - d.center.z, gp.x - d.center.x))
            rotDeg = normDeg(rotDeg - (angleNowDeg - d.initialAngleDeg))
          }
          return { id, patch: { rotationDeg: rotDeg } }
        })
        useAppStore.getState().actions.updateInstances(patches)
        inst.clearLive()
        rotateHandle.setActive(false)
        setCursor('grab')
        syncRotateHandle()
        requestRender()
        return
      }
      if (d.kind === 'box') {
        setBoxRect(null)
        requestRender()
        return
      }
    }

    // The OS can take a touch away mid-gesture (iOS edge swipe, app switcher).
    // Treat it as a hard reset so nothing is left half-dragged.
    function onPointerCancel(e: PointerEvent) {
      const eng = engine.current!
      if (e.pointerType !== 'touch') return
      eng.touchIds.delete(e.pointerId)
      if (eng.touchIds.size === 0) eng.gestureLatch = false
      cancelDrag()
    }

    function placeGhost(e: { clientX: number; clientY: number }) {
      const eng = engine.current!
      const assetId = store().selectedAssetId
      if (!assetId) return
      const asset = getAssetById(assetId)
      if (!asset) return
      const gp = groundPoint(e)
      if (!gp) return
      const { x, z } = snapWorld(gp.x, gp.z)
      const t = store().table
      const cells = ghostCells(asset, x, z, eng.ghostRot)
      const base = eng.levelOverride != null ? eng.levelOverride : surfaceTop(store().instances, assetMap(), t, cells)
      if (!validAtLevel(asset, x, z, eng.ghostRot, base, new Set())) return

      const commit = () => {
        const id = useAppStore.getState().actions.addInstance({
          assetId, position: { x, z }, rotationDeg: eng.ghostRot, level: base,
        })
        inst.markPopped([id])
        requestRender()
      }

      // Collaboration gate: an artist placing another artist's model on a showcase
      // must send a collaboration request before it can be used. The placement is
      // deferred until they confirm (see ui/App CollabRequestModal).
      const s = store()
      const needsCollab =
        s.currentUserIsArtist && !!asset.artistId &&
        asset.artistId !== s.currentUserId &&
        !s.requestedCollaboratorIds.has(asset.artistId)
      if (needsCollab) {
        s.openCollabPrompt(asset.artistId!, asset.artistName ?? 'this artist', commit)
        return
      }
      commit()
    }

    // Re-evaluate the ghost at the last cursor position (after a level/rotation change).
    function refreshGhost() {
      const eng = engine.current!
      if (eng.lastPointer && store().selectedAssetId) updateGhost(eng.lastPointer)
    }

    // Rotate whatever the R key would rotate: the ghost while placing, otherwise
    // the selection. Shared by the key handler and the touch controls.
    function rotateActive(dir: 1 | -1) {
      const eng = engine.current!
      if (store().selectedAssetId) {
        eng.ghostRot = normDeg(eng.ghostRot + rotationStep() * dir)
        refreshGhost()
        requestRender()
      } else {
        rotateSelection(dir)
      }
    }

    // Raise/lower the level the ghost places at, overriding the auto-surface.
    function nudgeLevel(delta: 1 | -1) {
      const eng = engine.current!
      if (!store().selectedAssetId) return
      const cur = eng.levelOverride != null ? eng.levelOverride : eng.lastAutoLevel
      eng.levelOverride = Math.max(0, cur + delta)
      refreshGhost()
    }

    function rotateSelection(dir: 1 | -1) {
      const step = rotationStep() * dir
      const ids = useAppStore.getState().selectedInstanceIds
      if (!ids.length) return
      const patches = ids.map(id => {
        const i = store().instances.find(ii => ii.id === id)!
        return { id, patch: { rotationDeg: normDeg(i.rotationDeg + step) } }
      })
      useAppStore.getState().actions.updateInstances(patches)
      inst.setSelection(new Set(ids))
      requestRender()
    }

    // Alt+Arrow: nudge the selection by a fraction of the grid, unsnapped and
    // with no collision check — fine enough to tuck one piece inside another
    // (e.g. seating a barrel inside a ruined wall) when the grid step is too
    // coarse to land there. World-axis, not camera-relative, matching every
    // other piece-manipulation key (rotate/tilt/level are all table-relative).
    function nudgeSelection(dirX: number, dirZ: number) {
      const ids = useAppStore.getState().selectedInstanceIds
      if (!ids.length) return
      const t = store().table
      const step = Math.max(0.0005, t.gridSize / 8)
      const hw = t.width / 2, hh = t.height / 2
      const patches = ids.map(id => {
        const i = store().instances.find(ii => ii.id === id)!
        const x = THREE.MathUtils.clamp(i.position.x + dirX * step, -hw, hw)
        const z = THREE.MathUtils.clamp(i.position.z + dirZ * step, -hh, hh)
        return { id, patch: { position: { x, z } } }
      })
      useAppStore.getState().actions.updateInstances(patches)
      inst.setSelection(new Set(ids))
      requestRender()
    }

    // Alt+PageUp/PageDown: the vertical counterpart of nudgeSelection — fine-steps
    // `level` (a fractional "levels" unit, LEVEL_HEIGHT metres each) instead of the
    // whole-level jump PageUp/PageDown makes while placing, so a piece can be eased
    // down inside/through another one instead of only ever resting on its surface.
    // Same no-collision-check free movement as the horizontal nudge; clamped at 0
    // so a piece can't be nudged beneath the table itself.
    function nudgeSelectionLevel(dir: 1 | -1) {
      const ids = useAppStore.getState().selectedInstanceIds
      if (!ids.length) return
      const FINE_LEVEL_STEP = 0.125 // ~1.6mm at the default 12.7mm/level — matches nudgeSelection's XZ step
      const patches = ids.map(id => {
        const i = store().instances.find(ii => ii.id === id)!
        const level = Math.max(0, (i.level ?? 0) + dir * FINE_LEVEL_STEP)
        return { id, patch: { level } }
      })
      useAppStore.getState().actions.updateInstances(patches)
      inst.setSelection(new Set(ids))
      requestRender()
    }

    // Show/hide/reposition the free-rotate gizmo for the current selection. A
    // single selected piece gets it (multi-select has no single pivot that reads
    // clearly); it's hidden while placing, sculpting, read-only, or mid-drag.
    function syncRotateHandle() {
      const s = store()
      const ids = s.selectedInstanceIds
      if (s.readOnly || s.terrainTool !== 'none' || s.selectedAssetId || ids.length !== 1 || engine.current!.drag.kind !== 'none') {
        rotateHandle.hide()
        return
      }
      const i = s.instances.find((ii) => ii.id === ids[0])
      const asset = i && assetMap().get(i.assetId)
      if (!i || !asset) { rotateHandle.hide(); return }
      const a = asset.aabb ?? { x: 0.2, y: 0.2, z: 0.2 }
      const radius = Math.max((Math.max(a.x, a.z) / 2) * 1.3, 0.05)
      const y = levelToY(i.level ?? 0) + terrainHeightAt(i.position.x, i.position.z) + 0.006
      rotateHandle.setTransform(i.position.x, y, i.position.z, radius)
    }

    // ---- keyboard ----
    function isTextTarget(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTextTarget(e)) return
      const eng = engine.current!
      const s = useAppStore.getState()
      const k = e.key.toLowerCase()

      // View-only mode: only the camera framing keys are allowed; everything
      // else (place/select/rotate/delete/undo/sculpt) is disabled.
      if (s.readOnly) {
        if (k === 'f') { cam.frameBox(tableBox()); return }
        if (k === 'home') { cam.home(tableBox()); return }
        return
      }

      // Alt momentary (opposite of baseline)
      if (e.key === 'Alt') {
        e.preventDefault()
        if (!s.altMomentary) { s.setAltMomentary(true); applySnapVisual() }
        return
      }

      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); s.actions.undo(); afterStateChange(); return }
        if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); s.actions.redo(); afterStateChange(); return }
        if (k === 'd' && s.selectedInstanceIds.length) {
          e.preventDefault()
          const ids = s.actions.duplicateInstances(s.selectedInstanceIds)
          inst.markPopped(ids)
          afterStateChange()
          return
        }
        // Fuse / un-fuse the selection into a stack that moves as one piece
        // (Ctrl+G / Ctrl+Shift+G — the standard group/ungroup shortcut).
        if (k === 'g' && !e.shiftKey && s.selectedInstanceIds.length >= 2) {
          e.preventDefault()
          s.actions.fuseSelected()
          afterStateChange()
          return
        }
        if (k === 'g' && e.shiftKey && s.selectedInstanceIds.length) {
          e.preventDefault()
          s.actions.unfuseSelected()
          afterStateChange()
          return
        }
        return
      }

      if (e.key === 'Escape') {
        if (s.selectedAssetId) { useAppStore.getState().setSelectedAsset(null); ghost.setAsset(null); cellHi.visible = false }
        else { useAppStore.getState().setSelectedInstances([]); inst.setSelection(new Set()) }
        eng.levelOverride = null
        useAppStore.getState().setPlacement(0, false)
        requestRender()
        return
      }

      // PageUp/PageDown: manually raise/lower the placement level (override auto-surface).
      if ((e.key === 'PageUp' || e.key === 'PageDown') && s.selectedAssetId) {
        e.preventDefault()
        nudgeLevel(e.key === 'PageUp' ? 1 : -1)
        return
      }

      // Alt+Arrow: fine-nudge the selected piece(s) so they can be tucked inside
      // another model. BuilderCamera's own arrow-key pan already bails out on
      // e.altKey, so there's no conflict.
      if (e.altKey && s.selectedInstanceIds.length && ARROW_NUDGE[e.key]) {
        e.preventDefault()
        const { dx, dz } = ARROW_NUDGE[e.key]
        nudgeSelection(dx, dz)
        return
      }

      // Alt+PageUp/PageDown: the vertical counterpart — fine-nudge the selection's
      // own height instead of the ghost's placement level (that's the plain
      // PageUp/PageDown case just below, for a not-yet-placed asset).
      if (e.altKey && s.selectedInstanceIds.length && (e.key === 'PageUp' || e.key === 'PageDown')) {
        e.preventDefault()
        nudgeSelectionLevel(e.key === 'PageUp' ? 1 : -1)
        return
      }

      if (k === 'r') {
        rotateActive(e.shiftKey ? -1 : 1)
        return
      }

      // Tilt the selected piece(s) about X (stand up / lay flat). Shift = opposite.
      if (k === 't' && s.selectedInstanceIds.length) {
        s.actions.tiltSelected(rotationStep() * (e.shiftKey ? -1 : 1))
        inst.setSelection(new Set(s.selectedInstanceIds))
        requestRender()
        return
      }

      if (k === 'g') { s.toggleSnapBaseline(); applySnapVisual(); return }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedInstanceIds.length) {
          s.actions.removeInstances(s.selectedInstanceIds)
          inst.setSelection(new Set())
          afterStateChange()
        }
        return
      }

      if (k === 'f') {
        const ids = new Set(s.selectedInstanceIds)
        cam.frameBox(ids.size ? inst.getBox(ids) : tableBox())
        return
      }
      if (k === 'home') { cam.home(tableBox()); return }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Alt') {
        const s = useAppStore.getState()
        if (s.altMomentary) { s.setAltMomentary(false); applySnapVisual() }
      }
    }

    // After an action mutated instances/selection in the store, re-sync the engine.
    function afterStateChange() {
      const s = store()
      inst.sync(s.instances, new Map([...s.assets, ...s.setPartAssets].map(a => [a.id, a])))
      inst.setSelection(new Set(s.selectedInstanceIds))
      syncRotateHandle()
      requestRender()
    }

    // ---- store subscriptions (decoupled from React render) ----
    const unsubInstances = useAppStore.subscribe((s, prev) => {
      if (s.instances !== prev.instances || s.assets !== prev.assets || s.setPartAssets !== prev.setPartAssets) {
        inst.sync(s.instances, new Map([...s.assets, ...s.setPartAssets].map(a => [a.id, a])))
        inst.setSelection(new Set(s.selectedInstanceIds))
        requestRender()
      }
      if (s.selectedInstanceIds !== prev.selectedInstanceIds) {
        inst.setSelection(new Set(s.selectedInstanceIds))
        requestRender()
      }
      if (s.selectedAssetId !== prev.selectedAssetId) {
        const a = s.selectedAssetId ? getAssetById(s.selectedAssetId) : null
        if (a) ensureTemplate(a)
        ghost.setAsset(a ?? null)
        engine.current!.ghostRot = 0
        engine.current!.levelOverride = null // fresh tool starts on auto-surface
        setCursor(a ? 'cell' : 'default')
        if (!a) cellHi.visible = false
        requestRender()
      }
      if (s.table !== prev.table || s.tableMaterial !== prev.tableMaterial) {
        buildTable()
        requestRender()
      }
      if (s.terrainRev !== prev.terrainRev || s.heightmap !== prev.heightmap) {
        syncTerrain()
        inst.refreshTransforms() // pieces ride the sculpted surface
      }
      if (s.paintRev !== prev.paintRev || s.paint !== prev.paint) {
        syncPaint()
      }
      if (s.terrainTool !== prev.terrainTool) {
        // Entering/leaving sculpt mode: hide the brush ring + set the cursor.
        if (s.terrainTool === 'none') brushRing.visible = false
        setCursor(s.terrainTool !== 'none' ? 'crosshair' : (s.selectedAssetId ? 'cell' : 'default'))
        requestRender()
      }
      if (s.snapBaseline !== prev.snapBaseline || s.altMomentary !== prev.altMomentary) {
        applySnapVisual()
      }
      // Cheap enough to just re-derive every tick rather than enumerate every
      // condition (selection/instances/tool/asset) that should show or hide it.
      syncRotateHandle()
    })

    // Textures/models load asynchronously after their material/template is built;
    // with on-demand rendering the scene must be nudged to draw the new pixels
    // (otherwise assets only "pop in" once the camera next moves). Once the queue
    // first drains, warm up the GPU — compile shaders and upload textures — while
    // the loading overlay is still up, so the first real interaction doesn't stall
    // the main thread compiling/uploading.
    let warmedUp = false
    const unsubLoading = subscribeLoading((p) => {
      requestRender()
      if (!warmedUp && !p.active && p.total > 0) {
        warmedUp = true
        try { renderer.compile(scene, camera) } catch { /* best-effort warm-up */ }
        requestRender()
      }
    })

    // ---- listeners ----
    const dom = renderer.domElement
    dom.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', trackGround)
    window.addEventListener('pointermove', onPointerMoveLeft)
    window.addEventListener('pointerup', onPointerUpLeft)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      ro.disconnect()
      unsubInstances()
      unsubLoading()
      dom.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', trackGround)
      window.removeEventListener('pointermove', onPointerMoveLeft)
      window.removeEventListener('pointerup', onPointerUpLeft)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      useAppStore.getState().setCameraApi(null)
      cam.dispose()
      inst.dispose()
      rotateHandle.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <div className="tb-canvas-wrap" ref={mountRef} />
      {boxRect && (
        <div
          style={{
            position: 'absolute',
            left: boxRect.l, top: boxRect.t, width: boxRect.w, height: boxRect.h,
            border: '1px solid #6cc4ff',
            background: 'rgba(108,196,255,0.12)',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        />
      )}
    </>
  )
}

function normDeg(d: number): number {
  return ((d % 360) + 360) % 360
}
