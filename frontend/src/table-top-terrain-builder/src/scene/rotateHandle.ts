// src/scene/rotateHandle.ts
//
// The free-rotate gizmo: two curved arrow handles that sit flat on the table
// around the base of the selected piece. Unlike the keyboard/toolbar rotate
// (which steps by 90°/15°, see ThreeStage's rotationStep()), dragging a handle
// swings the piece to any angle — the point you grabbed keeps tracking the
// cursor as you drag it around the pivot.

import * as THREE from 'three'

const COLOR = new THREE.Color(0xffb020)
const ACTIVE_COLOR = new THREE.Color(0xffffff)

const ARC_INNER = 0.78
const ARC_OUTER = 1.0
const ARC_SPAN = THREE.MathUtils.degToRad(100)
const HEAD_END_ANGLE = ARC_SPAN / 2 // the arc's leading end, where the arrowhead sits

/** One curved-arrow handle: a partial ring + a triangular arrowhead at its tip,
 *  built in the local XY plane (angle measured from +X, same convention as
 *  Math.atan2), at unit radius — the caller scales/positions the whole gizmo. */
function buildHandleUnit(): THREE.Group {
  const group = new THREE.Group()
  const matOpts = { transparent: true, opacity: 0.92, depthTest: false, side: THREE.DoubleSide as THREE.Side }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ARC_INNER, ARC_OUTER, 28, 1, -ARC_SPAN / 2, ARC_SPAN),
    new THREE.MeshBasicMaterial({ color: COLOR.clone(), ...matOpts }),
  )
  ring.renderOrder = 1000
  group.add(ring)

  // Arrowhead: a flat triangle pointing tangentially (the direction of
  // increasing angle) from the ring's leading end.
  const midR = (ARC_INNER + ARC_OUTER) / 2
  const h = (ARC_OUTER - ARC_INNER) * 1.7
  const w = h * 0.95
  const headShape = new THREE.Shape()
  headShape.moveTo(0, h / 2)
  headShape.lineTo(-w / 2, -h / 2)
  headShape.lineTo(w / 2, -h / 2)
  headShape.closePath()
  const head = new THREE.Mesh(
    new THREE.ShapeGeometry(headShape),
    new THREE.MeshBasicMaterial({ color: COLOR.clone(), ...matOpts }),
  )
  head.position.set(midR * Math.cos(HEAD_END_ANGLE), midR * Math.sin(HEAD_END_ANGLE), 0)
  // A shape built pointing along local +Y, rotated by the tangent angle at this
  // point on the ring, points the way increasing angle goes.
  head.rotation.z = HEAD_END_ANGLE
  head.renderOrder = 1000
  group.add(head)

  return group
}

export class RotateHandle {
  readonly group = new THREE.Group()
  /** World-space pivot from the last setTransform() — what drag math rotates around. */
  center = { x: 0, z: 0 }

  private handleA = buildHandleUnit()
  private handleB = buildHandleUnit()
  private materials: THREE.MeshBasicMaterial[]

  constructor() {
    // Opposite side of the circle, same rotational sense as handleA — two
    // reachable grab points rather than a "clockwise" one and a "counter-
    // clockwise" one (either can be dragged either way once grabbed).
    this.handleB.rotation.z = Math.PI
    // The units are built flat in the local XY plane; lay the whole gizmo down
    // onto the ground (world XZ) once, here, and never touch this rotation again.
    this.group.rotation.x = -Math.PI / 2
    this.group.add(this.handleA, this.handleB)
    this.group.visible = false
    this.group.renderOrder = 1000
    this.materials = [this.handleA, this.handleB].flatMap((g) =>
      g.children.map((c) => (c as THREE.Mesh).material as THREE.MeshBasicMaterial),
    )
  }

  /** Every pickable mesh, for raycasting. */
  get pickables(): THREE.Object3D[] {
    return [...this.handleA.children, ...this.handleB.children]
  }

  get visible(): boolean {
    return this.group.visible
  }

  /** Position at world (x, z), floating `y` above the table, sized to `radius`. */
  setTransform(x: number, y: number, z: number, radius: number) {
    this.center = { x, z }
    this.group.position.set(x, y, z)
    this.group.scale.setScalar(radius)
    this.group.visible = true
    // Raycasting can happen synchronously on the next pointer event, before the
    // next render loop would otherwise refresh matrixWorld — keep it current.
    this.group.updateMatrixWorld(true)
  }

  hide() {
    this.group.visible = false
  }

  /** Brighten while a handle is actively being dragged. */
  setActive(active: boolean) {
    for (const m of this.materials) m.color.copy(active ? ACTIVE_COLOR : COLOR)
  }

  dispose() {
    for (const g of [this.handleA, this.handleB]) {
      for (const child of g.children) {
        const mesh = child as THREE.Mesh
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
    }
  }
}
