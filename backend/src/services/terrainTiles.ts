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
const DEFAULT_BASE_MM = 8 // tall enough to hold the interlocking connector band
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

// ---- interlocking connectors ("lego"-style pegs + sockets) -----------------
//
// Each seam gets an ALTERNATING run of pegs and sockets (peg, hole, peg, hole…)
// so every peg on one tile lands next to a socket on the same tile — a strong,
// self-locating joint. The two edges of a shared seam are complementary: East/
// North edges start with a peg on even slots, West/South start with a socket, so
// at every slot a peg meets a hole. Connectors live in a flat lower "band" of the
// wall (below the sculpted relief), on interior segments only (never a corner).
// Peg tips are inset by a clearance and slightly shallower than the socket, so
// they physically slot together with a printable tolerance.

export type ConnKind = 'peg' | 'hole'
export interface EdgeSpec { connect: boolean; primary: ConnKind }
interface Connectors { south: EdgeSpec; north: EdgeSpec; west: EdgeSpec; east: EdgeSpec }

const CONN = {
  bandTopMm: 7,      // height of the flat lower wall band the connectors live in
  z0: 2,             // connector bottom
  z1: 6,             // connector top
  pegDepthMm: 3.5,   // how far a peg sticks out
  holeDepthMm: 4.0,  // socket depth (deeper than peg → bottoming clearance)
  clearanceMm: 0.4,  // peg tip inset all round → fits the nominal socket
  maxPerEdge: 4,     // up to this many connectors per edge (peg/hole/peg/hole)
}

const opposite = (k: ConnKind): ConnKind => (k === 'peg' ? 'hole' : 'peg')

/**
 * Which segments of an edge carry a connector, and its kind — alternating from the
 * edge's `primary` type. Deterministic from the segment count, so the two edges of
 * a shared seam (same length) pick the same segments with complementary kinds.
 */
export function connectorPlan(n: number, spec: EdgeSpec): Map<number, ConnKind> {
  const plan = new Map<number, ConnKind>()
  const interior = n - 2 // usable segments 1..n-2 (keep connectors off the corners)
  if (!spec.connect || interior < 1) return plan
  const maxFit = Math.floor((interior + 1) / 2) // every-other placement leaves a gap
  const count = Math.min(CONN.maxPerEdge, maxFit)
  const span = 2 * count - 1
  const start = 1 + Math.floor((interior - span) / 2) // centre the run on the edge
  for (let i = 0; i < count; i++) {
    plan.set(start + 2 * i, i % 2 === 0 ? spec.primary : opposite(spec.primary))
  }
  return plan
}

const vadd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const vscale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const vnorm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const vavg = (pts: V3[]): V3 => vscale(pts.reduce((p, q) => vadd(p, q), [0, 0, 0] as V3), 1 / pts.length)

/** A peg (protruding) or socket (recessed) box attached to a rectangular wall opening. */
function addConnectorBox(b: STLBuilder, opening: [V3, V3, V3, V3], outward: V3, kind: 'peg' | 'hole') {
  const peg = kind === 'peg'
  const off = vscale(outward, peg ? CONN.pegDepthMm : -CONN.holeDepthMm)
  let cap: V3[] = opening.map((o) => vadd(o, off))
  if (peg) {
    // Inset the tip toward the opening centre so it's smaller than the socket.
    const u = vnorm(vsub(opening[1], opening[0])) // along the edge
    const z: V3 = [0, 0, 1]
    const c = CONN.clearanceMm
    cap = [
      vadd(cap[0], vadd(vscale(u, +c), vscale(z, +c))),
      vadd(cap[1], vadd(vscale(u, -c), vscale(z, +c))),
      vadd(cap[2], vadd(vscale(u, -c), vscale(z, -c))),
      vadd(cap[3], vadd(vscale(u, +c), vscale(z, -c))),
    ]
  }
  const centroid = vavg([...opening, ...cap])
  const faces: Array<[V3, V3, V3, V3]> = [
    [opening[0], opening[1], cap[1], cap[0]],
    [opening[1], opening[2], cap[2], cap[1]],
    [opening[2], opening[3], cap[3], cap[2]],
    [opening[3], opening[0], cap[0], cap[3]],
    [cap[0], cap[1], cap[2], cap[3]], // end cap / socket floor
  ]
  for (const f of faces) {
    const fc = vavg(f)
    // Peg faces point away from the box; socket faces point into the cavity.
    const out = peg ? vsub(fc, centroid) : vsub(centroid, fc)
    b.quad(f[0], f[1], f[2], f[3], vnorm(out))
  }
}

