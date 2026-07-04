// src/core/heightmap.ts
//
// Deformable table surface = a single-valued height field (a "heightmap") sampled
// on a regular grid that spans the table. Sculpting brushes raise/lower/smooth/
// flatten the heights; the mesh is rebuilt from the field. Cliffs are steep
// slopes (a heightmap can't do overhangs), which is also what prints cleanly.
//
// This module is deliberately framework-free (pure data + THREE geometry helpers)
// so the same field can later be shipped to the backend to generate printable
// STL tiles. See memory `project-terrain-sculpting`.

import * as THREE from 'three'
import type { Table } from '../state/store'

export type TerrainTool = 'none' | 'raise' | 'lower' | 'smooth' | 'flatten'

export interface Heightmap {
  /** Vertices along X (width). */
  cols: number
  /** Vertices along Z (height/depth). */
  rows: number
  /** Height (metres) at each vertex, row-major: heights[j * cols + i]. 0 = table top. */
  heights: Float32Array
}

/** Target spacing between height samples (metres). ~2.5cm keeps a 6×4ft table light. */
export const TERRAIN_CELL = 0.025
/** Clamp the surface so a single brush can't punch absurd spikes/pits. */
export const MAX_HEIGHT = 0.35
export const MIN_HEIGHT = -0.18

export function terrainDims(table: Table): { cols: number; rows: number } {
  const cols = Math.max(2, Math.round(table.width / TERRAIN_CELL) + 1)
  const rows = Math.max(2, Math.round(table.height / TERRAIN_CELL) + 1)
  return { cols, rows }
}

export function createHeightmap(table: Table): Heightmap {
  const { cols, rows } = terrainDims(table)
  return { cols, rows, heights: new Float32Array(cols * rows) }
}

/** The heightmap fits the table when its grid matches the table's target resolution. */
export function heightmapFitsTable(hm: Heightmap | null | undefined, table: Table): hm is Heightmap {
  if (!hm) return false
  const { cols, rows } = terrainDims(table)
  return hm.cols === cols && hm.rows === rows && hm.heights.length === cols * rows
}

export function isFlat(hm: Heightmap | null | undefined): boolean {
  if (!hm) return true
  for (let k = 0; k < hm.heights.length; k++) if (Math.abs(hm.heights[k]) > 1e-4) return false
  return true
}

/** World position (metres) of vertex (i, j) for the current table. */
function vertX(i: number, cols: number, table: Table) {
  return -table.width / 2 + (i / (cols - 1)) * table.width
}
function vertZ(j: number, rows: number, table: Table) {
  return -table.height / 2 + (j / (rows - 1)) * table.height
}

/** Build a fresh terrain mesh geometry from the height field. */
export function buildTerrainGeometry(hm: Heightmap, table: Table): THREE.BufferGeometry {
  const { cols, rows } = hm
  const positions = new Float32Array(cols * rows * 3)
  const uvs = new Float32Array(cols * rows * 2)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i
      positions[idx * 3] = vertX(i, cols, table)
      positions[idx * 3 + 1] = hm.heights[idx]
      positions[idx * 3 + 2] = vertZ(j, rows, table)
      uvs[idx * 2] = i / (cols - 1)
      uvs[idx * 2 + 1] = j / (rows - 1)
    }
  }
  const indices: number[] = []
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i
      const b = j * cols + i + 1
      const c = (j + 1) * cols + i
      const d = (j + 1) * cols + i + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('uv2', new THREE.BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/** Push updated heights into an existing geometry (positions + normals only). */
export function updateTerrainGeometry(geo: THREE.BufferGeometry, hm: Heightmap) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const arr = pos.array as Float32Array
  for (let k = 0; k < hm.heights.length; k++) arr[k * 3 + 1] = hm.heights[k]
  pos.needsUpdate = true
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
}

/**
 * Apply one brush dab centred at world (wx, wz). `strength` is 0..1 from the UI;
 * `radius` is in metres. Returns true if any height changed.
 */
export function applyBrush(
  hm: Heightmap,
  table: Table,
  wx: number,
  wz: number,
  tool: TerrainTool,
  radius: number,
  strength: number,
): boolean {
  if (tool === 'none' || radius <= 0) return false
  const { cols, rows } = hm
  const dx = table.width / (cols - 1)
  const dz = table.height / (rows - 1)

  // Grid-space bounding box of the brush.
  const ci = (wx + table.width / 2) / dx
  const cj = (wz + table.height / 2) / dz
  const ri = radius / dx
  const rj = radius / dz
  const i0 = Math.max(0, Math.floor(ci - ri))
  const i1 = Math.min(cols - 1, Math.ceil(ci + ri))
  const j0 = Math.max(0, Math.floor(cj - rj))
  const j1 = Math.min(rows - 1, Math.ceil(cj + rj))
  if (i0 > i1 || j0 > j1) return false

  // Per-dab magnitude in metres (scaled by the surface range so the slider feels
  // consistent across brushes).
  const amount = strength * 0.05
  const centreH = hm.heights[Math.round(cj) * cols + Math.round(ci)] ?? 0
  let changed = false

  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const wxi = vertX(i, cols, table)
      const wzi = vertZ(j, rows, table)
      const dist = Math.hypot(wxi - wx, wzi - wz)
      if (dist > radius) continue
      // Smooth falloff (1 at centre → 0 at the edge).
      const t = 1 - dist / radius
      const falloff = t * t * (3 - 2 * t)
      const idx = j * cols + i
      const h = hm.heights[idx]
      let next = h

      if (tool === 'raise') next = h + amount * falloff
      else if (tool === 'lower') next = h - amount * falloff
      else if (tool === 'flatten') next = h + (centreH - h) * falloff * Math.min(1, strength)
      else if (tool === 'smooth') {
        // Blend toward the average of the 4-neighbourhood.
        let sum = 0
        let n = 0
        if (i > 0) { sum += hm.heights[idx - 1]; n++ }
        if (i < cols - 1) { sum += hm.heights[idx + 1]; n++ }
        if (j > 0) { sum += hm.heights[idx - cols]; n++ }
        if (j < rows - 1) { sum += hm.heights[idx + cols]; n++ }
        const avg = n ? sum / n : h
        next = h + (avg - h) * falloff * Math.min(1, strength)
      }

      next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, next))
      if (next !== h) { hm.heights[idx] = next; changed = true }
    }
  }
  return changed
}

// ---- persistence (compact: heights quantised to millimetres) --------------

export interface SerializedHeightmap {
  cols: number
  rows: number
  /** Heights in millimetres (integers) to keep the JSON small. */
  mm: number[]
}

export function serializeHeightmap(hm: Heightmap | null): SerializedHeightmap | null {
  if (!hm || isFlat(hm)) return null
  const mm = new Array(hm.heights.length)
  for (let k = 0; k < hm.heights.length; k++) mm[k] = Math.round(hm.heights[k] * 1000)
  return { cols: hm.cols, rows: hm.rows, mm }
}

export function deserializeHeightmap(data: any, table: Table): Heightmap | null {
  if (!data || !Array.isArray(data.mm)) return null
  const { cols, rows } = terrainDims(table)
  // Only accept a field that matches the current table resolution.
  if (data.cols !== cols || data.rows !== rows || data.mm.length !== cols * rows) return null
  const heights = new Float32Array(cols * rows)
  for (let k = 0; k < heights.length; k++) heights[k] = (Number(data.mm[k]) || 0) / 1000
  return { cols, rows, heights }
}
