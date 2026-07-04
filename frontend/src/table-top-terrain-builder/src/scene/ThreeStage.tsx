import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useAppStore } from '@state/store'
import { GridHelper } from './helpers'
import { getAssetById, type Asset } from '@core/assets'
import { BuilderCamera } from './BuilderCamera'
import { InstancedScene } from './InstancedScene'
import { Ghost } from './ghost'
import { ensureTemplate } from './loaders'
import { subscribeLoading } from './loadManager'
import {
  worldToCell, aabbFootprint,
  inBounds, snapRotationForFootprint,
} from '@core/occupancy'
import { footprintCellsFor } from '@core/footprintMask'
import {
  surfaceTop, buildOccupied3D, collides3D, occupyUnits, levelToY,
} from '@core/elevation'
import { buildTableMaterial } from '@core/tableMaterials'
import { buildTerrainGeometry, updateTerrainGeometry, heightmapFitsTable } from '@core/heightmap'

const DRAG_THRESHOLD = 4 // px before a press becomes a drag

type LeftDrag =
  | { kind: 'none' }
  | { kind: 'maybePlace'; x: number; y: number }
  | { kind: 'maybe'; mode: 'piece' | 'box'; x: number; y: number; pieceId?: string; ground: THREE.Vector3 | null; additive: boolean }
  | { kind: 'move'; startGround: THREE.Vector3; ids: string[]; orig: Map<string, { x: number; z: number }> }
  | { kind: 'box'; x: number; y: number; base: Set<string> }

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

    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x202830, 0.9))
    const dir = new THREE.DirectionalLight(0xffffff, 0.7)
    dir.position.set(3, 6, 2)
    scene.add(dir)

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

    // ---- instanced placed pieces ----
    const inst = new InstancedScene(() => {
      // a template finished loading — re-sync from current store
      const s = store()
      inst.sync(s.instances, new Map(s.assets.map(a => [a.id, a])))
      inst.setSelection(new Set(s.selectedInstanceIds))
      requestRender()
    })
    scene.add(inst.group)

    // ---- ghost ----
    const ghost = new Ghost(requestRender)
    scene.add(ghost.group)

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
    // user starts sculpting (see buildTable / syncTerrain).
    let terrainMesh: THREE.Mesh | null = null
    let terrainGeo: THREE.BufferGeometry | null = null

    const raycaster = new THREE.Raycaster()
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

    engine.current = {
      renderer, scene, camera, cam, inst, ghost, tableGroup, gridGroup, cellHi,
      raycaster, ground, requestRender, ghostRot: 0, drag: { kind: 'none' }, hovered: null,
      levelOverride: null, lastAutoLevel: 0, lastPointer: null, sculpting: false,
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

    buildTable()
    applySnapVisual()
    cam.home(tableBox())
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
    function buildTable() {
      const t = store().table
      const hm = store().heightmap
      tableGroup.clear()
      terrainMesh = null
      terrainGeo = null
      const mat = buildTableMaterial(store().tableMaterial, t)

      if (hm && heightmapFitsTable(hm, t)) {
        // Sculpted surface: a heightmap mesh in world space (Y up).
        const geo = buildTerrainGeometry(hm, t)
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.y = -0.004
        mesh.receiveShadow = true
        tableGroup.add(mesh)
        terrainMesh = mesh
        terrainGeo = geo
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

    // Re-sync the surface mesh after a sculpt (or when the heightmap appears/clears).
    function syncTerrain() {
      const s = store()
      const hasTerrain = !!(s.heightmap && heightmapFitsTable(s.heightmap, s.table))
      if (hasTerrain !== !!terrainMesh) {
        buildTable() // switch between flat plane and terrain mesh
      } else if (hasTerrain && terrainGeo && s.heightmap) {
        updateTerrainGeometry(terrainGeo, s.heightmap)
      }
      requestRender()
    }

    // Apply the active brush at the ground point under the cursor.
    function sculptAt(e: { clientX: number; clientY: number }) {
      const gp = groundPoint(e)
      if (!gp) return
      // Geometry updates via the terrainRev store subscription → syncTerrain.
      store().actions.sculptTerrain(gp.x, gp.z)
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
      return new Map(store().assets.map(a => [a.id, a]))
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
      return !collides3D(cells, base, occupyUnits(asset), occ)
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
      const y = levelToY(base)

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

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return // right/middle handled by BuilderCamera
      const eng = engine.current!
      const s = store()

      // Terrain sculpt mode owns the left button: drag to sculpt, ignore placement.
      if (s.terrainTool !== 'none') {
        eng.sculpting = true
        sculptAt(e)
        return
      }

      if (s.selectedAssetId) {
        eng.drag = { kind: 'maybePlace', x: e.clientX, y: e.clientY }
        return
      }
      const pieceId = pickPiece(e)
      const gp = groundPoint(e)
      if (pieceId) {
        const additive = e.shiftKey
        const sel = new Set(s.selectedInstanceIds)
        if (additive) {
          sel.has(pieceId) ? sel.delete(pieceId) : sel.add(pieceId)
          useAppStore.getState().setSelectedInstances([...sel])
        } else if (!sel.has(pieceId)) {
          useAppStore.getState().setSelectedInstances([pieceId])
        }
        inst.setSelection(new Set(useAppStore.getState().selectedInstanceIds))
        eng.drag = { kind: 'maybe', mode: 'piece', x: e.clientX, y: e.clientY, pieceId, ground: gp, additive }
      } else {
        eng.drag = { kind: 'maybe', mode: 'box', x: e.clientX, y: e.clientY, ground: gp, additive: e.shiftKey }
      }
      requestRender()
    }

    function onPointerMoveLeft(e: PointerEvent) {
      const eng = engine.current!
      const overCanvas = e.target === renderer.domElement

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
            const base = d.additive ? new Set(useAppStore.getState().selectedInstanceIds) : new Set<string>()
            eng.drag = { kind: 'box', x: d.x, y: d.y, base }
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
      if (eng.sculpting) { eng.sculpting = false; return }
      const d = eng.drag
      eng.drag = { kind: 'none' }

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
      if (d.kind === 'box') {
        setBoxRect(null)
        requestRender()
        return
      }
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
      const id = useAppStore.getState().actions.addInstance({
        assetId, position: { x, z }, rotationDeg: eng.ghostRot, level: base,
      })
      inst.markPopped([id])
      requestRender()
    }

    // Re-evaluate the ghost at the last cursor position (after a level/rotation change).
    function refreshGhost() {
      const eng = engine.current!
      if (eng.lastPointer && store().selectedAssetId) updateGhost(eng.lastPointer)
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
        const cur = eng.levelOverride != null ? eng.levelOverride : eng.lastAutoLevel
        eng.levelOverride = e.key === 'PageUp' ? cur + 1 : Math.max(0, cur - 1)
        refreshGhost()
        return
      }

      if (k === 'r') {
        if (s.selectedAssetId) {
          eng.ghostRot = normDeg(eng.ghostRot + rotationStep() * (e.shiftKey ? -1 : 1))
          refreshGhost()
          requestRender()
        } else {
          rotateSelection(e.shiftKey ? -1 : 1)
        }
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
      inst.sync(s.instances, new Map(s.assets.map(a => [a.id, a])))
      inst.setSelection(new Set(s.selectedInstanceIds))
      requestRender()
    }

    // ---- store subscriptions (decoupled from React render) ----
    const unsubInstances = useAppStore.subscribe((s, prev) => {
      if (s.instances !== prev.instances || s.assets !== prev.assets) {
        inst.sync(s.instances, new Map(s.assets.map(a => [a.id, a])))
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
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      useAppStore.getState().setCameraApi(null)
      cam.dispose()
      inst.dispose()
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
