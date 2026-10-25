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
 * Where to move a tilted model so it rests on y=0 AND stays centred on its spot.
 * The model is base-aligned (x,z centred, y ∈ [0, H]) and tilts about its
 * base-centre, so a 90° pitch alone would swing it H/2 to one side of where it
 * was placed (off its footprint, selection ring and grid square). Returns the
 * offset in the tilt's parent frame (before yaw): x/z re-centre the tilted box,
 * y lifts its lowest point to the table.
 */
export function tiltOffset(tilt: THREE.Quaternion, aabb: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity
  for (const sx of [-0.5, 0.5]) for (const y of [0, aabb.y]) for (const sz of [-0.5, 0.5]) {
    tmpV.set(sx * aabb.x, y, sz * aabb.z).applyQuaternion(tilt)
    minX = Math.min(minX, tmpV.x); maxX = Math.max(maxX, tmpV.x)
    minY = Math.min(minY, tmpV.y)
    minZ = Math.min(minZ, tmpV.z); maxZ = Math.max(maxZ, tmpV.z)
  }
  return out.set(-(minX + maxX) / 2, -minY, -(minZ + maxZ) / 2)
}
