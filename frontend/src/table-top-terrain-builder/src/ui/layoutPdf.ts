// src/ui/layoutPdf.ts — "Print layout" PDF: a to-scale top-down plan of the table
// with every piece numbered, plus the measurements needed to set it out on a real
// table with a tape measure (centre distance from the left and front edges, and
// the edge-to-edge gap to each piece's nearest neighbour).
//
// Busy tables (more than MAX_ONE_PAGE pieces) get an overview page showing the
// table split into lettered sections, then one zoomed page per section with that
// section's numbers and gaps, so labels stay readable on 400-piece tables.
//
// Orientation matches the planner's default camera, which looks from the +X/+Z
// corner: +Z is the FRONT (bottom of the page), −X is the LEFT edge.
import * as THREE from 'three'
import type { Instance, Table } from '@state/store'
import { getAssetById } from '@core/assets'
import { tiltOffset, tiltQuaternion } from '@core/orientation'
import type { UnitSystem } from '@/store/unitsStore'

type Pt = { x: number; z: number }

type Piece = {
  num: number
  name: string
  hull: Pt[]          // top-down footprint (metres, table coords)
  cx: number          // footprint centre
  cz: number
  rotationDeg: number
  pitchDeg: number
  level: number
  section?: string    // "B2" etc. on sectioned prints
  nearest?: { num: number; gap: number; a: Pt; b: Pt }
}

const M_PER_IN = 0.0254
const LEVEL_M = 0.0127 // one planner level = 1/2"
/** A piece whose base is this close under a level marker still counts as on that floor. */
const MARKER_TOLERANCE = 0.002

/** A length for setting out on a real table: inches (imperial) or cm (metric). */
export function formatLength(m: number, system: UnitSystem): string {
  return system === 'imperial' ? `${(m / M_PER_IN).toFixed(1)}"` : `${(m * 100).toFixed(1)} cm`
}

// ---- geometry ---------------------------------------------------------------

const Y = new THREE.Vector3(0, 1, 0)

/** Top-down footprint of a placed piece: its (tilted, yawed) bounding box projected
 *  onto the table, as a convex polygon. Mirrors InstancedScene.composeMatrix. */
function footprintHull(inst: Instance, aabb: { x: number; y: number; z: number }, rollDeg: number): Pt[] {
  const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(inst.rotationDeg))
  const offset = new THREE.Vector3()
  const pitch = inst.pitchDeg ?? 0
  if (pitch || rollDeg) {
    const tilt = tiltQuaternion(pitch, rollDeg, new THREE.Quaternion())
    tiltOffset(tilt, aabb, offset).applyQuaternion(q)
    q.multiply(tilt)
  }
  const v = new THREE.Vector3()
  const pts: Pt[] = []
  for (const sx of [-0.5, 0.5]) for (const y of [0, aabb.y]) for (const sz of [-0.5, 0.5]) {
    v.set(sx * aabb.x, y, sz * aabb.z).applyQuaternion(q)
    pts.push({ x: inst.position.x + offset.x + v.x, z: inst.position.z + offset.z + v.z })
  }
  return convexHull(pts)
}

function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.z - b.z)
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)
  const lower: Pt[] = []
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 1e-12) lower.pop()
    lower.push(pt)
  }
  const upper: Pt[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 1e-12) upper.pop()
    upper.push(pt)
  }
  upper.pop(); lower.pop()
  return lower.concat(upper)
}

function closestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0
  return { x: a.x + t * dx, z: a.z + t * dz }
}

function insideConvex(p: Pt, poly: Pt[]): boolean {
  if (poly.length < 3) return false
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const c = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)
    if (Math.abs(c) < 1e-12) continue
    const s = Math.sign(c)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x)
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}

/** Edge-to-edge gap between two convex footprints (0 when they touch/overlap),
 *  with the closest pair of points for drawing the dimension line. */
function polygonGap(A: Pt[], B: Pt[]): { gap: number; a: Pt; b: Pt } {
  const overlap =
    A.some(p => insideConvex(p, B)) || B.some(p => insideConvex(p, A)) ||
    A.some((p, i) => B.some((q, j) => segmentsCross(p, A[(i + 1) % A.length], q, B[(j + 1) % B.length])))
  let best = { gap: Infinity, a: A[0], b: B[0] }
  const scan = (P: Pt[], Q: Pt[], flip: boolean) => {
    for (const p of P) for (let j = 0; j < Q.length; j++) {
      const c = closestOnSegment(p, Q[j], Q[(j + 1) % Q.length])
      const d = Math.hypot(p.x - c.x, p.z - c.z)
      if (d < best.gap) best = flip ? { gap: d, a: c, b: p } : { gap: d, a: p, b: c }
    }
  }
  scan(A, B, false)
  scan(B, A, true)
  if (overlap) best.gap = 0
  return best
}

