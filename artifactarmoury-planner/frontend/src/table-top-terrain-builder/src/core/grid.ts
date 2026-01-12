/* Grid conversion helpers (same as scaffold text) */
// src/core/grid.ts

/** Convert a world coordinate (metres) to a snapped grid cell index. */
export function worldToCell(valueM: number, gridSizeM: number) {
  if (gridSizeM <= 0) return 0
  return Math.round(valueM / gridSizeM)
}

/** Convert a grid cell index to the world coordinate (metres). */
export function cellToWorld(cell: number, gridSizeM: number) {
  return cell * gridSizeM
}

/** Snap an arbitrary world coordinate to the nearest grid line (metres). */
export function snapToGrid(valueM: number, gridSizeM: number) {
  return cellToWorld(worldToCell(valueM, gridSizeM), gridSizeM)
}
