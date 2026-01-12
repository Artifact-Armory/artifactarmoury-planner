// src/scene/helpers.ts
import * as THREE from 'three'

export function GridHelper(width: number, height: number, cell: number) {
  const group = new THREE.Group()
  const matMinor = new THREE.LineBasicMaterial({ color: 0x243246 })
  const matMajor = new THREE.LineBasicMaterial({ color: 0x3a4e6a })

  const hw = width / 2
  const hh = height / 2

  const minor = new THREE.BufferGeometry()
  const major = new THREE.BufferGeometry()
  const minorVerts: number[] = []
  const majorVerts: number[] = []

  const cols = Math.floor(width / cell)
  for (let i = -Math.floor(cols / 2); i <= Math.floor(cols / 2); i++) {
    const x = i * cell
    const verts = i % 5 === 0 ? majorVerts : minorVerts
    // vertical lines along Z on the XZ plane (y = 0)
    verts.push(x, 0, -hh, x, 0, hh)
  }

  const rows = Math.floor(height / cell)
  for (let j = -Math.floor(rows / 2); j <= Math.floor(rows / 2); j++) {
    const z = j * cell
    const verts = j % 5 === 0 ? majorVerts : minorVerts
    // horizontal lines along X on the XZ plane (y = 0)
    verts.push(-hw, 0, z, hw, 0, z)
  }

  minor.setAttribute('position', new THREE.Float32BufferAttribute(minorVerts, 3))
  major.setAttribute('position', new THREE.Float32BufferAttribute(majorVerts, 3))

  const minorLines = new THREE.LineSegments(minor, matMinor)
  const majorLines = new THREE.LineSegments(major, matMajor)

  group.add(minorLines, majorLines)
  return group
}
