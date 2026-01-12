import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useAppStore } from '@state/store'
import { useBuilderUIStore } from '@state/uiStore'
import { GridHelper } from './helpers'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { getAssetById } from '@core/assets'
import { buildPlaceholderFor, setGhostValid } from './primitiveFactory'

// Helper function that normalizes rotation values to 0, 90, 180, or 270 degrees
function normalizeRotation(rotation: number): 0|90|180|270 {
  const normalized = ((rotation % 360) + 360) % 360
  if (normalized === 0) return 0
  if (normalized === 90) return 90
  if (normalized === 180) return 180
  if (normalized === 270) return 270
  
  // If not exactly on a 90-degree increment, round to nearest
  const rounded = Math.round(normalized / 90) * 90 % 360
  if (rounded === 0) return 0
  if (rounded === 90) return 90
  if (rounded === 180) return 180
  return 270
}
import {
  worldToCell, aabbFootprint, footprintCells,
  inBounds, buildOccupiedSet, collides, snapRotationForFootprint
} from '@core/occupancy'
import type { Asset } from '@core/assets'


export function ThreeStage() {
  const mountRef = useRef<HTMLDivElement>(null)

  // store selectors
  const table = useAppStore(s => s.table)
  const setRefs = useAppStore(s => s.setRefs)
  const fitView = useAppStore(s => s.actions.fitView)
  const selectedAssetId = useAppStore(s => s.selectedAssetId)
  const setSelectedAsset = useAppStore(s => s.setSelectedAsset)
  const instances = useAppStore((s) => s.instances)
  const addInstance = useAppStore((s) => s.actions.addInstance)
  const selectedInstanceIds = useAppStore((s) => s.selectedInstanceIds)
  const primaryInstanceId = useAppStore((s) => s.primaryInstanceId)
  const selectInstance = useAppStore((s) => s.selectInstance)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const setPrimaryInstance = useAppStore((s) => s.setPrimaryInstance)
  const showGrid = useAppStore((s) => s.showGrid)
  const snapToGrid = useAppStore((s) => s.snapToGrid)
  const measurement = useAppStore((s) => s.measurement)
  const setMeasurementPoint = useAppStore((s) => s.setMeasurementPoint)
  const clearMeasurement = useAppStore((s) => s.clearMeasurement)
  const updateInstance = useAppStore((s) => s.actions.updateInstance)
  const openContextMenu = useBuilderUIStore((s) => s.openContextMenu)
  const closeContextMenu = useBuilderUIStore((s) => s.closeContextMenu)

  // Current rotation display
  const [currentRotation, setCurrentRotation] = React.useState<number | null>(null)

  // core refs
  const raycaster = useRef(new THREE.Raycaster())
  const mouseNDC = useRef(new THREE.Vector2())
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)

  // controls/gizmo
  const orbitRef = useRef<OrbitControls | null>(null)
  const tctrlRef = useRef<TransformControls | null>(null)

  // scene element refs
  const tableGroupRef = useRef<THREE.Group | null>(null)
  const tablePlaneRef = useRef<THREE.Mesh | null>(null)
  const placedGroupRef = useRef<THREE.Group | null>(null)
  const gridRef = useRef<THREE.Group | null>(null)
  const meshByInstanceId = useRef<Map<string, THREE.Object3D>>(new Map())
  const measurementLineRef = useRef<THREE.Line | null>(null)

  // placement refs
  const ghostRef = useRef<THREE.Object3D | null>(null)
  const ghostRotationRef = useRef<0 | 90 | 180 | 270>(0)
  const rotateDragRef = useRef<{ instanceId: string; startX: number; startRotation: number } | null>(null)

  // transform state
  const lastValid = useRef<{ pos: THREE.Vector3; rot: number } | null>(null)

  // Helper function to calculate proper Y position based on AABB and rotation
  function calculateYPosition(asset: Asset, rotationY: number): number {
    // Buildings are created with their base at y=0 in buildPlaceholderFor
    // The geometry has height 'h', positioned so bottom is at y=0, top at y=h
    // We need to return 0 so the base sits on the floor
    return 0
  }

  useEffect(() => {
    const mount = mountRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setClearColor(0x0b0f14)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 500)
    camera.position.set(2, 2, 3)

    const orbit = new OrbitControls(camera, renderer.domElement)
    orbit.enableDamping = true
    orbit.maxPolarAngle = Math.PI * 0.49
    ;(camera as any).controlsTarget = orbit.target
    orbitRef.current = orbit

    // Transform controls with 360-degree rotation
    const tctrl = new TransformControls(camera, renderer.domElement)
    tctrl.setSpace('world')
    tctrl.setTranslationSnap(useAppStore.getState().table.gridSize)
    tctrl.setRotationSnap(THREE.MathUtils.degToRad(15)) // 15-degree default snap
    tctrl.setSize(0.8) // Smaller, more subtle gizmo
    tctrl.showX = true
    tctrl.showY = false // Hide Y axis (we only rotate around Y)
    tctrl.showZ = true
    
    const tctrlObj = tctrl as unknown as THREE.Object3D
    scene.add(tctrlObj)
    tctrlRef.current = tctrl
    
    // Make gizmo more subtle - reduce opacity after adding to scene
    tctrlObj.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        const mat = child.material as THREE.Material
        if (mat) {
          mat.opacity = 0.6
          mat.transparent = true
        }
      }
    })

    tctrl.addEventListener('dragging-changed', (e: any) => {
      if (orbitRef.current) orbitRef.current.enabled = !e.value
      // Clear rotation display when drag ends
      if (!e.value) {
        setCurrentRotation(null)
      }
    })

    // Track if shift is held for free rotation (no snap)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        (tctrl as any).setRotationSnap(null) // Disable snap while shift held
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        tctrl.setRotationSnap(THREE.MathUtils.degToRad(15)) // Re-enable snap
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    // live snap update if grid changes
    const updateSnapFromTable = () => {
      tctrl.setTranslationSnap(useAppStore.getState().table.gridSize)
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir = new THREE.DirectionalLight(0xffffff, 0.6); dir.position.set(3, 5, 2); scene.add(dir)

    // root groups
    const tableGroup = new THREE.Group(); scene.add(tableGroup)
    const placedGroup = new THREE.Group(); scene.add(placedGroup)

    // refs
    sceneRef.current = scene
    cameraRef.current = camera
    rendererRef.current = renderer
    tableGroupRef.current = tableGroup
    placedGroupRef.current = placedGroup

    // initial build
    rebuildTable()

    setRefs({ scene, camera, renderer })
    fitView()

    const onResize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(onResize); ro.observe(mount)

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      orbit.update()
      renderer.render(scene, camera)
    }
    tick()

    // pointer: placement ghost
    function onPointerMove(e: PointerEvent) {
      const rotateDrag = rotateDragRef.current
      if (rotateDrag) {
        const mesh = meshByInstanceId.current.get(rotateDrag.instanceId)
        if (mesh) {
          const deltaX = e.clientX - rotateDrag.startX
          const degrees = rotateDrag.startRotation + deltaX * 0.5
          mesh.rotation.y = THREE.MathUtils.degToRad(degrees)
          const normalized = ((degrees % 360) + 360) % 360
          setCurrentRotation(Math.round(normalized))
        }
      }

      if (!tablePlaneRef.current || !cameraRef.current || !rendererRef.current) return

      const rect = rendererRef.current.domElement.getBoundingClientRect()
      mouseNDC.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouseNDC.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.current.setFromCamera(mouseNDC.current, cameraRef.current)
      const hit = raycaster.current.intersectObject(tablePlaneRef.current, false)[0]
      if (!hit) return

      const storeState = useAppStore.getState()
      const tbl = storeState.table
      const gs = tbl.gridSize
      const shouldSnap = storeState.snapToGrid
      let x = shouldSnap ? Math.round(hit.point.x / gs) * gs : hit.point.x
      let z = shouldSnap ? Math.round(hit.point.z / gs) * gs : hit.point.z
      const hw = tbl.width / 2
      const hh = tbl.height / 2
      x = THREE.MathUtils.clamp(x, -hw, hw)
      z = THREE.MathUtils.clamp(z, -hh, hh)

      // ensure ghost for current selection
      if (!ghostRef.current) {
        const currentSelected = useAppStore.getState().selectedAssetId
        if (!currentSelected || !sceneRef.current) return
        const asset = getAssetById(currentSelected)
        if (!asset) return
        const ghost = buildPlaceholderFor(asset)
        ghost.userData.assetId = asset.id
        ghostRef.current = ghost
        sceneRef.current.add(ghost)
      }

      const ghost = ghostRef.current!
      ghost.position.set(x, ghost.position.y, z)
      ghost.rotation.y = THREE.MathUtils.degToRad(ghostRotationRef.current)

      // validity
      const assetsById = new Map(useAppStore.getState().assets.map(a => [a.id, a]))
      const occ = buildOccupiedSet(useAppStore.getState().instances, assetsById, tbl)
      const anchor = worldToCell(x, z, tbl)
      const assetId = (ghost.userData as any).assetId as string
      const asset = assetsById.get(assetId)
      let valid = false
      if (asset) {
        const fp = aabbFootprint(asset, ghostRotationRef.current, tbl.gridSize)
        const cells = footprintCells(anchor, fp)
        valid = inBounds(cells, tbl) && !collides(cells, occ)
      }
      setGhostValid(ghost, valid)
      ghost.userData.valid = valid
    }

    // click: place OR select
    function onClick(e: MouseEvent) {
      closeContextMenu()
      const measurementState = useAppStore.getState().measurement
      if (measurementState.active) {
        if (!cameraRef.current || !rendererRef.current || !tablePlaneRef.current) return
        const rect = rendererRef.current.domElement.getBoundingClientRect()
        mouseNDC.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        mouseNDC.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.current.setFromCamera(mouseNDC.current, cameraRef.current)
        const hit = raycaster.current.intersectObject(tablePlaneRef.current, false)[0]
        if (hit) {
          setMeasurementPoint({ x: hit.point.x, z: hit.point.z })
        }
        return
      }

      // if in placement mode (have a ghost), try to place
      if (ghostRef.current) {
        if (ghostRef.current.userData.valid) {
          const assetId: string | undefined = (ghostRef.current.userData as any).assetId
          if (assetId) {
            const p = ghostRef.current.position
            addInstance({ assetId, position: { x: p.x, z: p.z }, rotationDeg: ghostRotationRef.current })
          }
        }
        return
      }

      // else: selection of placed meshes
      if (!cameraRef.current || !rendererRef.current || !placedGroupRef.current) return
      const rect = rendererRef.current.domElement.getBoundingClientRect()
      mouseNDC.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouseNDC.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.current.setFromCamera(mouseNDC.current, cameraRef.current)
      const hits = raycaster.current.intersectObjects(placedGroupRef.current.children, true)
      if (hits.length === 0) {
        clearSelection()
        if (tctrlRef.current) tctrlRef.current.detach()
        return
      }
      const hitObj = hits[0].object
      const entry = [...meshByInstanceId.current.entries()].find(([_, mesh]) => hitObj === mesh || mesh.children.includes(hitObj))
      if (!entry) return
      const [instanceId] = entry
      const selectionMode = e.ctrlKey || e.metaKey ? 'toggle' : 'replace'
      selectInstance(instanceId, selectionMode)

      const nextPrimary = useAppStore.getState().primaryInstanceId
      const mesh = nextPrimary ? meshByInstanceId.current.get(nextPrimary) : null
      if (!nextPrimary || !mesh) {
        if (tctrlRef.current) tctrlRef.current.detach()
        return
      }

      if (tctrlRef.current) {
        tctrlRef.current.attach(mesh as THREE.Object3D)
        tctrlRef.current.setMode('translate') // default mode
        // record last valid
        lastValid.current = { pos: mesh.position.clone(), rot: mesh.rotation.y }
      }
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return
      if (useAppStore.getState().measurement.active) return
      if (ghostRef.current) return
      if (tctrlRef.current?.dragging) return
      if (!cameraRef.current || !rendererRef.current) return

      const primary = useAppStore.getState().primaryInstanceId
      if (!primary) return

      const mesh = meshByInstanceId.current.get(primary)
      if (!mesh) return

      const rect = rendererRef.current.domElement.getBoundingClientRect()
      mouseNDC.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouseNDC.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.current.setFromCamera(mouseNDC.current, cameraRef.current)
      const hit = raycaster.current.intersectObject(mesh, true)[0]
      if (!hit) return

      rotateDragRef.current = {
        instanceId: primary,
        startX: e.clientX,
        startRotation: THREE.MathUtils.radToDeg(mesh.rotation.y),
      }
      const initialDegrees = rotateDragRef.current.startRotation
      const normalized = ((initialDegrees % 360) + 360) % 360
      setCurrentRotation(Math.round(normalized))
      if (orbitRef.current) orbitRef.current.enabled = false
      rendererRef.current.domElement.setPointerCapture(e.pointerId)
    }

    function onPointerUp(e: PointerEvent) {
      const drag = rotateDragRef.current
      if (!drag) return
      rotateDragRef.current = null
      if (orbitRef.current) orbitRef.current.enabled = true
      rendererRef.current?.domElement.releasePointerCapture(e.pointerId)

      const mesh = meshByInstanceId.current.get(drag.instanceId)
      if (!mesh) return
      let degrees = THREE.MathUtils.radToDeg(mesh.rotation.y)
      degrees = ((degrees % 360) + 360) % 360
      updateInstance(drag.instanceId, { rotationDeg: Math.round(degrees) })
      setCurrentRotation(null)
    }

    function onDragOver(e: DragEvent) {
      e.preventDefault()
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy'
      }
    }

    function processAssetDrop({ clientX, clientY, dataTransfer }: { clientX: number; clientY: number; dataTransfer: DataTransfer | null }) {
      if (!cameraRef.current || !rendererRef.current || !tablePlaneRef.current || !dataTransfer) return

      const assetId = dataTransfer.getData('application/x-terrain-asset') || dataTransfer.getData('text/plain')
      if (!assetId) return

      const rect = rendererRef.current.domElement.getBoundingClientRect()
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return
      }

      mouseNDC.current.x = ((clientX - rect.left) / rect.width) * 2 - 1
      mouseNDC.current.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.current.setFromCamera(mouseNDC.current, cameraRef.current)
      const hit = raycaster.current.intersectObject(tablePlaneRef.current, false)[0]
      if (!hit) return

      const state = useAppStore.getState()
      const asset = state.assets.find((a) => a.id === assetId)
      if (!asset) return

      state.setSelectedAsset(assetId)

      const tbl = state.table
      const gs = tbl.gridSize
      const shouldSnap = state.snapToGrid
      let x = shouldSnap ? Math.round(hit.point.x / gs) * gs : hit.point.x
      let z = shouldSnap ? Math.round(hit.point.z / gs) * gs : hit.point.z
      const hw = tbl.width / 2
      const hh = tbl.height / 2
      x = THREE.MathUtils.clamp(x, -hw, hw)
      z = THREE.MathUtils.clamp(z, -hh, hh)

      const assetsById = new Map(state.assets.map((a) => [a.id, a]))
      const occ = buildOccupiedSet(state.instances, assetsById, tbl)
      const anchor = worldToCell(x, z, tbl)
      const fp = aabbFootprint(asset, 0, tbl.gridSize)
      const cells = footprintCells(anchor, fp)
      const valid = inBounds(cells, tbl) && !collides(cells, occ)
      if (!valid) return

      const newId = state.actions.addInstance({
        assetId,
        position: { x, z },
        rotationDeg: 0,
      })
      state.setSelectedInstances([newId])
      state.setPrimaryInstance(newId)
    }

    function onDrop(e: DragEvent) {
      e.preventDefault()
      e.stopPropagation()
      processAssetDrop({ clientX: e.clientX, clientY: e.clientY, dataTransfer: e.dataTransfer })
    }

    function onWindowDrop(e: DragEvent) {
      e.preventDefault()
      processAssetDrop({ clientX: e.clientX, clientY: e.clientY, dataTransfer: e.dataTransfer })
    }

    function onContextMenu(e: MouseEvent) {
      e.preventDefault()
      if (useAppStore.getState().measurement.active) return
      if (!cameraRef.current || !rendererRef.current || !placedGroupRef.current) {
        openContextMenu({ x: e.clientX, y: e.clientY, targetIds: [] })
        return
      }

      const rect = rendererRef.current.domElement.getBoundingClientRect()
      mouseNDC.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouseNDC.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.current.setFromCamera(mouseNDC.current, cameraRef.current)
      const hits = raycaster.current.intersectObjects(placedGroupRef.current.children, true)
      if (hits.length === 0) {
        openContextMenu({ x: e.clientX, y: e.clientY, targetIds: [] })
        return
      }

      const hitObj = hits[0].object
      const entry = [...meshByInstanceId.current.entries()].find(([_, mesh]) =>
        hitObj === mesh || mesh.children.includes(hitObj)
      )
      if (!entry) {
        openContextMenu({ x: e.clientX, y: e.clientY, targetIds: [] })
        return
      }

      const [instanceId] = entry
      const state = useAppStore.getState()
      let targets = state.selectedInstanceIds
      if (!state.selectedInstanceIds.includes(instanceId)) {
        state.selectInstance(instanceId)
        targets = [instanceId]
      }
      openContextMenu({ x: e.clientX, y: e.clientY, targetIds: targets })
    }


    // transform validation + commit/revert
    function onTctrlChange() {
      const tctrl = tctrlRef.current
      if (!tctrl || !tctrl.object) return
      const obj = tctrl.object
      const tbl = useAppStore.getState().table
      const gs = tbl.gridSize

      const currentMode: string = (tctrl as any).getMode ? (tctrl as any).getMode() : (tctrl as any).mode
      if (currentMode === 'translate') {
        if (useAppStore.getState().snapToGrid) {
          obj.position.x = Math.round(obj.position.x / gs) * gs
          obj.position.z = Math.round(obj.position.z / gs) * gs
        }
      } else if (currentMode === 'rotate') {
        // Rotation is now free (0-360-degree) with optional 15-degree snap via TransformControls
        // Normalize to 0-360 range for storage
        let radians = obj.rotation.y
        while (radians < 0) radians += Math.PI * 2
        while (radians >= Math.PI * 2) radians -= Math.PI * 2
        obj.rotation.y = radians
        
        // Update rotation display
        const degrees = Math.round(THREE.MathUtils.radToDeg(radians))
        setCurrentRotation(degrees)       
      
      }

      // validate against occupancy excluding the edited instance
      const instId = useAppStore.getState().primaryInstanceId
      if (!instId) return
      const assetsById = new Map(useAppStore.getState().assets.map(a => [a.id, a]))
      const currentInstances = useAppStore.getState().instances.filter(i => i.id !== instId)
      const occ = buildOccupiedSet(currentInstances, assetsById, tbl)

      const inst = useAppStore.getState().instances.find(i => i.id === instId)
      if (!inst) return
      const asset = assetsById.get(inst.assetId)
      if (!asset) return

      const anchor = worldToCell(obj.position.x, obj.position.z, tbl)
      
      // For collision detection, snap rotation to 90-degree increments

      const rotDeg = normalizeRotation(THREE.MathUtils.radToDeg(obj.rotation.y))
      const fp = aabbFootprint(asset, rotDeg, tbl.gridSize)
      const cells = footprintCells(anchor, fp)
      const valid = inBounds(cells, tbl) && !collides(cells, occ)

      // tint mesh (wireframe material) to indicate validity while dragging
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material
        if (mat instanceof THREE.MeshBasicMaterial) {
          mat.color.setHex(valid ? 0x3fbf5a : 0xe05757)
        }
      }

      // if valid, record as last valid
      if (valid) {
        lastValid.current = { pos: obj.position.clone(), rot: obj.rotation.y }
      }
    }

    function onTctrlMouseUp() {
      const tctrl = tctrlRef.current
      if (!tctrl || !tctrl.object) return
      const obj = tctrl.object
      const instId = useAppStore.getState().primaryInstanceId
      if (!instId) return

      // revert if we never had a valid state during drag
      if (!lastValid.current) {
        return
      }

      // Store actual rotation in degrees (0-360) - NO SNAPPING
      let rotDeg = THREE.MathUtils.radToDeg(lastValid.current.rot)
      while (rotDeg < 0) rotDeg += 360
      while (rotDeg >= 360) rotDeg -= 360
      
      // Round to nearest degree for storage
      const roundedRotDeg = Math.round(rotDeg)
      
      obj.position.copy(lastValid.current.pos)
      obj.rotation.y = lastValid.current.rot
      
      updateInstance(instId, {
        position: { x: obj.position.x, z: obj.position.z },
        rotationDeg: roundedRotDeg
      })
      
      // Clear rotation display
      setCurrentRotation(null)
    }

    tctrl.addEventListener('change', onTctrlChange)
    tctrl.addEventListener('mouseUp', onTctrlMouseUp)

    // listeners
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.addEventListener('contextmenu', onContextMenu)
    renderer.domElement.addEventListener('dragover', onDragOver)
    renderer.domElement.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onWindowDrop)

    function onKeyDown(e: KeyboardEvent) {
      const store = useAppStore.getState()

      // Esc: cancel placement or deselect transform
      if (e.key === 'Escape') {
        if (sceneRef.current && ghostRef.current) {
          sceneRef.current.remove(ghostRef.current); ghostRef.current = null
        }
        ghostRotationRef.current = 0
        rotateDragRef.current = null
        setCurrentRotation(null)
        if (orbitRef.current) orbitRef.current.enabled = true
        clearMeasurement()
        setSelectedAsset(null)
        if (tctrlRef.current) tctrlRef.current.detach()
        clearSelection()
        return
      }

      // Placement rotation (ghost)
      if (ghostRef.current && e.key.toLowerCase() === 'r') {

        ghostRotationRef.current = normalizeRotation(ghostRotationRef.current + 90)
        ghostRef.current.rotation.y = THREE.MathUtils.degToRad(ghostRotationRef.current)
        return
      }

      // If an instance is selected: mode toggles + delete + Q/E rotate
      const instId = store.primaryInstanceId
      const selectionIds = store.selectedInstanceIds
      if (!instId) return

      // Delete / Backspace → remove selected instances
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectionIds.length) {
        if (tctrlRef.current) tctrlRef.current.detach()
        useAppStore.getState().actions.removeInstances(selectionIds)
        return
      }

      if (e.key.toLowerCase() === 't') tctrlRef.current?.setMode('translate')
      if (e.key.toLowerCase() === 'r') tctrlRef.current?.setMode('rotate')

      // Q = -90-degree, E = +90-degree, collision/bounds-aware
      if (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'e') {
        const delta = e.key.toLowerCase() === 'q' ? -90 : 90
        const inst = store.instances.find((ii) => ii.id === instId)
        if (!inst) return

        const tbl = store.table
        const assetsById: Map<string, Asset> = new Map<string, Asset>(store.assets.map((a) => [a.id, a]))
        const asset = assetsById.get(inst.assetId)
        if (!asset) return

        // current position (prefer live mesh if attached)
        const mesh = meshByInstanceId.current.get(instId)
        const px = mesh ? mesh.position.x : inst.position.x
        const pz = mesh ? mesh.position.z : inst.position.z

        const newRot = normalizeRotation(inst.rotationDeg + delta)

        // occupancy excluding the instance being rotated
        const others = store.instances.filter((ii) => ii.id !== instId)
        const occ = buildOccupiedSet(others, assetsById, tbl)

        const anchor = worldToCell(px, pz, tbl)
        const fp = aabbFootprint(asset, newRot, tbl.gridSize)
        const cells = footprintCells(anchor, fp)
        const valid = inBounds(cells, tbl) && !collides(cells, occ)

        if (!valid) {
          // flash red for feedback
          if (mesh && mesh instanceof THREE.Mesh) {
            const mat = mesh.material
            if (mat instanceof THREE.MeshBasicMaterial) {
              mat.color.setHex(0xe05757)
              setTimeout(() => {
                mat.color.setHex(0x4da3ff)
              }, 120)
            }
          }
          return
        }

        // commit rotation
        updateInstance(instId, { rotationDeg: newRot })
        if (mesh) mesh.rotation.y = THREE.MathUtils.degToRad(newRot)
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      if (measurementLineRef.current && sceneRef.current) {
        sceneRef.current.remove(measurementLineRef.current)
        measurementLineRef.current = null
      }
      renderer.dispose()
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('contextmenu', onContextMenu)
      renderer.domElement.removeEventListener('dragover', onDragOver)
      renderer.domElement.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onWindowDrop)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      tctrl.removeEventListener('change', onTctrlChange)
      tctrl.removeEventListener('mouseUp', onTctrlMouseUp)
      mount.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Rebuild table + grid on changes
  useEffect(() => {
    rebuildTable()
    // keep transform snap in sync with grid
    const gridSize = table.gridSize
    if (tctrlRef.current) {
      const shouldSnap = useAppStore.getState().snapToGrid
      const snapValue = shouldSnap ? gridSize : null
      tctrlRef.current.setTranslationSnap(snapValue as number | null)
    }
  }, [table.width, table.height, table.gridSize])

  useEffect(() => {
    if (tctrlRef.current) {
      const gridSize = useAppStore.getState().table.gridSize
      const snapValue = snapToGrid ? gridSize : null
      tctrlRef.current.setTranslationSnap(snapValue as number | null)
    }
  }, [snapToGrid])

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.visible = showGrid
    }
  }, [showGrid])

  // Rebuild placed meshes when instances change
  useEffect(() => {
    const group = placedGroupRef.current
    if (!group) return
    group.clear()
    meshByInstanceId.current.clear()

    const assetsById = new Map(useAppStore.getState().assets.map((a) => [a.id, a]))
    const selectedSet = new Set(selectedInstanceIds)

    for (const inst of instances) {
      const asset = assetsById.get(inst.assetId)
      if (!asset) continue
      const mesh = buildPlaceholderFor(asset)
      const rotationRad = THREE.MathUtils.degToRad(inst.rotationDeg)
      mesh.position.set(inst.position.x, mesh.position.y, inst.position.z)
      mesh.rotation.y = rotationRad
      mesh.userData.instanceId = inst.id

      if (selectedSet.has(inst.id)) {
        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const material = child.material
            if (material instanceof THREE.MeshBasicMaterial) {
              material.color.setHex(0x4da3ff)
            }
          }
        })
      }

      group.add(mesh)
      meshByInstanceId.current.set(inst.id, mesh)
    }

    if (tctrlRef.current) {
      const primary = primaryInstanceId
      if (primary) {
        const handle = meshByInstanceId.current.get(primary)
        if (handle) {
          tctrlRef.current.attach(handle as THREE.Object3D)
        } else {
          tctrlRef.current.detach()
        }
      } else {
        tctrlRef.current.detach()
      }
    }
  }, [instances, selectedInstanceIds, primaryInstanceId])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    const existing = measurementLineRef.current
    if (!measurement.active || !measurement.start || !measurement.end) {
      if (existing) {
        scene.remove(existing)
        measurementLineRef.current = null
      }
      return
    }

    const start = new THREE.Vector3(measurement.start.x, 0.01, measurement.start.z)
    const end = new THREE.Vector3(measurement.end.x, 0.01, measurement.end.z)

    if (!existing) {
      const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
      const material = new THREE.LineBasicMaterial({ color: 0x4da3ff })
      const line = new THREE.Line(geometry, material)
      measurementLineRef.current = line
      scene.add(line)
    } else {
      const positions = new Float32Array([
        start.x, start.y, start.z,
        end.x, end.y, end.z,
      ])
      existing.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      existing.geometry.attributes.position.needsUpdate = true
    }
  }, [measurement])

  // Ghost lifecycle on selection change
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (ghostRef.current) { scene.remove(ghostRef.current); ghostRef.current = null }
    ghostRotationRef.current = 0
    if (selectedAssetId) {
      const asset = getAssetById(selectedAssetId); if (!asset) return
      const ghost = buildPlaceholderFor(asset)
      ghost.userData.assetId = asset.id
      scene.add(ghost); ghostRef.current = ghost
      ghost.position.set(0, ghost.position.y, 0)
      ghost.rotation.y = 0
    }
  }, [selectedAssetId])

  function rebuildTable() {
    const tableGroup = tableGroupRef.current
    if (!tableGroup) return
    tableGroup.clear()

    // plane
    const geo = new THREE.PlaneGeometry(table.width, table.height)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a2330,
      metalness: 0,
      roughness: 0.9,
      side: THREE.DoubleSide,
    })
    const plane = new THREE.Mesh(geo, mat)
    plane.rotation.x = -Math.PI / 2
      plane.position.y = -0.005  // ← ADD THIS LINE: Lower table slightly below ground
      plane.receiveShadow = true
      tableGroup.add(plane)
      tablePlaneRef.current = plane

    // border
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(table.width, 0.02, table.height)),
        new THREE.LineBasicMaterial({ color: 0x2c3a50 })
      )
      border.position.y = -0.005  // ← Change from 0.01 to -0.005
      tableGroup.add(border)

    // grid
      const grid = GridHelper(table.width, table.height, table.gridSize)
      gridRef.current = grid
      grid.visible = useAppStore.getState().showGrid
      grid.position.y = 0  // ← Change from 0.011 to 0 (sits at ground level)
      tableGroup.add(grid)
  }

  return (
    <>
      <div className="absolute inset-0" ref={mountRef} />
      
      {/* Rotation angle indicator - only show while actively rotating */}
      {currentRotation !== null && tctrlRef.current?.dragging && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(77, 163, 255, 0.95)',
          color: '#fff',
          padding: '12px 24px',
          borderRadius: 8,
          fontSize: 24,
          fontWeight: 600,
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          {currentRotation}\u00b0
        </div>
      )}
    </>
  )
}

