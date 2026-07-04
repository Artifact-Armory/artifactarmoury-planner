// backend/src/services/terrainTiles.ts
//
// Turn a sculpted table heightmap (the planner's `layout_data.heightmap`) into a
// set of printable STL tiles. Each tile is a single WATERTIGHT, MANIFOLD closed
// shell — the sculpted top surface, vertical perimeter walls, and a flat bottom
// at z=0. It is NOT modelled as a solid brick or an internal lattice: the buyer
// slices it with normal infill (gyroid/honeycomb), which is the strong repeating
// pattern that keeps it light. See memory `project-terrain-sculpting`.
//
// A shared global minimum height + a common z=0 bottom means neighbouring tiles
// have identical edge profiles, so they butt together into the exact map the user
// designed in the planner. STL units are millimetres (3D-printing convention).

/** Serialized heightmap as stored in layout_data.heightmap (heights in mm). */
export interface HeightField {
  cols: number
  rows: number
  mm: number[] // row-major, length cols*rows
}

export interface TileOptions {
  /** Physical table size in millimetres (from table_config width/height in metres × 1000). */
  tableWidthMm: number
  tableDepthMm: number
  /** Max tile footprint (per side) so a tile fits a typical printer bed. */
  bedSizeMm?: number
  /** Solid floor under the lowest point of the whole map. */
  baseThicknessMm?: number
}

export interface TileQuote {
  tilesX: number
  tilesY: number
  tileCount: number
  bedSizeMm: number
  tileWidthMm: number
  tileDepthMm: number
}

export interface GeneratedTile {
  /** e.g. "tile_r1_c2.stl" (1-indexed row/col). */
  name: string
  stl: Buffer
  col: number
  row: number
}

const DEFAULT_BED_MM = 200
const DEFAULT_BASE_MM = 3
/** A tile with no point rising more than this above the map floor is untouched → skipped. */
const RELIEF_EPS_MM = 0.5

function opt(o: TileOptions) {
  return {
    bedSizeMm: o.bedSizeMm ?? DEFAULT_BED_MM,
    baseThicknessMm: o.baseThicknessMm ?? DEFAULT_BASE_MM,
  }
}

function fieldMin(field: HeightField): number {
  let m = Infinity
  for (const h of field.mm) if (h < m) m = h
  return Number.isFinite(m) ? m : 0
}

/** True if any vertex in the tile rises above the map floor (i.e. it was sculpted). */
function tileHasRelief(field: HeightField, ix0: number, ix1: number, iy0: number, iy1: number, minMm: number): boolean {
  for (let j = iy0; j <= iy1; j++) {
    for (let i = ix0; i <= ix1; i++) {
      if (field.mm[j * field.cols + i] - minMm > RELIEF_EPS_MM) return true
    }
  }
  return false
}

interface TileCell { ix0: number; ix1: number; iy0: number; iy1: number; col: number; row: number }

/** Tiles (in full-grid positions) that actually contain sculpted relief. */
function enumerateTiles(field: HeightField, options: TileOptions): { cells: TileCell[]; tilesX: number; tilesY: number; minMm: number } {
  const { bedSizeMm } = opt(options)
  const xr = tileRanges(field.cols, options.tableWidthMm, bedSizeMm)
  const yr = tileRanges(field.rows, options.tableDepthMm, bedSizeMm)
  const minMm = fieldMin(field)
  const cells: TileCell[] = []
  for (let ry = 0; ry < yr.length; ry++) {
    for (let rx = 0; rx < xr.length; rx++) {
      const [ix0, ix1] = xr[rx]
      const [iy0, iy1] = yr[ry]
      if (tileHasRelief(field, ix0, ix1, iy0, iy1, minMm)) {
        cells.push({ ix0, ix1, iy0, iy1, col: rx + 1, row: ry + 1 })
      }
    }
  }
  return { cells, tilesX: xr.length, tilesY: yr.length, minMm }
}

/** Split the vertex grid into contiguous cell ranges that fit the printer bed. */
function tileRanges(verts: number, spanMm: number, bedMm: number): Array<[number, number]> {
  const cells = verts - 1
  if (cells <= 0) return [[0, verts - 1]]
  const spacing = spanMm / cells
  const cellsPerTile = Math.max(1, Math.floor(bedMm / spacing))
  const ranges: Array<[number, number]> = []
  for (let c0 = 0; c0 < cells; c0 += cellsPerTile) {
    const c1 = Math.min(cells, c0 + cellsPerTile)
    ranges.push([c0, c1]) // vertex indices c0..c1 inclusive (shares c1 with next tile)
  }
  return ranges
}

export function quoteTiles(field: HeightField, options: TileOptions): TileQuote {
  const { bedSizeMm } = opt(options)
  const { cells, tilesX, tilesY } = enumerateTiles(field, options)
  return {
    tilesX,
    tilesY,
    tileCount: cells.length, // only sculpted tiles are printed
    bedSizeMm,
    tileWidthMm: options.tableWidthMm / tilesX,
    tileDepthMm: options.tableDepthMm / tilesY,
  }
}

