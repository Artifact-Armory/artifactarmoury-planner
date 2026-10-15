// src/core/paintmap.ts
//
// Ground texture painting = a fine-resolution grid of material indices over the
// table (independent of the height field). The brush stamps a chosen table
// material (grass / sand / dirt / …) onto cells; the scene bakes these into
// transparent overlay maps (colour, normal, roughness) that sit just above the
// surface, so the base material still shows through everywhere the user hasn't
// painted. Edges are softened at bake time (groundCoverage.ts), not stored.
//
// Kept framework-free (pure data) so it serialises with the saved table and can
// later be shipped to the backend alongside the height field. The index→material
// mapping lives in `palette` so it survives changes to the material catalogue's
// order.

import type { Table } from '../state/store'

/** Fine paint grid in metres; bounded independently of table size (PAINT_MAX). */
export const PAINT_CELL = 0.005
const PAINT_MAX = 512
/** Cell size every map saved before the fine grid used. Still loaded (upsampled). */
const LEGACY_PAINT_CELL = 0.04

export interface PaintMap {
  /** Cells across X (width). */
  cols: number
  /** Cells across Z (depth). */
  rows: number
  /** Material index per cell, row-major cells[j * cols + i]. 0 = unpainted (base
   *  material shows). 1..palette.length index into `palette`. */
  cells: Uint8Array
  /** Material ids for indices 1..N (palette[k] is index k+1). */
  palette: string[]
}

export function paintDims(table: Pick<Table, 'width' | 'height'>): { cols: number; rows: number } {
  const cols = Math.min(PAINT_MAX, Math.max(1, Math.round(table.width / PAINT_CELL)))
  const rows = Math.min(PAINT_MAX, Math.max(1, Math.round(table.height / PAINT_CELL)))
  return { cols, rows }
}

export function createPaintMap(table: Table): PaintMap {
  const { cols, rows } = paintDims(table)
  return { cols, rows, cells: new Uint8Array(cols * rows), palette: [] }
}

/** A paint map fits the table when its grid matches the table's paint resolution. */
export function paintFitsTable(pm: PaintMap | null | undefined, table: Table): pm is PaintMap {
  if (!pm) return false
  const { cols, rows } = paintDims(table)
  return pm.cols === cols && pm.rows === rows && pm.cells.length === cols * rows
}

export function isBlank(pm: PaintMap | null | undefined): boolean {
  if (!pm) return true
  for (let k = 0; k < pm.cells.length; k++) if (pm.cells[k] !== 0) return false
  return true
}

/** World-space centre (x, z) of cell (i, j). */
export function cellCentre(i: number, j: number, pm: PaintMap, table: Table): { x: number; z: number } {
  return {
    x: -table.width / 2 + ((i + 0.5) / pm.cols) * table.width,
    z: -table.height / 2 + ((j + 0.5) / pm.rows) * table.height,
  }
}

/** Resolve a material id to its 1-based palette index, appending it if new. */
function indexFor(pm: PaintMap, materialId: string): number {
  const existing = pm.palette.indexOf(materialId)
  if (existing >= 0) return existing + 1
  pm.palette.push(materialId)
  return pm.palette.length // 1-based
}

/**
 * Paint (or erase, when materialId is null) a circular brush of `radius` metres
 * centred at world (wx, wz). With `from`, the whole capsule between the previous
 * pointer position and this one is covered, so a fast stroke leaves no gaps
 * between dabs. Mutates the map in place; returns true if any cell changed.
 */
