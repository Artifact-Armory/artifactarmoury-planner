import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useAppStore, groupMembersOf } from '@state/store'
import { GridHelper } from './helpers'
import { getAssetById, type Asset } from '@core/assets'
import { BuilderCamera } from './BuilderCamera'
import { InstancedScene } from './InstancedScene'
import { LevelMarkerView } from './levelMarkers'
import { useUnitsStore } from '@/store/unitsStore'
import { Ghost } from './ghost'
import { RotateHandle } from './rotateHandle'
import { ensureTemplate } from './loaders'
import { subscribeLoading, getLoadProgress } from './loadManager'
import {
  worldToCell, aabbFootprint,
  inBounds, snapRotationForFootprint,
} from '@core/occupancy'
import { footprintCellsFor } from '@core/footprintMask'
import {
  surfaceTop, buildOccupied3D, collides3D, occupyUnitsAt, levelToY, collisionTable,
} from '@core/elevation'
import {
  buildTableMaterial, bakePaintOverlayMaps, makePaintOverlayTextures, preloadGroundTextures, preparePaintSources,
  emptyPaintOverlayMaps, type PaintOverlayCanvases, type PaintOverlayTextures,
} from '@core/tableMaterials'
import { buildTerrainGeometry, updateTerrainGeometry, heightmapFitsTable, sampleHeight, createHeightmap } from '@core/heightmap'
import { paintFitsTable, isBlank as paintIsBlank, type PaintMap } from '@core/paintmap'
import {
  featureDistance, featurePoint, featureBounds, featureLabel, evaluateTerrainHeight, FLAT_RATIO,
  type TerrainFeature, type TerrainFeatureType,
} from '@core/terrainFeatures'
import { FrameQueue } from '@core/frameQueue'
import { LatestPaintJob } from './latestPaintJob'

// Outline / preview colour per landform type.
const FEATURE_COLOR: Record<TerrainFeatureType, number> = {
  hill: 0xffcc44,
  plateau: 0x6cc4ff,
}
// Overlay bake size (longest edge, px): lighter while a stroke is in progress,
// full detail once it settles; the no-worker fallback bakes on the main thread.
const PAINT_LIVE_PX = 1024
const PAINT_SETTLED_PX = 2048
const PAINT_FALLBACK_PX = 512

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
  // Dragging a landform: the cursor is read off a horizontal plane at the grab
  // height, and the original grab offset from its centre is kept throughout.
  | { kind: 'moveFeature'; id: string; orig: { x: number; z: number }; start: THREE.Vector3; plane: THREE.Plane }
  | {
      kind: 'rotate'
      ids: string[]
      center: { x: number; z: number }
      initialAngleDeg: number
      // Original position AND yaw per piece — a fused group must orbit the
      // pivot as a rigid body (position rotates too), not just spin each
      // piece's own yaw in place. See rotateGroupPatches.
      orig: Map<string, { x: number; z: number; rotationDeg: number }>
    }

