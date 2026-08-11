// A small, self-contained 3D preview used in Edit Model to help an artist pick the
// tilt that stands their model upright in the planner. Vanilla three (the app has
// no R3F); GLBs are Draco-compressed (decoder served at /draco/, same as the planner).
//
// It mirrors the planner's placement maths (InstancedScene.composeMatrix / ghost):
//   base-align (min.y → 0) → pitch about the base-centre X → re-ground so the tilted
//   model rests on the y=0 grid — so what the artist sees here is what buyers place.

import React from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// One decoder shared across previews (matches the planner's /draco/ setup).
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')
dracoLoader.setDecoderConfig({ type: 'wasm' })
const gltfLoader = new GLTFLoader()
gltfLoader.setDRACOLoader(dracoLoader)
// Previews load through the signed /preview.glb endpoint; a draft is owner-gated, so
// send the JWT to our API (the browser strips it on the cross-origin redirect to R2).
try {
  const token = localStorage.getItem('terrain_builder_token')
  if (token) (gltfLoader as any).setRequestHeader({ Authorization: `Bearer ${token}` })
} catch { /* anonymous is fine for published models */ }

interface Props {
  /** GLB URL (the planner preview mesh). */
  url?: string
  /** Tilt about X in degrees (the value being previewed). */
  pitchDeg: number
  className?: string
}

const ModelOrientationPreview: React.FC<Props> = ({ url, pitchDeg, className }) => {
  const mountRef = React.useRef<HTMLDivElement | null>(null)
  // Live scene handles kept across renders so a pitch change doesn't reload the GLB.
  const pivotRef = React.useRef<THREE.Group | null>(null)
  const aabbRef = React.useRef<{ y: number; z: number }>({ y: 0, z: 0 })
  // Latest pitch, readable inside the (url-scoped) load callback without re-running it.
  const pitchDegRef = React.useRef(pitchDeg)
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error' | 'empty'>('loading')

  // Build the renderer/scene once per url; tear down on unmount or url change.
  React.useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    if (!url) { setStatus('empty'); return }
    setStatus('loading')

    const width = mount.clientWidth || 320
    const height = mount.clientHeight || 240

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 5000)

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.1))
    const dir = new THREE.DirectionalLight(0xffffff, 1.4)
    dir.position.set(1, 2, 1.5)
    scene.add(dir)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = false

    // Pivot holds the model; we tilt & re-ground the pivot (base-centre at its origin).
    const pivot = new THREE.Group()
    pivotRef.current = pivot
    scene.add(pivot)

    let grid: THREE.GridHelper | null = null
    let raf = 0
    let disposed = false

    gltfLoader.load(
      url,
      (gltf) => {
        if (disposed) return
        const model = gltf.scene
        // Base-align: centre x/z, sit min.y on 0 (like loaders.baseAlign).
        model.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(model)
        const size = new THREE.Vector3(); box.getSize(size)
        const center = new THREE.Vector3(); box.getCenter(center)
        model.position.x += -center.x
        model.position.z += -center.z
        model.position.y += -box.min.y
        pivot.add(model)
        aabbRef.current = { y: size.y, z: size.z }

        // A ground grid sized to the model so "resting on the table" reads clearly.
        const span = Math.max(size.x, size.z) * 2.2
        grid = new THREE.GridHelper(span, 12, 0x9aa4b2, 0xd3d8e0)
        ;(grid.material as THREE.Material).opacity = 0.5
        ;(grid.material as THREE.Material).transparent = true
        scene.add(grid)

        // Frame the camera to the model's bounding sphere (radius is rotation-
        // invariant, so re-tilting never needs a reframe).
        const radius = Math.max(0.001, size.length() / 2)
        const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.15
        camera.position.set(dist * 0.7, dist * 0.6, dist * 0.9)
        controls.target.set(0, size.y * 0.4, 0)
        controls.update()

        applyPitch(pivot, pitchDegRef.current, aabbRef.current)
        setStatus('ready')
      },
      undefined,
      () => { if (!disposed) setStatus('error') },
    )

    const animate = () => {
      raf = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      const w = mount.clientWidth || width
      const h = mount.clientHeight || height
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mount)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if ((m as any).isMesh) {
          m.geometry?.dispose()
          const mat = m.material
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
          else mat?.dispose()
        }
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      pivotRef.current = null
    }
  }, [url])

  // Re-tilt the already-loaded model when the previewed pitch changes (no reload).
  React.useEffect(() => {
    pitchDegRef.current = pitchDeg
    if (pivotRef.current) applyPitch(pivotRef.current, pitchDeg, aabbRef.current)
  }, [pitchDeg])

  return (
    <div className={className ?? 'relative w-full h-56 rounded-sm border bg-linear-to-b from-slate-50 to-slate-100 overflow-hidden'}>
      <div ref={mountRef} className="absolute inset-0" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Loading preview…</div>
      )}
      {status === 'empty' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground text-center px-4">
          No 3D preview yet — it appears once the model finishes processing.
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Preview unavailable</div>
      )}
      {status === 'ready' && (
        <div className="absolute bottom-1 right-2 text-[10px] text-muted-foreground select-none">drag to rotate</div>
      )}
    </div>
  )
}

/** Tilt the pivot about X and re-ground it so the model rests on y=0 (matches the planner). */
function applyPitch(pivot: THREE.Group, pitchDeg: number, aabb: { y: number; z: number }) {
  pivot.rotation.x = THREE.MathUtils.degToRad(pitchDeg)
  const th = THREE.MathUtils.degToRad(pitchDeg)
  const minY = Math.min(0, aabb.y * Math.cos(th)) - (aabb.z / 2) * Math.abs(Math.sin(th))
  pivot.position.y = -minY
}

export default ModelOrientationPreview
