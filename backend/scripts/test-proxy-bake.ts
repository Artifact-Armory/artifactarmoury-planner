/**
 * End-to-end test for the Preview Proxy Bake Pipeline core (Blender bake +
 * gltf-transform post-process), independent of R2 and the DB.
 *
 *   npm run test:proxybake
 *
 * It generates a synthetic HIGH-POLY closed mesh (a displaced UV sphere sitting on
 * z=0 — ~160k triangles, a flat-ish bottom for the base-face poison pill), runs
 * bake_proxy.py in Blender, post-processes the GLB, and asserts the acceptance
 * criteria:
 *   - report.status === 'ok'
 *   - proxy triangles <= triangleBudget
 *   - boundaryEdgeCount > 0            (non-watertight — unprintable)
 *   - final GLB <= targetMaxFileMb
 *   - GLB loads and has POSITION + NORMAL + TANGENT + a normal-map texture
 *   - proxy footprint matches the source within tolerance (scale preserved)
 *
 * If Blender isn't installed (BLENDER_PATH not runnable) the test SKIPS cleanly
 * with exit 0 — the full bake is only exercised inside the Docker image / worker.
 */
import { spawnSync } from 'child_process'
import { promises as fsp } from 'fs'
import os from 'os'
import path from 'path'
import { loadDefaults } from '../src/services/proxyBake/config'
import { postProcessGlb } from '../src/services/proxyBake/bake'

const BLENDER_PATH = process.env.BLENDER_PATH || 'blender'
const BAKE_SCRIPT = path.resolve(process.cwd(), 'blender/bake_proxy.py')

function blenderAvailable(): boolean {
  try {
    const r = spawnSync(BLENDER_PATH, ['--version'], { encoding: 'utf8' })
    return r.status === 0 && /Blender/i.test(r.stdout || '')
  } catch {
    return false
  }
}

/** Write a displaced UV sphere OBJ (closed, high-poly) sitting on the z=0 plane. */
async function writeSyntheticObj(file: string, stacks = 220, slices = 220): Promise<number> {
  const R = 25 // mm
  const lines: string[] = ['# synthetic high-poly test sphere']
  const idx = (i: number, j: number) => i * (slices + 1) + j + 1 // OBJ is 1-based

  for (let i = 0; i <= stacks; i++) {
    const phi = (Math.PI * i) / stacks // 0..PI (top..bottom)
    for (let j = 0; j <= slices; j++) {
      const theta = (2 * Math.PI * j) / slices
      // Surface detail: small radial ripples so there's something to bake.
      const bump = 1 + 0.06 * Math.sin(6 * theta) * Math.sin(6 * phi)
      const r = R * bump
      const x = r * Math.sin(phi) * Math.cos(theta)
      const y = r * Math.sin(phi) * Math.sin(theta)
      const z = r * Math.cos(phi) + R // shift up so the bottom pole sits at ~z=0
      lines.push(`v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`)
    }
  }
  let tris = 0
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = idx(i, j)
      const b = idx(i + 1, j)
      const c = idx(i + 1, j + 1)
      const d = idx(i, j + 1)
      lines.push(`f ${a} ${b} ${c}`)
      lines.push(`f ${a} ${c} ${d}`)
      tris += 2
    }
  }
  await fsp.writeFile(file, lines.join('\n'))
  return tris
}

function assert(cond: any, msg: string) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
  console.log('  ✓ ' + msg)
}

