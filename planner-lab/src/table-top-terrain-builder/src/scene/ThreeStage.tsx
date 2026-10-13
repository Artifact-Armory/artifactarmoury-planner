import { pathPaintChanged } from '../core/paintmap'
import { FrameQueue } from '../core/frameQueue'
import { defaultPhysicalDetail, type PhysicalDetail } from '../../../manufacturing/physicalDetails'
import { compositePathPaint } from '@core/paintmap'
import type { BattlefieldDocument } from '../../../manufacturing/document'
import { evaluateTerrainHeight } from '@core/terrainFeatures'
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
  surfaceTop, buildOccupied3D, collides3D, occupyUnitsAt, levelToY,
} from '@core/elevation'
import { buildTableMaterial, bakePaintOverlayCanvas, makePaintOverlayTexture } from '@core/tableMaterials'
import { buildTerrainGeometry, heightmapFitsTable, sampleHeight, createHeightmap } from '@core/heightmap'
import { paintFitsTable, isBlank as paintIsBlank } from '@core/paintmap'
import { FEATURE_DEFAULTS, type TerrainFeatureType } from '@core/terrainFeatures'
import {
  DITCH_DEFAULTS, ROAD_DEFAULTS, CLIFF_DEFAULTS, SHORELINE_DEFAULTS,
  distToPath, translatePath, isPathKind, type TerrainPath, type TerrainPathKind,
} from '@core/terrainPaths'

const FEATURE_COLOR: Record<TerrainFeatureType, number> = {
  hill: 0xffcc44,
  plateau: 0x6cc4ff,
}
// Colour + preview-tint per path kind. Bands (ditch/road) render a symmetric
// pair of edge rails; edges (cliff/shoreline) render one rail on the high side.
const PATH_COLOR: Record<TerrainPathKind, number> = {
  trench: 0xb89a70,
  ditch: 0xff6b4a, road: 0x9aa0a6, cliff: 0xb5793f, shoreline: 0x4fc3d9,
}
const PATH_PREVIEW_COLOR: Record<TerrainPathKind, number> = {
  trench: 0xd8ba90,
  ditch: 0xffa07a, road: 0xc7cbcf, cliff: 0xd9ab73, shoreline: 0x9fe3ee,
}
const PATH_IS_BAND: Record<TerrainPathKind, boolean> = {
  trench: true,
  ditch: true, road: true, cliff: false, shoreline: false,
}
/** Half-width of the drawing-preview footprint, using each kind's defaults (nothing is committed yet, so the actual path's own params don't exist). */
const PATH_PREVIEW_HALF: Record<TerrainPathKind, number> = {
  trench: 0.03,
  ditch: DITCH_DEFAULTS.channelWidth / 2 + DITCH_DEFAULTS.bermWidth,
  road: ROAD_DEFAULTS.channelWidth / 2 + ROAD_DEFAULTS.bermWidth,
  cliff: CLIFF_DEFAULTS.transitionWidth,
  shoreline: SHORELINE_DEFAULTS.transitionWidth,
}

const DRAG_THRESHOLD = 4 // px before a press becomes a drag

// `touch` marks a press made with a finger. A finger has no second button and no
// wheel, so on touch a drag that would box-select on desktop pans the camera
// instead — tap still places/selects, via the same movement threshold.
type LeftDrag =
  | { kind: 'moveDetail'; id:string; orig:{x:number;z:number}; start:THREE.Vector3; plane:THREE.Plane }
  | { kind: 'none' }
  | { kind: 'maybePlace'; x: number; y: number; touch: boolean }
  | { kind: 'maybe'; mode: 'piece' | 'box'; x: number; y: number; pieceId?: string; ground: THREE.Vector3 | null; additive: boolean; touch: boolean }
  | { kind: 'move'; startGround: THREE.Vector3; ids: string[]; orig: Map<string, { x: number; z: number }> }
  | { kind: 'moveFeature'; id: string; orig: { x: number; z: number } }
  | { kind: 'movePath'; id: string; startGround: { x: number; z: number }; lastGround: { x: number; z: number } }
  | { kind: 'box'; x: number; y: number; base: Set<string> }
  | { kind: 'pan'; x: number; y: number }

