// backend/scripts/test-fingerprint.ts
//
// Validates the geometry fingerprint: a transformed copy of a model (rotated,
// rescaled, translated, triangles + vertex order shuffled — i.e. what a thief
// would do to dodge an exact-hash check) must still MATCH the original, while
// genuinely different models must NOT match.
//
//   node -r ts-node/register/transpile-only scripts/test-fingerprint.ts

import { promises as fs } from 'fs'
import path from 'path'
import { parseSTL } from '../src/services/fileProcessor'
import { computeGeometryFingerprint, fingerprintDistance, isLikelyDuplicate, MATCH_THRESHOLD } from '../src/services/fingerprint'

const DIR = path.resolve(__dirname, '../../frontend/public/assets/pre converted/kieran_s/terrain-kieran_s')
const MODELS = ['floor.stl', 'barrell.stl', 'sandbags.stl', 'shutters.stl']

function writeBinarySTL(filePath: string, tris: Array<{ vertices: Array<{ x: number; y: number; z: number }> }>): Promise<void> {
  const buf = Buffer.alloc(84 + tris.length * 50)
  buf.write('fingerprint-test', 0)
  buf.writeUInt32LE(tris.length, 80)
  let off = 84
  for (const t of tris) {
    // normal (0,0,0 is fine; slicers recompute) then 3 vertices
    off += 12
    for (const v of t.vertices) {
      buf.writeFloatLE(v.x, off); buf.writeFloatLE(v.y, off + 4); buf.writeFloatLE(v.z, off + 8)
      off += 12
    }
    off += 2 // attribute byte count
  }
  return fs.writeFile(filePath, buf)
}

// Rotate about Y, scale, translate, and shuffle triangle + vertex order.
async function makeAdversarialCopy(srcPath: string, outPath: string) {
  const stl = await parseSTL(srcPath)
  const ang = (37 * Math.PI) / 180, s = 1.7, cos = Math.cos(ang), sin = Math.sin(ang)
  const tx = 123.4, ty = -55.1, tz = 9.9
  const xform = (v: { x: number; y: number; z: number }) => {
    const x = v.x * cos + v.z * sin, z = -v.x * sin + v.z * cos
    return { x: x * s + tx, y: v.y * s + ty, z: z * s + tz }
  }
  const tris = stl.triangles.map((t) => ({
    // reverse winding to also perturb vertex order
    vertices: [xform(t.vertices[2]), xform(t.vertices[1]), xform(t.vertices[0])] as any,
  }))
  tris.reverse() // shuffle triangle order
  await writeBinarySTL(outPath, tris)
}

async function main() {
  const tmp = path.join(__dirname, '_fp_tmp.stl')
  const fps: Record<string, any> = {}
  for (const m of MODELS) {
    fps[m] = await computeGeometryFingerprint(path.join(DIR, m))
    console.log(`  fingerprinted ${m}  (tris=${fps[m].tris}, compactness=${fps[m].compactness.toFixed(2)})`)
  }

  // Adversarial copy of floor.stl
  await makeAdversarialCopy(path.join(DIR, 'floor.stl'), tmp)
  const floorCopy = await computeGeometryFingerprint(tmp)
  await fs.rm(tmp, { force: true })

  console.log(`\nMatch threshold = ${MATCH_THRESHOLD}\n`)
  const dCopy = fingerprintDistance(fps['floor.stl'], floorCopy)
  console.log(`floor.stl  vs  floor.stl (rotated+scaled+reordered)  → distance ${dCopy.toFixed(4)}  ${isLikelyDuplicate(fps['floor.stl'], floorCopy) ? 'MATCH ✅ (theft caught)' : 'MISS ❌'}`)

  console.log('\nfloor.stl vs the other (different) models — should NOT match:')
  for (const m of MODELS) {
    if (m === 'floor.stl') continue
    const d = fingerprintDistance(fps['floor.stl'], fps[m])
    console.log(`  floor.stl vs ${m.padEnd(16)} → distance ${d.toFixed(4)}  ${isLikelyDuplicate(fps['floor.stl'], fps[m]) ? 'MATCH ❌ (false positive)' : 'no match ✅'}`)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