function overlaps(A: Pt[], B: Pt[]): boolean {
  return polygonGap(A, B).gap === 0
}

// ---- layout data ------------------------------------------------------------

export function buildLayoutPieces(instances: Instance[]): { pieces: Piece[]; skipped: number } {
  let skipped = 0
  const raw: Omit<Piece, 'num'>[] = []
  for (const inst of instances) {
    const asset = getAssetById(inst.assetId)
    if (!asset?.aabb) { skipped++; continue }
    const hull = footprintHull(inst, asset.aabb, inst.rollDeg ?? asset.defaultRollDeg ?? 0)
    const xs = hull.map(p => p.x), zs = hull.map(p => p.z)
    raw.push({
      name: asset.name,
      hull,
      cx: (Math.min(...xs) + Math.max(...xs)) / 2,
      cz: (Math.min(...zs) + Math.max(...zs)) / 2,
      rotationDeg: ((Math.round(inst.rotationDeg) % 360) + 360) % 360,
      pitchDeg: Math.round(inst.pitchDeg ?? 0),
      level: inst.level ?? 0,
    })
  }
  // Number in reading order: back row first (top of the page), left to right.
  // Rows are bucketed to 5 cm so pieces roughly in line read as one row.
  raw.sort((a, b) => Math.round(a.cz / 0.05) - Math.round(b.cz / 0.05) || a.cx - b.cx)
  const pieces: Piece[] = raw.map((p, i) => ({ ...p, num: i + 1 }))
  findNearest(pieces)
  return { pieces, skipped }
}

/** Set each piece's nearest neighbour among `pieces` (only those passing `same`, if given). */
function findNearest(pieces: Piece[], same?: (a: Piece, b: Piece) => boolean) {
  for (const p of pieces) {
    p.nearest = undefined
    for (const o of pieces) {
      if (o === p || (same && !same(p, o))) continue
      // A piece stacked on top of another isn't "next to" it — skip that pairing.
      if (o.level !== p.level && overlaps(p.hull, o.hull)) continue
      const g = polygonGap(p.hull, o.hull)
      if (!p.nearest || g.gap < p.nearest.gap) p.nearest = { num: o.num, gap: g.gap, a: g.a, b: g.b }
    }
  }
}

// ---- PDF --------------------------------------------------------------------

/** jsPDF's built-in fonts only cover Latin-1; swap the common typographic
 *  characters and drop anything else rather than print garbage. */
function pdfText(s: string): string {
  return s
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/×/g, 'x')
    .replace(/[^\x20-\x7E -ÿ]/g, '?')
}

type Doc = import('jspdf').jsPDF
type Rect = { x0: number; z0: number; x1: number; z1: number } // table coords (metres)
type Box = { left: number; top: number; right: number; bottom: number } // page (mm)

/** Up to this many pieces print as one page; more get split into zoomed sections. */
const MAX_ONE_PAGE = 60
/** Aim for at most this many pieces on each section page. */
const MAX_PER_SECTION = 45
const MAX_SECTIONS = 16
/** Gaps smaller than this aren't drawn on the plan (the list still gives them). */
const MIN_DRAWN_GAP = 0.002
/** ...nor longer than this: a long line across the map is clutter, and the rulers do that job better. */
const MAX_DRAWN_GAP = 0.1

const sectionName = (col: number, row: number) => `${String.fromCharCode(65 + col)}${row + 1}`

/** Split the table into cols x rows sections, roughly the shape of the page,
 *  adding sections until the busiest one holds MAX_PER_SECTION or fewer pieces. */
