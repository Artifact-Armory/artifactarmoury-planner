// src/scene/BuilderCamera.ts
//
// A constrained "city-builder / RTS" camera. Replaces raw OrbitControls so the
// view can never disorient the user:
//
//   • Scroll wheel  → zoom toward the cursor (not screen centre)
//   • Right drag    → orbit, pitch clamped (~15–80°) so it never flips or goes under
//   • Middle drag   → pan across the table
//   • WASD / arrows → pan across the table
//   • Always "up"   → camera.up is fixed, lookAt(target) every frame
//
// TOUCH (tablets) is a strictly separate path — a touch pointer always reports
// button 0 and never fires `wheel`, so none of the mouse handlers above can ever
// see it, and none of this can regress a desktop control:
//
//   • Two-finger pinch  → zoom toward the midpoint (same maths as the wheel)
//   • Two-finger twist  → orbit
//   • Two-finger drag ↕ → pitch
//   • One finger        → left to the host (tap = place/select, drag = pan/move)
//
// All motion is damped toward a desired state; nothing snaps. The controller only
// reports `isMoving` so the host can drive on-demand rendering.

import * as THREE from 'three'

const DEG = Math.PI / 180

export interface BuilderCameraOptions {
  minPolar?: number // radians from +Y axis (small = looking down more)
  maxPolar?: number
  minDistance?: number
  maxDistance?: number
  damping?: number // 0..1 per-frame approach (higher = snappier)
}

export class BuilderCamera {
  readonly camera: THREE.PerspectiveCamera
  private dom: HTMLElement

  // spherical state around `target`
  private target = new THREE.Vector3(0, 0, 0)
  private desiredTarget = new THREE.Vector3(0, 0, 0)
  private azimuth = 45 * DEG
  private polar = 55 * DEG
  private distance = 4
  private desiredAzimuth = 45 * DEG
  private desiredPolar = 55 * DEG
  private desiredDistance = 4

  private minPolar: number
  private maxPolar: number
  private minDistance: number
  private maxDistance: number
  private damping: number

  // input
  private dragButton: number | null = null
  private lastX = 0
  private lastY = 0
  // Live touch points, by pointerId. Two of them = a camera gesture; one is the
  // host's business (tap to place, drag to pan or move a piece).
  private touches = new Map<number, { x: number; y: number }>()
  private gesture: { dist: number; angle: number; midY: number } | null = null
  private keys = new Set<string>()
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private raycaster = new THREE.Raycaster()
  private ndc = new THREE.Vector2()

  private onChange: () => void

  constructor(
    camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    onChange: () => void,
    opts: BuilderCameraOptions = {},
  ) {
    this.camera = camera
    this.dom = dom
    this.onChange = onChange
    this.minPolar = opts.minPolar ?? 15 * DEG
    this.maxPolar = opts.maxPolar ?? 80 * DEG
    this.minDistance = opts.minDistance ?? 0.4
    this.maxDistance = opts.maxDistance ?? 30
    this.damping = opts.damping ?? 0.18

    camera.up.set(0, 1, 0)
    this.attach()
    this.applyImmediate()
  }

  // ---- public API ---------------------------------------------------------

  /** Step the damped camera. Returns true while still moving (host keeps rendering). */
  update(): boolean {
    // keyboard pan (frame-rate independent enough for feel)
    if (this.keys.size) this.applyKeyboardPan()

    const aD = this.desiredAzimuth - this.azimuth
    const pD = this.desiredPolar - this.polar
    const dD = this.desiredDistance - this.distance
    const tD = this.desiredTarget.distanceTo(this.target)

    const moving =
      Math.abs(aD) > 1e-4 || Math.abs(pD) > 1e-4 || Math.abs(dD) > 1e-4 || tD > 1e-4 || this.keys.size > 0

    if (moving) {
      const k = this.damping
      this.azimuth += aD * k
      this.polar += pD * k
      this.distance += dD * k
      this.target.lerp(this.desiredTarget, k)
      this.applyImmediate()
    }
    return moving
  }

