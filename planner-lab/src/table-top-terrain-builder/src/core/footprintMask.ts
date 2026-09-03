// src/core/footprintMask.ts
//
// Per-model occupancy footprint. The planner used each piece's bounding-box
// rectangle for placement/stacking, so an L-shaped corner reserved (and stacked
// onto) its whole square. Here we rasterize a model's top-down (XZ) silhouette
// into a normalized bitmap once, then derive a per-cell mask at any grid size /
// rotation — so only cells the geometry actually covers count.

import type { Asset } from './assets'
import { aabbFootprint, footprintCells, type Cell, type Rotation } from './occupancy'

const RES = 64 // normalized bitmap resolution per axis

// assetId → RES×RES silhouette bitmap over the model's XZ bounding box (v-major).
const bitmaps = new Map<string, Uint8Array>()

// Cached masked cell offsets (relative to the anchor) keyed by asset|grid|rot —
// they don't depend on where the piece sits, so we derive them once.
const offsetCache = new Map<string, Array<{ dc: number; dr: number }>>()

export function setFootprintBitmap(assetId: string, bmp: Uint8Array): void {
  bitmaps.set(assetId, bmp)
  for (const k of offsetCache.keys()) if (k.startsWith(`${assetId}|`)) offsetCache.delete(k)
}
export function hasFootprintBitmap(assetId: string): boolean {
  return bitmaps.has(assetId)
}

/**
 * Rasterize XZ triangles (centered on the bbox: x∈[-halfX,halfX], z∈[-halfZ,halfZ])
 * into the RES×RES silhouette bitmap. `tris` is flat: [x0,z0, x1,z1, x2,z2, …].
 */
export function computeFootprintBitmap(tris: Float32Array, halfX: number, halfZ: number): Uint8Array {
  const bmp = new Uint8Array(RES * RES)
  if (halfX <= 0 || halfZ <= 0) { bmp.fill(1); return bmp }
  const u = (x: number) => ((x + halfX) / (2 * halfX)) * RES
  const v = (z: number) => ((z + halfZ) / (2 * halfZ)) * RES
  for (let i = 0; i + 5 < tris.length; i += 6) {
    rasterize(bmp, u(tris[i]), v(tris[i + 1]), u(tris[i + 2]), v(tris[i + 3]), u(tris[i + 4]), v(tris[i + 5]))
  }
  return bmp
}

function rasterize(bmp: Uint8Array, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void {
  const mark = (px: number, py: number) => { if (px >= 0 && py >= 0 && px < RES && py < RES) bmp[py * RES + px] = 1 }
  // Always stamp the vertex cells (captures thin walls narrower than a cell).
  mark(ax | 0, ay | 0); mark(bx | 0, by | 0); mark(cx | 0, cy | 0)
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
  if (Math.abs(area) < 1e-9) return
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
  const maxX = Math.min(RES, Math.ceil(Math.max(ax, bx, cx)))
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
  const maxY = Math.min(RES, Math.ceil(Math.max(ay, by, cy)))
  for (let py = minY; py < maxY; py++) {
    for (let px = minX; px < maxX; px++) {
      const x = px + 0.5, y = py + 0.5
      const w0 = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
      const w1 = (cx - bx) * (y - by) - (cy - by) * (x - bx)
      const w2 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx)
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) bmp[py * RES + px] = 1
    }
  }
}

/** Down-sample the bitmap to a cols×rows boolean mask (a cell is set if any pixel in it is). */
export function deriveMask0(bmp: Uint8Array, cols: number, rows: number): boolean[] {
  const m = new Array(cols * rows).fill(false)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u0 = Math.floor((c / cols) * RES), u1 = Math.max(u0 + 1, Math.floor(((c + 1) / cols) * RES))
      const v0 = Math.floor((r / rows) * RES), v1 = Math.max(v0 + 1, Math.floor(((r + 1) / rows) * RES))
      let any = false
      for (let v = v0; v < v1 && !any; v++) for (let u = u0; u < u1; u++) if (bmp[v * RES + u]) { any = true; break }
      m[r * cols + c] = any
    }
  }
  return m
}

/**
 * Rotate a cols×rows mask by a 90° step. Correct by construction: each cell
 * centre is rotated by the SAME Y-rotation matrix the mesh uses
 * (x' = x·cosθ + z·sinθ, z' = -x·sinθ + z·cosθ) and rebinned, so the footprint
 * always matches the rotated model. Dims swap for 90/270.
 */
export function rotateMask(m: boolean[], cols: number, rows: number, rot: Rotation): { cols: number; rows: number; m: boolean[] } {
  if (rot === 0) return { cols, rows, m }
  const swap = rot === 90 || rot === 270
  const nc = swap ? rows : cols
  const nr = swap ? cols : rows
  const rad = (rot * Math.PI) / 180
  const cos = Math.round(Math.cos(rad)) // ±1 or 0 for 90° multiples
  const sin = Math.round(Math.sin(rad))
  const out = new Array(nc * nr).fill(false)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!m[r * cols + c]) continue
      const lx = c - (cols - 1) / 2
      const lz = r - (rows - 1) / 2
      const nx = lx * cos + lz * sin
      const nz = -lx * sin + lz * cos
      const cc = Math.round(nx + (nc - 1) / 2)
      const rr = Math.round(nz + (nr - 1) / 2)
      if (cc >= 0 && rr >= 0 && cc < nc && rr < nr) out[rr * nc + cc] = true
    }
  }
  return { cols: nc, rows: nr, m: out }
}

/**
 * Cells a piece covers at `anchor` — using the model's real silhouette when we
 * have a bitmap for it, else the full bounding-box rectangle (unchanged behaviour
 * while the GLB is still loading, or for assets with no geometry).
 */
export function footprintCellsFor(asset: Asset, anchor: Cell, rot: Rotation, gridSize: number): Cell[] {
  const bmp = bitmaps.get(asset.id)
  if (!bmp || !asset.aabb) return footprintCells(anchor, aabbFootprint(asset, rot, gridSize))

  const key = `${asset.id}|${gridSize.toFixed(4)}|${rot}`
  let offs = offsetCache.get(key)
  if (!offs) {
    const cols0 = Math.max(1, Math.ceil(asset.aabb.x / gridSize))
    const rows0 = Math.max(1, Math.ceil(asset.aabb.z / gridSize))
    const { cols, rows, m } = rotateMask(deriveMask0(bmp, cols0, rows0), cols0, rows0, rot)
    const baseC = -Math.floor(cols / 2), baseR = -Math.floor(rows / 2)
    offs = []
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (m[r * cols + c]) offs.push({ dc: baseC + c, dr: baseR + r })
    if (offs.length === 0) {
      // Degenerate mask — fall back to the full rectangle.
      const fp = aabbFootprint(asset, rot, gridSize)
      const bC = -Math.floor(fp.cols / 2), bR = -Math.floor(fp.rows / 2)
      for (let dc = 0; dc < fp.cols; dc++) for (let dr = 0; dr < fp.rows; dr++) offs.push({ dc: bC + dc, dr: bR + dr })
    }
    offsetCache.set(key, offs)
  }
  return offs.map((o) => ({ c: anchor.c + o.dc, r: anchor.r + o.dr }))
}
