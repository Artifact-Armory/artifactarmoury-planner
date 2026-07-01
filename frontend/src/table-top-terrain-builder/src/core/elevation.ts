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
  worldToCell, aabbFootprint, footprintCells, snapRotationForFootprint,
  type Cell,
} from './occupancy'

/** Metres per elevation level (a half-block step). A full 1-inch block is 2 levels. */
export const LEVEL_HEIGHT = 0.0127

export function levelToY(level: number): number {
  return level * LEVEL_HEIGHT
}

/** Vertical levels a tile contributes to the surface (0 for props that don't raise it). */
export function heightUnits(asset: Asset): number {
  return asset.elevation?.heightUnits ?? 0
}

/** Levels a piece physically occupies (≥1 so props still claim their own slab). */
export function occupyUnits(asset: Asset): number {
  return Math.max(1, heightUnits(asset))
}

export function isTile(asset: Asset): boolean {
  return heightUnits(asset) > 0
}

function placedCells(
  inst: { assetId: string; position: { x: number; z: number }; rotationDeg: number },
  asset: Asset,
  table: Table,
): Cell[] {
  const anchor = worldToCell(inst.position.x, inst.position.z, table)
  const fp = aabbFootprint(asset, snapRotationForFootprint(inst.rotationDeg), table.gridSize)
  return footprintCells(anchor, fp)
}

type PlacedInstance = {
  assetId: string
  position: { x: number; z: number }
  rotationDeg: number
  level: number
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
  let top = 0
  for (const inst of instances) {
    if (excludeIds?.has((inst as any).id)) continue
    const asset = assetsById.get(inst.assetId)
    if (!asset) continue
    const units = heightUnits(asset)
    if (units <= 0) continue
    const cells = placedCells(inst, asset, table)
    const covers = cells.some((oc) => targetCells.some((c) => c.c === oc.c && c.r === oc.r))
    if (!covers) continue
    top = Math.max(top, (inst.level ?? 0) + units)
  }
  return top
}

const key3 = (c: number, r: number, l: number) => `${c},${r},${l}`

/** Occupied (cell × level) slabs of all placed pieces. */
export function buildOccupied3D(
  instances: PlacedInstance[],
  assetsById: Map<string, Asset>,
  table: Table,
  excludeIds?: Set<string>,
): Set<string> {
  const occ = new Set<string>()
  for (const inst of instances) {
    if (excludeIds?.has((inst as any).id)) continue
    const asset = assetsById.get(inst.assetId)
    if (!asset) continue
    const base = inst.level ?? 0
    const units = occupyUnits(asset)
    for (const cell of placedCells(inst, asset, table)) {
      if (cell.c < 0 || cell.r < 0) continue
      for (let l = base; l < base + units; l++) occ.add(key3(cell.c, cell.r, l))
    }
  }
  return occ
}

/** Does a footprint at [base, base+units) collide with occupied slabs? */
export function collides3D(cells: Cell[], base: number, units: number, occ: Set<string>): boolean {
  for (const cell of cells) {
    for (let l = base; l < base + units; l++) {
      if (occ.has(key3(cell.c, cell.r, l))) return true
    }
  }
  return false
}
