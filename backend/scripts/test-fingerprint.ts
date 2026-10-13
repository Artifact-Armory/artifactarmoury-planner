// backend/scripts/test-fingerprint.ts
//
// Calibrates and validates the v2 geometry fingerprint (services/fingerprint.ts).
//
//   npm run test:fingerprint                       # the repo's demo STLs
//   npm run test:fingerprint -- <dir> [<dir> ...]  # any folders of STLs
//
// For every STL it builds the copies a thief would upload to dodge the exact
// SHA-256 check, and every one must MATCH its original:
//   xform    random 3-D rotation + mirror + rescale + translate + shuffled triangle/vertex order
//   subdiv   every triangle split into 4 (re-meshed, identical surface)
//   quant    coordinates rounded to 0.02 mm (low-precision re-export)
//   noise    every vertex jittered by up to 0.02% of the model's RMS radius (~0.01 mm — below print resolution)
//   dec50    decimated toward 50% of its triangles (meshoptimizer, ≤1% shape error)
//   dec25    decimated toward 25% — a STRESS test, reported but not required:
//            on a low-poly or finely-textured piece it removes real surface
//            detail, i.e. it is no longer quite the same model
// Then every pair of DIFFERENT files must NOT match. Files whose names differ
// only by Left/Right are mirror images of each other, which the fingerprint
// deliberately treats as the same shape — those pairs are reported, not failed.
//
// Prints, per component, the worst distance seen on a genuine copy against the
// closest pair of different models — the headroom the tolerances sit in.

import { promises as fs } from 'fs'
import path from 'path'
import { MeshoptSimplifier } from 'meshoptimizer'
import {
  readTrianglePositions, fingerprintFromPositions, compareFingerprints,
  COMPONENT_TOLERANCE, MATCH_THRESHOLD, type GeometryFingerprint, type FingerprintComponent,
} from '../src/services/fingerprint'

const DEFAULT_DIR = path.resolve(__dirname, '../../frontend/public/assets/pre converted/kieran_s/terrain-kieran_s')
const COMPONENTS = Object.keys(COMPONENT_TOLERANCE) as FingerprintComponent[]

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Weld exact-duplicate positions → indexed mesh. */
function weld(P: Float32Array): { verts: Float32Array; idx: Uint32Array } {
  const n = P.length / 3
  const map = new Map<string, number>()
  const verts: number[] = []
  const idx = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    const key = `${P[i * 3]},${P[i * 3 + 1]},${P[i * 3 + 2]}`
    let v = map.get(key)
    if (v === undefined) { v = verts.length / 3; map.set(key, v); verts.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]) }
    idx[i] = v
  }
  return { verts: new Float32Array(verts), idx }
}

function unweld(verts: Float32Array, idx: Uint32Array): Float32Array {
  const out = new Float32Array(idx.length * 3)
  for (let i = 0; i < idx.length; i++) {
    out[i * 3] = verts[idx[i] * 3]; out[i * 3 + 1] = verts[idx[i] * 3 + 1]; out[i * 3 + 2] = verts[idx[i] * 3 + 2]
  }
  return out
}

