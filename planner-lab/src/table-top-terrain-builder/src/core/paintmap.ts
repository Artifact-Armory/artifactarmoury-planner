// src/core/paintmap.ts
//
// Ground texture painting = a low-resolution grid of material indices over the
// table (independent of the height field). The brush stamps a chosen table
// material (grass / sand / dirt / …) onto cells; the scene bakes these into a
// transparent overlay texture that sits just above the surface, so the base
// material still shows through everywhere the user hasn't painted.
//
// Kept framework-free (pure data) so it serialises with the saved table and can
// later be shipped to the backend alongside the height field. The index→material
// mapping lives in `palette` so it survives changes to the material catalogue's
// order.

import type { Table } from '../state/store'

/** Grid cell size (metres) for painting. Coarser than the height field — texture
 *  regions are broad, and this keeps the overlay bake cheap. */
export const PAINT_CELL = 0.04

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

export function paintDims(table: Table): { cols: number; rows: number } {
  const cols = Math.max(1, Math.round(table.width / PAINT_CELL))
  const rows = Math.max(1, Math.round(table.height / PAINT_CELL))
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
 * centred at world (wx, wz). Mutates the map in place; returns true if any cell
 * changed.
 */
export function applyPaintBrush(
  pm: PaintMap,
  table: Table,
  wx: number,
  wz: number,
  materialId: string | null,
  radius: number,
): boolean {
  if (radius <= 0) return false
  const value = materialId ? indexFor(pm, materialId) : 0
  const dx = table.width / pm.cols
  const dz = table.height / pm.rows
  const ci = (wx + table.width / 2) / dx - 0.5
  const cj = (wz + table.height / 2) / dz - 0.5
  const ri = radius / dx
  const rj = radius / dz
  const i0 = Math.max(0, Math.floor(ci - ri))
  const i1 = Math.min(pm.cols - 1, Math.ceil(ci + ri))
  const j0 = Math.max(0, Math.floor(cj - rj))
  const j1 = Math.min(pm.rows - 1, Math.ceil(cj + rj))
  if (i0 > i1 || j0 > j1) return false

  let changed = false
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = cellCentre(i, j, pm, table)
      if (Math.hypot(c.x - wx, c.z - wz) > radius) continue
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

export interface SerializedPaintMap {
  cols: number
  rows: number
  palette: string[]
  /** Cell indices as a plain number array (small — one byte-range int per cell). */
  cells: number[]
}

export function serializePaint(pm: PaintMap | null): SerializedPaintMap | null {
  if (!pm || isBlank(pm)) return null
  return { cols: pm.cols, rows: pm.rows, palette: [...pm.palette], cells: Array.from(pm.cells) }
}

export function deserializePaint(data: any, table: Table): PaintMap | null {
  if (!data || !Array.isArray(data.cells) || !Array.isArray(data.palette)) return null
  const { cols, rows } = paintDims(table)
  // Only accept a grid that matches the current table resolution.
  if (data.cols !== cols || data.rows !== rows || data.cells.length !== cols * rows) return null
  const cells = new Uint8Array(cols * rows)
  for (let k = 0; k < cells.length; k++) cells[k] = Number(data.cells[k]) || 0
  return { cols, rows, cells, palette: data.palette.map((s: any) => String(s)) }
}
