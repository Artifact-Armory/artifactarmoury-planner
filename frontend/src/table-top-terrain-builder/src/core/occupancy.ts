// src/core/occupancy.ts
import type { Asset } from '@core/assets'
import type { Table } from '@state/store'

export type Rotation = 0|90|180|270
export type Cell = { c: number; r: number }

// Grid dimensions in cells (centre-origin board, but indices are 0..N-1)
export function gridDims(table: Table){
  const cols = Math.max(1, Math.round(table.width  / table.gridSize) + 1)
  const rows = Math.max(1, Math.round(table.height / table.gridSize) + 1)
  return { cols, rows }
}

// World (metres) → cell index (0..N-1), rounding to nearest cell
export function worldToCell(x: number, z: number, table: Table){
  const { cols, rows } = gridDims(table)
  const u = (x + table.width  / 2) / table.gridSize
  const v = (z + table.height / 2) / table.gridSize
  const c = clamp(Math.round(u), 0, cols - 1)
  const r = clamp(Math.round(v), 0, rows - 1)
  return { c, r }
}

// Footprint derived from AABB vs current grid size, rotated in the XZ plane
export function aabbFootprint(asset: Asset, rot: Rotation, gridSize: number){
  // Use default dimensions of 1 if aabb is undefined
  const aabb = asset.aabb || { x: gridSize, z: gridSize }
  const w = rot === 90 || rot === 270 ? aabb.z : aabb.x // width along X
  const d = rot === 90 || rot === 270 ? aabb.x : aabb.z // depth along Z
  const cols = Math.max(1, Math.ceil(w / gridSize))
  const rows = Math.max(1, Math.ceil(d / gridSize))
  return { cols, rows }
}

// Helper to snap any rotation to nearest 90° for footprint calculation
export function snapRotationForFootprint(rotationDeg: number): Rotation {
  const snapped = Math.round(rotationDeg / 90) * 90
  return ((snapped % 360) + 360) % 360 as Rotation
}

// Cells covered when the anchor (cursor) cell is the centre of the object
export function footprintCells(anchor: Cell, fp: {cols:number;rows:number}): Cell[] {
  const baseC = anchor.c - Math.floor(fp.cols / 2)
  const baseR = anchor.r - Math.floor(fp.rows / 2)
  const cells: Cell[] = []
  for (let dc = 0; dc < fp.cols; dc++){
    for (let dr = 0; dr < fp.rows; dr++){
      cells.push({ c: baseC + dc, r: baseR + dr })
    }
  }
  return cells
}

export function inBounds(cells: Cell[], table: Table){
  const { cols, rows } = gridDims(table)
  return cells.every(({c,r}) => c >= 0 && r >= 0 && c < cols && r < rows)
}

// Build an occupied-set from placed instances using dynamic footprints
export function buildOccupiedSet(
  instances: {assetId:string; position:{x:number;z:number}; rotationDeg:number}[],
  assetsById: Map<string, Asset>,
  table: Table
){
  const occ = new Set<string>()
  for (const inst of instances){
    const asset = assetsById.get(inst.assetId)
    if (!asset) continue
    const anchor = worldToCell(inst.position.x, inst.position.z, table)
    // Snap rotation to 90° for footprint calculation
    const snappedRot = snapRotationForFootprint(inst.rotationDeg)
    const fp = aabbFootprint(asset, snappedRot, table.gridSize)
    for (const cell of footprintCells(anchor, fp)){
      if (cell.c >= 0 && cell.r >= 0) occ.add(key(cell))
    }
  }
  return occ
}

export function collides(cells: Cell[], occupied: Set<string>){
  return cells.some(c => occupied.has(key(c)))
}

export function key(cell: Cell){ return `${cell.c},${cell.r}` }
function clamp(v:number, a:number, b:number){ return Math.max(a, Math.min(b, v)) }