function chooseSections(pieces: Piece[], table: Table, pageAspect: number): { cols: number; rows: number } {
  if (pieces.length <= MAX_ONE_PAGE) return { cols: 1, rows: 1 }
  let best = { cols: 1, rows: 1 }
  for (let n = 2; n <= MAX_SECTIONS; n++) {
    const rows = Math.max(1, Math.round(Math.sqrt((n * table.height * pageAspect) / table.width)))
    const cols = Math.max(1, Math.ceil(n / rows))
    if (cols * rows > MAX_SECTIONS) break
    best = { cols, rows }
    const counts = new Map<string, number>()
    for (const p of pieces) {
      const k = sectionOf(p, table, cols, rows)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    if (Math.max(...counts.values()) <= MAX_PER_SECTION) break
  }
  return best
}

function sectionOf(p: Piece, table: Table, cols: number, rows: number): string {
  const c = Math.min(cols - 1, Math.max(0, Math.floor(((p.cx + table.width / 2) / table.width) * cols)))
  const r = Math.min(rows - 1, Math.max(0, Math.floor(((p.cz + table.height / 2) / table.height) * rows)))
  return sectionName(c, r)
}

function sectionRect(table: Table, cols: number, rows: number, c: number, r: number): Rect {
  const w = table.width / cols, h = table.height / rows
  return { x0: -table.width / 2 + c * w, z0: -table.height / 2 + r * h, x1: -table.width / 2 + (c + 1) * w, z1: -table.height / 2 + (r + 1) * h }
}

/** Draw a top-down plan of `view` (part or all of the table) into `box`.
 *  Only pieces in `numbered` get number badges and gap lines. With `faintOthers`
 *  the rest are drawn faintly, as context from the neighbouring sections. */
function drawPlan(doc: Doc, o: {
  table: Table
  view: Rect
  box: Box
  pieces: Piece[]
  numbered: Set<Piece>
  faintOthers: boolean
  gaps: boolean
  system: UnitSystem
  sections?: { cols: number; rows: number }
}) {
  const { table, view, box, pieces, numbered, system } = o
  const fmt = (m: number) => formatLength(m, system)
  const vw = view.x1 - view.x0, vh = view.z1 - view.z0
  const s = Math.min((box.right - box.left) / vw, (box.bottom - box.top) / vh) // mm per metre
  const fw = vw * s, fh = vh * s
  const ox = box.left + (box.right - box.left - fw) / 2
  const oy = box.top + (box.bottom - box.top - fh) / 2
  const px = (x: number) => ox + (x - view.x0) * s
  const py = (z: number) => oy + (z - view.z0) * s
  const tx0 = Math.max(px(-table.width / 2), ox), tx1 = Math.min(px(table.width / 2), ox + fw)
  const ty0 = Math.max(py(-table.height / 2), oy), ty1 = Math.min(py(table.height / 2), oy + fh)

  // Grid + rulers, always measured from the table's left and front edges.
  const steps = system === 'imperial'
    ? [1, 2, 3, 6, 12, 24].map(n => n * M_PER_IN)
    : [0.02, 0.05, 0.1, 0.2, 0.5]
  const step = steps.find(st => Math.max(vw, vh) / st <= 16) ?? steps[steps.length - 1]
  doc.setDrawColor(225).setLineWidth(0.15)
  doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(120)
  const fromLeft0 = view.x0 + table.width / 2
  for (let d = Math.ceil((fromLeft0 + 1e-6) / step) * step; d < Math.min(view.x1 + table.width / 2, table.width) - 1e-6; d += step) {
    const x = px(d - table.width / 2)
    doc.line(x, ty0, x, ty1)
    doc.text(fmt(d), x, oy + fh + 3.5, { align: 'center' })
  }
  const fromFront0 = table.height / 2 - view.z1
  for (let d = Math.ceil((fromFront0 + 1e-6) / step) * step; d < Math.min(table.height / 2 - view.z0, table.height) - 1e-6; d += step) {
    const y = py(table.height / 2 - d)
    doc.line(tx0, y, tx1, y)
    doc.text(fmt(d), ox - 1.5, y + 1, { align: 'right' })
  }

  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(60)
  doc.text('FRONT', ox + fw / 2, oy + fh + 8, { align: 'center' })
  doc.text('BACK', ox + fw / 2, oy - 1.5, { align: 'center' })
  // jsPDF's align: 'center' shifts sideways even on rotated text, so centre by hand.
  doc.text('LEFT', ox - 11, oy + fh / 2 + doc.getTextWidth('LEFT') / 2, { angle: 90 })
  doc.text('RIGHT', ox + fw + 3.5, oy + fh / 2 + doc.getTextWidth('RIGHT') / 2, { angle: 90 })

  // Everything inside the plan is clipped to the frame.
  doc.saveGraphicsState()
  doc.rect(ox, oy, fw, fh, null)
  doc.clip()
  doc.discardPath()

  // Pieces, lowest level first. Fill darkens with each level so stacks read at a
  // glance; pieces outside this section are drawn faintly for context.
  const inView = (p: Piece) => p.hull.some(h => h.x >= view.x0 - 0.05 && h.x <= view.x1 + 0.05 && h.z >= view.z0 - 0.05 && h.z <= view.z1 + 0.05)
  const ordered = pieces.filter(inView).sort((a, b) => a.level - b.level)
  for (const p of ordered) {
    if (p.hull.length < 3) continue
    const pts = p.hull.map(h => [px(h.x), py(h.z)] as [number, number])
    const segs = pts.slice(1).map((pt, i) => [pt[0] - pts[i][0], pt[1] - pts[i][1]])
    const own = !o.faintOthers || numbered.has(p)
    const t = Math.min(1, Math.max(0, p.level) / 8) // 0 at table level -> 1 at 8 levels up
    if (own) doc.setFillColor(222 - 40 * t, 228 - 52 * t, 236 - 76 * t).setDrawColor(60).setLineWidth(p.level > 0 ? 0.3 : 0.2)
    else doc.setFillColor(242, 243, 245).setDrawColor(185).setLineWidth(0.15)
    if (p.level > 0) doc.setLineDashPattern([1.2, 0.6], 0)
    doc.lines(segs, pts[0][0], pts[0][1], [1, 1], 'FD', true)
    doc.setLineDashPattern([], 0)
  }
  doc.restoreGraphicsState()

  // Table edge (drawn over the clipped pieces so overhangs stay visible).
  doc.setDrawColor(40).setLineWidth(0.5)
  doc.rect(tx0, ty0, tx1 - tx0, ty1 - ty0)
  if (tx0 > ox + 0.01 || tx1 < ox + fw - 0.01 || ty0 > oy + 0.01 || ty1 < oy + fh - 0.01) {
    // Section page: a thin frame shows where this zoomed view is cut.
    doc.setDrawColor(150).setLineWidth(0.2)
    doc.rect(ox, oy, fw, fh)
  }

  if (o.sections) {
    const { cols, rows } = o.sections
    doc.setDrawColor(37, 99, 235).setLineWidth(0.6)
    for (let c = 1; c < cols; c++) doc.line(px(-table.width / 2 + (c * table.width) / cols), ty0, px(-table.width / 2 + (c * table.width) / cols), ty1)
    for (let r = 1; r < rows; r++) doc.line(tx0, py(-table.height / 2 + (r * table.height) / rows), tx1, py(-table.height / 2 + (r * table.height) / rows))
    doc.setFont('helvetica', 'bold').setFontSize(16)
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const rc = sectionRect(table, cols, rows, c, r)
      const label = sectionName(c, r)
      const x = px((rc.x0 + rc.x1) / 2), y = py((rc.z0 + rc.z1) / 2)
      const w = doc.getTextWidth(label) + 4
      doc.setFillColor(255, 255, 255).setDrawColor(37, 99, 235).setLineWidth(0.4)
      doc.roundedRect(x - w / 2, y - 4.5, w, 9, 1.5, 1.5, 'FD')
      doc.setTextColor(37, 99, 235)
      doc.text(label, x, y + 2.1, { align: 'center' })
    }
  }

  // Badge spots first (so gap labels can steer clear of them). Small pieces go
  // first so they get their own centre; big boards and stacked-under pieces then
  // find a free spot nearby, joined to their centre by a short leader line.
  type Badge = { p: Piece; x: number; y: number; r: number; cx: number; cy: number }
  const badges: Badge[] = []
  const area = (p: Piece) => p.hull.reduce((a, h, i) => {
    const n = p.hull[(i + 1) % p.hull.length]
    return a + h.x * n.z - n.x * h.z
  }, 0)
  const toBadge = [...numbered].sort((a, b) => Math.abs(area(a)) - Math.abs(area(b)))
  doc.setFont('helvetica', 'bold').setFontSize(6.5)
  for (const p of toBadge) {
    const r = p.num >= 100 ? 2.5 : 2.1
    const cx = px(p.cx), cy = py(p.cz)
    const free = (x: number, y: number) =>
      x - r >= ox && x + r <= ox + fw && y - r >= oy && y + r <= oy + fh &&
      !badges.some(b => Math.hypot(b.x - x, b.y - y) < b.r + r + 0.3)
    let spot: { x: number; y: number } | undefined
    search: for (let ring = 0; ring <= 10; ring++) {
      const n = ring === 0 ? 1 : 8 + ring * 4
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        const x = cx + Math.cos(a) * ring * r * 0.9, y = cy + Math.sin(a) * ring * r * 0.9
        if (free(x, y)) { spot = { x, y }; break search }
      }
    }
    const pos = spot ?? { x: Math.min(Math.max(cx, ox + r), ox + fw - r), y: Math.min(Math.max(cy, oy + r), oy + fh - r) }
    badges.push({ p, ...pos, r, cx, cy })
  }

  // Nearest-gap dimension lines, one per pair, only where the label has room.
  if (o.gaps) {
    type Lbl = { x: number; y: number; w: number; h: number }
    const labels: Lbl[] = []
    const hitsBadge = (l: Lbl) => badges.some(b => {
      const nx = Math.max(l.x, Math.min(b.x, l.x + l.w)), ny = Math.max(l.y, Math.min(b.y, l.y + l.h))
      return Math.hypot(b.x - nx, b.y - ny) < b.r + 0.2
    })
    const hitsLabel = (l: Lbl) => labels.some(m => l.x < m.x + m.w + 0.3 && m.x < l.x + l.w + 0.3 && l.y < m.y + m.h + 0.3 && m.y < l.y + l.h + 0.3)
    const drawn = new Set<string>()
    doc.setFont('helvetica', 'normal').setFontSize(6)
    for (const p of numbered) {
      const n = p.nearest
      if (!n || n.gap < MIN_DRAWN_GAP || n.gap > MAX_DRAWN_GAP) continue
      const key = [p.num, n.num].sort((a, b) => a - b).join('-')
      if (drawn.has(key)) continue
      drawn.add(key)
      const x1 = px(n.a.x), y1 = py(n.a.z), x2 = px(n.b.x), y2 = py(n.b.z)
      const label = fmt(n.gap)
      const lw = doc.getTextWidth(label) + 1.6, lh = 3.2
      // Try the midpoint, then either side of the line.
      const len = Math.hypot(x2 - x1, y2 - y1) || 1
      const nx = -(y2 - y1) / len, ny = (x2 - x1) / len
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
      const spot = [0, 1, -1].map(k => ({ x: mx + nx * k * 3.4 - lw / 2, y: my + ny * k * 3.4 - lh / 2, w: lw, h: lh }))
        .find(l => l.x >= ox && l.x + l.w <= ox + fw && l.y >= oy && l.y + l.h <= oy + fh && !hitsBadge(l) && !hitsLabel(l))
      if (!spot) continue
      labels.push(spot)
      doc.setDrawColor(214, 98, 20).setLineWidth(0.3)
      doc.line(x1, y1, x2, y2)
      doc.setFillColor(214, 98, 20)
      for (const [x, y] of [[x1, y1], [x2, y2]]) doc.circle(x, y, 0.45, 'F')
      const lcx = spot.x + lw / 2, lcy = spot.y + lh / 2
      if (Math.hypot(lcx - mx, lcy - my) > 0.5) { doc.setLineWidth(0.15); doc.line(mx, my, lcx, lcy) }
      doc.setFillColor(255, 255, 255).setDrawColor(214, 98, 20).setLineWidth(0.15)
      doc.roundedRect(spot.x, spot.y, lw, lh, 0.6, 0.6, 'FD')
      doc.setTextColor(170, 70, 10)
      doc.text(label, lcx, lcy + 0.75, { align: 'center' })
    }
  }

  // Leader lines, then number badges on top of everything.
  for (const b of badges) {
    if (Math.hypot(b.x - b.cx, b.y - b.cy) < b.r * 0.6) continue
    doc.setDrawColor(70).setLineWidth(0.2)
    doc.line(b.cx, b.cy, b.x, b.y)
    doc.setFillColor(40, 40, 40)
    doc.circle(b.cx, b.cy, 0.5, 'F')
  }
  doc.setFont('helvetica', 'bold').setFontSize(6.5)
  for (const b of badges) {
    const up = b.p.level > 0
    doc.setFillColor(up ? 140 : 30, up ? 80 : 41, up ? 20 : 59)
    doc.circle(b.x, b.y, b.r, 'F')
    doc.setTextColor(255)
    doc.text(String(b.p.num), b.x, b.y + 0.85, { align: 'center' })
  }
}

