import React from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * Spin-around 3D view of one model on its product page (phones included).
 * Loads the same watermarked preview GLB the planner uses (the server decides
 * proxy vs owner's full copy), so no STL ever reaches the browser here.
 * Lazy-loaded by ModelDetails so three.js is only fetched when someone asks.
 */
export default function Model3DViewer({ url, name }: { url: string; name: string }) {
  const mountRef = React.useRef<HTMLDivElement>(null)
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading')

  React.useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, mount.clientWidth / mount.clientHeight, 0.001, 100)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(2, 3, 2)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xffffff, 0.5)
    rim.position.set(-2, 1.5, -2)
    scene.add(rim)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.autoRotate = true
    controls.autoRotateSpeed = 1.5
    controls.enablePan = false
    // Stop the turntable as soon as someone takes hold of the model.
    controls.addEventListener('start', () => { controls.autoRotate = false })

    const draco = new DRACOLoader()
    draco.setDecoderPath('/draco/')
    const loader = new GLTFLoader()
    loader.setDRACOLoader(draco)
    try {
      const token = localStorage.getItem('terrain_builder_token')
      // Lets an owner see their full-quality copy; the browser drops it on the R2 redirect.
      if (token) (loader as any).setRequestHeader({ Authorization: `Bearer ${token}` })
    } catch { /* anonymous is fine for public models */ }

    loader.load(
      url,
      (gltf) => {
        if (disposed) return
        const root = gltf.scene
        root.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.isMesh) {
            mesh.material = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.75, metalness: 0.05 })
          }
        })
        // Centre on the origin and frame it, whatever units the GLB uses.
        const box = new THREE.Box3().setFromObject(root)
        const size = box.getSize(new THREE.Vector3())
        const centre = box.getCenter(new THREE.Vector3())
        root.position.sub(centre)
        scene.add(root)
        const radius = Math.max(size.length() / 2, 1e-4)
        const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05
        camera.near = dist / 100
        camera.far = dist * 100
        camera.position.set(dist * 0.6, dist * 0.45, dist * 0.65).normalize().multiplyScalar(dist)
        camera.updateProjectionMatrix()
        controls.minDistance = dist * 0.3
        controls.maxDistance = dist * 3
        controls.update()
        setStatus('ready')
      },
      undefined,
      () => { if (!disposed) setStatus('error') },
    )

    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    const onResize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mount)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      ro.disconnect()
      controls.dispose()
      draco.dispose()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry?.dispose()
          ;(mesh.material as THREE.Material)?.dispose?.()
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [url])

  return (
    <div className="relative h-full w-full" aria-label={`3D view of ${name}`}>
      <div ref={mountRef} className="h-full w-full touch-none" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Loading 3D view…</div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          The 3D view couldn't load. Try again later.
        </div>
      )}
      {status === 'ready' && (
        <>
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-0.5 text-xs font-medium text-white">
            Drag to turn, pinch or scroll to zoom
          </span>
          {/* The preview mesh is reduced and carries our logo; say so, or it reads
              as "the model is low quality / comes with a logo cut into it". */}
          <p className="pointer-events-none absolute inset-x-3 bottom-3 rounded-md bg-black/55 px-3 py-1.5 text-xs text-white">
            Preview only. This view is lower detail and carries our logo to protect the artist. The STL files you
            download are full detail, with no logo on the model.
          </p>
        </>
      )}
    </div>
  )
}
