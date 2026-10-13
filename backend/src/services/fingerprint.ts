// backend/src/services/fingerprint.ts
//
// Geometry fingerprint — a shape descriptor used to detect re-uploads of an
// existing model even when the file has been re-exported, re-meshed, reordered,
// re-centred, rescaled, rotated, mirrored or decimated. It NEVER modifies the
// model: it is computed from the mesh and stored in the database. (Pairs with
// the header watermark, which traces honest copies; this is the anti-theft
// mechanism for files whose header has been stripped.)
//
// v1 (until 2026-10-13) was a single D2 histogram from 16k random point pairs.
// Its sampling noise alone was ~0.05 L1, and unrelated models sat at 0.07-0.09,
// so a tank turret "matched" a house and rejection had to be switched off.
//
// v2 measures FIVE independent things, each rotation/translation/scale/mirror
// invariant, from 131,072 stratified surface samples (and ~4.7M point pairs):
//
//   eig   exact principal-moment ratios of the surface (λ2/λ1, λ3/λ1) —
//         computed analytically per triangle, so it has no sampling noise
//   d1    distribution of distance from the surface centroid
//   d2    distribution of distance between pairs of surface points (Osada D2)
//   axes  distribution of |coordinate| along each principal axis
//   sh    spherical-harmonic energy per degree (l=1..8) in 8 radial shells
//         (Kazhdan's rotation-invariant shape descriptor) — encodes angular
//         layout, which the other four are blind to
//
// A model is a duplicate only if EVERY component is within its own tolerance:
// score = max over components of (distance / tolerance), match when ≤ 1. Two
// different models have to agree on all five measurements at once, which is
// what makes the false-positive rate drop by orders of magnitude versus v1.
//
// Tolerances were calibrated on 49 real catalogue-style STLs (buildings, ruins,
// palisade sections, tank hulls/turrets/guns) against thief-style transforms —
// see scripts/test-fingerprint.ts (`npm run test:fingerprint`).
//
// Memory: binary STLs are read straight into a Float32Array (36 B/triangle,
// off the V8 heap) instead of parseSTL's object graph, so fingerprinting a
// 10M-triangle upload no longer needs a multi-GB heap.

import { readFile } from 'fs/promises'
import { parseSTL, MAX_INGEST_TRIANGLES } from './fileProcessor'

export const FINGERPRINT_VERSION = 2

const SURFACE_SAMPLES = 131_072 // stratified, area-weighted surface points
const D2_PAIRS = 1 << 23 // ~8.4M random pairs drawn from all the surface samples
const D1_BINS = 64, D1_MAX = 3.0 // radius in units of the RMS radius
const D2_BINS = 96, D2_MAX = 5.0
const AXIS_BINS = 48, AXIS_MAX = 3.0
const SH_SHELLS = 8, SH_RMAX = 2.4, SH_L = 8
const SEED = 0x2545f491 // fixed → same mesh always yields the same descriptor