  /** Frame a world-space box (selection or whole table) at a 3/4 angle. */
  frameBox(box: THREE.Box3) {
    if (box.isEmpty()) return
    const center = new THREE.Vector3()
    const size = new THREE.Vector3()
    box.getCenter(center)
    box.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z, 0.3)
    const fov = this.camera.fov * DEG
    const dist = (maxDim * 1.3) / Math.tan(fov / 2)
    this.desiredTarget.copy(center)
    this.desiredDistance = THREE.MathUtils.clamp(dist, this.minDistance, this.maxDistance)
    this.onChange()
  }

  /** Reset to the default 3/4 builder angle, framing a box. */
  home(box: THREE.Box3) {
    this.desiredAzimuth = 45 * DEG
    this.desiredPolar = 55 * DEG
    this.frameBox(box)
  }

  setTarget(v: THREE.Vector3) {
    this.desiredTarget.copy(v)
    this.onChange()
  }

  /**
   * Pan the view by a screen-space delta. Public so the host can drive a
   * one-finger drag across empty table as a pan (touch has no middle button).
   */
  panByScreenDelta(dx: number, dy: number) {
    this.panByPixels(dx, dy)
    this.onChange()
  }

  /** True while two or more fingers are down — the host suppresses its own drag. */
  isGesturing(): boolean {
    return this.touches.size >= 2
  }

  dispose() {
    this.detach()
  }

  // ---- internals ----------------------------------------------------------

  private applyImmediate() {
    this.polar = THREE.MathUtils.clamp(this.polar, this.minPolar, this.maxPolar)
    this.distance = THREE.MathUtils.clamp(this.distance, this.minDistance, this.maxDistance)
    const sinP = Math.sin(this.polar)
    const x = this.target.x + this.distance * sinP * Math.sin(this.azimuth)
    const y = this.target.y + this.distance * Math.cos(this.polar)
    const z = this.target.z + this.distance * sinP * Math.cos(this.azimuth)
    this.camera.position.set(x, y, z)
    this.camera.lookAt(this.target)
  }

  private attach() {
    this.dom.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
    this.dom.addEventListener('wheel', this.onWheel, { passive: false })
    this.dom.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  private detach() {
    this.dom.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    this.dom.removeEventListener('wheel', this.onWheel)
    this.dom.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
  }

  // Right (2) = orbit, Middle (1) = pan. Left (0) is left for the host (place/select).
  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      // The second finger starts a camera gesture; capture its baseline so the
      // first move frame doesn't jump.
      if (this.touches.size === 2) this.gesture = this.readGesture()
      return
    }
    if (e.button === 2 || e.button === 1) {
      this.dragButton = e.button
      this.lastX = e.clientX
      this.lastY = e.clientY
      e.preventDefault()
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (!this.touches.has(e.pointerId)) return
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.touches.size >= 2) this.applyTouchGesture()
      return
    }
    if (this.dragButton === null) return
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY

    if (this.dragButton === 2) {
      // orbit
      this.desiredAzimuth -= dx * 0.005
      this.desiredPolar = THREE.MathUtils.clamp(
        this.desiredPolar - dy * 0.005,
        this.minPolar,
        this.maxPolar,
      )
    } else if (this.dragButton === 1) {
      this.panByPixels(dx, dy)
    }
    this.onChange()
  }

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId)
      // Dropping below two fingers ends the gesture. Re-baseline if fingers are
      // still down, so lifting one of three doesn't snap the view.
      this.gesture = this.touches.size >= 2 ? this.readGesture() : null
      return
    }
    if (e.button === this.dragButton) this.dragButton = null
  }

  // ---- touch gestures -----------------------------------------------------

  /** Pinch distance, twist angle and midpoint height of the first two fingers. */
  private readGesture(): { dist: number; angle: number; midY: number } {
    const [a, b] = [...this.touches.values()]
    const dx = b.x - a.x
    const dy = b.y - a.y
    return {
      dist: Math.max(1, Math.hypot(dx, dy)),
      angle: Math.atan2(dy, dx),
      midY: (a.y + b.y) / 2,
    }
  }

  /**
   * Two fingers: pinch zooms (toward the midpoint, like the wheel zooms toward
   * the cursor), twisting orbits, and dragging both fingers up/down pitches.
   * Midpoint horizontal travel is deliberately ignored — it's nearly always the
   * by-product of a twist, and panning it too makes the view feel slippery.
   */
  private applyTouchGesture() {
    const prev = this.gesture
    const now = this.readGesture()
    this.gesture = now
    if (!prev) return

    const [a, b] = [...this.touches.values()]
    this.zoomToward((a.x + b.x) / 2, (a.y + b.y) / 2, prev.dist / now.dist)

    // Twist → orbit. Normalise to (-π, π] so crossing the ±180° seam doesn't spin.
    let dAngle = now.angle - prev.angle
    if (dAngle > Math.PI) dAngle -= 2 * Math.PI
    if (dAngle < -Math.PI) dAngle += 2 * Math.PI
    this.desiredAzimuth += dAngle

    // Both fingers travelling vertically → pitch, same sensitivity as a right-drag.
    this.desiredPolar = THREE.MathUtils.clamp(
      this.desiredPolar - (now.midY - prev.midY) * 0.005,
      this.minPolar,
      this.maxPolar,
    )
    this.onChange()
  }

  private onContextMenu = (e: Event) => e.preventDefault()

  // Pan the target in the ground plane, scaled so a pixel ≈ same world delta
  // regardless of zoom.
  private panByPixels(dx: number, dy: number) {
    const scale = (this.distance * 0.0018)
    const forward = new THREE.Vector3(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth))
    const right = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth))
    this.desiredTarget.addScaledVector(right, -dx * scale)
    this.desiredTarget.addScaledVector(forward, dy * scale)
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.zoomToward(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0012)) // smooth, multiplicative
  }

  /**
   * Scale the view distance by `factor`, keeping the world point under
   * (clientX, clientY) pinned on screen. Shared by the wheel and pinch-zoom.
   */
  private zoomToward(clientX: number, clientY: number, factor: number) {
    if (!isFinite(factor) || factor <= 0) return
    const rect = this.dom.getBoundingClientRect()
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1

    // world point currently under the cursor / pinch centre (on the ground plane)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hit = new THREE.Vector3()
    const hasHit = this.raycaster.ray.intersectPlane(this.groundPlane, hit) !== null

    const newDistance = THREE.MathUtils.clamp(
      this.desiredDistance * factor,
      this.minDistance,
      this.maxDistance,
    )

    if (hasHit) {
      // Shift the target toward that point so it stays put on screen.
      const t = 1 - newDistance / this.desiredDistance
      this.desiredTarget.lerp(hit, THREE.MathUtils.clamp(t, -1, 1))
    }
    this.desiredDistance = newDistance
    this.onChange()
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTextTarget(e)) return
    if (e.ctrlKey || e.metaKey || e.altKey) return // don't pan during Ctrl/Cmd/Alt shortcuts
    const k = e.key.toLowerCase()
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      this.keys.add(k)
      this.onChange()
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase())
  }

  private isTextTarget(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  }

  private applyKeyboardPan() {
    const step = this.distance * 0.012
    const forward = new THREE.Vector3(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth))
    const right = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth))
    if (this.keys.has('w') || this.keys.has('arrowup')) this.desiredTarget.addScaledVector(forward, step)
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.desiredTarget.addScaledVector(forward, -step)
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.desiredTarget.addScaledVector(right, -step)
    if (this.keys.has('d') || this.keys.has('arrowright')) this.desiredTarget.addScaledVector(right, step)
  }
}