export async function exportLayoutPdf(opts: {
  name: string
  table: Table
  instances: Instance[]
  system: UnitSystem
  /** Floor heights from the level marker tool (metres above the table top). */
  levelMarkers?: number[]
}): Promise<void> {
  const doc = await buildLayoutPdf(opts)
  const file = (opts.name || 'table').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'table'
  doc.save(`${file}-layout.pdf`)
}

export async function buildLayoutPdf(opts: {
  name: string
  table: Table
  instances: Instance[]
  system: UnitSystem
  levelMarkers?: number[]
}): Promise<Doc> {
  const { name, table, instances, system } = opts
  const markers = [...(opts.levelMarkers ?? [])].filter(y => Number.isFinite(y) && y > 0).sort((a, b) => a - b)
  const { jsPDF } = await import('jspdf')
  const { pieces, skipped } = buildLayoutPieces(instances)
  const fmt = (m: number) => formatLength(m, system)

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 12
  const title = pdfText(name || 'Untitled table')
  // Plan area, leaving room for the title, edge labels and rulers.
  const box: Box = { left: M + 14, top: M + 16, right: PW - M - 6, bottom: PH - M - 14 }

  // Tables with level markers print one map per floor (a piece is on the floor of
  // the highest marker at or below its base). Busy tables without markers print
  // one map per half-inch level. Pieces below are shown faintly, so you can see
  // what each one sits on, and any level still too busy for one page is split
  // into zoomed sections. Pieces are renumbered level by level, then section by
  // section, so each page carries a run of consecutive numbers.
  const lvl = markers.length
    ? (p: Piece) => markers.filter(m => p.level * LEVEL_M >= m - MARKER_TOLERANCE).length
    : (p: Piece) => Math.max(0, Math.round(p.level))
  const levels = [...new Set(pieces.map(lvl))].sort((a, b) => a - b)
  const byLevel = levels.length > 1 && (markers.length > 0 || pieces.length > MAX_ONE_PAGE)
  const groups = byLevel ? levels.map(l => pieces.filter(p => lvl(p) === l)) : [pieces]
  const busiest = groups.reduce((a, g) => (g.length > a.length ? g : a), groups[0])
  const sections = chooseSections(busiest, table, (box.right - box.left) / (box.bottom - box.top))
  const splits = (g: Piece[]) => sections.cols * sections.rows > 1 && g.length > MAX_ONE_PAGE
  const sectioned = groups.some(splits)
  for (const g of groups) if (splits(g)) for (const p of g) p.section = sectionOf(p, table, sections.cols, sections.rows)
  if (byLevel || sectioned) {
    const sectionKey = (p: Piece) => {
      if (!p.section) return 0
      const c = p.section.charCodeAt(0) - 65, r = Number(p.section.slice(1)) - 1
      return r * sections.cols + c
    }
    const renum = new Map<number, number>()
    pieces.sort((a, b) => lvl(a) - lvl(b) || sectionKey(a) - sectionKey(b) || a.num - b.num)
      .forEach((p, i) => { renum.set(p.num, i + 1); p.num = i + 1 })
    // On a per-level map the nearest gap must be to a piece on that same map.
    if (byLevel) findNearest(pieces, (a, b) => lvl(a) === lvl(b))
    else for (const p of pieces) if (p.nearest) p.nearest.num = renum.get(p.nearest.num) ?? p.nearest.num
  }

  const heading = (h: string, sub: string) => {
    doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(20)
    doc.text(h, M, M + 2)
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(90)
    doc.text(sub, M, M + 7)
  }
  const tableLine = `Table ${fmt(table.width)} x ${fmt(table.height)}  |  ${pieces.length} piece${pieces.length === 1 ? '' : 's'}  |  ` +
    `Printed ${new Date().toLocaleDateString()}`
  const fullTable: Rect = { x0: -table.width / 2, z0: -table.height / 2, x1: table.width / 2, z1: table.height / 2 }
  const footer = (text: string) => {
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(90)
    doc.text(text, M, PH - M + 2, { maxWidth: PW - 2 * M })
  }
  const legend = `FRONT is the long edge nearest you in the planner's default view. Rulers measure from the left and front edges.` +
    (byLevel ? '' : ` Dark badges sit on the table, brown badges and dashed outlines are stacked on another piece (darker fill = higher).`)
  const levelName = (l: number) => markers.length
    ? (l === 0 ? 'Ground floor (on the table)' : `Floor ${l} (marker at ${fmt(markers[l - 1])})`)
    : (l === 0 ? 'Level 0 (on the table)' : `Level ${l} (about ${fmt(l * LEVEL_M)} up)`)
  const levelWord = markers.length ? 'floor' : 'level'
  const numRange = (g: Piece[]) => {
    const nums = g.map(p => p.num)
    return `Pieces ${Math.min(...nums)}-${Math.max(...nums)}`
  }

  // -- Page 1: whole table ------------------------------------------------------
  heading(title, tableLine)
  if (!byLevel && !sectioned) {
    drawPlan(doc, { table, view: fullTable, box, pieces, numbered: new Set(pieces), faintOthers: false, gaps: true, system })
    footer(`Viewed from above. ${legend} Orange lines = gap to each piece's nearest neighbour (short gaps with room for a label; every gap is in the list after the plan).`)
  } else {
    drawPlan(doc, { table, view: fullTable, box, pieces, numbered: new Set(), faintOthers: false, gaps: false, system, sections: sectioned ? sections : undefined })
    footer(`Overview of the whole table. ` +
      (markers.length && byLevel ? '' : `It has too many pieces to number on one page, so `) +
      (byLevel ? `${markers.length ? 'Each floor (set with the level markers)' : 'each height level'} follows on its own map, from the table up${sectioned ? `, and busy ${levelWord}s are split into the sections shown in blue` : ''}. ` : 'it is split into the sections shown in blue, each on its own zoomed page. ') +
      `Positions for every piece are listed at the end.`)

    const lead = (l: number) => (byLevel ? `${levelName(l)}. ` : '')
    const context = (l: number) => (byLevel
      ? `Numbered pieces are on this ${levelWord}. Grey pieces are on the ${levelWord}s below (what these sit on); higher pieces are on later pages.`
      : `Grey pieces belong to the next section.`)
    for (const g of groups) {
      const l = lvl(g[0])
      const below = pieces.filter(p => lvl(p) <= l)
      const levelTitle = !byLevel ? '' : markers.length ? (l === 0 ? ' - ground floor' : ` - floor ${l}`) : ` - level ${l}`
      if (!splits(g)) {
        // -- One map for this level --------------------------------------------
        doc.addPage()
        heading(`${title}${levelTitle}`, `${byLevel ? levelName(l) + '  |  ' : ''}${numRange(g)}`)
        drawPlan(doc, { table, view: fullTable, box, pieces: below, numbered: new Set(g), faintOthers: true, gaps: true, system })
        footer(`${lead(l)}Viewed from above. ${context(l)} Orange lines = gap to the nearest neighbour on the same level ` +
          `(short gaps with room for a label; every gap is in the list at the end). ${legend}`)
        continue
      }
      // -- One zoomed page per section ----------------------------------------
      for (let r = 0; r < sections.rows; r++) for (let c = 0; c < sections.cols; c++) {
        const name = sectionName(c, r)
        const own = g.filter(p => p.section === name)
        if (!own.length) continue
        const rc = sectionRect(table, sections.cols, sections.rows, c, r)
        // A little of the neighbouring sections shows round the edge for context.
        const pad = Math.min(rc.x1 - rc.x0, rc.z1 - rc.z0) * 0.06
        const view: Rect = {
          x0: Math.max(rc.x0 - pad, -table.width / 2 - 0.02), z0: Math.max(rc.z0 - pad, -table.height / 2 - 0.02),
          x1: Math.min(rc.x1 + pad, table.width / 2 + 0.02), z1: Math.min(rc.z1 + pad, table.height / 2 + 0.02),
        }
        doc.addPage()
        heading(`${title}${levelTitle} - section ${name}`, `${byLevel ? levelName(l) + '  |  ' : ''}${numRange(own)}  |  ` +
          `${fmt(rc.x0 + table.width / 2)}-${fmt(rc.x1 + table.width / 2)} from the left edge, ` +
          `${fmt(table.height / 2 - rc.z1)}-${fmt(table.height / 2 - rc.z0)} from the front edge`)

        // Locator: where this section sits on the table.
        const lw = 30, lh = Math.min(16, (lw * table.height) / table.width)
        const lx = PW - M - lw, ly = M - 4
        const lcw = lw / sections.cols, lch = lh / sections.rows
        doc.setDrawColor(150).setLineWidth(0.15)
        for (let rr = 0; rr < sections.rows; rr++) for (let cc = 0; cc < sections.cols; cc++) {
          if (rr === r && cc === c) doc.setFillColor(37, 99, 235)
          else doc.setFillColor(236, 239, 244)
          doc.rect(lx + cc * lcw, ly + rr * lch, lcw, lch, 'FD')
        }
        doc.setFont('helvetica', 'normal').setFontSize(6).setTextColor(120)
        doc.text('BACK', lx + lw / 2, ly - 0.8, { align: 'center' })

        drawPlan(doc, { table, view, box, pieces: below, numbered: new Set(own), faintOthers: true, gaps: true, system })
        footer(`${lead(l)}Zoomed view of section ${name}, from above. ${context(l)} Orange lines = gap to the nearest neighbour ` +
          `${byLevel ? 'on the same level ' : ''}(short gaps with room for a label; every gap is in the list at the end). ${legend}`)
      }
    }
  }

  // -- Piece list ---------------------------------------------------------------
  const cols = [
    { h: '#', w: 10 },
    ...(sectioned ? [{ h: 'Section', w: 16 }] : []),
    { h: 'Model', w: sectioned ? 70 : 84 },
    { h: 'From left edge', w: 30 },
    { h: 'From front edge', w: 30 },
    { h: 'Rotation', w: 22 },
    { h: 'Level', w: 24 },
    { h: 'Nearest gap', w: 0 },
  ]
  cols[cols.length - 1].w = PW - 2 * M - cols.reduce((a, c) => a + c.w, 0)
  const rowH = 6
  let y = 0
  const header = () => {
    doc.addPage()
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(20)
    doc.text(`${title} - piece positions`, M, M + 2)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90)
    doc.text('Distances are measured from the table edge to the CENTRE of each piece.' +
      (byLevel ? ' Nearest gap is to a piece on the same level.' : ''), M, M + 7)
    y = M + 13
    doc.setFillColor(30, 41, 59)
    doc.rect(M, y, PW - 2 * M, rowH, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(255)
    let x = M
    for (const c of cols) { doc.text(c.h, x + 1.5, y + 4.1); x += c.w }
    y += rowH
  }
  const fit = (s: string, w: number) => {
    if (doc.getTextWidth(s) <= w) return s
    while (s.length > 1 && doc.getTextWidth(s + '...') > w) s = s.slice(0, -1)
    return s + '...'
  }
  header()
  pieces.forEach((p, i) => {
    if (y + rowH > PH - M) header()
    if (i % 2 === 0) { doc.setFillColor(244, 246, 249); doc.rect(M, y, PW - 2 * M, rowH, 'F') }
    const nearest = !p.nearest
      ? '-'
      : p.nearest.gap <= 0.001 ? `touching #${p.nearest.num}` : `${fmt(p.nearest.gap)} to #${p.nearest.num}`
    const rot = p.pitchDeg ? `${p.rotationDeg} deg (tilt ${p.pitchDeg})` : `${p.rotationDeg} deg`
    const cells = [
      String(p.num),
      ...(sectioned ? [p.section ?? ''] : []),
      pdfText(p.name),
      fmt(p.cx + table.width / 2),
      fmt(table.height / 2 - p.cz),
      rot,
      byLevel ? (markers.length ? (lvl(p) ? `floor ${lvl(p)}` : 'ground') : `level ${lvl(p)}`) : p.level > 0 ? `stacked (${p.level})` : 'table',
      nearest,
    ]
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(30)
    let x = M
    cells.forEach((c, ci) => {
      if (ci === 0) doc.setFont('helvetica', 'bold')
      doc.text(fit(c, cols[ci].w - 3), x + 1.5, y + 4.1)
      if (ci === 0) doc.setFont('helvetica', 'normal')
      x += cols[ci].w
    })
    y += rowH
  })
  if (skipped) {
    doc.setFontSize(7.5).setTextColor(160, 60, 20)
    doc.text(`${skipped} piece${skipped === 1 ? '' : 's'} could not be measured (model data not loaded) and are not shown.`, M, Math.min(y + 6, PH - 6))
  }

  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(140)
    doc.text(`Artifact Armoury  |  page ${i} of ${total}`, PW - M, PH - 4, { align: 'right' })
  }
  return doc
}