export interface GeometryFingerprint {
  v: 2
  tris: number
  /** Surface area (source units², usually mm²) — informational, not compared. */
  area: number
  /** RMS distance of the surface from its centroid (source units) — the scale normaliser. */
  rms: number
  /** S³ / (36π V²): 1 for a sphere. Informational only — volume is meaningless on open/kitbashed meshes. */
  compactness: number
  /** Principal moments normalised to the largest: [1, λ2/λ1, λ3/λ1]. */
  eig: number[]
  d1: number[]
  d2: number[]
  /** |coordinate| histograms along principal axes 1..3 (largest first). */
  axes: number[][]
  /**
   * In-plane radius histograms for the principal planes (1-2, 1-3, 2-3). Used
   * instead of `axes` when two moments are nearly equal (a square or round
   * tower), where the axes inside that plane are arbitrary and can rotate.
   */
  planes: number[][]
  /** SH_SHELLS × SH_L energies, each in [0,1] (1 = all mass in one direction). */
  sh: number[]
  /** Fraction of surface samples in each SH shell (weights the sh comparison). */
  shellMass: number[]
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

/**
 * Triangle positions as a flat Float32Array (9 floats per triangle).
 * Binary is detected by size (84 + 50n), not by the "solid" prefix — plenty of
 * binary exporters write "solid" into the header, which fools the prefix test.
 */
export async function readTrianglePositions(stlPath: string): Promise<Float32Array> {
  const buf = await readFile(stlPath)
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80)
    if (84 + n * 50 === buf.length) {
      if (n > MAX_INGEST_TRIANGLES) {
        throw new Error(`Mesh has ${n.toLocaleString()} triangles — the maximum is ${MAX_INGEST_TRIANGLES.toLocaleString()}.`)
      }
      const out = new Float32Array(n * 9)
      for (let i = 0, off = 84 + 12, o = 0; i < n; i++, off += 50) {
        for (let k = 0; k < 9; k++) out[o++] = buf.readFloatLE(off + k * 4)
      }
      return out
    }
  }
  // ASCII (or a malformed binary) — the full parser handles it and its limits.
  const stl = await parseSTL(stlPath)
  const out = new Float32Array(stl.triangles.length * 9)
  let o = 0
  for (const t of stl.triangles) {
    for (const v of t.vertices) { out[o++] = v.x; out[o++] = v.y; out[o++] = v.z }
  }
  return out
}

/** Eigen-decomposition of a symmetric 3×3 (cyclic Jacobi). Returns values desc + column vectors. */
function eigenSym3(m: number[][]): { values: number[]; vectors: number[][] } {
  const a = m.map((r) => r.slice())
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2])
    if (off < 1e-15 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-300)) break
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-300) continue
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1), s = t * c
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q]
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k]
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q]
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i])
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => [v[0][i], v[1][i], v[2][i]]),
  }
}

/** Add `w` to a histogram with linear (soft) binning — removes bin-edge jitter. */
function softAdd(h: Float64Array, x: number, max: number, w = 1) {
  const bins = h.length
  let f = (x / max) * bins - 0.5
  if (f <= 0) { h[0] += w; return }
  if (f >= bins - 1) { h[bins - 1] += w; return }
  const i = Math.floor(f)
  f -= i
  h[i] += w * (1 - f)
  h[i + 1] += w * f
}

function normalise(h: Float64Array): number[] {
  let s = 0
  for (let i = 0; i < h.length; i++) s += h[i]
  return Array.from(h, (x) => round(s > 0 ? x / s : 0))
}

const round = (x: number) => Math.round(x * 1e7) / 1e7

/**
 * Accumulate orthonormal real spherical-harmonic coefficients for unit vector
 * (x,y,z) into coef[l*l + l + m] (m in -l..l), scaled by w.
 */
function addSH(coef: Float64Array, x: number, y: number, z: number, w: number, P: Float64Array) {
  const L = SH_L
  const st = Math.sqrt(Math.max(0, 1 - z * z))
  const phi = Math.atan2(y, x)
  // Normalised associated Legendre p[l][m] (stored at l*(L+1)+m), including 1/sqrt(4π).
  const W = L + 1
  P[0] = 0.28209479177387814 // 1/sqrt(4π)
  for (let m = 1; m <= L; m++) P[m * W + m] = -Math.sqrt((2 * m + 1) / (2 * m)) * st * P[(m - 1) * W + (m - 1)]
  for (let m = 0; m < L; m++) P[(m + 1) * W + m] = Math.sqrt(2 * m + 3) * z * P[m * W + m]
  for (let m = 0; m <= L; m++) {
    for (let l = m + 2; l <= L; l++) {
      const a = Math.sqrt((4 * l * l - 1) / (l * l - m * m))
      const b = Math.sqrt(((l - 1) * (l - 1) - m * m) / (4 * (l - 1) * (l - 1) - 1))
      P[l * W + m] = a * (z * P[(l - 1) * W + m] - b * P[(l - 2) * W + m])
    }
  }
  for (let l = 1; l <= L; l++) {
    const base = l * l + l
    coef[base] += w * P[l * W]
    for (let m = 1; m <= l; m++) {
      const p = Math.SQRT2 * P[l * W + m] * w
      coef[base + m] += p * Math.cos(m * phi)
      coef[base - m] += p * Math.sin(m * phi)
    }
  }
}

