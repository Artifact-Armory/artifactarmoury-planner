import * as THREE from 'three'

const X = new THREE.Vector3(1, 0, 0)
const Z = new THREE.Vector3(0, 0, 1)
const tmpRoll = new THREE.Quaternion()
const tmpPitch = new THREE.Quaternion()
const tmpV = new THREE.Vector3()

/**
 * Tilt applied to a base-aligned model: roll about its local Z first, then pitch
 * about X. (Pitch alone can't stand up a figure lying along X — roll can.)
 */
export function tiltQuaternion(pitchDeg: number, rollDeg: number, out: THREE.Quaternion): THREE.Quaternion {
  tmpRoll.setFromAxisAngle(Z, THREE.MathUtils.degToRad(rollDeg))
  tmpPitch.setFromAxisAngle(X, THREE.MathUtils.degToRad(pitchDeg))
  return out.copy(tmpPitch).multiply(tmpRoll)
}

/**
 * How far to lift a tilted model so its lowest point rests on y=0. The model is
 * base-aligned (x,z centred, y ∈ [0, H]) and tilts about its base-centre; yaw
 * about Y doesn't change heights, so it's ignored.
 */
export function groundOffset(tilt: THREE.Quaternion, aabb: { x: number; y: number; z: number }): number {
  let minY = Infinity
  for (const sx of [-0.5, 0.5]) for (const y of [0, aabb.y]) for (const sz of [-0.5, 0.5]) {
    minY = Math.min(minY, tmpV.set(sx * aabb.x, y, sz * aabb.z).applyQuaternion(tilt).y)
  }
  return -minY
}