export function ThreeStage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [boxRect, setBoxRect] = useState<{ l: number; t: number; w: number; h: number } | null>(null)
  const [landformHint, setLandformHint] = useState('')

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
    ghostMirror: boolean           // M pressed while placing: the next piece goes down mirrored
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
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x4a5260, 1.0)
    scene.add(hemi)
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
    // Brightness slider: scales every light from its base intensity above.
    const lightBase = ([hemi, dir, fill, top] as THREE.Light[]).map((l) => [l, l.intensity] as const)
    const applyBrightness = (b: number) => {
      for (const [l, base] of lightBase) l.intensity = base * b
    }
    applyBrightness(store().brightness)

    // ---- on-demand rendering ----
    let renderRequested = false
    let lowRes = false
    const requestRender = () => {
      if (renderRequested) return
      renderRequested = true
      requestAnimationFrame(renderLoop)
    }
    // The snap grid has ~144x96 minor lines on a 6x4ft table. Zoomed out they pack
    // tighter than a pixel apart and paint over the whole surface (the table reads
    // as solid grid-coloured / black), so fade the minor lines out with their
    // on-screen cell size. Major lines always stay.
    let gridSnapAmt = 1
    const fadeMinorGrid = () => {
      const cell = store().table.gridSize
      const dist = Math.max(0.05, camera.position.length())
      const cellPx = (cell / (2 * dist * Math.tan((camera.fov * Math.PI) / 360))) * mount.clientHeight
      const vis = Math.min(1, Math.max(0, (cellPx - 4) / 10))
      gridGroup.traverse((o) => {
        if (!o.userData.minor) return
        const line = o as THREE.LineSegments
        const m = line.material as THREE.LineBasicMaterial
        m.opacity = gridSnapAmt * vis
        line.visible = m.opacity > 0.01
      })
    }

    const renderLoop = () => {
      renderRequested = false
      const camMoving = cam.update()
      const sceneAnimating = inst.update()
      // Pick each piece's LOD for this view. Sized against the FULL-resolution
      // buffer even while moving, so the reduced-DPR frames below never coarsen it.
      inst.updateLod(camera, mount.clientHeight * FULL_DPR)
      // Render at reduced resolution while the camera is in motion, then snap back
      // to full resolution for the settled frame (keeps interaction smooth without
      // any lasting quality loss).
      if (camMoving !== lowRes) {
        lowRes = camMoving
        renderer.setPixelRatio(camMoving ? LOW_DPR : FULL_DPR)
        renderer.setSize(mount.clientWidth, mount.clientHeight, false)
      }
      fadeMinorGrid()
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
    // A template-load callback fires ONCE PER UNIQUE MODEL on the table as
    // each one's GLB individually arrives — and inst.sync() -> rebuild()
    // tears down and recreates EVERY asset group's InstancedMeshes, not just
    // the one that just loaded (see InstancedScene.rebuild). Loading a
    // showcase with many different models therefore used to run that full
    // dispose-and-recreate pass once per model, redoing the already-finished
    // ones every time — an O(unique models²)-ish cascade of GPU churn on
    // exactly the kind of table (varied, model-on) reported slow. Coalesce
    // every template that finishes within the same animation frame into one
    // sync instead of one per model.
    let pendingTemplateSync = false
    const inst = new InstancedScene(() => {
      if (pendingTemplateSync) return
      pendingTemplateSync = true
      requestAnimationFrame(() => {
        pendingTemplateSync = false
        const s = store()
        inst.sync(s.instances, assetMap())
        inst.setSelection(new Set(s.selectedInstanceIds))
        requestRender()
      })
    })
    inst.setHeightSampler(terrainHeightAt)
    inst.setDefaultColor(store().modelColor)
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

    // Landform outlines: the selected landform's footprint + flat-top rings, and
    // the translucent surface preview of an armed (not yet placed) one.
    const featureGroup = new THREE.Group()
    scene.add(featureGroup)
    const landformPreview = new THREE.Group()
    scene.add(landformPreview)

    // Level markers: placed floor outlines + the blue glow while the tool is on.
    const levelView = new LevelMarkerView()
    scene.add(levelView.group)
    levelView.sync(store().levelMarkers, store().table)

    // Deformable surface: the flat plane is swapped for a heightmap mesh once the
    // user starts sculpting (see buildTable / syncTerrain). A grid mesh is also used
    // (flat) when the surface is painted, so the overlay has known UVs.
    let terrainMesh: THREE.Mesh | null = null
    let terrainGeo: THREE.BufferGeometry | null = null
    // Painted-texture overlay: a transparent mesh sharing the surface geometry,
    // sitting a hair above it so the base material shows through unpainted areas.
    let paintMesh: THREE.Mesh | null = null
    let paintTex: PaintOverlayTextures | null = null
    let paintCanvas: PaintOverlayCanvases | null = null
    // Paint-bake job state (see "paint baking" below). Declared up here because
    // buildTable() runs at mount, before the functions that use these.
    const paintJobs = new LatestPaintJob()
    let paintReady = false
    let paintStarted = false
    let paintFallbackTimer: ReturnType<typeof setTimeout> | undefined
    let activePaint: { id: number; mesh: THREE.Mesh; paint: PaintMap | null } | null = null
    let paintWorker: Worker | null = null
    // Pointer input is applied at most once per frame (latest position wins);
    // pointer-up flushes it so the last dab/position is never dropped.
    const editQueue = new FrameQueue()
    const cursorQueue = new FrameQueue()
    let disposed = false

    const raycaster = new THREE.Raycaster()
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

    engine.current = {
      renderer, scene, camera, cam, inst, ghost, tableGroup, gridGroup, cellHi,
      raycaster, ground, requestRender, ghostRot: 0, ghostMirror: false, drag: { kind: 'none' }, hovered: null,
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
      getPose: () => cam.getPose(),
    })
    // Engine actions the on-screen touch controls need (no keyboard on a tablet).
    useAppStore.getState().setStageApi({
      rotate: (dir) => rotateActive(dir),
      nudgeLevel: (delta) => nudgeLevel(delta),
      mirror: () => mirrorActive(),
      captureTable: (w, h) => captureTable(w, h),
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

    // ---- table snapshot (saved table thumbnail) ----
    // rAF is paused in a background tab; the timer keeps a capture from stalling there.
    const nextFrame = () => new Promise<void>((r) => {
      const t = setTimeout(r, 100)
      requestAnimationFrame(() => { clearTimeout(t); r() })
    })
    async function waitForAssets(timeoutMs: number) {
      const start = performance.now()
      while (!disposed && getLoadProgress().active && performance.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 150))
      }
      // Finished templates are folded into the scene on the next animation frame.
      await nextFrame()
      await nextFrame()
    }

    /** Pull a camera back along `dir` until every corner of `box` sits inside the frame. */
    function fitCamera(cam: THREE.PerspectiveCamera, box: THREE.Box3, dir: THREE.Vector3) {
      const corners: THREE.Vector3[] = []
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z))
      const target = box.getCenter(new THREE.Vector3())
      const p = new THREE.Vector3()
      const place = (d: number) => {
        cam.position.copy(target).addScaledVector(dir, d)
        cam.lookAt(target)
        cam.updateMatrixWorld()
      }
      const extent = () => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (const c of corners) {
          p.copy(c).project(cam)
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
        }
        return { minX, maxX, minY, maxY }
      }
      const MARGIN = 0.94 // fraction of the frame the table may fill
      for (let pass = 0; pass < 3; pass++) {
        let lo = 0.1, hi = 100
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2
          place(mid)
          const e = extent()
          const fits = Math.max(-e.minX, e.maxX, -e.minY, e.maxY) <= MARGIN
          if (fits) hi = mid; else lo = mid
        }
        place(hi)
        // Centre the projected bounds (perspective makes the near edge loom larger).
        const e = extent()
        const cx = (e.minX + e.maxX) / 2, cy = (e.minY + e.maxY) / 2
        if (Math.abs(cx) < 0.005 && Math.abs(cy) < 0.005) break
        const ndc = new THREE.Vector3(cx, cy, new THREE.Vector3().copy(target).project(cam).z).unproject(cam)
        target.add(ndc.sub(target))
      }
    }

    async function captureTable(width: number, height: number): Promise<HTMLCanvasElement | null> {
      await waitForAssets(20000)
      if (disposed) return null
      const s = store()

      const box = tableBox()
      box.max.y = 0
      box.union(inst.getBox())
      // Terrain can rise above the table top; keep peaks in shot.
      const hm = s.heightmap
      if (hm && heightmapFitsTable(hm, s.table)) {
        let peak = 0
        for (let k = 0; k < hm.heights.length; k++) peak = Math.max(peak, hm.heights[k])
        box.max.y = Math.max(box.max.y, peak)
      }

      const shot = new THREE.PerspectiveCamera(30, width / height, 0.05, 500)
      const az = 30 * (Math.PI / 180), polar = 52 * (Math.PI / 180)
      const dir = new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az))
      fitCamera(shot, box, dir)
      const radius = box.getBoundingSphere(new THREE.Sphere()).radius
      shot.near = Math.max(0.01, shot.position.distanceTo(box.getCenter(new THREE.Vector3())) - radius * 2)
      shot.far = shot.position.distanceTo(box.getCenter(new THREE.Vector3())) + radius * 2
      shot.updateProjectionMatrix()

      // Hide everything that is editor chrome rather than the table itself.
      const hidden = [ghost.group, rotateHandle.group, gridGroup, cellHi, brushRing, featureGroup, landformPreview, levelView.group].filter((o) => o.visible)
      hidden.forEach((o) => { o.visible = false })
      const selection = new Set(s.selectedInstanceIds)
      const hovered = engine.current?.hovered ?? null
      if (selection.size) inst.setSelection(new Set())
      if (hovered) inst.setHover(null)

      // Supersample 2x (when the GPU allows) and scale down, for clean edges.
      const maxSize = renderer.capabilities.maxTextureSize
      const ss = Math.max(1, Math.min(2, maxSize / width, maxSize / height))
      const out = document.createElement('canvas')
      out.width = width
      out.height = height
      try {
        renderer.setPixelRatio(ss)
        renderer.setSize(width, height, false)
        inst.updateLod(shot, height * ss)
        renderer.render(scene, shot)
        const ctx = out.getContext('2d')!
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        // preserveDrawingBuffer keeps the frame readable after render().
        ctx.drawImage(renderer.domElement, 0, 0, width, height)
      } finally {
        hidden.forEach((o) => { o.visible = true })
        if (selection.size) inst.setSelection(selection)
        if (hovered) inst.setHover(hovered)
        renderer.setPixelRatio(FULL_DPR)
        lowRes = false
        renderer.setSize(mount.clientWidth, mount.clientHeight, false)
        inst.updateLod(camera, mount.clientHeight * FULL_DPR)
        requestRender()
      }
      return out
    }

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
      if (paintTex) Object.values(paintTex).forEach((texture) => texture.dispose())
      terrainMesh = null
      terrainGeo = null
      paintMesh = null
      paintTex = null
      paintCanvas = null
      const mat = buildTableMaterial(store().tableMaterial, t, requestRender)

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
    // It starts empty; the colour/normal/roughness maps arrive from the bake.
    function buildPaintOverlay(geo: THREE.BufferGeometry, baseY: number) {
      const s = store()
      if (!paintFitsTable(s.paint, s.table)) return
      paintCanvas = emptyPaintOverlayMaps()
      paintTex = makePaintOverlayTextures(paintCanvas)
      const mat = new THREE.MeshStandardMaterial({
        map: paintTex.albedo,
        normalMap: paintTex.normal,
        roughnessMap: paintTex.roughness,
        normalScale: new THREE.Vector2(0.65, 0.65),
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
        roughness: 1,
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
      requestPaintPreview()
    }

    // ---- paint baking ----
    // One bake runs at a time in a worker (OffscreenCanvas); while it runs, only
    // "the latest state is wanted" is remembered — the paint map is read when a
    // job is DISPATCHED, so a fast stroke never queues up stale copies. A result
    // is dropped if the overlay was rebuilt (resize, material change) or the paint
    // map was replaced (undo/redo, load) since the job went out.

    // Lazily start the worker the first time a table actually has paint, so the
    // ground photos are only fetched when they are needed.
    function startPaintWorker() {
      if (paintStarted) return
      paintStarted = true
      try {
        if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
          paintWorker = new Worker(new URL('./paintPreview.worker.ts', import.meta.url), { type: 'module' })
        }
      } catch {
        paintWorker = null
      }
      if (!paintWorker) {
        // Main-thread fallback: re-bake once the photos land.
        paintReady = true
        void preloadGroundTextures().then(() => { if (!disposed) requestPaintPreview() })
        return
      }
      paintWorker.onerror = failPaintWorker
      paintWorker.onmessage = (event: MessageEvent<{ id: number; error?: string; bitmaps?: Record<'albedo' | 'normal' | 'roughness', ImageBitmap> }>) => {
        const data = event.data
        const job = activePaint
        if (!paintJobs.finish(data.id)) {
          if (data.bitmaps) Object.values(data.bitmaps).forEach((bitmap) => bitmap.close())
          return
        }
        activePaint = null
        if (data.error) { failPaintWorker(); return }
        if (job && !disposed && job.mesh === paintMesh && job.paint === store().paint && paintCanvas && data.bitmaps) {
          for (const channel of ['albedo', 'normal', 'roughness'] as const) {
            const canvas = paintCanvas[channel], bitmap = data.bitmaps[channel]
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) { canvas.width = bitmap.width; canvas.height = bitmap.height }
            const ctx = canvas.getContext('2d')!
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.drawImage(bitmap, 0, 0)
          }
          uploadPaintMaps()
        }
        if (data.bitmaps) Object.values(data.bitmaps).forEach((bitmap) => bitmap.close())
        sendPaintPreview()
      }
      void preparePaintSources().then((sources) => {
        if (disposed || !paintWorker) { sources.forEach((source) => source.image.close()); return }
        paintWorker.postMessage({ kind: 'init', sources }, sources.map((source) => source.image))
        paintReady = true
        sendPaintPreview()
      }).catch(failPaintWorker)
    }

    function failPaintWorker() {
      paintWorker?.terminate()
      paintWorker = null
      paintReady = true
      if (activePaint) paintJobs.finish(activePaint.id)
      activePaint = null
      void preloadGroundTextures().then(() => { if (!disposed) requestPaintPreview() })
      requestPaintPreview()
    }

    function requestPaintPreview() {
      startPaintWorker()
      paintJobs.request()
      sendPaintPreview()
    }

    // Hand the baked canvases to the GPU (re-creating the textures on a size change).
    function uploadPaintMaps() {
      if (!paintCanvas || !paintTex || !paintMesh) return
      const texture = paintTex.albedo
      if (texture.userData.width !== paintCanvas.albedo.width || texture.userData.height !== paintCanvas.albedo.height) {
        Object.values(paintTex).forEach((map) => map.dispose())
        paintTex = makePaintOverlayTextures(paintCanvas)
        const material = paintMesh.material as THREE.MeshStandardMaterial
        material.map = paintTex.albedo
        material.normalMap = paintTex.normal
        material.roughnessMap = paintTex.roughness
        material.needsUpdate = true
      } else {
        Object.values(paintTex).forEach((map) => { map.needsUpdate = true })
      }
      requestRender()
    }

    function sendPaintPreview() {
      if (disposed || !paintReady || !paintMesh || !paintCanvas) return
      if (!paintWorker) {
        // Coalesced main-thread bake at reduced resolution.
        if (paintFallbackTimer !== undefined) return
        paintFallbackTimer = setTimeout(() => {
          paintFallbackTimer = undefined
          const id = paintJobs.take()
          if (id === null) return
          const state = store()
          if (paintCanvas && paintMesh && !disposed && paintFitsTable(state.paint, state.table)) {
            bakePaintOverlayMaps(state.paint, state.table, paintCanvas, PAINT_FALLBACK_PX)
            uploadPaintMaps()
          }
          paintJobs.finish(id)
          sendPaintPreview()
        }, 50)
        return
      }
      const state = store()
      if (!paintFitsTable(state.paint, state.table)) return
      const id = paintJobs.take()
      if (id === null) return
      const size = engine.current?.sculpting ? PAINT_LIVE_PX : PAINT_SETTLED_PX
      activePaint = { id, mesh: paintMesh, paint: state.paint }
      // Structured cloning copies the cell bytes once per dispatched job.
      paintWorker.postMessage({ kind: 'paint', id, paint: state.paint, table: { width: state.table.width, height: state.table.height }, size })
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
    // Paint never rebuilds the terrain geometry, except to add/remove the overlay.
    function syncPaint() {
      const painted = hasPaint()
      if (painted !== !!paintMesh) {
        buildTable() // add/remove the overlay (and switch flat plane ↔ grid mesh)
      } else if (painted && paintCanvas && paintTex) {
        requestPaintPreview()
      }
      requestRender()
    }

    function clearMarkers(group: THREE.Group) {
      group.traverse((obj) => {
        const m = obj as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose()
      })
      group.clear()
    }

    function markerLine(pts: THREE.Vector3[], color: number, opacity: number, dashed: boolean): THREE.Line {
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.03, gapSize: 0.02, depthTest: false })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false })
      const line = new THREE.Line(geo, mat)
      if (dashed) line.computeLineDistances()
      line.renderOrder = 9
      return line
    }

    /** Footprint + flat-top rings draped on the ground, a rise marker and a centre cross. */
    function outlineFeature(f: TerrainFeature, group: THREE.Group, features: TerrainFeature[], preview = false) {
      const state = store(), color = FEATURE_COLOR[f.type]
      const height = (x: number, z: number) => evaluateTerrainHeight(features, state.terrainDetail, state.table, x, z)
      for (const ring of [1, f.flatTop ?? FLAT_RATIO[f.type]]) {
        if (ring <= 0) continue
        const points = Array.from({ length: 65 }, (_, i) => {
          const a = i / 64 * Math.PI * 2, p = featurePoint(f, Math.cos(a) * ring, Math.sin(a) * ring)
          return new THREE.Vector3(p.x, height(p.x, p.z) + 0.004, p.z)
        })
        group.add(markerLine(points, color, ring === 1 ? 1 : 0.6, false))
      }
      const centreY = height(f.x, f.z)
      const baseY = evaluateTerrainHeight(features.filter((v) => v.id !== f.id), state.terrainDetail, state.table, f.x, f.z)
      group.add(markerLine([new THREE.Vector3(f.x, baseY + 0.004, f.z), new THREE.Vector3(f.x, centreY + 0.02, f.z)], color, 1, true))
      for (const [u, v] of [[1, 0], [0, 1]]) {
        const points = [-0.08, 0.08].map((t) => {
          const p = featurePoint(f, u * t, v * t)
          return new THREE.Vector3(p.x, height(p.x, p.z) + 0.006, p.z)
        })
        group.add(markerLine(points, color, preview ? 0.6 : 1, false))
      }
    }

    function syncFeatureMarkers() {
      clearMarkers(featureGroup)
      const state = store(), f = state.terrainFeatures.find((v) => v.id === state.selectedFeatureId)
      if (f) outlineFeature(f, featureGroup, state.terrainFeatures)
      requestRender()
    }

    function hideLandformPreview() {
      clearMarkers(landformPreview)
      setLandformHint('')
      requestRender()
    }

    /** Translucent surface of the armed landform under the cursor, before it is placed. */
    function updateLandformPreview(e: { clientX: number; clientY: number }) {
      const state = store(), draft = state.landformDraft
      if (!draft || !state.landformArmed) { hideLandformPreview(); return }
      const gp = groundPoint(e), hw = state.table.width / 2, hh = state.table.height / 2
      if (!gp || Math.abs(gp.x) > hw || Math.abs(gp.z) > hh) { hideLandformPreview(); return }
      const f = { ...draft, x: gp.x, z: gp.z }, features = [...state.terrainFeatures, f]
      clearMarkers(landformPreview)
      // Sample just the candidate footprint with the same evaluator the surface uses.
      const rings = 12, segments = 48, positions: number[] = [], indices: number[] = []
      for (let j = 0; j <= rings; j++) for (let i = 0; i <= segments; i++) {
        const a = i / segments * Math.PI * 2, p = featurePoint(f, Math.cos(a) * j / rings, Math.sin(a) * j / rings)
        p.x = Math.max(-hw, Math.min(hw, p.x)); p.z = Math.max(-hh, Math.min(hh, p.z))
        positions.push(p.x, evaluateTerrainHeight(features, state.terrainDetail, state.table, p.x, p.z) + 0.003, p.z)
      }
      for (let j = 0; j < rings; j++) for (let i = 0; i < segments; i++) {
        const a = j * (segments + 1) + i, b = a + segments + 1
        indices.push(a, b, a + 1, a + 1, b, b + 1)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.setIndex(indices)
      geo.computeVertexNormals()
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: FEATURE_COLOR[f.type], transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, roughness: 0.8,
      }))
      mesh.renderOrder = 8
      landformPreview.add(mesh)
      outlineFeature(f, landformPreview, features, true)
      const b = featureBounds(f), cropped = b.minX < -hw || b.maxX > hw || b.minZ < -hh || b.maxZ > hh
      setLandformHint(`${featureLabel(f)} · ${Math.round(f.radius * 2000)} × ${Math.round((f.radiusZ ?? f.radius) * 2000)} mm · rise ${Math.round(f.height * 1000)} mm · click to place${cropped ? ' · cropped at the table edge' : ''}`)
      requestRender()
    }

    /** Nearest placed landform whose footprint contains the world point, or null. */
    function pickFeatureAt(gp: THREE.Vector3 | null): string | null {
      if (!gp) return null
      let best: { id: string; dist: number } | null = null
      for (const f of store().terrainFeatures) {
        const dist = featureDistance(f, gp.x, gp.z)
        if (dist <= 1 && (!best || dist < best.dist)) best = { id: f.id, dist }
      }
      return best?.id ?? null
    }


    // Apply the active brush at the ground point under the cursor. Height tools
    // sculpt the field; paint/erase tools stamp the texture overlay. A changed dab
    // flags the stroke so pointer-up records one undo step.
    function sculptAt(e: { clientX: number; clientY: number }) {
      const point = { clientX: e.clientX, clientY: e.clientY }, tool = store().terrainTool
      editQueue.enqueue(() => {
        if (!engine.current || store().terrainTool !== tool) return
        applySculptAt(point)
        updateBrushRing(point)
      })
    }
    // Previous paint position in this stroke: each dab covers the segment from
    // it, so a fast stroke (or an erase) is continuous rather than a dotted line.
    let lastPaintPoint: { x: number; z: number; tool: string } | undefined
    function applySculptAt(e: { clientX: number; clientY: number }) {
      const gp = groundPoint(e)
      if (!gp) { lastPaintPoint = undefined; return }
      const tool = store().terrainTool
      const painting = tool === 'paint' || tool === 'erase'
      // Geometry/overlay updates via the terrainRev/paintRev store subscriptions.
      const changed = painting
        ? store().actions.paintTerrain(gp.x, gp.z, lastPaintPoint?.tool === tool ? lastPaintPoint : undefined)
        : store().actions.sculptTerrain(gp.x, gp.z)
      lastPaintPoint = painting ? { x: gp.x, z: gp.z, tool } : undefined
      if (changed) engine.current!.strokeChanged = true
    }

    /** End a brush stroke: apply the last dab, ask for a full-detail bake, one undo step. */
    function finishStroke() {
      const eng = engine.current!
      editQueue.flush()
      eng.sculpting = false
      lastPaintPoint = undefined
      if (hasPaint()) requestPaintPreview()
      if (eng.strokeChanged) { store().actions.commitHistory(); eng.strokeChanged = false }
    }

    function updateBrushRing(e: { clientX: number; clientY: number }) {
      const s = store()
      if (s.landformArmed) { brushRing.visible = false; updateLandformPreview(e); return }
      const gp = s.terrainTool !== 'none' ? groundPoint(e) : null
      if (!gp) { if (brushRing.visible) { brushRing.visible = false; requestRender() } return }
      brushRing.position.set(gp.x, gp.y + 0.03, gp.z)
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
          if (!o.userData.minor) m.opacity = snap ? 1 : 0.18
        }
      })
      gridSnapAmt = snap ? 1 : 0.18
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
      // Sculpted/landform tables: hit the actual surface, not the y=0 plane, so
      // the brush, the landform preview and dabs land under the cursor on a hill.
      if (terrainMesh) {
        const hits = raycaster.intersectObject(terrainMesh, false)
        if (hits.length) return hits[0].point.clone()
      }
      const hit = new THREE.Vector3()
      return raycaster.ray.intersectPlane(ground, hit) ? hit : null
    }
    /** Height under the cursor for a level marker: the nearest piece surface hit,
     *  else the table, to the nearest millimetre. */
    function markerHeight(e: { clientX: number; clientY: number }): number | null {
      const gp = groundPoint(e)
      raycaster.setFromCamera(ndc(e, ndcTmp), camera)
      const hit = inst.pickHit(raycaster)
      const origin = raycaster.ray.origin
      const p = hit && (!gp || hit.point.distanceTo(origin) < gp.distanceTo(origin)) ? hit.point : gp
      return p ? Math.max(0, Math.round(p.y * 1000) / 1000) : null
    }
    function updateMarkerPreview(e: { clientX: number; clientY: number }) {
      const y = markerHeight(e)
      const metric = useUnitsStore.getState().system !== 'imperial'
      const text = y == null ? '' : metric ? `${(y * 100).toFixed(1)} cm` : `${(y / 0.0254).toFixed(2)}"`
      levelView.setPreview(y, store().table, text)
      requestRender()
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

    // assetMap() is called from several hot paths — every mousemove while
    // placing a piece (buildOccupied3D/surfaceTop below), and every store tick
    // while anything is selected (syncRotateHandle) — so rebuilding a Map over
    // the WHOLE catalogue (every published model + set part, which on a live
    // marketplace can be large) on every single call is real, repeated cost
    // for no reason: the catalogue only actually changes when `assets` or
    // `setPartAssets` themselves change. Cache the built Map and only rebuild
    // when either array reference changes (Zustand replaces these wholesale on
    // a catalogue load/update, never mutates in place, so reference equality
    // is a safe and cheap "did it change" check).
    let assetMapCache: { assets: ReturnType<typeof store>['assets']; setPartAssets: ReturnType<typeof store>['setPartAssets']; map: Map<string, Asset> } | null = null
    function assetMap() {
      const s = store()
      if (assetMapCache && assetMapCache.assets === s.assets && assetMapCache.setPartAssets === s.setPartAssets) {
        return assetMapCache.map
      }
      // Include set-part assets — they're kept off the flat catalogue (s.assets) but
      // are placeable, so collision/stacking/rendering must resolve them too.
      const map = new Map([...s.assets, ...s.setPartAssets].map(a => [a.id, a]))
      assetMapCache = { assets: s.assets, setPartAssets: s.setPartAssets, map }
      return map
    }

    // Grid cells a footprint covers at the cursor.
    // On the collision grid (≥5mm), not the snap grid; see collisionTable.
    function ghostCells(asset: Asset, x: number, z: number, rotDeg: number, mirrored = false) {
      const t = collisionTable(store().table)
      const anchor = worldToCell(x, z, t)
      return footprintCellsFor(asset, anchor, snapRotationForFootprint(rotDeg), t.gridSize, mirrored)
    }

    // Validity at a specific elevation level (3D occupancy: cell × level slab).
    function validAtLevel(asset: Asset, x: number, z: number, rotDeg: number, base: number, exclude: Set<string>, mirrored = false): boolean {
      const t = collisionTable(store().table)
      const cells = ghostCells(asset, x, z, rotDeg, mirrored)
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
      const cells = ghostCells(asset, x, z, eng.ghostRot, eng.ghostMirror)
      const auto = surfaceTop(store().instances, assetMap(), collisionTable(t), cells)
      eng.lastAutoLevel = auto
      const base = eng.levelOverride != null ? eng.levelOverride : auto
      const y = levelToY(base) + terrainHeightAt(x, z)

      ghost.setTransform(x, z, eng.ghostRot, y)
      const valid = validAtLevel(asset, x, z, eng.ghostRot, base, new Set(), eng.ghostMirror)
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
      const s = store(), drag = engine.current!.drag
      if (s.terrainTool !== 'none' || s.landformArmed || drag.kind === 'moveFeature') return
      lastGround = groundPoint(e)
    }

    // Abandon whatever left-button/finger drag is in flight (a second finger just
    // landed, so the camera owns the gesture now).
    function cancelDrag() {
      const eng = engine.current!
      editQueue.flush()
      if (eng.drag.kind === 'moveFeature') {
        const drag = eng.drag, f = store().terrainFeatures.find((v) => v.id === drag.id)
        if (f && (f.x !== drag.orig.x || f.z !== drag.orig.z)) store().actions.commitHistory()
      }
      if (eng.drag.kind === 'move') inst.clearLive()
      if (eng.drag.kind === 'rotate') { inst.clearLive(); rotateHandle.setActive(false) }
      if (eng.drag.kind === 'box') setBoxRect(null)
      eng.drag = { kind: 'none' }
      // A second finger also ends a terrain stroke — pointerup is swallowed while
      // the gesture latch is set, so close the undo step here or the brush would
      // stay "down" and keep sculpting after the pinch.
      if (eng.sculpting) finishStroke()
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
        // A finger has no middle button, so on touch a drag is the only way to
        // pan — arm the same tap-or-drag detection the editor uses (a drag past
        // the threshold becomes a pan in onPointerMove; a tap does nothing more).
        eng.drag = touch ? { kind: 'maybePlace', x: e.clientX, y: e.clientY, touch: true } : { kind: 'none' }
        requestRender()
        return
      }
      const s = store()

      // Level marker tool: each click adds a marker at the height under the cursor.
      if (s.levelMarkerArmed) {
        const y = markerHeight(e)
        if (y != null && y > 0.001) s.addLevelMarker(y)
        requestRender()
        return
      }

      // Terrain sculpt mode owns the left button: drag to sculpt, ignore placement.
      if (s.terrainTool !== 'none') {
        lastPaintPoint = undefined
        eng.sculpting = true
        eng.strokeChanged = false
        // The press itself is applied now, not queued: a move in the same frame
        // would otherwise replace it and the stroke would start late.
        editQueue.clear()
        applySculptAt(e)
        updateBrushRing(e)
        return
      }

      // An armed landform: this click places it (single-shot, one undo step) and
      // leaves it selected for adjustment.
      if (s.landformArmed) {
        cursorQueue.clear()
        const gp = groundPoint(e)
        if (gp) s.actions.addTerrainFeature(s.landformArmed, gp.x, gp.z)
        useAppStore.getState().setLandformArmed(null)
        requestRender()
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
            const orig = new Map(ids.map((id) => {
              const i = store().instances.find((ii) => ii.id === id)
              return [id, { x: i?.position.x ?? center.x, z: i?.position.z ?? center.z, rotationDeg: i?.rotationDeg ?? 0 }]
            }))
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
      // While the terrain panel is open, a click on a landform (not a model)
      // selects it and starts dragging it from where it was grabbed.
      const featureId = !pieceId && s.landformEditing && s.terrainFeatures.length ? pickFeatureAt(gp) : null
      if (featureId && gp) {
        const f = s.terrainFeatures.find((v) => v.id === featureId)!
        useAppStore.getState().setSelectedFeature(featureId)
        inst.setSelection(new Set())
        eng.drag = { kind: 'moveFeature', id: featureId, orig: { x: f.x, z: f.z }, start: gp.clone(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -gp.y) }
        setCursor('grabbing')
        requestRender()
        return
      }
      if (s.selectedFeatureId) useAppStore.getState().setSelectedFeature(null)
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
      if (e.target === renderer.domElement) eng.lastPointer = { clientX: e.clientX, clientY: e.clientY }
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
        const d = eng.drag
        if (d.kind === 'maybePlace' && d.touch && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_THRESHOLD) {
          eng.drag = { kind: 'pan', x: e.clientX, y: e.clientY }
          return
        }
        if (overCanvas && e.buttons === 0) setCursor(pickPiece(e) ? 'pointer' : 'default')
        return
      }

      // Level marker tool: the blue plane follows the height under the cursor.
      if (store().levelMarkerArmed) {
        if (overCanvas) {
          const point = { clientX: e.clientX, clientY: e.clientY }
          cursorQueue.enqueue(() => updateMarkerPreview(point))
        }
        return
      }

      // Terrain sculpt mode: brush ring follows the cursor; drag paints the surface.
      if (store().terrainTool !== 'none') {
        if (!eng.sculpting && overCanvas) {
          const point = { clientX: e.clientX, clientY: e.clientY }
          cursorQueue.enqueue(() => updateBrushRing(point))
        }
        if (eng.sculpting && (e.buttons & 1)) sculptAt(e)
        return
      }

      // Armed landform: preview its surface under the cursor.
      if (store().landformArmed) {
        if (overCanvas) {
          const point = { clientX: e.clientX, clientY: e.clientY }
          cursorQueue.enqueue(() => updateLandformPreview(point))
        } else {
          cursorQueue.clear()
          hideLandformPreview()
        }
        return
      }

      if (eng.drag.kind === 'moveFeature') {
        const point = { clientX: e.clientX, clientY: e.clientY }
        editQueue.enqueue(() => {
          const drag = engine.current!.drag
          if (drag.kind !== 'moveFeature') return
          raycaster.setFromCamera(ndc(point, ndcTmp), camera)
          const hit = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3())
          if (!hit) return
          const pos = snapWorld(drag.orig.x + hit.x - drag.start.x, drag.orig.z + hit.z - drag.start.z)
          store().actions.updateTerrainFeatureLive(drag.id, pos)
        })
        setCursor('grabbing')
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
        // Snap the group as ONE rigid body: round a single anchor's target
        // position to the grid, then carry every member by that exact same
        // delta. Snapping each member independently (the old behaviour) rounds
        // each piece's own fractional grid-offset differently, so a fused
        // group whose internal spacing isn't itself a multiple of the grid
        // (anything not axis-aligned, e.g. after a free rotate) comes apart —
        // faster/further drags just make the always-present rounding error
        // more visible by landing on a less forgiving fractional offset.
        const ids = eng.drag.ids
        const anchor = eng.drag.orig.get(ids[0])!
        const snappedAnchor = snapWorld(anchor.x + dx, anchor.z + dz)
        const gdx = snappedAnchor.x - anchor.x
        const gdz = snappedAnchor.z - anchor.z
        for (const id of ids) {
          const o = eng.drag.orig.get(id)!
          const i = store().instances.find(ii => ii.id === id)
          inst.setLiveTransform(id, { x: o.x + gdx, z: o.z + gdz, rotDeg: i?.rotationDeg ?? 0 })
        }
        setCursor('grabbing')
        requestRender()
      } else if (eng.drag.kind === 'rotate') {
        const gp = groundPoint(e)
        if (gp) {
          const { center, initialAngleDeg, orig, ids } = eng.drag
          const angleNowDeg = THREE.MathUtils.radToDeg(Math.atan2(gp.z - center.z, gp.x - center.x))
          // The grabbed point tracks the cursor exactly: as the world angle to the
          // pivot increases by δ, the piece's yaw must decrease by δ to keep that
          // point under the cursor (rotationDeg follows the standard +Y-axis
          // right-hand convention, which runs the other way from atan2(z, x)).
          const deltaDeg = -(angleNowDeg - initialAngleDeg)
          for (const p of rotateGroupPatches(ids, center, deltaDeg, orig)) {
            inst.setLiveTransform(p.id, { x: p.patch.position.x, z: p.patch.position.z, rotDeg: p.patch.rotationDeg })
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
        // Record the whole stroke as one undoable step (terrain + paint are in the
        // same timeline as placement).
        finishStroke()
        return
      }
      editQueue.flush()
      const d = eng.drag
      eng.drag = { kind: 'none' }

      if (d.kind === 'moveFeature') {
        // A plain click (no movement) just leaves it selected — no no-op undo step.
        const f = store().terrainFeatures.find((v) => v.id === d.id)
        if (f && (f.x !== d.orig.x || f.z !== d.orig.z)) store().actions.commitHistory()
        setCursor('default')
        requestRender()
        return
      }

      if (d.kind === 'pan') return
      if (d.kind === 'maybePlace') {
        const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y)
        if (moved <= DRAG_THRESHOLD && !store().readOnly) placeGhost(e)
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
        // Same single-anchor snap as the live preview above, so the committed
        // position matches exactly what was drawn — see that block for why.
        let patches: Array<{ id: string; patch: { position: { x: number; z: number } } }> =
          d.ids.map((id) => ({ id, patch: { position: { x: d.orig.get(id)!.x, z: d.orig.get(id)!.z } } }))
        if (gp) {
          const dx = gp.x - d.startGround.x
          const dz = gp.z - d.startGround.z
          const anchor = d.orig.get(d.ids[0])!
          const snappedAnchor = snapWorld(anchor.x + dx, anchor.z + dz)
          const gdx = snappedAnchor.x - anchor.x
          const gdz = snappedAnchor.z - anchor.z
          patches = d.ids.map((id) => {
            const o = d.orig.get(id)!
            return { id, patch: { position: { x: o.x + gdx, z: o.z + gdz } } }
          })
        }
        useAppStore.getState().actions.updateInstances(patches)
        inst.clearLive()
        setCursor('grab')
        requestRender()
        return
      }
      if (d.kind === 'rotate') {
        const gp = lastGround
        let deltaDeg = 0
        if (gp) {
          const angleNowDeg = THREE.MathUtils.radToDeg(Math.atan2(gp.z - d.center.z, gp.x - d.center.x))
          deltaDeg = -(angleNowDeg - d.initialAngleDeg)
        }
        const patches = rotateGroupPatches(d.ids, d.center, deltaDeg, d.orig)
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
      const cells = ghostCells(asset, x, z, eng.ghostRot, eng.ghostMirror)
      const base = eng.levelOverride != null ? eng.levelOverride : surfaceTop(store().instances, assetMap(), collisionTable(t), cells)
      if (!validAtLevel(asset, x, z, eng.ghostRot, base, new Set(), eng.ghostMirror)) return

      const commit = () => {
        const id = useAppStore.getState().actions.addInstance({
          assetId, position: { x, z }, rotationDeg: eng.ghostRot, level: base,
          ...(eng.ghostMirror ? { mirrored: true } : {}),
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

    // Mirror whatever the M key would mirror: the ghost while placing, otherwise
    // the selection. Shared by the key handler and the on-screen buttons.
    function mirrorActive() {
      const eng = engine.current!
      const s = store()
      if (s.selectedAssetId) {
        eng.ghostMirror = !eng.ghostMirror
        ghost.setMirror(eng.ghostMirror)
        refreshGhost()
        requestRender()
      } else if (s.selectedInstanceIds.length) {
        s.actions.mirrorSelected()
        afterStateChange()
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

    // Rotate a set of pieces as ONE rigid body around `pivot`, by `deltaDeg` —
    // the same value added to each piece's own rotationDeg. Applying Three.js's
    // own Y-rotation convention to the position term too means a lone piece
    // (pivot = its own position, so relX/relZ = 0) reduces to a pure yaw
    // change — the old single-piece behaviour — while a fused group's members
    // orbit the pivot together and stay rigidly spaced instead of each piece
    // spinning in place around itself (which is what came out of alignment).
    // `origState`, when given, is a per-id snapshot to rotate FROM — a drag
    // recomputes the total delta from drag-start every frame (same pattern the
    // old rotationDeg-only math used); omitted, it reads the live store state.
    function rotateGroupPatches(
      ids: string[],
      pivot: { x: number; z: number },
      deltaDeg: number,
      origState?: Map<string, { x: number; z: number; rotationDeg: number }>,
    ): Array<{ id: string; patch: { position: { x: number; z: number }; rotationDeg: number } }> {
      const rad = THREE.MathUtils.degToRad(deltaDeg)
      const cos = Math.cos(rad), sin = Math.sin(rad)
      return ids.map((id) => {
        // During a drag, origState is provided and already has every id — the
        // store().instances.find() fallback below only actually runs for the
        // no-origState (keyboard/toolbar) call, not on every frame of a drag.
        const cached = origState?.get(id)
        const base = cached ?? (() => {
          const i = store().instances.find((ii) => ii.id === id)
          return { x: i?.position.x ?? pivot.x, z: i?.position.z ?? pivot.z, rotationDeg: i?.rotationDeg ?? 0 }
        })()
        const relX = base.x - pivot.x
        const relZ = base.z - pivot.z
        return {
          id,
          patch: {
            position: { x: pivot.x + relX * cos + relZ * sin, z: pivot.z - relX * sin + relZ * cos },
            rotationDeg: normDeg(base.rotationDeg + deltaDeg),
          },
        }
      })
    }

    /** Centre of a set of pieces (average position) — the natural pivot for
     *  rotating them as one rigid body. A single id's "group" is just itself,
     *  so this doubles as that piece's own position in the lone-selection case. */
    function groupCenter(ids: string[]): { x: number; z: number } | null {
      const list = ids
        .map((id) => store().instances.find((ii) => ii.id === id))
        .filter((i): i is NonNullable<typeof i> => !!i)
      if (!list.length) return null
      const x = list.reduce((sum, i) => sum + i.position.x, 0) / list.length
      const z = list.reduce((sum, i) => sum + i.position.z, 0) / list.length
      return { x, z }
    }

    function rotateSelection(dir: 1 | -1) {
      const step = rotationStep() * dir
      const ids = useAppStore.getState().selectedInstanceIds
      if (!ids.length) return
      const pivot = groupCenter(ids)
      if (!pivot) return
      const patches = rotateGroupPatches(ids, pivot, step)
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
      const step = Math.max(0.0005, t.gridSize / 16)
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
    // step is in levels: FINE_LEVEL_STEP for Alt+PgUp/PgDn, 1 for plain PgUp/PgDn.
    const FINE_LEVEL_STEP = 0.0625 // ~0.8mm at the default 12.7mm/level — matches nudgeSelection's XZ step
    function nudgeSelectionLevel(dir: 1 | -1, step = FINE_LEVEL_STEP) {
      const ids = useAppStore.getState().selectedInstanceIds
      if (!ids.length) return
      const patches = ids.map(id => {
        const i = store().instances.find(ii => ii.id === id)!
        const level = Math.max(0, (i.level ?? 0) + dir * step)
        return { id, patch: { level } }
      })
      useAppStore.getState().actions.updateInstances(patches)
      inst.setSelection(new Set(ids))
      requestRender()
    }

    // Show/hide/reposition the free-rotate gizmo for the current selection. A
    // single piece gets it around its own centre; a single FUSED GROUP (every
    // selected id shares one groupId — setSelectedInstances always expands to
    // whole groups, so that's the same as "is this selection one fused group")
    // gets it around the group's centre, so a stack can be free-rotated as one
    // rigid body instead of only the 90°/15° keyboard steps. An arbitrary
    // multi-select of unrelated pieces still has no single pivot that reads
    // clearly, so it gets nothing. Hidden while placing, sculpting, read-only,
    // mid-drag, or while Alt is held — Alt drives the fine-nudge/free-placement
    // mechanics (nudgeSelection, snap toggle) right where the arrows sit, so
    // they'd only get in the way of the thing Alt is for.
    function syncRotateHandle() {
      const s = store()
      const ids = s.selectedInstanceIds
      if (s.readOnly || s.terrainTool !== 'none' || s.selectedAssetId || !ids.length || engine.current!.drag.kind !== 'none' || s.altMomentary) {
        rotateHandle.hide()
        return
      }
      if (ids.length === 1) {
        const i = s.instances.find((ii) => ii.id === ids[0])
        const asset = i && assetMap().get(i.assetId)
        if (!i || !asset) { rotateHandle.hide(); return }
        const a = asset.aabb ?? { x: 0.2, y: 0.2, z: 0.2 }
        const radius = Math.max((Math.max(a.x, a.z) / 2) * 1.3, 0.05)
        const y = levelToY(i.level ?? 0) + terrainHeightAt(i.position.x, i.position.z) + 0.006
        rotateHandle.setTransform(i.position.x, y, i.position.z, radius)
        return
      }
      const members = ids.map((id) => s.instances.find((ii) => ii.id === id)).filter((i): i is NonNullable<typeof i> => !!i)
      const gid = members[0]?.groupId
      if (!gid || members.length !== ids.length || !members.every((m) => m.groupId === gid)) {
        rotateHandle.hide()
        return
      }
      // Reuse the already-resolved `members` for the centroid instead of
      // calling groupCenter(ids) — that would re-run its own O(ids × instances)
      // find() pass over the whole table for every member all over again.
      const pivot = {
        x: members.reduce((sum, m) => sum + m.position.x, 0) / members.length,
        z: members.reduce((sum, m) => sum + m.position.z, 0) / members.length,
      }
      // assetMap() rebuilds a Map over the WHOLE catalogue (assets + set
      // parts) — call it once for the group, not once per member. This runs
      // on every store tick while a fused group is selected (see the comment
      // above), so doing it per-member turned into a very expensive
      // O(group size × catalogue size) recompute on every tick and could
      // visibly stall the planner with a large catalogue or a big group.
      const am = assetMap()
      let radius = 0.05
      let topLevel = 0
      for (const m of members) {
        const asset = am.get(m.assetId)
        const a = asset?.aabb ?? { x: 0.2, y: 0.2, z: 0.2 }
        const pieceRadius = (Math.max(a.x, a.z) / 2) * 1.3
        radius = Math.max(radius, Math.hypot(m.position.x - pivot.x, m.position.z - pivot.z) + pieceRadius)
        topLevel = Math.max(topLevel, m.level ?? 0)
      }
      const y = levelToY(topLevel) + terrainHeightAt(pivot.x, pivot.z) + 0.006
      rotateHandle.setTransform(pivot.x, y, pivot.z, radius)
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

      if (e.key === 'Escape' && s.levelMarkerArmed) {
        s.setLevelMarkerArmed(false)
        return
      }
      if (e.key === 'Escape') {
        // Cancels a pending landform placement (and any landform selection).
        if (s.landformArmed) s.setLandformArmed(null)
        if (s.selectedFeatureId) s.setSelectedFeature(null)
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

      // Plain PgUp/PgDn with pieces selected: move them a whole level (½") per press.
      if (s.selectedInstanceIds.length && (e.key === 'PageUp' || e.key === 'PageDown')) {
        e.preventDefault()
        nudgeSelectionLevel(e.key === 'PageUp' ? 1 : -1, 1)
        return
      }

      if (k === 'r') {
        rotateActive(e.shiftKey ? -1 : 1)
        return
      }

      if (k === 'm') {
        mirrorActive()
        return
      }

      // Tilt the selected piece(s) about X (T) or sideways (Y) to stand up / lay
      // flat. Shift = opposite.
      if ((k === 't' || k === 'y') && s.selectedInstanceIds.length) {
        s.actions.tiltSelected(rotationStep() * (e.shiftKey ? -1 : 1), k === 'y' ? 'roll' : 'pitch')
        inst.setSelection(new Set(s.selectedInstanceIds))
        requestRender()
        return
      }

      if (k === 'g') { s.toggleSnapBaseline(); applySnapVisual(); return }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedFeatureId && !s.selectedInstanceIds.length) {
          s.actions.removeTerrainFeature(s.selectedFeatureId)
          return
        }
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
      inst.sync(s.instances, assetMap())
      inst.setSelection(new Set(s.selectedInstanceIds))
      syncRotateHandle()
      requestRender()
    }

    // ---- store subscriptions (decoupled from React render) ----
    const unsubInstances = useAppStore.subscribe((s, prev) => {
      if (s.instances !== prev.instances || s.assets !== prev.assets || s.setPartAssets !== prev.setPartAssets) {
        inst.sync(s.instances, assetMap())
        inst.setSelection(new Set(s.selectedInstanceIds))
        requestRender()
      }
      if (s.selectedInstanceIds !== prev.selectedInstanceIds) {
        inst.setSelection(new Set(s.selectedInstanceIds))
        requestRender()
      }
      if (s.modelColor !== prev.modelColor) {
        inst.setDefaultColor(s.modelColor)
        requestRender()
      }
      if (s.brightness !== prev.brightness) {
        applyBrightness(s.brightness)
        requestRender()
      }
      if (s.selectedAssetId !== prev.selectedAssetId) {
        const a = s.selectedAssetId ? getAssetById(s.selectedAssetId) : null
        if (a) ensureTemplate(a)
        ghost.setAsset(a ?? null)
        engine.current!.ghostRot = 0
        engine.current!.ghostMirror = false // ghost.setAsset cleared its mirror too
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
        syncFeatureMarkers()     // outlines follow the ground
      } else if (s.selectedFeatureId !== prev.selectedFeatureId) {
        syncFeatureMarkers()
      }
      if (s.table !== prev.table || s.historyIndex !== prev.historyIndex || s.terrainTool !== prev.terrainTool) editQueue.clear()
      if (s.landformDraft !== prev.landformDraft && s.landformDraft && engine.current!.lastPointer) {
        const point = engine.current!.lastPointer
        cursorQueue.enqueue(() => updateLandformPreview(point))
      }
      if (s.landformArmed !== prev.landformArmed) {
        cursorQueue.clear()
        hideLandformPreview()
        brushRing.visible = false
        setCursor(s.landformArmed ? 'crosshair' : (s.selectedAssetId ? 'cell' : 'default'))
      }
      if (s.paintRev !== prev.paintRev || s.paint !== prev.paint) {
        syncPaint()
      }
      if (s.levelMarkers !== prev.levelMarkers || s.table !== prev.table) {
        levelView.sync(s.levelMarkers, s.table)
        requestRender()
      }
      if (s.levelMarkerArmed !== prev.levelMarkerArmed) {
        cursorQueue.clear()
        levelView.setPreview(null, s.table)
        if (s.levelMarkerArmed) { cellHi.visible = false; brushRing.visible = false }
        setCursor(s.levelMarkerArmed ? 'crosshair' : (s.selectedAssetId ? 'cell' : 'default'))
        requestRender()
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
      disposed = true
      paintJobs.stop()
      paintWorker?.terminate()
      if (paintFallbackTimer !== undefined) clearTimeout(paintFallbackTimer)
      editQueue.clear()
      cursorQueue.clear()
      clearMarkers(featureGroup)
      clearMarkers(landformPreview)
      levelView.dispose()
      if (paintTex) Object.values(paintTex).forEach((texture) => texture.dispose())
      useAppStore.getState().setStageApi(null)
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
      {landformHint && <div role="status" className="tb-landform-preview-hint">{landformHint}</div>}
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