function emptyFingerprint(tris: number): GeometryFingerprint {
  return {
    v: 2, tris, area: 0, rms: 0, compactness: 0, eig: [0, 0, 0],
    d1: new Array(D1_BINS).fill(0), d2: new Array(D2_BINS).fill(0),
    axes: [0, 1, 2].map(() => new Array(AXIS_BINS).fill(0)),
    planes: [0, 1, 2].map(() => new Array(AXIS_BINS).fill(0)),
    sh: new Array(SH_SHELLS * SH_L).fill(0), shellMass: new Array(SH_SHELLS).fill(0),
  }
}

/** Compute the geometry fingerprint for an STL file. */
export async function computeGeometryFingerprint(stlPath: string): Promise<GeometryFingerprint> {
  return fingerprintFromPositions(await readTrianglePositions(stlPath))
}

/** Fingerprint a flat triangle-position array (9 floats per triangle). Exported for tests. */
export function fingerprintFromPositions(P: ArrayLike<number>): GeometryFingerprint {
  const n = Math.floor(P.length / 9)
  if (n === 0) return emptyFingerprint(0)

  // --- Pass 1: per-triangle area (cumulative, for sampling) + area-weighted centroid.
  const cumArea = new Float64Array(n)
  let S = 0, cx = 0, cy = 0, cz = 0
  for (let i = 0, o = 0; i < n; i++, o += 9) {
    const abx = P[o + 3] - P[o], aby = P[o + 4] - P[o + 1], abz = P[o + 5] - P[o + 2]
    const acx = P[o + 6] - P[o], acy = P[o + 7] - P[o + 1], acz = P[o + 8] - P[o + 2]
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
    let A = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (!Number.isFinite(A)) A = 0 // NaN/Inf vertices: never sampled
    if (A > 0) {
      S += A
      cx += A * (P[o] + P[o + 3] + P[o + 6]) / 3
      cy += A * (P[o + 1] + P[o + 4] + P[o + 7]) / 3
      cz += A * (P[o + 2] + P[o + 5] + P[o + 8]) / 3
    }
    cumArea[i] = S
  }
  if (!(S > 0)) return emptyFingerprint(n)
  cx /= S; cy /= S; cz /= S

  // --- Pass 2: exact surface second-moment tensor about the centroid, + volume.
  //   ∫_T p pᵀ dA = A/12 · (a aᵀ + b bᵀ + c cᵀ + s sᵀ), s = a+b+c
  let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0, vol = 0
  for (let i = 0, o = 0; i < n; i++, o += 9) {
    const A = cumArea[i] - (i > 0 ? cumArea[i - 1] : 0)
    if (A <= 0) continue
    const ax = P[o] - cx, ay = P[o + 1] - cy, az = P[o + 2] - cz
    const bx = P[o + 3] - cx, by = P[o + 4] - cy, bz = P[o + 5] - cz
    const qx = P[o + 6] - cx, qy = P[o + 7] - cy, qz = P[o + 8] - cz
    const sx = ax + bx + qx, sy = ay + by + qy, sz = az + bz + qz
    const k = A / 12
    xx += k * (ax * ax + bx * bx + qx * qx + sx * sx)
    yy += k * (ay * ay + by * by + qy * qy + sy * sy)
    zz += k * (az * az + bz * bz + qz * qz + sz * sz)
    xy += k * (ax * ay + bx * by + qx * qy + sx * sy)
    xz += k * (ax * az + bx * bz + qx * qz + sx * sz)
    yz += k * (ay * az + by * bz + qy * qz + sy * sz)
    vol += (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6
  }
  const C = [[xx / S, xy / S, xz / S], [xy / S, yy / S, yz / S], [xz / S, yz / S, zz / S]]
  const { values, vectors } = eigenSym3(C)
  const rms = Math.sqrt(Math.max(1e-300, values[0] + values[1] + values[2]))
  const l1 = values[0] > 0 ? values[0] : 1
  const [e1, e2, e3] = vectors

  // --- Stratified area-weighted surface sampling, in the principal frame, unit RMS radius.
  // Sample k lands at cumulative area (k + u)/N · S, so the samples cover the
  // surface far more evenly than independent draws (much lower estimator noise).
  const rand = mulberry32(SEED)
  const N = SURFACE_SAMPLES
  const qxA = new Float32Array(N), qyA = new Float32Array(N), qzA = new Float32Array(N)
  let tri = 0
  for (let k = 0; k < N; k++) {
    const r = ((k + rand()) / N) * S
    while (tri < n - 1 && cumArea[tri] < r) tri++
    const o = tri * 9
    let u = rand(), w = rand()
    if (u + w > 1) { u = 1 - u; w = 1 - w }
    const px = P[o] + u * (P[o + 3] - P[o]) + w * (P[o + 6] - P[o]) - cx
    const py = P[o + 1] + u * (P[o + 4] - P[o + 1]) + w * (P[o + 7] - P[o + 1]) - cy
    const pz = P[o + 2] + u * (P[o + 5] - P[o + 2]) + w * (P[o + 8] - P[o + 2]) - cz
    qxA[k] = (px * e1[0] + py * e1[1] + pz * e1[2]) / rms
    qyA[k] = (px * e2[0] + py * e2[1] + pz * e2[2]) / rms
    qzA[k] = (px * e3[0] + py * e3[1] + pz * e3[2]) / rms
  }

  // --- d1, axes, sh (all from the full sample set).
  const d1 = new Float64Array(D1_BINS)
  const ax = [new Float64Array(AXIS_BINS), new Float64Array(AXIS_BINS), new Float64Array(AXIS_BINS)]
  const pl = [new Float64Array(AXIS_BINS), new Float64Array(AXIS_BINS), new Float64Array(AXIS_BINS)]
  const NC = (SH_L + 1) * (SH_L + 1)
  const coef = Array.from({ length: SH_SHELLS }, () => new Float64Array(NC))
  const shellW = new Float64Array(SH_SHELLS)
  const shellW2 = new Float64Array(SH_SHELLS) // Σw² — the noise floor of a shell's energy
  const Pbuf = new Float64Array((SH_L + 1) * (SH_L + 1))
  for (let k = 0; k < N; k++) {
    const x = qxA[k], y = qyA[k], z = qzA[k]
    const r = Math.sqrt(x * x + y * y + z * z)
    softAdd(d1, r, D1_MAX)
    softAdd(ax[0], Math.abs(x), AXIS_MAX)
    softAdd(ax[1], Math.abs(y), AXIS_MAX)
    softAdd(ax[2], Math.abs(z), AXIS_MAX)
    softAdd(pl[0], Math.sqrt(x * x + y * y), AXIS_MAX)
    softAdd(pl[1], Math.sqrt(x * x + z * z), AXIS_MAX)
    softAdd(pl[2], Math.sqrt(y * y + z * z), AXIS_MAX)
    if (r < 1e-9) continue
    // Soft shell assignment between the two nearest shell centres.
    let f = (r / SH_RMAX) * SH_SHELLS - 0.5
    let s0: number, s1: number, w1: number
    if (f <= 0) { s0 = s1 = 0; w1 = 0 }
    else if (f >= SH_SHELLS - 1) { s0 = s1 = SH_SHELLS - 1; w1 = 0 }
    else { s0 = Math.floor(f); s1 = s0 + 1; w1 = f - s0 }
    const ux = x / r, uy = y / r, uz = z / r
    const w0 = 1 - w1
    if (w0 > 0) { addSH(coef[s0], ux, uy, uz, w0, Pbuf); shellW[s0] += w0; shellW2[s0] += w0 * w0 }
    if (w1 > 0) { addSH(coef[s1], ux, uy, uz, w1, Pbuf); shellW[s1] += w1; shellW2[s1] += w1 * w1 }
  }
  const sh: number[] = []
  let totalW = 0
  for (let s = 0; s < SH_SHELLS; s++) totalW += shellW[s]
  for (let s = 0; s < SH_SHELLS; s++) {
    const W = shellW[s]
    for (let l = 1; l <= SH_L; l++) {
      let E = 0
      for (let m = -l; m <= l; m++) { const c = coef[s][l * l + l + m]; E += c * c }
      // E for uncorrelated directions ≈ Σw²·(2l+1)/4π; subtract that floor so a
      // sparsely-populated shell doesn't read as structured.
      const norm = (2 * l + 1) / (4 * Math.PI)
      const f = W > 0 ? (E - shellW2[s] * norm) / (norm * W * W) : 0
      sh.push(round(Math.max(0, Math.min(1, f))))
    }
  }
  const shellMass = Array.from(shellW, (w) => round(totalW > 0 ? w / totalW : 0))

  // --- d2: distances between random pairs of surface samples. Drawing pairs
  // from all N samples (not all-pairs of a small subset) keeps the estimate's
  // noise down to the level of the other components.
  const d2 = new Float64Array(D2_BINS)
  for (let p = 0; p < D2_PAIRS; p++) {
    const i = (rand() * N) | 0, j = (rand() * N) | 0
    const dx = qxA[i] - qxA[j], dy = qyA[i] - qyA[j], dz = qzA[i] - qzA[j]
    softAdd(d2, Math.sqrt(dx * dx + dy * dy + dz * dz), D2_MAX)
  }

  const absVol = Math.abs(vol)
  return {
    v: 2,
    tris: n,
    area: round(S),
    rms: round(rms),
    compactness: absVol > 0 ? round(Math.pow(S, 3) / (36 * Math.PI * absVol * absVol)) : 0,
    eig: [1, round(Math.max(0, values[1]) / l1), round(Math.max(0, values[2]) / l1)],
    d1: normalise(d1),
    d2: normalise(d2),
    axes: ax.map(normalise),
    planes: pl.map(normalise),
    sh,
    shellMass,
  }
}

// ---------------------------------------------------------------- comparison

/** Earth mover's distance between two 1-D histograms over [0, max] (in RMS radii). */
function emd(a: number[], b: number[], max: number): number {
  let ca = 0, cb = 0, s = 0
  for (let i = 0; i < a.length; i++) { ca += a[i]; cb += b[i]; s += Math.abs(ca - cb) }
  return (s * max) / a.length
}

/**
 * Per-component tolerances. A component's distance divided by its tolerance is
 * its "score"; a re-upload has to score ≤ 1 on every component. Calibrated with
 * `npm run test:fingerprint` (see its output for the measured headroom).
 */
export const COMPONENT_TOLERANCE = {
  eig: 0.016,
  d1: 0.013,
  d2: 0.009,
  axes: 0.007,
  sh: 0.008,
} as const

export type FingerprintComponent = keyof typeof COMPONENT_TOLERANCE

export interface FingerprintComparison {
  /** max(component distance / tolerance). ≤ MATCH_THRESHOLD = duplicate. */
  score: number
  /** Raw per-component distances (for logs and calibration). */
  distances: Record<FingerprintComponent, number>
}

function isV2(f: any): f is GeometryFingerprint {
  return !!f && f.v === 2 && Array.isArray(f.d1) && Array.isArray(f.sh) && Array.isArray(f.axes) && Array.isArray(f.planes) && f.tris > 0 && f.rms > 0
}

/**
 * Two principal moments within this fraction of each other (in EITHER model)
 * are treated as "the same": the axes inside that plane are then arbitrary —
 * a square tower's can sit at any angle — so per-axis profiles are compared
 * only where they are well defined, and the in-plane radius stands in for the
 * rest. Without this a re-upload of a square piece could miss.
 */
const DEGENERATE_GAP = 0.1

function axesDistance(a: GeometryFingerprint, b: GeometryFingerprint): number {
  const degen = (i: number, j: number) => {
    const near = (e: number[]) => Math.abs(e[i] - e[j]) / Math.max(e[i], e[j], 1e-12) < DEGENERATE_GAP
    return near(a.eig) || near(b.eig)
  }
  const d01 = degen(0, 1), d12 = degen(1, 2), d02 = degen(0, 2)
  const axis = (k: number) => emd(a.axes[k], b.axes[k], AXIS_MAX)
  const plane = (k: number) => emd(a.planes[k], b.planes[k], AXIS_MAX) // 0: 1-2, 1: 1-3, 2: 2-3
  if ((d01 && d12) || d02) return 0 // all three moments alike: nothing axis-specific to compare (d1 covers it)
  if (d01) return (2 * plane(0) + axis(2)) / 3
  if (d12) return (2 * plane(2) + axis(0)) / 3
  return (axis(0) + axis(1) + axis(2)) / 3
}

/** Compare two fingerprints. null when either is missing or from an older version. */
export function compareFingerprints(a: GeometryFingerprint | null | undefined, b: GeometryFingerprint | null | undefined): FingerprintComparison | null {
  if (!isV2(a) || !isV2(b)) return null
  const eig = Math.abs(a.eig[1] - b.eig[1]) + Math.abs(a.eig[2] - b.eig[2])
  const d1 = emd(a.d1, b.d1, D1_MAX)
  const d2 = emd(a.d2, b.d2, D2_MAX)
  const axes = axesDistance(a, b)
  let sh = 0
  for (let s = 0; s < SH_SHELLS; s++) {
    const w = (a.shellMass[s] + b.shellMass[s]) / 2
    let ds = 0
    for (let l = 0; l < SH_L; l++) ds += Math.abs(a.sh[s * SH_L + l] - b.sh[s * SH_L + l])
    sh += w * (ds / SH_L)
  }
  const distances = { eig, d1, d2, axes, sh }
  let score = 0
  for (const k of Object.keys(COMPONENT_TOLERANCE) as FingerprintComponent[]) {
    score = Math.max(score, distances[k] / COMPONENT_TOLERANCE[k])
  }
  return { score, distances }
}

/** Match score: 0 = identical, ≤ MATCH_THRESHOLD = duplicate, Infinity = not comparable. */
export function fingerprintDistance(a: GeometryFingerprint | null, b: GeometryFingerprint | null): number {
  return compareFingerprints(a, b)?.score ?? Infinity
}

// Score threshold (every component must be within score × its tolerance).
// Lower = stricter. FINGERPRINT_MATCH_SCORE overrides it. (v1's
// FINGERPRINT_MATCH_THRESHOLD was an L1 distance and is no longer read.)
export const MATCH_THRESHOLD = Number(process.env.FINGERPRINT_MATCH_SCORE ?? 1)

// Rejecting uploads on a geometry match. v1 had to be switched off (2026-10-12):
// unrelated shapes scored on top of its threshold. See the top of this file for
// what v2 changed; GEOMETRY_DEDUP_ENABLED=false turns rejection off again while
// still logging the closest match.
export const GEOMETRY_DEDUP_ENABLED = process.env.GEOMETRY_DEDUP_ENABLED !== 'false'

/** True when two descriptors almost certainly describe the same shape. */
export function isLikelyDuplicate(
  a: GeometryFingerprint | null,
  b: GeometryFingerprint | null,
  threshold = MATCH_THRESHOLD,
): boolean {
  return fingerprintDistance(a, b) <= threshold
}