export function ThreeStage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [terrainQuality, setTerrainQuality] = useState('')
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
      return evaluateTerrainHeight(s.terrainFeatures,s.terrainPaths,s.terrainDetail,s.table,s.terraceStep,x,z)
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

    // Landform stamp markers — one ring per placed feature (hill/plateau/
    // depression), so they're visible and clickable even when not actively
    // placing a new one. Rebuilt (cheap — a handful of stamps, not the
    // per-vertex terrain mesh) whenever the feature list, selection, or
    // surface height changes.
    const featureGroup = new THREE.Group()
    scene.add(featureGroup)

    // Committed ditches + the live draw-in-progress preview — see syncPaths()
    // and updatePathPreview().
    const pathGroup = new THREE.Group()
    scene.add(pathGroup)
    const detailGroup=new THREE.Group(),detailGhost=new THREE.Group()
    scene.add(detailGroup,detailGhost)
    const pathPreviewGroup = new THREE.Group()
    scene.add(pathPreviewGroup)

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
      return s.terrainPaths.length > 0 || (paintFitsTable(s.paint, s.table) && !paintIsBlank(s.paint))
    }

    function buildTable() {
      const t = store().table
      const hm = store().heightmap
      const sculpted = !!(hm && heightmapFitsTable(hm, t))
      const painted = hasPaint()
      const geometries=new Set<THREE.BufferGeometry>()
      tableGroup.traverse(obj=>{const m=obj as THREE.Mesh;if(m.geometry)geometries.add(m.geometry);if(m.material)for(const mat of Array.isArray(m.material)?m.material:[m.material])mat.dispose()})
      geometries.forEach(g=>g.dispose());paintTex?.dispose()
      tableGroup.clear()
      terrainMesh = null
      terrainGeo = null
      paintMesh = null
      paintTex = null
      paintCanvas = null
      const mat = buildTableMaterial(store().tableMaterial, t)

      if (sculpted || painted || store().physicalDetails.length) {
        // World-space grid mesh (Y up), known UVs 0..1 for the paint overlay. Uses
        // the height field when sculpted, otherwise a flat field.
        const field = sculpted ? hm! : createHeightmap(t)
        const geo=buildTerrainGeometry(field,t)
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.y = 0 // Same surface used by placement sampling and manufacturing.
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
        plane.position.y = 0
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
      paintCanvas = bakePaintOverlayCanvas(compositePathPaint(s.paint,s.table,s.terrainPaths), s.table)
      paintTex = makePaintOverlayTexture(paintCanvas)
      const mat = new THREE.MeshStandardMaterial({
        map: paintTex,
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
        roughness: 0.95,
        metalness: 0,
        flatShading: !!geo.userData.hardTerrain,
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

    // Keep only the newest input and one outstanding worker job. Superseded replies
    // cannot replace a newer edit, undo, table resize, or completed interaction.
    const editQueue=new FrameQueue(),cursorQueue=new FrameQueue()
    let terrainFrame:number|null=null,terrainDirty=false,paintDirty=false,disposed=false
    let previewId=0,workerBusy=false,previewPending=false
    let previewWorker:Worker|null=new Worker(new URL('./terrainPreview.worker.ts',import.meta.url),{type:'module'})
    const isInteracting=()=>store().terrainInteractive||!!engine.current&&(engine.current.sculpting||engine.current.drag.kind==='moveDetail'||engine.current.drag.kind==='moveFeature'||engine.current.drag.kind==='movePath')
    function previewDocument():BattlefieldDocument {
      const state=store()
      return {schemaVersion:1,evaluatorVersion:3,physicalDetails:state.physicalDetails,units:'metres-y-up',id:'preview',name:'Preview',revision:0,seed:1,table:state.table,tableMaterial:state.tableMaterial,terrainFeatures:state.terrainFeatures,terrainPaths:state.terrainPaths,terrainDetail:state.terrainDetail?{...state.terrainDetail,heights:Array.from(state.terrainDetail.heights)}:null,terraceStep:state.terraceStep,paint:null,instances:[],print:state.printProfile}
    }
    function sendPreview() {
      if(disposed||workerBusy||!previewPending||!previewWorker)return
      workerBusy=true;previewPending=false
      previewWorker.postMessage({id:previewId,doc:previewDocument(),interactive:isInteracting()})
    }
    function installPreview(data:{position:Float32Array;normal:Float32Array;uv:Float32Array;index:Uint16Array|Uint32Array;hard:boolean}) {
      if(!terrainMesh)return
      const geo=new THREE.BufferGeometry()
      geo.setAttribute('position',new THREE.BufferAttribute(data.position,3));geo.setAttribute('normal',new THREE.BufferAttribute(data.normal,3))
      geo.setAttribute('uv',new THREE.BufferAttribute(data.uv,2));geo.setAttribute('uv2',geo.getAttribute('uv'));geo.setIndex(new THREE.BufferAttribute(data.index,1));geo.userData.hardTerrain=data.hard
      geo.computeBoundingSphere()
      const old=terrainGeo;terrainGeo=geo;terrainMesh.geometry=geo
      const material=terrainMesh.material as THREE.MeshStandardMaterial
      if(material.flatShading!==data.hard){material.flatShading=data.hard;material.needsUpdate=true}
      if(paintMesh){paintMesh.geometry=geo;const m=paintMesh.material as THREE.MeshStandardMaterial;if(m.flatShading!==data.hard){m.flatShading=data.hard;m.needsUpdate=true}}
      old?.dispose();requestRender()
    }
    previewWorker.onmessage=event=>{
      workerBusy=false
      const data=event.data
      if(!disposed&&data.id===previewId) {
        if(data.error) {buildTable();setTerrainQuality('Reduced preview — detailed rebuild failed')}
        else {installPreview(data);setTerrainQuality(data.interactive?'Reduced quality while editing':'')}
      }
      sendPreview()
    }
    previewWorker.onerror=()=>{
      previewWorker?.terminate();previewWorker=null;workerBusy=false
      setTerrainQuality('Reduced preview — worker unavailable')
      buildTable()
    }
    function queueTerrainSync(surface=true,paint=false) {
      terrainDirty ||= surface;paintDirty ||= paint
      if(surface){previewId++;previewPending=true}
      if(terrainFrame!==null)return
      terrainFrame=requestAnimationFrame(()=>{
        terrainFrame=null
        const surfaceChanged=terrainDirty,paintChanged=paintDirty;terrainDirty=false;paintDirty=false
        if(surfaceChanged){syncTerrain();inst.refreshTransforms();syncFeatureMarkers();syncPaths()}
        if(paintChanged)syncPaint()
        requestRender()
      })
    }
    function syncTerrain() {
      const s=store(),needsGrid=!!s.heightmap||hasPaint()||s.physicalDetails.length>0
      if(needsGrid!==!!terrainMesh)buildTable()
      if(previewWorker)sendPreview()
      else buildTable()
    }
    function finishTerrainInput() {
      editQueue.flush()
      // Ending interaction requests the 10 mm / exact-boundary worker preview.
      queueTerrainSync()
    }
    function clearMarkers(group:THREE.Group) {
      group.traverse(obj=>{const m=obj as THREE.Mesh;if(m.geometry)m.geometry.dispose();if(m.material)for(const mat of Array.isArray(m.material)?m.material:[m.material])mat.dispose()})
      group.clear()
    }

    // Re-bake the painted overlay after a paint stroke (or when it appears/clears).
    function syncPaint() {
      const painted = hasPaint()
      if (painted !== !!paintMesh) {
        buildTable() // add/remove the overlay (and switch flat plane ↔ grid mesh)
        queueTerrainSync() // restore exact boundaries after replacing the shared mesh
      } else if (painted && paintCanvas && paintTex) {
        bakePaintOverlayCanvas(compositePathPaint(store().paint,store().table,store().terrainPaths), store().table, paintCanvas)
        paintTex.needsUpdate = true
      }
      requestRender()
    }

    // Apply the active brush at the ground point under the cursor. Height tools
    // sculpt the field; paint/erase tools stamp the texture overlay. A changed dab
    // flags the stroke so pointer-up records one undo step.
    function sculptAt(e: { clientX: number; clientY: number }) {
      const point={clientX:e.clientX,clientY:e.clientY},tool=store().terrainTool
      editQueue.enqueue(()=>{
        if(!engine.current||store().terrainTool!==tool)return
        const start=performance.now()
        applySculptAt(point)
        updateBrushRing(point)
        if(performance.now()-start>16.7)setTerrainQuality('Reduced quality while editing')
      })
    }
    function applySculptAt(e: { clientX: number; clientY: number }) {
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
      // While a point-stamp landform (hill/plateau) is armed, the same ring
      // previews its footprint (radius + colour) at the point it'll be placed
      // — one less concept to learn than a second cursor indicator. A drawn
      // path (ditch/road/cliff/shoreline) has its own preview
      // (updatePathPreview) instead of this ring.
      const armed = !isPathKind(s.landformArmed) ? s.landformArmed : null
      const active = s.terrainTool !== 'none' || !!armed
      const gp = active ? groundPoint(e) : null
      if (!gp) { if (brushRing.visible) { brushRing.visible = false; requestRender() } return }
      const radius = armed ? FEATURE_DEFAULTS[armed].radius : s.brushRadius
      const color = armed ? FEATURE_COLOR[armed] : 0xffcc44
      ;(brushRing.material as THREE.MeshBasicMaterial).color.setHex(color)
      brushRing.position.set(gp.x, gp.y + 0.03, gp.z)
      brushRing.scale.set(radius, radius, radius)
      brushRing.visible = true
      requestRender()
    }

    /** Offset each point of a polyline perpendicular to its local direction (unmitered — fine for a preview/outline at this segment count). */
    function perpOffset(points: Array<{ x: number; z: number }>, offset: number): Array<{ x: number; z: number }> {
      const n = points.length
      return points.map((p, i) => {
        const prev = points[Math.max(0, i - 1)]
        const next = points[Math.min(n - 1, i + 1)]
        const dx = next.x - prev.x, dz = next.z - prev.z
        const len = Math.hypot(dx, dz) || 1
        return { x: p.x + (-dz / len) * offset, z: p.z + (dx / len) * offset }
      })
    }

    function pointsToWorld(points: Array<{ x: number; z: number }>, s: ReturnType<typeof store>, yOffset: number): THREE.Vector3[] {
      return points.map((p) => new THREE.Vector3(p.x, evaluateTerrainHeight(s.terrainFeatures,s.terrainPaths,s.terrainDetail,s.table,s.terraceStep,p.x,p.z) + yOffset, p.z))
    }

    function buildPathLine(pts: THREE.Vector3[], color: number, opacity: number, dashed: boolean): THREE.Line {
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.03, gapSize: 0.02, depthTest: false })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false })
      const line = new THREE.Line(geo, mat)
      if (dashed) line.computeLineDistances()
      line.renderOrder = 9
      return line
    }

    function pointDot(p: { x: number; z: number }, s: ReturnType<typeof store>, color: number, opacity: number, yOffset: number): THREE.Mesh {
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.022, 16),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false }),
      )
      dot.rotation.x = -Math.PI / 2
      dot.position.set(p.x, evaluateTerrainHeight(s.terrainFeatures,s.terrainPaths,s.terrainDetail,s.table,s.terraceStep,p.x,p.z) + yOffset, p.z)
      dot.renderOrder = 10
      return dot
    }

    /** Nearest committed path whose footprint (+ a little slack) contains the world point, or null. */
    function pickPathAt(gp: THREE.Vector3 | null): string | null {
      if (!gp) return null
      const { terrainPaths } = store()
      const slack = 0.08
      let best: { id: string; dist: number } | null = null
      for (const p of terrainPaths) {
        const d = distToPath(p.points, gp.x, gp.z)
        const threshold = (PATH_IS_BAND[p.kind] ? p.channelWidth / 2 + p.bermWidth : p.transitionWidth) + slack
        if (d <= threshold && (!best || d < best.dist)) best = { id: p.id, dist: d }
      }
      return best?.id ?? null
    }

    // Rebuild committed-path outlines. Band kinds (ditch/road): a dashed
    // centreline + two rails at the core's edges (channelWidth/2 either
    // side). Edge kinds (cliff/shoreline): a solid centreline (it's a
    // permanent boundary, not a hollow channel) + one dashed rail on the
    // HIGH side marking where the ramp finishes (offset by transitionWidth,
    // using highSide so it lands on the same side edgeContribution() treats
    // as high — see nearestSegmentSide's doc comment). All follow the actual
    // sampled surface so they hug the real (raised/ramped) terrain.
    let markerPaths:ReturnType<typeof store>['terrainPaths']|null=null,markerPathSelection:string|null=null
    function syncPaths() {
      const s = store()
      if(markerPaths===s.terrainPaths&&markerPathSelection===s.selectedPathId) {
        pathGroup.traverse(obj=>{
          if(obj instanceof THREE.Line) {
            const pos=obj.geometry.getAttribute('position') as THREE.BufferAttribute
            const offsets=obj.userData.surfaceOffsets as number[]
            for(let i=0;i<pos.count;i++)pos.setY(i,evaluateTerrainHeight(s.terrainFeatures,s.terrainPaths,s.terrainDetail,s.table,s.terraceStep,pos.getX(i),pos.getZ(i))+offsets[i])
            pos.needsUpdate=true;obj.geometry.computeBoundingSphere();if(obj.material instanceof THREE.LineDashedMaterial)obj.computeLineDistances()
          } else if(obj instanceof THREE.Mesh) obj.position.y=evaluateTerrainHeight(s.terrainFeatures,s.terrainPaths,s.terrainDetail,s.table,s.terraceStep,obj.position.x,obj.position.z)+obj.userData.surfaceOffset
        })
        return
      }
      markerPaths=s.terrainPaths;markerPathSelection=s.selectedPathId
      clearMarkers(pathGroup)
      for (const p of s.terrainPaths) {
        if (p.points.length < 2) continue
        const selected = s.selectedPathId === p.id
        if(!selected)continue
        const color = PATH_COLOR[p.kind]
        if (PATH_IS_BAND[p.kind]) {
          pathGroup.add(buildPathLine(pointsToWorld(p.points, s, 0.016), color, selected ? 1 : 0.55, true))
          const half = p.channelWidth / 2
          pathGroup.add(buildPathLine(pointsToWorld(perpOffset(p.points, half), s, 0.015), color, selected ? 0.9 : 0.4, false))
          pathGroup.add(buildPathLine(pointsToWorld(perpOffset(p.points, -half), s, 0.015), color, selected ? 0.9 : 0.4, false))
        } else {
          pathGroup.add(buildPathLine(pointsToWorld(p.points, s, 0.016), color, selected ? 1 : 0.6, false))
          const crest = perpOffset(p.points, p.highSide * p.transitionWidth)
          pathGroup.add(buildPathLine(pointsToWorld(crest, s, 0.015), color, selected ? 0.85 : 0.35, true))
          for (const pt of crest) pathGroup.add(pointDot(pt, s, color, selected ? 0.7 : 0.3, 0.016))
        }
        for (const pt of p.points) pathGroup.add(pointDot(pt, s, color, selected ? 0.95 : 0.5, 0.017))
      }
      pathGroup.traverse(obj=>{
        if(obj instanceof THREE.Line){const pos=obj.geometry.getAttribute('position') as THREE.BufferAttribute;obj.userData.surfaceOffsets=Array.from({length:pos.count},(_,i)=>pos.getY(i)-evaluateTerrainHeight(s.terrainFeatures,s.terrainPaths,s.terrainDetail,s.table,s.terraceStep,pos.getX(i),pos.getZ(i)))}
        else if(obj instanceof THREE.Mesh)obj.userData.surfaceOffset=obj.position.y-evaluateTerrainHeight(s.terrainFeatures,s.terrainPaths,s.terrainDetail,s.table,s.terraceStep,obj.position.x,obj.position.z)
      })
    }

    // Live preview while drawing a path — never touches terrainPaths/the
    // heightmap, just shows where it'll go (centreline + footprint at the
    // armed kind's default width) from the placed points out to the live
    // cursor. Bands preview both edges; edges (cliff/shoreline) preview just
    // the default high-side rail (highSide defaults to +1 until committed).
    function updatePathPreview(e: { clientX: number; clientY: number } | null) {
      const s = store()
      clearMarkers(pathPreviewGroup)
      if (!isPathKind(s.landformArmed)) { requestRender(); return }
      const kind = s.landformArmed
      const color = PATH_PREVIEW_COLOR[kind]
      const gp = e ? groundPoint(e) : null
      const drawn = s.pathDrawing?.points ?? []
      const preview = gp ? [...drawn, { x: gp.x, z: gp.z }] : drawn
      if (preview.length >= 2) {
        pathPreviewGroup.add(buildPathLine(pointsToWorld(preview, s, 0.02), color, 0.9, true))
        const half = PATH_PREVIEW_HALF[kind]
        if (PATH_IS_BAND[kind]) {
          pathPreviewGroup.add(buildPathLine(pointsToWorld(perpOffset(preview, half), s, 0.019), color, 0.4, false))
          pathPreviewGroup.add(buildPathLine(pointsToWorld(perpOffset(preview, -half), s, 0.019), color, 0.4, false))
        } else {
          pathPreviewGroup.add(buildPathLine(pointsToWorld(perpOffset(preview, half), s, 0.019), color, 0.4, true))
        }
      }
      for (const pt of drawn) pathPreviewGroup.add(pointDot(pt, s, color, 0.95, 0.021))
      if (gp) pathPreviewGroup.add(pointDot({ x: gp.x, z: gp.z }, s, color, 0.9, 0.021))
      requestRender()
    }

    /** Nearest placed stamp whose footprint contains the world point, or null. */
    function pickFeatureAt(gp: THREE.Vector3 | null): string | null {
      if (!gp) return null
      const { terrainFeatures } = store()
      let best: { id: string; dist: number } | null = null
      for (const f of terrainFeatures) {
        const dist = Math.hypot(f.x - gp.x, f.z - gp.z)
        if (dist <= f.radius && (!best || dist < best.dist)) best = { id: f.id, dist }
      }
      return best?.id ?? null
    }

    // Rebuild the stamp marker rings. Called whenever the feature list, the
    // selection, or the composited surface (which the rings sit just above)
    // changes — see queueTerrainSync and the selectedFeatureId subscription.
    let markerFeatures:ReturnType<typeof store>['terrainFeatures']|null=null,markerFeatureSelection:string|null=null
    function syncFeatureMarkers() {
      const s = store()
      if(markerFeatures===s.terrainFeatures&&markerFeatureSelection===s.selectedFeatureId){
        for(const obj of featureGroup.children)obj.position.y=evaluateTerrainHeight(s.terrainFeatures,s.terrainPaths,s.terrainDetail,s.table,s.terraceStep,obj.position.x,obj.position.z)+obj.userData.surfaceOffset
        return
      }
      markerFeatures=s.terrainFeatures;markerFeatureSelection=s.selectedFeatureId
      clearMarkers(featureGroup)
      for (const f of s.terrainFeatures) {
        const selected = s.selectedFeatureId === f.id
        if(!selected)continue
        const color = FEATURE_COLOR[f.type]
        const y = evaluateTerrainHeight(s.terrainFeatures,s.terrainPaths,s.terrainDetail,s.table,s.terraceStep,f.x,f.z) + 0.015
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(f.radius * 0.94, f.radius, 48),
          new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: selected ? 0.95 : 0.5,
            side: THREE.DoubleSide, depthTest: false,
          }),
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.set(f.x, y, f.z)
        ring.userData.surfaceOffset=0.015
        ring.renderOrder = 9
        featureGroup.add(ring)
        if (selected) {
          const dot = new THREE.Mesh(
            new THREE.CircleGeometry(Math.min(0.035, f.radius * 0.15), 24),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }),
          )
          dot.rotation.x = -Math.PI / 2
          dot.position.set(f.x, y + 0.001, f.z)
          dot.userData.surfaceOffset=0.016
          dot.renderOrder = 9
          featureGroup.add(dot)
        }
      }
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
      // Sculpted tables: hit-test the actual raised/lowered surface, not the flat
      // y=0 plane. Without this the brush ring (and the point a dab lands at)
      // drifts away from what's visually under the cursor as terrain gets taller —
      // worst exactly when sculpting hills, the main use case. Flat tables (no
      // terrainMesh) fall through to the plane test unchanged.
      if (terrainMesh) {
        const hits = raycaster.intersectObject(terrainMesh, false)
        if (hits.length) return hits[0].point
      }
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

    function detailOutline(f:PhysicalDetail,group:THREE.Group,color:number) {
      clearMarkers(group)
      const box=new THREE.BoxGeometry(f.length/1000,Math.max(f.height,2)/1000,f.width/1000)
      const edges=new THREE.EdgesGeometry(box);box.dispose()
      const wire=new THREE.LineSegments(edges,new THREE.LineBasicMaterial({color,depthTest:false,transparent:true,opacity:0.9}))
      const cut=f.kind==='crack'||f.kind==='pothole'
      wire.position.set(f.x,terrainHeightAt(f.x,f.z)+(f.elevation+(cut?-f.height/2:f.height/2))/1000,f.z)
      wire.rotation.y=-f.rotation*Math.PI/180;wire.renderOrder=11;group.add(wire)
    }
    function syncDetails() {
      const s=store(),f=s.physicalDetails.find(f=>f.id===s.selectedDetailId)
      if(f)detailOutline(f,detailGroup,0xffcc44);else clearMarkers(detailGroup)
      if(!s.detailArmed)clearMarkers(detailGhost)
    }
    function updateDetailGhost(e:{clientX:number;clientY:number}) {
      const s=store();if(!s.detailArmed)return
      const gp=groundPoint(e);if(!gp)return
      detailOutline({...defaultPhysicalDetail(s.detailArmed),...snapWorld(gp.x,gp.z)},detailGhost,0x44d07a)
      setCursor('crosshair');requestRender()
    }
    function pickDetail(gp:THREE.Vector3|null) {
      if(!gp)return null
      return [...store().physicalDetails].reverse().find(f=>{
        const a=f.rotation*Math.PI/180,dx=(gp.x-f.x)*1000,dz=(gp.z-f.z)*1000
        const x=dx*Math.cos(a)+dz*Math.sin(a),z=-dx*Math.sin(a)+dz*Math.cos(a)
        return Math.abs(x)<=f.length/2+2&&Math.abs(z)<=f.width/2+2
      })??null
    }
    function onBranchPointerDown(e:PointerEvent) {
      const s=store();if(e.button!==1||s.readOnly||s.pathDrawing)return
      const p=s.terrainPaths.find(p=>p.id===s.selectedPathId)
      if(!p||!['trench','ditch','shoreline'].includes(p.kind))return
      const rect=renderer.domElement.getBoundingClientRect()
      let best=14,index=-1
      p.points.forEach((pt,i)=>{
        const v=new THREE.Vector3(pt.x,terrainHeightAt(pt.x,pt.z)+0.017,pt.z).project(camera)
        if(v.z<-1||v.z>1)return
        const distance=Math.hypot(rect.left+(v.x+1)*rect.width/2-e.clientX,rect.top+(1-v.y)*rect.height/2-e.clientY)
        if(distance<best){best=distance;index=i}
      })
      if(index<0)return
      e.preventDefault();e.stopImmediatePropagation()
      s.actions.startPathBranch(p.id,index);requestRender()
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
      const s=store(),drag=engine.current!.drag
      if(s.terrainTool!=='none'||s.landformArmed||s.detailArmed||drag.kind==='moveDetail'||drag.kind==='moveFeature'||drag.kind==='movePath')return
      lastGround = groundPoint(e)
    }

    // Abandon whatever left-button/finger drag is in flight (a second finger just
    // landed, so the camera owns the gesture now).
    function cancelDrag() {
      const eng = engine.current!
      editQueue.flush()
      if(eng.drag.kind==='moveDetail') {
        const drag=eng.drag,f=store().physicalDetails.find(f=>f.id===drag.id)
        if(f&&(f.x!==drag.orig.x||f.z!==drag.orig.z))store().actions.commitHistory()
      }
      if (eng.drag.kind === 'move') inst.clearLive()
      if (eng.drag.kind === 'box') setBoxRect(null)
      eng.drag = { kind: 'none' }
      // A second finger also ends a terrain stroke — pointerup is swallowed while
      // the gesture latch is set, so close the undo step here or the brush would
      // stay "down" and keep sculpting after the pinch.
      if (eng.sculpting) {
        finishTerrainInput()
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
      if(s.detailArmed) {
        const gp=groundPoint(e);if(gp){const pos=snapWorld(gp.x,gp.z);s.placeDetail(pos.x,pos.z)}
        requestRender();return
      }
      if (s.terrainTool !== 'none') {
        eng.sculpting = true
        eng.strokeChanged = false
        sculptAt(e)
        return
      }

      // A path tool (ditch/road/cliff/shoreline) is armed: Manor-Lords-road
      // style — every click adds a point to the path being drawn; Finish/
      // Enter (in the panel, or the keydown handler) commits it. Stays armed
      // across clicks (unlike hill/plateau below).
      if (isPathKind(s.landformArmed)) {
        const gp = groundPoint(e)
        if (gp) store().actions.addPathPoint(gp.x, gp.z)
        requestRender()
        return
      }
      // A point-stamp landform is armed: this click places one (single-shot —
      // arming clears itself so a placement is always a deliberate,
      // individually-editable action rather than a spray of stamps).
      if (s.landformArmed) {
        const gp = groundPoint(e)
        if (gp) store().actions.addTerrainFeature(s.landformArmed, gp.x, gp.z)
        useAppStore.getState().setLandformArmed(null)
        requestRender()
        return
      }

      if (s.selectedAssetId) {
        eng.drag = { kind: 'maybePlace', x: e.clientX, y: e.clientY, touch }
        return
      }
      const pieceId = pickPiece(e)
      const gp = groundPoint(e)
      const detail=pickDetail(gp)
      if(detail&&gp&&!pieceId) {
        s.selectDetail(detail.id)
        eng.drag={kind:'moveDetail',id:detail.id,orig:{x:detail.x,z:detail.z},start:gp.clone(),plane:new THREE.Plane(new THREE.Vector3(0,1,0),-gp.y)}
        setCursor('grab');requestRender();return
      }
      if (pieceId) {
        useAppStore.getState().setSelectedFeature(null)
        useAppStore.getState().setSelectedPath(null)
        const additive = e.shiftKey
        const sel = new Set(s.selectedInstanceIds)
        if (additive) {
          sel.has(pieceId) ? sel.delete(pieceId) : sel.add(pieceId)
          useAppStore.getState().setSelectedInstances([...sel])
        } else if (!sel.has(pieceId)) {
          useAppStore.getState().setSelectedInstances([pieceId])
        }
        inst.setSelection(new Set(useAppStore.getState().selectedInstanceIds))
        eng.drag = { kind: 'maybe', mode: 'piece', x: e.clientX, y: e.clientY, pieceId, ground: gp, additive, touch }
      } else {
        // Not armed, no piece under the cursor: a placed stamp or ditch here
        // is selected (and immediately draggable) instead of falling through
        // to box-select. Existing model-piece behaviour above is untouched.
        const featureId = s.terrainFeatures.length ? pickFeatureAt(gp) : null
        const pathId = !featureId && s.terrainPaths.length ? pickPathAt(gp) : null
        if (featureId) {
          const f = s.terrainFeatures.find(ff => ff.id === featureId)!
          useAppStore.getState().setSelectedFeature(featureId)
          useAppStore.getState().setSelectedInstances([]) // Delete/Backspace below is unambiguous
          inst.setSelection(new Set())
          eng.drag = { kind: 'moveFeature', id: featureId, orig: { x: f.x, z: f.z } }
        } else if (pathId && gp) {
          useAppStore.getState().setSelectedPath(pathId)
          useAppStore.getState().setSelectedInstances([])
          inst.setSelection(new Set())
          eng.drag = { kind: 'movePath', id: pathId, startGround: { x: gp.x, z: gp.z }, lastGround: { x: gp.x, z: gp.z } }
        } else {
          useAppStore.setState({selectedDetailId:null,selectedFeatureId:null,selectedPathId:null})
          eng.drag = { kind: 'maybe', mode: 'box', x: e.clientX, y: e.clientY, ground: gp, additive: e.shiftKey, touch }
        }
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
        if (!eng.sculpting) {
          const point={clientX:e.clientX,clientY:e.clientY}
          cursorQueue.enqueue(()=>updateBrushRing(point))
        }
        if (eng.sculpting && (e.buttons & 1)) sculptAt(e)
        return
      }
      // Landform tool armed: preview where/how big it'll be placed. A path
      if(store().detailArmed) {
        if(overCanvas){const point={clientX:e.clientX,clientY:e.clientY};cursorQueue.enqueue(()=>updateDetailGhost(point))}
        else {clearMarkers(detailGhost);requestRender()}
        return
      }
      // tool draws a path preview (from the last click to the cursor); hill/
      // plateau show the brush-style radius ring.
      if (isPathKind(store().landformArmed)) {
        if (overCanvas) {const point={clientX:e.clientX,clientY:e.clientY};cursorQueue.enqueue(()=>updatePathPreview(point))}
        return
      }
      if (store().landformArmed) {
        if (overCanvas) {const point={clientX:e.clientX,clientY:e.clientY};cursorQueue.enqueue(()=>updateBrushRing(point))}
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
      } else if(eng.drag.kind==='moveDetail') {
        const point={clientX:e.clientX,clientY:e.clientY}
        editQueue.enqueue(()=>{
          const drag=eng.drag;if(drag.kind!=='moveDetail')return
          raycaster.setFromCamera(ndc(point,ndcTmp),camera)
          const hit=raycaster.ray.intersectPlane(drag.plane,new THREE.Vector3());if(!hit)return
          const pos=snapWorld(drag.orig.x+hit.x-drag.start.x,drag.orig.z+hit.z-drag.start.z)
          store().moveDetailLive(drag.id,pos.x,pos.z)
        });setCursor('grabbing')
      } else if (eng.drag.kind === 'moveFeature' || eng.drag.kind === 'movePath') {
        const point={clientX:e.clientX,clientY:e.clientY}
        editQueue.enqueue(()=>{
          const drag=eng.drag
          if(drag.kind!=='moveFeature'&&drag.kind!=='movePath')return
          const gp=groundPoint(point);if(!gp)return
          const start=performance.now()
          if(drag.kind==='moveFeature')store().actions.updateTerrainFeatureLive(drag.id,{x:gp.x,z:gp.z})
          else {store().actions.moveTerrainPathLive(drag.id,gp.x-drag.lastGround.x,gp.z-drag.lastGround.z);eng.drag={...drag,lastGround:{x:gp.x,z:gp.z}}}
          if(performance.now()-start>16.7)setTerrainQuality('Reduced quality while editing')
        })
        setCursor('grabbing')
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
        finishTerrainInput()
        eng.sculpting = false
        // Record the whole stroke as one undoable step (terrain + paint are in the
        // same timeline as placement).
        if (eng.strokeChanged) { store().actions.commitHistory(); eng.strokeChanged = false }
        return
      }
      editQueue.flush()
      const d = eng.drag
      eng.drag = { kind: 'none' }
      if(d.kind==='moveFeature'||d.kind==='movePath'||d.kind==='moveDetail')queueTerrainSync()

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
      if(d.kind==='moveDetail') {
        const f=store().physicalDetails.find(f=>f.id===d.id)
        if(f&&(f.x!==d.orig.x||f.z!==d.orig.z))store().actions.commitHistory()
        setCursor('grab');requestRender();return
      }
      if (d.kind === 'moveFeature') {
        // A plain click (no actual movement) just leaves the stamp selected —
        // don't clutter undo with a no-op "move".
        const f = store().terrainFeatures.find(ff => ff.id === d.id)
        if (f && (f.x !== d.orig.x || f.z !== d.orig.z)) store().actions.commitHistory()
        setCursor('grab')
        requestRender()
        return
      }
      if (d.kind === 'movePath') {
        if (d.lastGround.x !== d.startGround.x || d.lastGround.z !== d.startGround.z) {
          store().actions.commitHistory()
        }
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

    // The OS can take a touch away mid-gesture (iOS edge swipe, app switcher).
    // Treat it as a hard reset so nothing is left half-dragged.
    function onPointerCancel(e: PointerEvent) {
      const eng = engine.current!
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
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); editQueue.clear(); eng.sculpting=false; eng.strokeChanged=false; s.actions.undo(); afterStateChange(); return }
        if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); editQueue.clear(); eng.sculpting=false; eng.strokeChanged=false; s.actions.redo(); afterStateChange(); return }
        if (k === 'd' && s.selectedInstanceIds.length) {
          e.preventDefault()
          const ids = s.actions.duplicateInstances(s.selectedInstanceIds)
          inst.markPopped(ids)
          afterStateChange()
          return
        }
        return
      }

      // Path drawing: Enter/Return commits the path (Manor-Lords-road style —
      // click, click, click, then confirm), Backspace un-does the last point,
      // Escape abandons the whole draw. Checked before the generic Escape
      // handler below so it doesn't also clear placement/selection.
      if (isPathKind(s.landformArmed)) {
        if (e.key === 'Enter') { e.preventDefault(); s.actions.finishPathDraw(); return }
        if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); s.actions.undoLastPathPoint(); return }
        if (e.key === 'Escape') { s.actions.cancelPathDraw(); return }
      }

      if (e.key === 'Escape') {
        useAppStore.setState({detailArmed:null,selectedDetailId:null,selectedFeatureId:null,selectedPathId:null})
        if (s.selectedAssetId) { useAppStore.getState().setSelectedAsset(null); ghost.setAsset(null); cellHi.visible = false }
        else { useAppStore.getState().setSelectedInstances([]); inst.setSelection(new Set()) }
        eng.levelOverride = null
        useAppStore.getState().setPlacement(0, false)
        requestRender()
        return
      }

      // Delete a selected ditch/stamp (mirrors the instance-delete key below).
      if((e.key==='Delete'||e.key==='Backspace')&&s.selectedDetailId) {
        e.preventDefault();s.setPhysicalDetails(s.physicalDetails.filter(f=>f.id!==s.selectedDetailId));s.selectDetail(null);return
      }
      if(k==='r'&&s.selectedDetailId) {
        e.preventDefault();s.setPhysicalDetails(s.physicalDetails.map(f=>f.id===s.selectedDetailId?{...f,rotation:(f.rotation+(e.shiftKey?-15:15)+360)%360}:f));return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedPathId) {
        s.actions.removeTerrainPath(s.selectedPathId)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedFeatureId) {
        s.actions.removeTerrainFeature(s.selectedFeatureId)
        return
      }

      // PageUp/PageDown: manually raise/lower the placement level (override auto-surface).
      if ((e.key === 'PageUp' || e.key === 'PageDown') && s.selectedAssetId) {
        e.preventDefault()
        nudgeLevel(e.key === 'PageUp' ? 1 : -1)
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
        queueTerrainSync()
        requestRender()
      }
      if (s.terrainRev !== prev.terrainRev || s.heightmap !== prev.heightmap || s.terrainInteractive !== prev.terrainInteractive) {
        queueTerrainSync()
      }
      if(s.physicalDetails!==prev.physicalDetails||s.selectedDetailId!==prev.selectedDetailId||s.detailArmed!==prev.detailArmed||s.terrainRev!==prev.terrainRev) {syncDetails();requestRender()}
      if(s.detailArmed!==prev.detailArmed){setCursor(s.detailArmed?'crosshair':'default');if(s.detailArmed)brushRing.visible=false}
      if (s.paintRev !== prev.paintRev || s.paint !== prev.paint || pathPaintChanged(prev.terrainPaths,s.terrainPaths)) {
        queueTerrainSync(false,true)
      }
      if(s.table!==prev.table||s.historyIndex!==prev.historyIndex||s.terrainTool!==prev.terrainTool)editQueue.clear()
      if (s.terrainTool !== prev.terrainTool) {
        // Entering/leaving sculpt mode: hide the brush ring + set the cursor.
        if (s.terrainTool === 'none') brushRing.visible = false
        setCursor(s.terrainTool !== 'none' ? 'crosshair' : (s.selectedAssetId ? 'cell' : 'default'))
        requestRender()
      }
      if (s.landformArmed !== prev.landformArmed) {
        if (!isPathKind(s.landformArmed)) brushRing.visible = false
        if (!isPathKind(s.landformArmed)) clearMarkers(pathPreviewGroup)
        setCursor(s.landformArmed ? 'crosshair' : (s.selectedAssetId ? 'cell' : 'default'))
        requestRender()
      }
      if (s.selectedFeatureId !== prev.selectedFeatureId) {
        syncFeatureMarkers()
        requestRender()
      }
      if (s.selectedPathId !== prev.selectedPathId) {
        syncPaths()
        requestRender()
      }
      if (s.pathDrawing !== prev.pathDrawing) {
        updatePathPreview(engine.current!.lastPointer)
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

    buildTable()
    syncFeatureMarkers()
    syncPaths()
    syncDetails()
    applySnapVisual()
    cam.home(tableBox())
    // Seed a baseline undo snapshot so the first placement/sculpt/paint is undoable.
    store().actions.ensureInitialHistory()
    requestRender()
    queueTerrainSync()

    // ---- listeners ----
    const dom = renderer.domElement
    dom.addEventListener('pointerdown', onPointerDown)
    dom.addEventListener('pointerdown', onBranchPointerDown, true)
    window.addEventListener('pointermove', trackGround)
    window.addEventListener('pointermove', onPointerMoveLeft)
    window.addEventListener('pointerup', onPointerUpLeft)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      disposed=true;editQueue.clear();cursorQueue.clear();if(terrainFrame!==null)cancelAnimationFrame(terrainFrame);previewWorker?.terminate()
      clearMarkers(featureGroup);clearMarkers(pathGroup);clearMarkers(pathPreviewGroup)
      clearMarkers(detailGroup);clearMarkers(detailGhost)
      ro.disconnect()
      unsubInstances()
      unsubLoading()
      dom.removeEventListener('pointerdown', onPointerDown)
      dom.removeEventListener('pointerdown', onBranchPointerDown, true)
      window.removeEventListener('pointermove', trackGround)
      window.removeEventListener('pointermove', onPointerMoveLeft)
      window.removeEventListener('pointerup', onPointerUpLeft)
      window.removeEventListener('pointercancel', onPointerCancel)
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
      {terrainQuality && <div role="status" style={{position:"absolute",bottom:12,left:12,zIndex:5,padding:"6px 10px",borderRadius:6,background:"#242a31",color:"#f2d39b",pointerEvents:"none",fontSize:12}}>{terrainQuality}</div>}
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