async function main() {
  if (!blenderAvailable()) {
    console.log(
      `\n⏭  SKIP: Blender not runnable at "${BLENDER_PATH}". ` +
        `The full bake is verified in the Docker worker image. ` +
        `Set BLENDER_PATH to a local Blender to run this end-to-end.\n`,
    )
    process.exit(0)
  }

  const cfg = loadDefaults()
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'aa-baketest-'))
  const outDir = path.join(work, 'out')
  await fsp.mkdir(outDir, { recursive: true })

  try {
    console.log('Generating synthetic high-poly OBJ…')
    const objPath = path.join(work, 'source.obj')
    const srcTris = await writeSyntheticObj(objPath)
    console.log(`  source ≈ ${srcTris} triangles`)

    const cfgPath = path.join(work, 'config.json')
    await fsp.writeFile(cfgPath, JSON.stringify(cfg))

    console.log('Running Blender bake…')
    const r = spawnSync(
      BLENDER_PATH,
      ['-b', '-P', BAKE_SCRIPT, '--', '--config', cfgPath, '--input', objPath, '--out-dir', outDir],
      { encoding: 'utf8', timeout: cfg.bakeTimeoutMinutes * 60_000 },
    )
    if (r.status !== 0) {
      console.error(r.stdout)
      console.error(r.stderr)
      throw new Error(`Blender exited ${r.status}`)
    }

    const report = JSON.parse(await fsp.readFile(path.join(outDir, 'report.json'), 'utf8'))
    console.log('Report:', JSON.stringify(report, null, 2))
    assert(report.status === 'ok', 'bake reported status ok')
    assert(report.proxyTriangles <= cfg.triangleBudget, `proxy tris (${report.proxyTriangles}) <= budget (${cfg.triangleBudget})`)
    assert(report.boundaryEdgeCount > 0, `proxy is non-watertight (boundary edges ${report.boundaryEdgeCount} > 0)`)

    console.log('Post-processing GLB (prune + textures + Draco)…')
    const finalGlb = path.join(outDir, 'proxy.glb')
    await postProcessGlb(path.join(outDir, 'proxy_raw.glb'), finalGlb, cfg)
    const mb = (await fsp.stat(finalGlb)).size / (1024 * 1024)
    console.log(`  final GLB = ${mb.toFixed(2)} MB`)
    assert(mb <= cfg.targetMaxFileMb, `final GLB (${mb.toFixed(2)}MB) <= target (${cfg.targetMaxFileMb}MB)`)

    // Inspect the GLB with gltf-transform (Draco decoder registered).
    const importESM = new Function('s', 'return import(s)') as <T = any>(s: string) => Promise<T>
    const { NodeIO } = await importESM<typeof import('@gltf-transform/core')>('@gltf-transform/core')
    const { KHRDracoMeshCompression } = await importESM<typeof import('@gltf-transform/extensions')>('@gltf-transform/extensions')
    const draco3dMod: any = await importESM('draco3dgltf')
    const draco3d = draco3dMod.default ?? draco3dMod
    const io = new NodeIO()
      .registerExtensions([KHRDracoMeshCompression])
      .registerDependencies({
        'draco3d.encoder': await draco3d.createEncoderModule(),
        'draco3d.decoder': await draco3d.createDecoderModule(),
      })
    const doc = await io.read(finalGlb)
    const meshes = doc.getRoot().listMeshes()
    assert(meshes.length > 0, 'GLB has at least one mesh')
    const prim = meshes[0].listPrimitives()[0]
    assert(!!prim.getAttribute('POSITION'), 'primitive has POSITION')
    assert(!!prim.getAttribute('NORMAL'), 'primitive has NORMAL')
    assert(!!prim.getAttribute('TANGENT'), 'primitive has TANGENT (no normal-map seams)')
    const mat = prim.getMaterial()
    assert(!!mat && !!mat.getNormalTexture(), 'material has a normal-map texture')

    // Footprint preserved: compare sorted bbox dims (glTF is Y-up vs source Z-up).
    const pos = prim.getAttribute('POSITION')!
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    const el: number[] = [0, 0, 0]
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], el[k])
        max[k] = Math.max(max[k], el[k])
      }
    }
    const glbDims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].sort((a, b) => a - b)
    const srcDims = [...(report.boundingBoxMm as number[])].sort((a, b) => a - b)
    for (let k = 0; k < 3; k++) {
      const rel = Math.abs(glbDims[k] - srcDims[k]) / Math.max(srcDims[k], 1e-6)
      assert(rel < 0.05, `footprint dim ${k} within 5% (src ${srcDims[k].toFixed(1)} vs proxy ${glbDims[k].toFixed(1)})`)
    }

    console.log('\n✅ Proxy bake E2E passed.\n')
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  console.error('\n❌ Proxy bake E2E failed:', err.message)
  process.exit(1)
})