/** One perimeter wall: sculpted skirt on top, flat connector band below. */
function buildEdge(
  b: STLBuilder,
  pts: Array<{ xy: [number, number]; tz: number }>,
  outward: V3,
  spec: EdgeSpec,
  base: number,
) {
  const n = pts.length - 1
  const { bandTopMm: BAND, z0: CZ0, z1: CZ1 } = CONN
  const p = (k: number, z: number): V3 => [pts[k].xy[0], pts[k].xy[1], z]
  const tp = (k: number): V3 => [pts[k].xy[0], pts[k].xy[1], pts[k].tz]
  const plan = connectorPlan(n, spec)

  for (let k = 0; k < n; k++) {
    // Sculpted skirt: connector band top up to the terrain surface.
    b.quad(p(k, BAND), p(k + 1, BAND), tp(k + 1), tp(k), outward)
    // Lower band, split into z-strips so connector edges line up everywhere.
    b.quad(p(k, 0), p(k + 1, 0), p(k + 1, CZ0), p(k, CZ0), outward)          // below connector
    b.quad(p(k, CZ1), p(k + 1, CZ1), p(k + 1, BAND), p(k, BAND), outward)    // above connector
    const kind = plan.get(k)
    if (kind) {
      // Opening in the wall + the peg/socket box.
      addConnectorBox(b, [p(k, CZ0), p(k + 1, CZ0), p(k + 1, CZ1), p(k, CZ1)], outward, kind)
    } else {
      b.quad(p(k, CZ0), p(k + 1, CZ0), p(k + 1, CZ1), p(k, CZ1), outward)    // plain middle
    }
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
  conn: Connectors,
): Buffer {
  const b = new STLBuilder()
  const base = Math.max(baseMm, CONN.bandTopMm + 1)
  const cols = field.cols

  const topZ = (i: number, j: number) => base + (field.mm[j * cols + i] - minMm)
  const lx = (i: number) => (i - ix0) * spacingXmm
  const ly = (j: number) => (j - iy0) * spacingYmm

  const top = (i: number, j: number): V3 => [lx(i), ly(j), topZ(i, j)]
  const bot = (i: number, j: number): V3 => [lx(i), ly(j), 0]
  const UP: V3 = [0, 0, 1], DOWN: V3 = [0, 0, -1]

  for (let j = iy0; j < iy1; j++) {
    for (let i = ix0; i < ix1; i++) {
      b.quad(top(i, j), top(i + 1, j), top(i + 1, j + 1), top(i, j + 1), UP)   // sculpted top
      b.quad(bot(i, j), bot(i + 1, j), bot(i + 1, j + 1), bot(i, j + 1), DOWN) // flat bottom
    }
  }

  const rowX = (jy: number) => Array.from({ length: ix1 - ix0 + 1 }, (_, k) => ({
    xy: [lx(ix0 + k), ly(jy)] as [number, number], tz: topZ(ix0 + k, jy),
  }))
  const colY = (ix: number) => Array.from({ length: iy1 - iy0 + 1 }, (_, k) => ({
    xy: [lx(ix), ly(iy0 + k)] as [number, number], tz: topZ(ix, iy0 + k),
  }))

  buildEdge(b, rowX(iy0), [0, -1, 0], conn.south, base) // south (min Y)
  buildEdge(b, rowX(iy1), [0, 1, 0], conn.north, base)  // north (max Y)
  buildEdge(b, colY(ix0), [-1, 0, 0], conn.west, base)  // west  (min X)
  buildEdge(b, colY(ix1), [1, 0, 0], conn.east, base)   // east  (max X)

  return b.toBuffer()
}

export function generateTerrainTiles(field: HeightField, options: TileOptions): GeneratedTile[] {
  if (!field?.mm?.length || field.cols < 2 || field.rows < 2) return []
  const { baseThicknessMm } = opt(options)
  const spacingXmm = options.tableWidthMm / (field.cols - 1)
  const spacingYmm = options.tableDepthMm / (field.rows - 1)

  const { cells, minMm } = enumerateTiles(field, options)
  const present = new Set(cells.map((c) => `${c.row},${c.col}`))
  const has = (row: number, col: number) => present.has(`${row},${col}`)

  return cells.map((c) => {
    // Alternating peg/hole runs on any shared seam. East/North start with a peg,
    // West/South with a socket, so a seam's two edges are complementary and every
    // peg lands opposite a socket.
    const conn: Connectors = {
      east: { connect: has(c.row, c.col + 1), primary: 'peg' },
      west: { connect: has(c.row, c.col - 1), primary: 'hole' },
      north: { connect: has(c.row + 1, c.col), primary: 'peg' },
      south: { connect: has(c.row - 1, c.col), primary: 'hole' },
    }
    return {
      name: `tile_r${c.row}_c${c.col}.stl`,
      stl: buildTile(field, c.ix0, c.ix1, c.iy0, c.iy1, spacingXmm, spacingYmm, minMm, baseThicknessMm, conn),
      col: c.col,
      row: c.row,
    }
  })
}
