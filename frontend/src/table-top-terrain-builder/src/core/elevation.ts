// src/core/elevation.ts
//
// Modular height tiles. Elevation is built by stamping catalogue tiles, so there
// is no raster heightmap — every tile is an ordinary SKU on the command stack and
// in the bill-of-materials. This module owns the discrete-level maths:
//
//   • a vertical grid measured in integer "levels" (sub-units, so half-height tiles
//     are first-class: a full block = 2 levels, a half block = 1)
//   • the per-cell "current top" lookup the ghost uses to sit on whatever it hovers
//   • 3D occupancy (cell × level slab) so stacked tiles don't collide

import type { Asset } from './assets'
import type { Table } from '../state/store'
import {
  worldToCell, snapRotationForFootprint,
  type Cell,
} from './occupancy'
import { footprintCellsFor, footprintVersion } from './footprintMask'

/** Metres per elevation level (a half-block step). A full 1-inch block is 2 levels. */
export const LEVEL_HEIGHT = 0.0127

export function levelToY(level: number): number {
  return level * LEVEL_HEIGHT
}

/** Vertical levels a tile contributes to the surface (0 for props that don't raise it). */
export function heightUnits(asset: Asset): number {
  return asset.elevation?.heightUnits ?? 0
}

/**
 * Levels a piece adds to the surface for stacking. Modular tiles use their
 * explicit metadata (which may be 0 for flat floor tiles); ordinary uploaded
 * models have none, so fall back to their real height (aabb.y) — this is what
 * lets a model placed over another sit on top of it. Fractional (exact height).
 */
export function surfaceUnits(asset: Asset): number {
  const meta = asset.elevation?.heightUnits
  if (meta != null) return meta
  const h = asset.aabb?.y ?? 0
  return h > 0 ? h / LEVEL_HEIGHT : 0
}

/** Levels a piece physically occupies for collision (≥1 so props claim a slab). */
export function occupyUnits(asset: Asset): number {
  return Math.max(1, Math.ceil(surfaceUnits(asset)))
}

/**
 * Integer collision slabs a piece claims given its (possibly fractional) base —
 * the rounded top minus the rounded base. Unlike `occupyUnits` (which rounds the
 * height *up* from the piece's own base, over-reserving space), this measures the
 * span between where the piece actually sits and where it actually ends. That
 * makes identical pieces stacked on each other's exact tops tile the vertical grid
 * seamlessly (no phantom self-collision), so a model stacks as high as you like —
 * while a piece *buried* into another still overlaps an occupied slab and blocks.
 * Still ≥1 so flat props claim a slab.
 */
export function occupyUnitsAt(asset: Asset, base: number): number {
  const b = Math.round(base)
  const top = Math.round(base + surfaceUnits(asset))
  return Math.max(1, top - b)
}

/**
 * Smallest cell used for collision/stacking checks. Snapping can go finer (1mm),
 * but a footprint's cell count grows with 1/size², so checking at 1mm made every
 * mouse move test ~10,000 cells per piece. Checks run at this size instead.
 */
export const COLLISION_MIN_CELL = 0.005

/** `table` with its grid coarsened to the collision cell size (same object if already coarse). */
export function collisionTable(table: Table): Table {
  return table.gridSize >= COLLISION_MIN_CELL ? table : { ...table, gridSize: COLLISION_MIN_CELL }
}

export function isTile(asset: Asset): boolean {
  return heightUnits(asset) > 0
}

function placedCells(
  inst: { assetId: string; position: { x: number; z: number }; rotationDeg: number; mirrored?: boolean },
  asset: Asset,
  table: Table,
): Cell[] {
  const anchor = worldToCell(inst.position.x, inst.position.z, table)
  return footprintCellsFor(asset, anchor, snapRotationForFootprint(inst.rotationDeg), table.gridSize, inst.mirrored)
}

type PlacedInstance = {
  assetId: string
  position: { x: number; z: number }
  rotationDeg: number
  level: number
  mirrored?: boolean
}

/**
 * Highest occupied top (in levels) across the given target cells — i.e. what the
 * ghost should rest on. Table is level 0; a tile based at level L of height H
 * provides a top of L+H. Only tiles (height > 0) raise the surface.
 */
