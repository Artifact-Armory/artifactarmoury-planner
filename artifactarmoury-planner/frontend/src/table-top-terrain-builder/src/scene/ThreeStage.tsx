import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useAppStore } from '@state/store'
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
  const instances = useAppStore(s => s.instances)
  const addInstance = useAppStore(s => s.actions.addInstance)
  const selectedInstanceId = useAppStore(s => s.selectedInstanceId)
  const setSelectedInstance = useAppStore(s => s.setSelectedInstance)
  const updateInstance = useAppStore(s => s.actions.updateInstance)

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
  const meshByInstanceId = useRef<Map<string, THREE.Object3D>>(new Map())

  // placement refs
  const ghostRef = useRef<THREE.Object3D | null>(null)
  const ghostRotationRef = useRef<0 | 90 | 180 | 270>(0)

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

    // Transform controls with 360Â° rotation
    const tctrl = new TransformControls(camera, renderer.domElement)
    tctrl.setSpace('world')
    tctrl.setTranslationSnap(useAppStore.getState().table.gridSize)
    tctrl.setRotationSnap(THREE.MathUtils.degToRad(15)) // 15Â° default snap
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
    let shiftHeld = false
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftHeld = true
        tctrl.setRotationSnap(undefined) // Disable snap while shift held
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftHeld = false
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
      if (!tablePlaneRef.current || !cameraRef.current || !rendererRef.current) return

      const rect = rendererRef.current.domElement.getBoundingClientRect()
      mouseNDC.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouseNDC.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.current.setFromCamera(mouseNDC.current, cameraRef.current)
      const hit = raycaster.current.intersectObject(tablePlaneRef.current, false)[0]
      if (!hit) return

      const tbl = useAppStore.getState().table
      const gs = tbl.gridSize
      let x = Math.round(hit.point.x / gs) * gs
      let z = Math.round(hit.point.z / gs) * gs
      const hw = tbl.width / 2, hh = tbl.height / 2
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
        setSelectedInstance(null)
        if (tctrlRef.current) tctrlRef.current.detach()
        return
      }
      const hitObj = hits[0].object
      console.log(`Hit object:`, hitObj.name, `Type: ${hitObj.type}`)

      // Find the instance group that contains this hit object
      let hitGroup: THREE.Object3D | null = hitObj
      while (hitGroup && !meshByInstanceId.current.has(
        [...meshByInstanceId.current.entries()].find(([_, mesh]) => mesh === hitGroup)?.[0] || ''
      )) {
        hitGroup = hitGroup.parent
        if (hitGroup === placedGroupRef.current) {
          hitGroup = null
          break
        }
      }

      const entry = [...meshByInstanceId.current.entries()].find(([_, mesh]) => mesh === hitGroup)
      if (!entry) {
        console.log(`No matching mesh found in meshByInstanceId`)
        return
      }
      const [instanceId, mesh] = entry
      console.log(`Selected instance: ${instanceId}, mesh scale:`, mesh.scale)
      setSelectedInstance(instanceId)

      if (tctrlRef.current) {
        tctrlRef.current.attach(mesh as THREE.Object3D)
        tctrlRef.current.setMode('translate') // default mode
        // record last valid
        lastValid.current = { pos: mesh.position.clone(), rot: mesh.rotation.y }
        console.log(`Attached gizmo to mesh`)
      }
    }

    // transform validation + commit/revert
    function onTctrlChange() {
      const tctrl = tctrlRef.current
      if (!tctrl || !tctrl.object) return
      const obj = tctrl.object
      const tbl = useAppStore.getState().table
      const gs = tbl.gridSize

      if (tctrl.mode === 'translate') {
        // snap to grid while dragging
        obj.position.x = Math.round(obj.position.x / gs) * gs
        obj.position.z = Math.round(obj.position.z / gs) * gs
      } else if (tctrl.mode === 'rotate') {
        // Rotation is now free (0-360Â°) with optional 15Â° snap via TransformControls
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
      const instId = useAppStore.getState().selectedInstanceId
      if (!instId) return
      const assetsById = new Map(useAppStore.getState().assets.map(a => [a.id, a]))
      const currentInstances = useAppStore.getState().instances.filter(i => i.id !== instId)
      const occ = buildOccupiedSet(currentInstances, assetsById, tbl)

      const inst = useAppStore.getState().instances.find(i => i.id === instId)
      if (!inst) return
      const asset = assetsById.get(inst.assetId)
      if (!asset) return

      const anchor = worldToCell(obj.position.x, obj.position.z, tbl)
      
      // For collision detection, snap rotation to 90Â° increments

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
      const instId = useAppStore.getState().selectedInstanceId
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
    renderer.domElement.addEventListener('click', onClick)

    function onKeyDown(e: KeyboardEvent) {
      const store = useAppStore.getState()

      // Esc: cancel placement or deselect transform
      if (e.key === 'Escape') {
        if (sceneRef.current && ghostRef.current) {
          sceneRef.current.remove(ghostRef.current); ghostRef.current = null
        }
        ghostRotationRef.current = 0
        setSelectedAsset(null)
        if (tctrlRef.current) tctrlRef.current.detach()
        setSelectedInstance(null)
        return
      }

      // Placement rotation (ghost)
      if (ghostRef.current && e.key.toLowerCase() === 'r') {

        ghostRotationRef.current = normalizeRotation(ghostRotationRef.current + 90)
        ghostRef.current.rotation.y = THREE.MathUtils.degToRad(ghostRotationRef.current)
        return
      }

      // If an instance is selected: mode toggles + delete + Q/E rotate
      const instId = store.selectedInstanceId
      if (!instId) return

      // Delete / Backspace â remove selected instance
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (tctrlRef.current) tctrlRef.current.detach()
        useAppStore.getState().actions.removeInstance(instId)
        setSelectedInstance(null)
        return
      }

      if (e.key.toLowerCase() === 't') tctrlRef.current?.setMode('translate')
      if (e.key.toLowerCase() === 'r') tctrlRef.current?.setMode('rotate')

      // X/Y/Z = rotate 180° on that axis (to turn model around without mirroring)
      // Alt+X = swap X and Z dimensions
      if (e.key.toLowerCase() === 'x') {
        const inst = store.instances.find((ii) => ii.id === instId)
        if (!inst) return

        if (e.altKey) {
          updateInstance(instId, { swapXZ: !inst.swapXZ })
          console.log(`✓ Swapped X/Z: ${!inst.swapXZ}`)
        } else {
          // Rotate 180° around X axis - calculate position offset to keep it in place
          const mesh = meshByInstanceId.current.get(instId)
          if (mesh) {
            const currentRotX = inst.rotationX ?? 0
            const newRotX = normalizeRotation(currentRotX + 180)

            // Get current bounding box
            mesh.updateMatrixWorld(true)
            const oldBbox = new THREE.Box3().setFromObject(mesh)
            const oldCenter = oldBbox.getCenter(new THREE.Vector3())

            // Temporarily apply new rotation to calculate new center
            mesh.rotation.x = THREE.MathUtils.degToRad(newRotX)
            mesh.updateMatrixWorld(true)
            const newBbox = new THREE.Box3().setFromObject(mesh)
            const newCenter = newBbox.getCenter(new THREE.Vector3())

            // Calculate offset to keep center in same place
            const offset = oldCenter.sub(newCenter)
            const newPos = { x: inst.position.x + offset.x, z: inst.position.z + offset.z }

            updateInstance(instId, { rotationX: newRotX, position: newPos })
            console.log(`✓ Rotated 180° on X axis: ${newRotX}°`)
          }
        }
        return
      }
      if (e.key.toLowerCase() === 'y') {
        const inst = store.instances.find((ii) => ii.id === instId)
        if (inst) {
          // Rotate 180° around Y axis - calculate position offset to keep it in place
          const mesh = meshByInstanceId.current.get(instId)
          if (mesh) {
            const currentRotY = inst.rotationDeg ?? 0
            const newRotY = normalizeRotation(currentRotY + 180)

            // Get current bounding box
            mesh.updateMatrixWorld(true)
            const oldBbox = new THREE.Box3().setFromObject(mesh)
            const oldCenter = oldBbox.getCenter(new THREE.Vector3())

            // Temporarily apply new rotation to calculate new center
            mesh.rotation.y = THREE.MathUtils.degToRad(newRotY)
            mesh.updateMatrixWorld(true)
            const newBbox = new THREE.Box3().setFromObject(mesh)
            const newCenter = newBbox.getCenter(new THREE.Vector3())

            // Calculate offset to keep center in same place
            const offset = oldCenter.sub(newCenter)
            const newPos = { x: inst.position.x + offset.x, z: inst.position.z + offset.z }

            updateInstance(instId, { rotationDeg: newRotY, position: newPos })
            console.log(`✓ Rotated 180° on Y axis: ${newRotY}°`)
          }
        }
        return
      }
      if (e.key.toLowerCase() === 'z') {
        const inst = store.instances.find((ii) => ii.id === instId)
        if (inst) {
          // Rotate 180° around Z axis - calculate position offset to keep it in place
          const mesh = meshByInstanceId.current.get(instId)
          if (mesh) {
            const currentRotZ = inst.rotationZ ?? 0
            const newRotZ = normalizeRotation(currentRotZ + 180)

            // Get current bounding box
            mesh.updateMatrixWorld(true)
            const oldBbox = new THREE.Box3().setFromObject(mesh)
            const oldCenter = oldBbox.getCenter(new THREE.Vector3())

            // Temporarily apply new rotation to calculate new center
            mesh.rotation.z = THREE.MathUtils.degToRad(newRotZ)
            mesh.updateMatrixWorld(true)
            const newBbox = new THREE.Box3().setFromObject(mesh)
            const newCenter = newBbox.getCenter(new THREE.Vector3())

            // Calculate offset to keep center in same place
            const offset = oldCenter.sub(newCenter)
            const newPos = { x: inst.position.x + offset.x, z: inst.position.z + offset.z }

            updateInstance(instId, { rotationZ: newRotZ, position: newPos })
            console.log(`✓ Rotated 180° on Z axis: ${newRotZ}°`)
          }
        }
        return
      }

      // Q/E = rotate around Y axis (horizontal)
      // Shift+Q/E = rotate around X axis (tip forward/back)
      // Ctrl+Q/E = rotate around Z axis (roll left/right)
      if (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'e') {
        const delta = e.key.toLowerCase() === 'q' ? -90 : 90
        const inst = store.instances.find((ii) => ii.id === instId)
        if (!inst) return

        if (e.shiftKey) {
          // Rotate around X axis (tip forward/back)
          const currentRotX = inst.rotationX ?? 0
          const newRotX = currentRotX + delta
          updateInstance(instId, { rotationX: newRotX })
          console.log(`✓ Rotated X: ${newRotX}°`)
          return
        } else if (e.ctrlKey) {
          // Rotate around Z axis (roll left/right)
          const currentRotZ = inst.rotationZ ?? 0
          const newRotZ = currentRotZ + delta
          updateInstance(instId, { rotationZ: newRotZ })
          console.log(`✓ Rotated Z: ${newRotZ}°`)
          return
        }

        const tbl = store.table
        const assetsById: Map<string, Asset> = new Map<string, Asset>(store.assets.map(a => [a.id, a]))
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
      renderer.dispose()
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('click', onClick)
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
    tctrlRef.current?.setTranslationSnap(table.gridSize)
  }, [table.width, table.height, table.gridSize])

  // Rebuild placed meshes when instances change
  useEffect(() => {
    const g = placedGroupRef.current
    if (!g) return
    g.clear()
    meshByInstanceId.current.clear()
    const byId = new Map(useAppStore.getState().assets.map(a => [a.id, a]))
    for (const inst of instances) {
      const asset = byId.get(inst.assetId)
      if (!asset) continue
      const mesh = buildPlaceholderFor(asset)

      // Apply all rotations
      const rotYRad = THREE.MathUtils.degToRad(inst.rotationDeg)
      const rotXRad = THREE.MathUtils.degToRad(inst.rotationX ?? 0)
      const rotZRad = THREE.MathUtils.degToRad(inst.rotationZ ?? 0)

      // Apply rotations in order: X, then Y, then Z
      mesh.rotation.order = 'XYZ'
      mesh.rotation.x = rotXRad
      mesh.rotation.y = rotYRad
      mesh.rotation.z = rotZRad

      // Apply stored model scale if available
      let scaleX = 1, scaleY = 1, scaleZ = 1
      const modelScale = (asset as any).modelScale
      if (modelScale) {
        scaleX = modelScale.x
        scaleY = modelScale.y
        scaleZ = modelScale.z
      }

      // Swap X and Z if needed
      if (inst.swapXZ) {
        [scaleX, scaleZ] = [scaleZ, scaleX]
      }

      mesh.scale.set(scaleX, scaleY, scaleZ)

      // Position the model at the instance position (X, Z are centered)
      // Calculate Y position based on model's bottom offset to ensure all models sit on the table surface
      let yPos = 0.001 // Tiny offset above table surface to prevent z-fighting
      const modelBottomOffset = (asset as any).modelBottomOffset
      if (modelBottomOffset !== undefined) {
        // The model is centered at origin, so its bottom is at -modelBottomOffset
        // To place the bottom at Y=0, we need to move it up by modelBottomOffset
        // IMPORTANT: Scale the offset by the Y scale factor since the model is scaled
        yPos = modelBottomOffset * scaleY + 0.001
      }
      mesh.position.set(inst.position.x, yPos, inst.position.z)

      mesh.userData.instanceId = inst.id
      g.add(mesh)
      meshByInstanceId.current.set(inst.id, mesh)
    }

    // if a selected instance was rebuilt, reattach gizmo
    if (selectedInstanceId && tctrlRef.current) {
      const m = meshByInstanceId.current.get(selectedInstanceId)
      if (m) tctrlRef.current.attach(m as THREE.Object3D)
    }
    
    // Add selection outline
    if (selectedInstanceId) {
      const m = meshByInstanceId.current.get(selectedInstanceId)
      if (m && m instanceof THREE.Mesh) {
        const mat = m.material
        if (mat instanceof THREE.MeshBasicMaterial) {
          mat.color.setHex(0x4da3ff)
        }
      }
    }
  }, [instances, selectedInstanceId])

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
      plane.position.y = 0  // â ADD THIS LINE: Lower table slightly below ground
      plane.receiveShadow = true
      tableGroup.add(plane)
      tablePlaneRef.current = plane

    // border
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(table.width, 0.02, table.height)),
        new THREE.LineBasicMaterial({ color: 0x2c3a50 })
      )
      border.position.y = 0  // â Change from 0.01 to -0.005
      tableGroup.add(border)

    // grid
      const grid = GridHelper(table.width, table.height, table.gridSize)
      grid.position.y = 0  // â Change from 0.011 to 0 (sits at ground level)
      tableGroup.add(grid)
  }

  return (
    <>
      <div className="tb-canvas-wrap" ref={mountRef} />
      
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
          {currentRotation}°
        </div>
      )}
    </>
  )
}





