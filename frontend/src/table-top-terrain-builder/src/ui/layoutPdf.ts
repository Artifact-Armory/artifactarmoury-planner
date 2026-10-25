// src/ui/layoutPdf.ts — "Print layout" PDF: a to-scale top-down plan of the table
// with every piece numbered, plus the measurements needed to set it out on a real
// table with a tape measure (centre distance from the left and front edges, and
// the edge-to-edge gap to each piece's nearest neighbour).
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
  nearest?: { num: number; gap: number; a: Pt; b: Pt }
}

const M_PER_IN = 0.0254

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
    const hull = footprintHull(inst, asset.aabb, asset.defaultRollDeg ?? 0)
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

  for (const p of pieces) {
    for (const o of pieces) {
      if (o === p) continue
      // A piece stacked on top of another isn't "next to" it — skip that pairing.
      if (o.level !== p.level && overlaps(p.hull, o.hull)) continue
      const g = polygonGap(p.hull, o.hull)
      if (!p.nearest || g.gap < p.nearest.gap) p.nearest = { num: o.num, gap: g.gap, a: g.a, b: g.b }
    }
  }
  return { pieces, skipped }
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

export async function exportLayoutPdf(opts: {
  name: string
  table: Table
  instances: Instance[]
  system: UnitSystem
}): Promise<void> {
  const { name, table, instances, system } = opts
  const { jsPDF } = await import('jspdf')
  const { pieces, skipped } = buildLayoutPieces(instances)
  const fmt = (m: number) => formatLength(m, system)

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 12
  const title = pdfText(name || 'Untitled table')

  // -- Page 1: plan -----------------------------------------------------------
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(20)
  doc.text(title, M, M + 2)
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(90)
  doc.text(
    `Table ${fmt(table.width)} x ${fmt(table.height)}  |  ${pieces.length} piece${pieces.length === 1 ? '' : 's'}  |  ` +
      `Printed ${new Date().toLocaleDateString()}`,
    M, M + 7,
  )

  // Fit the table in the remaining area, leaving room for edge labels + rulers.
  const top = M + 16, bottom = PH - M - 14, left = M + 14, right = PW - M - 6
  const s = Math.min((right - left) / table.width, (bottom - top) / table.height) // mm per metre
  const tw = table.width * s, th = table.height * s
  const ox = left + (right - left - tw) / 2
  const oy = top + (bottom - top - th) / 2
  const px = (x: number) => ox + (x + table.width / 2) * s
  const py = (z: number) => oy + (z + table.height / 2) * s

  // Grid + rulers measured from the left and front edges.
  const steps = system === 'imperial' ? [6 * M_PER_IN, 12 * M_PER_IN, 24 * M_PER_IN] : [0.1, 0.2, 0.5]
  const step = steps.find(st => Math.max(table.width, table.height) / st <= 24) ?? steps[steps.length - 1]
  doc.setDrawColor(225).setLineWidth(0.15)
  doc.setFontSize(6.5).setTextColor(120)
  for (let d = step; d < table.width - 1e-6; d += step) {
    const x = ox + d * s
    doc.line(x, oy, x, oy + th)
    doc.text(fmt(d), x, oy + th + 3.5, { align: 'center' })
  }
  for (let d = step; d < table.height - 1e-6; d += step) {
    const y = oy + th - d * s
    doc.line(ox, y, ox + tw, y)
    doc.text(fmt(d), ox - 1.5, y + 1, { align: 'right' })
  }
  doc.setDrawColor(40).setLineWidth(0.5)
  doc.rect(ox, oy, tw, th)

  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(60)
  doc.text('FRONT', ox + tw / 2, oy + th + 8, { align: 'center' })
  doc.text('BACK', ox + tw / 2, oy - 1.5, { align: 'center' })
  doc.text('LEFT', ox - 11, oy + th / 2, { angle: 90, align: 'center' })
  doc.text('RIGHT', ox + tw + 3.5, oy + th / 2, { angle: 90, align: 'center' })

  // Pieces: ground level solid, stacked pieces dashed so the one below stays readable.
  const ordered = [...pieces].sort((a, b) => a.level - b.level)
  for (const p of ordered) {
    if (p.hull.length < 3) continue
    const pts = p.hull.map(h => [px(h.x), py(h.z)] as [number, number])
    const segs = pts.slice(1).map((pt, i) => [pt[0] - pts[i][0], pt[1] - pts[i][1]])
    doc.setFillColor(p.level > 0 ? 235 : 214, p.level > 0 ? 228 : 222, p.level > 0 ? 210 : 232)
    doc.setDrawColor(70).setLineWidth(0.3)
    if (p.level > 0) doc.setLineDashPattern([1, 0.8], 0)
    doc.lines(segs, pts[0][0], pts[0][1], [1, 1], 'FD', true)
    doc.setLineDashPattern([], 0)
  }

  // Nearest-gap dimension lines, one per pair.
  const drawn = new Set<string>()
  doc.setFont('helvetica', 'normal').setFontSize(6)
  for (const p of pieces) {
    const n = p.nearest
    if (!n || n.gap <= 0.001) continue
    const key = [p.num, n.num].sort((a, b) => a - b).join('-')
    if (drawn.has(key)) continue
    drawn.add(key)
    const x1 = px(n.a.x), y1 = py(n.a.z), x2 = px(n.b.x), y2 = py(n.b.z)
    doc.setDrawColor(214, 98, 20).setLineWidth(0.3)
    doc.line(x1, y1, x2, y2)
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      doc.setFillColor(214, 98, 20)
      doc.circle(x, y, 0.45, 'F')
    }
    const label = fmt(n.gap)
    const lw = doc.getTextWidth(label) + 1.6
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
    doc.setFillColor(255, 255, 255).setDrawColor(214, 98, 20).setLineWidth(0.15)
    doc.roundedRect(mx - lw / 2, my - 1.6, lw, 3.2, 0.6, 0.6, 'FD')
    doc.setTextColor(170, 70, 10)
    doc.text(label, mx, my + 0.75, { align: 'center' })
  }

  // Number badges on top of everything.
  doc.setFont('helvetica', 'bold').setFontSize(6.5)
  // Stacked pieces share a centre with the piece below — nudge a badge sideways
  // until it clears the ones already placed so every number stays readable.
  const placed: { x: number; y: number; r: number }[] = []
  for (const p of ordered) {
    const r = p.num >= 100 ? 2.6 : 2.1
    let x = px(p.cx)
    const y = py(p.cz)
    while (placed.some(b => Math.hypot(b.x - x, b.y - y) < b.r + r + 0.3)) x += r + 0.4
    placed.push({ x, y, r })
    doc.setFillColor(p.level > 0 ? 120 : 30, p.level > 0 ? 70 : 41, p.level > 0 ? 20 : 59)
    doc.circle(x, y, r, 'F')
    doc.setTextColor(255)
    doc.text(String(p.num), x, y + 0.85, { align: 'center' })
  }

  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(90)
  doc.text(
    `Viewed from above. FRONT is the long edge nearest you in the planner's default view. ` +
      `Orange lines = gap to each piece's nearest neighbour. Dashed outline = stacked on another piece. ` +
      `Positions for every piece are listed on the next page.`,
    M, PH - M + 2, { maxWidth: PW - 2 * M },
  )

  // -- Page 2+: piece list ----------------------------------------------------
  const cols = [
    { h: '#', w: 10 },
    { h: 'Model', w: 84 },
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
    doc.text('Distances are measured from the table edge to the CENTRE of each piece.', M, M + 7)
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
      pdfText(p.name),
      fmt(p.cx + table.width / 2),
      fmt(table.height / 2 - p.cz),
      rot,
      p.level > 0 ? `stacked (${p.level})` : 'table',
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

  const file = (name || 'table').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'table'
  doc.save(`${file}-layout.pdf`)
}
