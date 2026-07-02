// backend/src/services/fingerprint.ts
//
// Geometry fingerprint — a shape descriptor used to detect re-uploads of an
// existing model even when the file has been re-exported, re-meshed, reordered,
// re-centred, rescaled or rotated. It NEVER modifies the model: it is computed
// from the mesh and stored in the database. (Pairs with the header watermark,
// which traces honest copies; this is the actual anti-theft mechanism.)
//
// Descriptor = a scale-normalised "D2 shape distribution" (Osada et al.): the
// histogram of distances between pairs of random points sampled uniformly over
// the surface, divided by the mean distance. Area-weighted surface sampling
// makes it invariant to tessellation (re-meshing); using distances makes it
// invariant to rotation/translation; dividing by the mean makes it invariant to
// scale. A compactness scalar (S³/V²) is kept as a cheap secondary check.

import { parseSTL } from './fileProcessor'

const D2_BINS = 64
const D2_SURFACE_SAMPLES = 8192 // points sampled over the surface
const D2_PAIRS = 16384 // distance samples drawn from those points
const D2_MAX = 2.0 // histogram spans d/meanDist in [0, D2_MAX]
const SEED = 0x2545f491 // fixed → same mesh always yields the same descriptor

export interface GeometryFingerprint {
  v: 1
  tris: number
  /** S³ / (36π V²): dimensionless, 1 for a sphere, larger for thin/complex shapes. */
  compactness: number
  /** Normalised D2 histogram, length D2_BINS, sums to 1. */
  d2: number[]
}

/** Small deterministic PRNG (mulberry32) so descriptors are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface V3 { x: number; y: number; z: number }

/** Compute the geometry fingerprint for an STL file. */
export async function computeGeometryFingerprint(stlPath: string): Promise<GeometryFingerprint> {
  const stl = await parseSTL(stlPath)
  const tris = stl.triangles
  const n = tris.length
  if (n === 0) return { v: 1, tris: 0, compactness: 0, d2: new Array(D2_BINS).fill(0) }

  // Per-triangle area (for area-weighted sampling) + signed volume.
  const cumArea = new Float64Array(n)
  let totalArea = 0
  let volume = 0
  for (let i = 0; i < n; i++) {
    const [a, b, c] = tris[i].vertices
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z
    const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    totalArea += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz)
    cumArea[i] = totalArea
    volume += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6
  }
  volume = Math.abs(volume)
  if (totalArea <= 0) return { v: 1, tris: n, compactness: 0, d2: new Array(D2_BINS).fill(0) }

  const rand = mulberry32(SEED)

  // Pick a triangle with probability proportional to its area (binary search).
  const pickTriangle = (): number => {
    const r = rand() * totalArea
    let lo = 0, hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cumArea[mid] < r) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const samplePoint = (): V3 => {
    const [a, b, c] = tris[pickTriangle()].vertices
    let u = rand(), w = rand()
    if (u + w > 1) { u = 1 - u; w = 1 - w } // reflect into the triangle
    return {
      x: a.x + u * (b.x - a.x) + w * (c.x - a.x),
      y: a.y + u * (b.y - a.y) + w * (c.y - a.y),
      z: a.z + u * (b.z - a.z) + w * (c.z - a.z),
    }
  }

  const pts: V3[] = new Array(D2_SURFACE_SAMPLES)
  for (let i = 0; i < D2_SURFACE_SAMPLES; i++) pts[i] = samplePoint()

  const dists = new Float64Array(D2_PAIRS)
  let meanDist = 0
  for (let i = 0; i < D2_PAIRS; i++) {
    const p = pts[(rand() * D2_SURFACE_SAMPLES) | 0]
    const q = pts[(rand() * D2_SURFACE_SAMPLES) | 0]
    const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    dists[i] = d
    meanDist += d
  }
  meanDist = meanDist / D2_PAIRS || 1

  const d2 = new Array(D2_BINS).fill(0)
  const binW = D2_MAX / D2_BINS
  for (let i = 0; i < D2_PAIRS; i++) {
    let bin = Math.floor(dists[i] / meanDist / binW)
    if (bin >= D2_BINS) bin = D2_BINS - 1
    else if (bin < 0) bin = 0
    d2[bin]++
  }
  for (let i = 0; i < D2_BINS; i++) d2[i] /= D2_PAIRS

  const compactness = volume > 0 ? Math.pow(totalArea, 3) / (36 * Math.PI * volume * volume) : 0
  return { v: 1, tris: n, compactness, d2 }
}

/** L1 distance between two D2 histograms: 0 = identical, up to 2 = disjoint. */
export function fingerprintDistance(a: GeometryFingerprint | null, b: GeometryFingerprint | null): number {
  if (!a?.d2 || !b?.d2 || a.d2.length !== b.d2.length) return Infinity
  let s = 0
  for (let i = 0; i < a.d2.length; i++) s += Math.abs(a.d2[i] - b.d2[i])
  return s
}

/** Match threshold (tunable): smaller = stricter. L1 over the D2 histogram. */
export const MATCH_THRESHOLD = Number(process.env.FINGERPRINT_MATCH_THRESHOLD ?? 0.2)

/** True when two descriptors almost certainly describe the same shape. */
export function isLikelyDuplicate(
  a: GeometryFingerprint | null,
  b: GeometryFingerprint | null,
  threshold = MATCH_THRESHOLD,
): boolean {
  const d = fingerprintDistance(a, b)
  if (d > threshold) return false
  // Secondary guard: compactness must also be close (catches different shapes
  // whose distance histograms happen to look similar).
  const ca = a!.compactness, cb = b!.compactness
  if (ca > 0 && cb > 0 && Math.abs(ca - cb) / Math.max(ca, cb) > 0.15) return false
  return true
}
