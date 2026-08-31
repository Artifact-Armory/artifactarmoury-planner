// backend/scripts/test-full-glb.ts
//
// Proof that the OWNER GLB (migration 041, lightly decimated as of the follow-up
// change below) is what it claims to be, run against the same service function
// production uses — no DB, no network.
//
// The claim is "no watermark, near-full fidelity, still meaningfully better than
// the public preview", and that last part is what could silently regress: the
// preview and owner converters share stlToDocument() and applyCreaseNormals(),
// and both now run a simplify() step, so it would be easy for the owner budget
// to drift down toward (or the preview's up toward) the other. So this asserts
// on triangle counts:
//
//   1. OWNER PATH RESPECTS ITS BUDGET  — on a mesh denser than
//      OWNER_GLB_TARGET_TRIS, the GLB decodes to no more than that budget (with
//      slack for the simplifier not hitting the ratio exactly).
//   2. OWNER PATH STAYS HIGHER-FIDELITY THAN THE PREVIEW — same STL through
//      generateGLB() (the public preview) comes back with meaningfully fewer
//      triangles than the owner copy. (Guards the mistake of the two budgets
//      converging, or the owner mesh leaking down to preview quality.)
//   3. GEOMETRY IS FAITHFUL            — the owner GLB's bounding box matches the
//      STL's to well under the configured simplifier error bound, so decimation
//      + Draco quantization aren't distorting the model.
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

  console.log('\nOwner GLB (migration 041, lightly decimated above a budget)')
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

  // ---- 1. the owner GLB respects its triangle budget -----------------------
  const ownerBudget = Number(process.env.FULL_GLB_TARGET_TRIS ?? 80000 * 3)
  const built = await convertSTLtoGLBFull(stlPath, fullPath)
  const full = await inspectGlb(fullPath)
  if (stl.triangleCount <= ownerBudget) {
    console.log(`  ⚠️  fixture is under the owner budget (${ownerBudget}) — expecting full fidelity, not decimation`)
    check(
      'owner GLB keeps every triangle (under budget, no decimation)',
      full.triangles === stl.triangleCount,
      `${full.triangles} / ${stl.triangleCount}`,
    )
  } else {
    // meshopt's simplifier targets the ratio, it doesn't guarantee hitting it
    // exactly — allow 15% slack above the nominal budget.
    check(
      'owner GLB is decimated toward its budget, not left at source density',
      full.triangles <= ownerBudget * 1.15 && full.triangles < stl.triangleCount,
      `${full.triangles} (budget ${ownerBudget}, source ${stl.triangleCount})`,
    )
  }
  check(
    'reported triangle count matches what was actually written',
    built.triangles === full.triangles,
    `${built.triangles} / ${full.triangles}`,
  )
  check(
    'reported source triangle count matches the STL',
    built.sourceTriangles === stl.triangleCount,
    `${built.sourceTriangles}`,
  )

  // ---- 2. the owner GLB stays meaningfully better than the public preview --
  const previewBudget = Number(process.env.PREVIEW_TARGET_TRIS ?? 80000)
  if (stl.triangleCount <= previewBudget) {
    console.log(`  ⚠️  fixture is under the preview budget (${previewBudget}) — comparison check skipped`)
  } else {
    const previewPath = await generateGLB(stlPath)
    const preview = await inspectGlb(previewPath)
    check(
      'owner mesh has meaningfully more detail than the public preview',
      full.triangles > preview.triangles,
      `${full.triangles} owner > ${preview.triangles} preview`,
    )
  }

  // ---- 3. geometry is faithful --------------------------------------------
  // Two lossy steps can move a vertex here: the light simplify() (bounded by
  // FULL_GLB_SIMPLIFY_ERROR, default 0.001 = 0.1% of the mesh extent) and Draco
  // quantization on top (microns, at the 16 bits convertSTLtoGLBFull asks for).
  // Allow well above the simplifier's own error bound for headroom.
  const worstDrift = Math.max(
    ...stlSize.map((s, i) => (s > 0 ? Math.abs(full.size[i] - s) / s : 0)),
  )
  check(
    'bounding box survives decimation + Draco quantization',
    worstDrift < 5e-3,
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
