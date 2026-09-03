// src/core/terrainPaths.ts
//
// Path-based terrain features — currently just the ditch, built Manor Lords
// road-style: click a point, click another to add a segment, click again for
// a corner, Enter/Finish to commit. Kept separate from terrainFeatures.ts
// (the circular hill/plateau stamps) because the shape and the placement
// interaction are both fundamentally different (a polyline you draw over
// several clicks, not a single click-to-drop point).
//
// THE KEY DESIGN CONSTRAINT: a ditch must never carve below the table's base
// (y=0) — the printable-tile backend builds a flat bottom shell under the
// surface, so a trench that dips below the base isn't a "deeper hole", it's
// unprintable geometry (either the base has to sink to match, wasting print
// material everywhere, or the trench clips straight through the bottom of
// the tile). So a ditch's FLOOR sits at 0 (flush with the base, unchanged),
// and it raises the ground on either side instead — like the spoil banks
// alongside a real dug trench. Everything this module produces is >= 0.

import type { Table } from '../state/store'
import { MAX_HEIGHT } from './heightmap'

export type TerrainPathKind = 'ditch' // future: 'road' | 'river', same polyline machinery

export interface TerrainPath {
  id: string
  kind: TerrainPathKind
  points: Array<{ x: number; z: number }> // world metres, table-centred; >=2 once committed
  /** Full width (metres) of the flat trench floor, flush with the table base. */
  channelWidth: number
  /** Width (metres) of the raised bank on EACH side of the channel. */
  bermWidth: number
  /** Peak height (metres) of the raised bank — always >= 0, see module doc. */
  bermHeight: number
}

export const DITCH_DEFAULTS = {
  channelWidth: 0.15,
  bermWidth: 0.12,
  bermHeight: 0.05,
}

export const DITCH_CHANNEL_RANGE = { min: 0.05, max: 0.5, step: 0.01 }
export const DITCH_BERM_WIDTH_RANGE = { min: 0.02, max: 0.3, step: 0.01 }
export const DITCH_BERM_HEIGHT_RANGE = { min: 0, max: Math.min(0.12, MAX_HEIGHT), step: 0.005 }

export function newPathId(): string {
  return `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function defaultPath(kind: TerrainPathKind, points: Array<{ x: number; z: number }>): TerrainPath {
  return { id: newPathId(), kind, points, ...DITCH_DEFAULTS }
}

/** Shortest distance from (x,z) to a single segment (x0,z0)-(x1,z1). */
function distToSegment(x: number, z: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0, dz = z1 - z0
  const lenSq = dx * dx + dz * dz
  if (lenSq < 1e-9) return Math.hypot(x - x0, z - z0)
  let t = ((x - x0) * dx + (z - z0) * dz) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz))
}

/** Shortest distance from (x,z) to the whole polyline (or to its single point, if degenerate). */
export function distToPath(points: Array<{ x: number; z: number }>, x: number, z: number): number {
  if (points.length === 0) return Infinity
  if (points.length === 1) return Math.hypot(x - points[0].x, z - points[0].z)
  let best = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    const d = distToSegment(x, z, a.x, a.z, b.x, b.z)
    if (d < best) best = d
  }
  return best
}

/**
 * This path's height contribution (metres, always >= 0) at world (x, z).
 * Cross-section, as distance `d` from the centreline increases:
 *   [0, innerHalf]                 → 0 (the trench floor, flush with base)
 *   [innerHalf, innerHalf+bermW]   → a smooth 0→peak→0 hump (the spoil bank)
 *   beyond                         → 0 (back to surrounding ground)
 */
export function pathContribution(path: TerrainPath, x: number, z: number): number {
  if (path.points.length === 0 || path.bermHeight <= 0) return 0
  const d = distToPath(path.points, x, z)
  const innerHalf = path.channelWidth / 2
  const outerHalf = innerHalf + path.bermWidth
  if (d <= innerHalf || d >= outerHalf || path.bermWidth <= 0) return 0
  const u = (d - innerHalf) / path.bermWidth // 0..1 across the bank
  return path.bermHeight * Math.sin(Math.PI * u) // smooth hump, 0 at both edges
}

export function pathsHeightAt(paths: TerrainPath[], x: number, z: number): number {
  let h = 0
  for (const p of paths) h += pathContribution(p, x, z)
  return h
}

/** Translate every point of a path by (dx, dz), clamped to stay on the table. */
export function translatePath(path: TerrainPath, dx: number, dz: number, table: Table): TerrainPath {
  const hw = table.width / 2, hh = table.height / 2
  return {
    ...path,
    points: path.points.map((p) => ({
      x: Math.min(hw, Math.max(-hw, p.x + dx)),
      z: Math.min(hh, Math.max(-hh, p.z + dz)),
    })),
  }
}

// ---- persistence ------------------------------------------------------

export function serializePaths(paths: TerrainPath[]): TerrainPath[] | null {
  return paths.length ? paths : null
}

export function deserializePaths(data: any): TerrainPath[] {
  if (!Array.isArray(data)) return []
  return data
    .map((p: any): TerrainPath | null => {
      if (p?.kind !== 'ditch') return null
      const points = Array.isArray(p.points)
        ? p.points
            .map((pt: any) => ({ x: Number(pt?.x), z: Number(pt?.z) }))
            .filter((pt: any) => Number.isFinite(pt.x) && Number.isFinite(pt.z))
        : []
      if (points.length < 2) return null
      const channelWidth = Number(p.channelWidth), bermWidth = Number(p.bermWidth), bermHeight = Number(p.bermHeight)
      if (![channelWidth, bermWidth, bermHeight].every(Number.isFinite)) return null
      return {
        id: typeof p.id === 'string' && p.id ? p.id : newPathId(),
        kind: 'ditch', points, channelWidth, bermWidth, bermHeight: Math.max(0, bermHeight),
      }
    })
    .filter((p): p is TerrainPath => p !== null)
}