// ---- geometry -> binary STL ------------------------------------------------

type V3 = [number, number, number]

class STLBuilder {
  private tris: Buffer[] = []
  count = 0

  private static normal(a: V3, b: V3, c: V3): V3 {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    return [nx / len, ny / len, nz / len]
  }

  /** Add a triangle, auto-orienting winding so its normal points along `outward`. */
  tri(a: V3, b: V3, c: V3, outward: V3) {
    let n = STLBuilder.normal(a, b, c)
    if (n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0) {
      ;[b, c] = [c, b]
      n = STLBuilder.normal(a, b, c)
    }
    const buf = Buffer.alloc(50)
    buf.writeFloatLE(n[0], 0); buf.writeFloatLE(n[1], 4); buf.writeFloatLE(n[2], 8)
    buf.writeFloatLE(a[0], 12); buf.writeFloatLE(a[1], 16); buf.writeFloatLE(a[2], 20)
    buf.writeFloatLE(b[0], 24); buf.writeFloatLE(b[1], 28); buf.writeFloatLE(b[2], 32)
    buf.writeFloatLE(c[0], 36); buf.writeFloatLE(c[1], 40); buf.writeFloatLE(c[2], 44)
    // bytes 48-49 attribute byte count = 0
    this.tris.push(buf)
    this.count++
  }

  /** A flat quad (a,b,c,d in order) as two triangles facing `outward`. */
  quad(a: V3, b: V3, c: V3, d: V3, outward: V3) {
    this.tri(a, b, c, outward)
    this.tri(a, c, d, outward)
  }

  toBuffer(): Buffer {
    const header = Buffer.alloc(84) // 80 header (watermark stamps this) + uint32 count
    header.writeUInt32LE(this.count, 80)
    return Buffer.concat([header, ...this.tris])
  }
}

/**
 * Build one printable tile covering vertex indices [ix0..ix1] × [iy0..iy1] of the
 * global field. `minMm` is the map-wide minimum height so all tiles share a floor.
 */
function buildTile(
  field: HeightField,
  ix0: number, ix1: number, iy0: number, iy1: number,
  spacingXmm: number, spacingYmm: number,
  minMm: number, baseMm: number,
): Buffer {
  const b = new STLBuilder()
  const ni = ix1 - ix0 + 1
  const nj = iy1 - iy0 + 1

  // Local vertex positions (tile placed at its own origin for easy slicing).
  const topZ = (i: number, j: number) => baseMm + (field.mm[j * field.cols + i] - minMm)
  const lx = (i: number) => (i - ix0) * spacingXmm
  const ly = (j: number) => (j - iy0) * spacingYmm

  const top = (i: number, j: number): V3 => [lx(i), ly(j), topZ(i, j)]
  const bot = (i: number, j: number): V3 => [lx(i), ly(j), 0]

  const UP: V3 = [0, 0, 1], DOWN: V3 = [0, 0, -1]
  const PX: V3 = [1, 0, 0], NX: V3 = [-1, 0, 0], PY: V3 = [0, 1, 0], NY: V3 = [0, -1, 0]

  for (let j = iy0; j < iy1; j++) {
    for (let i = ix0; i < ix1; i++) {
      // Top surface (up).
      b.quad(top(i, j), top(i + 1, j), top(i + 1, j + 1), top(i, j + 1), UP)
      // Flat bottom (down).
      b.quad(bot(i, j), bot(i + 1, j), bot(i + 1, j + 1), bot(i, j + 1), DOWN)
    }
  }

  // Perimeter walls (top edge down to the flat base).
  for (let i = ix0; i < ix1; i++) {
    b.quad(top(i, iy0), top(i + 1, iy0), bot(i + 1, iy0), bot(i, iy0), NY)          // south
    b.quad(top(i, iy1), top(i + 1, iy1), bot(i + 1, iy1), bot(i, iy1), PY)          // north
  }
  for (let j = iy0; j < iy1; j++) {
    b.quad(top(ix0, j), top(ix0, j + 1), bot(ix0, j + 1), bot(ix0, j), NX)          // west
    b.quad(top(ix1, j), top(ix1, j + 1), bot(ix1, j + 1), bot(ix1, j), PX)          // east
  }

  void ni; void nj
  return b.toBuffer()
}

export function generateTerrainTiles(field: HeightField, options: TileOptions): GeneratedTile[] {
  if (!field?.mm?.length || field.cols < 2 || field.rows < 2) return []
  const { baseThicknessMm } = opt(options)
  const spacingXmm = options.tableWidthMm / (field.cols - 1)
  const spacingYmm = options.tableDepthMm / (field.rows - 1)

  const { cells, minMm } = enumerateTiles(field, options)
  return cells.map((c) => ({
    name: `tile_r${c.row}_c${c.col}.stl`,
    stl: buildTile(field, c.ix0, c.ix1, c.iy0, c.iy1, spacingXmm, spacingYmm, minMm, baseThicknessMm),
    col: c.col,
    row: c.row,
  }))
}
