// backend/scripts/test-full-glb.ts
//
// Proof that the OWNER full-fidelity GLB (migration 041) is what it claims to be,
// run against the same service function production uses — no DB, no network.
//
// The claim is "no watermark, no decimation", and the second half of that is the
// part that could silently regress: the preview and full converters share
// stlToDocument() and applyCreaseNormals(), so someone tidying the preview's
// decimation could easily drag simplify() into the full path and nobody would
// notice by looking at a render. So this asserts on triangle counts:
//
//   1. FULL PATH KEEPS EVERY TRIANGLE — the GLB decodes to exactly the STL's
//      triangle count.
//   2. PREVIEW PATH STILL DECIMATES    — same STL through generateGLB() comes back
//      under the preview budget. (Guards the converse mistake: accidentally
//      shipping the full mesh as the public preview, which would hand away the
//      thing the proxy-bake pipeline exists to protect.)
//   3. GEOMETRY IS FAITHFUL            — the full GLB's bounding box matches the
//      STL's to well under a printable tolerance, so Draco quantization isn't
//      distorting the model.
//
//   npm run test:fullglb

import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import 'dotenv/config'
import { convertSTLtoGLBFull, generateGLB, parseSTL } from '../src/services/fileProcessor'

const DIR = path.resolve(__dirname, '../../frontend/public/assets/pre converted/kieran_s/terrain-kieran_s')
const SUBJECT = 'sandbags.stl' // the densest fixture — the one decimation actually bites on

// @gltf-transform/core is ESM-only under our CommonJS build (see fileProcessor.ts).
const importESM = new Function('specifier', 'return import(specifier)') as <T = any>(
  s: string,
) => Promise<T>

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

/** Decode a GLB and report its triangle count + world-space bounding box. */
async function inspectGlb(glbPath: string) {
  const { NodeIO } = await importESM<typeof import('@gltf-transform/core')>('@gltf-transform/core')
  const { KHRDracoMeshCompression } = await importESM<typeof import('@gltf-transform/extensions')>(
    '@gltf-transform/extensions',
  )
  const draco3dMod: any = await importESM('draco3dgltf')
  const draco3d = draco3dMod.default ?? draco3dMod
  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() })

  const doc = await io.read(glbPath)
  let triangles = 0
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices()
      const pos = prim.getAttribute('POSITION')!
      triangles += (idx ? idx.getCount() : pos.getCount()) / 3
      for (let i = 0; i < pos.getCount(); i++) {
        const v = pos.getElement(i, [0, 0, 0])
        for (let a = 0; a < 3; a++) {
          if (v[a] < min[a]) min[a] = v[a]
          if (v[a] > max[a]) max[a] = v[a]
        }
      }
    }
  }
  return { triangles, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }
}

async function main() {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'aa-fullglb-test-'))
  // Work on a COPY: generateGLB() writes its output next to the input, and the
  // fixtures live in the repo's frontend assets.
  const stlPath = path.join(work, SUBJECT)
  await fs.copyFile(path.join(DIR, SUBJECT), stlPath)
  const fullPath = path.join(work, 'full.glb')

  console.log('\nOwner full-fidelity GLB (migration 041)')
  console.log(`  subject: ${SUBJECT}`)

  const stl = await parseSTL(stlPath)
  // The STL is Z-up and the GLB is Y-up, so the source extents are permuted the
  // same way the converter permutes vertices: (x, y, z) -> (x, z, -y).
  const sMin = [Infinity, Infinity, Infinity]
  const sMax = [-Infinity, -Infinity, -Infinity]
  for (const tri of stl.triangles) {
    for (const v of tri.vertices) {
      const p = [v.x, v.z, -v.y]
      for (let a = 0; a < 3; a++) {
        if (p[a] < sMin[a]) sMin[a] = p[a]
        if (p[a] > sMax[a]) sMax[a] = p[a]
      }
    }
  }
  const stlSize = [sMax[0] - sMin[0], sMax[1] - sMin[1], sMax[2] - sMin[2]]
  console.log(`  source triangles: ${stl.triangleCount}`)

  // ---- 1. the owner GLB keeps every triangle -------------------------------
  const built = await convertSTLtoGLBFull(stlPath, fullPath)
  const full = await inspectGlb(fullPath)
  check(
    'owner GLB keeps every triangle (no decimation)',
    full.triangles === stl.triangleCount,
    `${full.triangles} / ${stl.triangleCount}`,
  )
  check(
    'reported triangle count matches the STL',
    built.triangles === stl.triangleCount,
    `${built.triangles}`,
  )

  // ---- 2. the public preview still decimates -------------------------------
  const budget = Number(process.env.PREVIEW_TARGET_TRIS ?? 80000)
  if (stl.triangleCount <= budget) {
    console.log(`  ⚠️  fixture is under the preview budget (${budget}) — decimation check skipped`)
  } else {
    const previewPath = await generateGLB(stlPath)
    const preview = await inspectGlb(previewPath)
    check(
      'public preview is still decimated (owner mesh did not leak into it)',
      preview.triangles < stl.triangleCount,
      `${preview.triangles} < ${stl.triangleCount}`,
    )
  }

  // ---- 3. geometry is faithful --------------------------------------------
  // Draco quantizes positions onto a grid across the mesh bounds. At the 16 bits
  // convertSTLtoGLBFull asks for, the error is ~1/65535 of the largest extent —
  // microns on a terrain piece. Allow 0.01% and it should still pass easily.
  const worstDrift = Math.max(
    ...stlSize.map((s, i) => (s > 0 ? Math.abs(full.size[i] - s) / s : 0)),
  )
  check(
    'bounding box survives Draco quantization',
    worstDrift < 1e-4,
    `worst axis drift ${(worstDrift * 100).toFixed(5)}%`,
  )

  console.log(`\n  built ${(built.bytes / 1024 / 1024).toFixed(2)} MB from a ${stl.triangleCount}-triangle STL`)
  await fs.rm(work, { recursive: true, force: true }).catch(() => {})

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