function xform(P: Float32Array): Float32Array {
  const r = rng(7)
  // Random rotation from a random unit quaternion.
  let [qw, qx, qy, qz] = [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5]
  const ql = Math.hypot(qw, qx, qy, qz); qw /= ql; qx /= ql; qy /= ql; qz /= ql
  const R = [
    [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
    [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
    [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
  ]
  const s = 1.37, t = [123.4, -55.1, 9.9]
  const n = P.length / 9
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  const out = new Float32Array(P.length)
  for (let k = 0; k < n; k++) {
    const src = order[k] * 9, rot = k % 3 // rotate vertex order too
    for (let v = 0; v < 3; v++) {
      const so = src + ((v + rot) % 3) * 3
      const x = -P[so], y = P[so + 1], z = P[so + 2] // mirror
      for (let c = 0; c < 3; c++) out[k * 9 + v * 3 + c] = s * (R[c][0] * x + R[c][1] * y + R[c][2] * z) + t[c]
    }
  }
  return out
}

function subdivide(P: Float32Array): Float32Array {
  const n = P.length / 9
  const out = new Float32Array(P.length * 4)
  let o = 0
  const put = (a: number[]) => { for (const x of a) out[o++] = x }
  for (let i = 0; i < n; i++) {
    const v = (k: number) => [P[i * 9 + k * 3], P[i * 9 + k * 3 + 1], P[i * 9 + k * 3 + 2]]
    const a = v(0), b = v(1), c = v(2)
    const mid = (p: number[], q: number[]) => p.map((x, j) => (x + q[j]) / 2)
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
    put([...a, ...ab, ...ca]); put([...ab, ...b, ...bc]); put([...ca, ...bc, ...c]); put([...ab, ...bc, ...ca])
  }
  return out
}

function quantize(P: Float32Array, step: number): Float32Array {
  return P.map((x) => Math.round(x / step) * step)
}

function noise(P: Float32Array, rms: number, frac: number): Float32Array {
  const { verts, idx } = weld(P)
  const r = rng(11)
  for (let i = 0; i < verts.length; i++) verts[i] += (r() * 2 - 1) * rms * frac
  return unweld(verts, idx)
}

function decimate(P: Float32Array, ratio: number): Float32Array {
  const { verts, idx } = weld(P)
  const target = Math.floor((idx.length * ratio) / 3) * 3
  const [out] = MeshoptSimplifier.simplify(idx, verts, 3, target, 0.01, ['LockBorder'])
  return unweld(verts, out)
}

const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(4) : '  ∞  ')
const mirrorKey = (f: string) => f.replace(/left|right/gi, 'LR')

async function main() {
  await MeshoptSimplifier.ready
  const dirs = process.argv.slice(2).length ? process.argv.slice(2) : [DEFAULT_DIR]
  const files: string[] = []
  for (const d of dirs) {
    for (const f of (await fs.readdir(d)).sort()) if (/\.stl$/i.test(f)) files.push(path.join(d, f))
  }
  console.log(`\nv2 geometry fingerprint — ${files.length} models, match when score ≤ ${MATCH_THRESHOLD}`)
  console.log(`tolerances: ${COMPONENTS.map((c) => `${c}=${COMPONENT_TOLERANCE[c]}`).join('  ')}\n`)

  const VARIANTS: Array<[string, (P: Float32Array, fp: GeometryFingerprint) => Float32Array | null]> = [
    ['xform', (P) => xform(P)],
    ['subdiv', (P) => (P.length / 9 <= 1_500_000 ? subdivide(P) : null)],
    ['quant', (P) => quantize(P, 0.02)],
    ['noise', (P, fp) => noise(P, fp.rms, 0.0002)],
    ['dec50', (P) => decimate(P, 0.5)],
    ['dec25', (P) => decimate(P, 0.25)],
  ]
  const worstCopy: Record<string, Record<FingerprintComponent, number> & { score: number; who: string }> = {}
  const originals: Array<{ name: string; fp: GeometryFingerprint }> = []
  let failures = 0
  let stressMisses = 0

  for (const file of files) {
    const name = path.basename(file)
    const t0 = Date.now()
    const P = await readTrianglePositions(file)
    const fp = fingerprintFromPositions(P)
    const ms = Date.now() - t0
    originals.push({ name, fp })
    const row: string[] = []
    for (const [vName, make] of VARIANTS) {
      const Q = make(P, fp)
      if (!Q) { row.push(`${vName} skip`); continue }
      const cmp = compareFingerprints(fp, fingerprintFromPositions(Q))!
      const w = (worstCopy[vName] ??= { score: 0, who: '', ...Object.fromEntries(COMPONENTS.map((c) => [c, 0])) } as any)
      for (const c of COMPONENTS) w[c] = Math.max(w[c], cmp.distances[c])
      if (cmp.score > w.score) { w.score = cmp.score; w.who = name }
      const ok = cmp.score <= MATCH_THRESHOLD
      const stress = vName === 'dec25'
      if (!ok && !stress) failures++
      if (!ok && stress) stressMisses++
      row.push(`${vName} ${cmp.score.toFixed(2)}${ok ? '' : stress ? '~' : '✗'}`)
    }
    console.log(`  ${name.padEnd(58).slice(0, 58)} ${String(fp.tris).padStart(8)} tris ${String(ms).padStart(5)}ms | ${row.join('  ')}`)
  }

  console.log(`\nStress (dec25) copies not matched: ${stressMisses} of ${files.length}`)
  console.log('\nWorst distance on a genuine copy (must stay under tolerance; dec25 is stress only):')
  console.log(`  ${'variant'.padEnd(8)} ${COMPONENTS.map((c) => c.padStart(8)).join('')}   score  model`)
  for (const [v, w] of Object.entries(worstCopy)) {
    console.log(`  ${v.padEnd(8)} ${COMPONENTS.map((c) => fmt(w[c]).padStart(8)).join('')}   ${w.score.toFixed(2).padStart(5)}  ${w.who}`)
  }

  // Cross-model comparisons.
  const pairs: Array<{ a: string; b: string; score: number; d: Record<FingerprintComponent, number>; mirror: boolean }> = []
  const minCross = Object.fromEntries(COMPONENTS.map((c) => [c, Infinity])) as Record<FingerprintComponent, number>
  for (let i = 0; i < originals.length; i++) {
    for (let j = i + 1; j < originals.length; j++) {
      const cmp = compareFingerprints(originals[i].fp, originals[j].fp)!
      const mirror = mirrorKey(originals[i].name) === mirrorKey(originals[j].name)
      pairs.push({ a: originals[i].name, b: originals[j].name, score: cmp.score, d: cmp.distances, mirror })
      if (!mirror) for (const c of COMPONENTS) minCross[c] = Math.min(minCross[c], cmp.distances[c])
    }
  }
  pairs.sort((x, y) => x.score - y.score)
  console.log(`\nClosest pairs of DIFFERENT models (${pairs.length} pairs; must score > ${MATCH_THRESHOLD}):`)
  console.log(`  ${'score'.padStart(6)} ${COMPONENTS.map((c) => c.padStart(8)).join('')}  pair`)
  for (const p of pairs.slice(0, 15)) {
    const bad = p.score <= MATCH_THRESHOLD
    if (bad && !p.mirror) failures++
    console.log(`  ${p.score.toFixed(2).padStart(6)} ${COMPONENTS.map((c) => fmt(p.d[c]).padStart(8)).join('')}  ${p.a}  ~  ${p.b}${p.mirror ? '   (mirror pair — expected match)' : bad ? '   ✗ FALSE POSITIVE' : ''}`)
  }
  const rest = pairs.slice(15).filter((p) => p.score <= MATCH_THRESHOLD && !p.mirror)
  failures += rest.length
  console.log(`\nSmallest per-component distance between different models: ${COMPONENTS.map((c) => `${c}=${fmt(minCross[c])}`).join('  ')}`)

  console.log(`\n${failures === 0 ? '✅ ALL FINGERPRINT CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