export function surfaceTop(
  instances: PlacedInstance[],
  assetsById: Map<string, Asset>,
  table: Table,
  targetCells: Cell[],
  excludeIds?: Set<string>,
): number {
  const tops = surfaceTopMap(instances, assetsById, table, excludeIds)
  let top = 0
  for (const c of targetCells) {
    const t = tops.get(key2(c.c, c.r))
    if (t != null && t > top) top = t
  }
  return top
}

const key2 = (c: number, r: number) => `${c},${r}`
const key3 = (c: number, r: number, l: number) => `${c},${r},${l}`

// The ghost asks these on every mouse move, but the answer only changes when
// the pieces, catalogue, grid or a footprint bitmap does, so keep the last one.
type CacheKey = { instances: unknown; assets: unknown; w: number; h: number; g: number; v: number; ex: string }
const sameKey = (a: CacheKey, b: CacheKey) =>
  a.instances === b.instances && a.assets === b.assets && a.w === b.w && a.h === b.h &&
  a.g === b.g && a.v === b.v && a.ex === b.ex
function cacheKey(instances: unknown, assets: unknown, table: Table, excludeIds?: Set<string>): CacheKey {
  return {
    instances, assets, w: table.width, h: table.height, g: table.gridSize, v: footprintVersion,
    ex: excludeIds?.size ? [...excludeIds].sort().join('|') : '',
  }
}
let topCache: { key: CacheKey; map: Map<string, number> } | null = null
let occCache: { key: CacheKey; set: Set<string> } | null = null

/** Highest top (in levels) per cell across all surface-raising pieces. */
function surfaceTopMap(
  instances: PlacedInstance[],
  assetsById: Map<string, Asset>,
  table: Table,
  excludeIds?: Set<string>,
): Map<string, number> {
  const key = cacheKey(instances, assetsById, table, excludeIds)
  if (topCache && sameKey(topCache.key, key)) return topCache.map
  const map = new Map<string, number>()
  for (const inst of instances) {
    if (excludeIds?.has((inst as any).id)) continue
    const asset = assetsById.get(inst.assetId)
    if (!asset) continue
    const units = surfaceUnits(asset)
    if (units <= 0) continue
    const top = (inst.level ?? 0) + units
    for (const cell of placedCells(inst, asset, table)) {
      const k = key2(cell.c, cell.r)
      const prev = map.get(k)
      if (prev == null || top > prev) map.set(k, top)
    }
  }
  topCache = { key, map }
  return map
}

/** Occupied (cell × level) slabs of all placed pieces. */
export function buildOccupied3D(
  instances: PlacedInstance[],
  assetsById: Map<string, Asset>,
  table: Table,
  excludeIds?: Set<string>,
): Set<string> {
  const key = cacheKey(instances, assetsById, table, excludeIds)
  if (occCache && sameKey(occCache.key, key)) return occCache.set
  const occ = new Set<string>()
  for (const inst of instances) {
    if (excludeIds?.has((inst as any).id)) continue
    const asset = assetsById.get(inst.assetId)
    if (!asset) continue
    // Bases can be fractional (a model stacked on another's exact top); snap to
    // integer slabs for the collision grid, measuring the span from this piece's
    // rounded base to its rounded top so stacked pieces tile without self-colliding.
    const base = Math.round(inst.level ?? 0)
    const units = occupyUnitsAt(asset, inst.level ?? 0)
    for (const cell of placedCells(inst, asset, table)) {
      if (cell.c < 0 || cell.r < 0) continue
      for (let l = base; l < base + units; l++) occ.add(key3(cell.c, cell.r, l))
    }
  }
  occCache = { key, set: occ }
  return occ
}

/** Does a footprint at [base, base+units) collide with occupied slabs? */
export function collides3D(cells: Cell[], base: number, units: number, occ: Set<string>): boolean {
  const b = Math.round(base) // base may be fractional (stacked on an exact top)
  for (const cell of cells) {
    for (let l = b; l < b + units; l++) {
      if (occ.has(key3(cell.c, cell.r, l))) return true
    }
  }
  return false
}