export function applyPaintBrush(
  pm: PaintMap,
  table: Table,
  wx: number,
  wz: number,
  materialId: string | null,
  radius: number,
  from?: { x: number; z: number },
): boolean {
  if (radius <= 0) return false
  const value = materialId ? indexFor(pm, materialId) : 0
  const dx = table.width / pm.cols
  const dz = table.height / pm.rows
  const ci = (wx + table.width / 2) / dx - 0.5
  const cj = (wz + table.height / 2) / dz - 0.5
  const ri = radius / dx
  const rj = radius / dz
  const start = from ?? { x: wx, z: wz }
  const si = (start.x + table.width / 2) / dx - 0.5
  const sj = (start.z + table.height / 2) / dz - 0.5
  const i0 = Math.max(0, Math.floor(Math.min(ci, si) - ri))
  const i1 = Math.min(pm.cols - 1, Math.ceil(Math.max(ci, si) + ri))
  const j0 = Math.max(0, Math.floor(Math.min(cj, sj) - rj))
  const j1 = Math.min(pm.rows - 1, Math.ceil(Math.max(cj, sj) + rj))
  const vx = wx - start.x, vz = wz - start.z
  const lengthSq = vx * vx + vz * vz
  if (i0 > i1 || j0 > j1) return false

  let changed = false
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = cellCentre(i, j, pm, table)
      // Distance from the cell centre to the segment start→end.
      const t = lengthSq > 0 ? Math.max(0, Math.min(1,
        ((c.x - start.x) * vx + (c.z - start.z) * vz) / lengthSq)) : 0
      if (Math.hypot(c.x - start.x - t * vx, c.z - start.z - t * vz) > radius) continue
      const k = j * pm.cols + i
      if (pm.cells[k] !== value) { pm.cells[k] = value; changed = true }
    }
  }
  return changed
}

export function clonePaintMap(pm: PaintMap | null): PaintMap | null {
  if (!pm) return null
  return { cols: pm.cols, rows: pm.rows, cells: new Uint8Array(pm.cells), palette: [...pm.palette] }
}

// ---- persistence (compact) -------------------------------------------------
//
// The fine grid is up to 512×512 cells, so cells are run-length encoded
// ([value, count, value, count, …]) — painted regions are long runs. Maps saved
// before the fine grid used a plain `cells` array at 4 cm; both still load.

export interface SerializedPaintMap {
  cols: number
  rows: number
  palette: string[]
  /** Run-length pairs [value, count, …] over the row-major cells. */
  rle?: number[]
  /** Legacy: one entry per cell. */
  cells?: number[]
}

export function serializePaint(pm: PaintMap | null): SerializedPaintMap | null {
  if (!pm || isBlank(pm)) return null
  const rle: number[] = []
  let run = pm.cells[0], count = 0
  for (let k = 0; k < pm.cells.length; k++) {
    if (pm.cells[k] === run) { count++; continue }
    rle.push(run, count)
    run = pm.cells[k]; count = 1
  }
  rle.push(run, count)
  return { cols: pm.cols, rows: pm.rows, palette: [...pm.palette], rle }
}

/** Expand stored cells (RLE or plain) to a flat array; null if malformed. */
function storedCells(data: any): ArrayLike<number> | null {
  const total = data.cols * data.rows
  if (Array.isArray(data.rle)) {
    if (data.rle.length % 2) return null
    const out = new Uint8Array(total)
    let k = 0
    for (let p = 0; p < data.rle.length; p += 2) {
      const value = Number(data.rle[p]), count = Number(data.rle[p + 1])
      if (!Number.isInteger(count) || count < 0 || k + count > total) return null
      out.fill(Number.isInteger(value) && value >= 0 && value <= 255 ? value : 0, k, k + count)
      k += count
    }
    return k === total ? out : null
  }
  if (Array.isArray(data.cells) || data.cells instanceof Uint8Array) {
    return data.cells.length === total ? data.cells : null
  }
  return null
}

export function deserializePaint(data: any, table: Table): PaintMap | null {
  if (!data || !Array.isArray(data.palette) || data.palette.length > 255) return null
  const { cols, rows } = paintDims(table)
  const legacy = data.cols === Math.max(1, Math.round(table.width / LEGACY_PAINT_CELL)) &&
    data.rows === Math.max(1, Math.round(table.height / LEGACY_PAINT_CELL))
  if (!legacy && (data.cols !== cols || data.rows !== rows)) return null
  const source = storedCells(data)
  if (!source) return null
  // Nearest-cell resample: identity for a current-resolution map, an exact
  // upsample (same coverage, same material per area) for a legacy 4 cm map.
  const cells = new Uint8Array(cols * rows)
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = Math.min(data.rows - 1, Math.floor((j + 0.5) / rows * data.rows)) * data.cols +
      Math.min(data.cols - 1, Math.floor((i + 0.5) / cols * data.cols))
    const value = Number(source[k])
    cells[j * cols + i] = Number.isInteger(value) && value >= 0 && value <= data.palette.length ? value : 0
  }
  return { cols, rows, cells, palette: data.palette.map((s: any) => String(s)) }
}
