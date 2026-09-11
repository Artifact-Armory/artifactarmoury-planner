/**
 * Scratch measurement harness for the planner LOD.
 *
 * Runs the SHIPPED transforms (postProcessGlb / buildPlannerLod) against a raw
 * Blender bake output, and reports the numbers that actually matter:
 *  - triangles, stored vertices, unique positions (the vertex-splitting tell)
 *  - geometry bytes vs texture bytes
 *  - boundary edges + boundary LOOPS (the anti-theft emboss holes)
 *
 * usage: npm run measure:lod -- <rawGlb> [outDir]
 */
import { promises as fsp } from 'fs'
import path from 'path'
import { postProcessGlb } from '../src/services/proxyBake/bake'
import { buildPlannerLod } from '../src/services/proxyBake/lod'
import { loadBakeConfig } from '../src/services/proxyBake/config'

const importESM = new Function('s', 'return import(s)') as <T = any>(s: string) => Promise<T>

interface Stats {
  triangles: number
  storedVerts: number
  uniquePositions: number
  boundaryEdges: number
  boundaryLoops: number
  textureBytes: number
  fileBytes: number
}

async function inspect(glb: string): Promise<Stats> {
  const { NodeIO } = await importESM<any>('@gltf-transform/core')
  const { KHRDracoMeshCompression } = await importESM<any>('@gltf-transform/extensions')
  const draco3dMod: any = await importESM('draco3dgltf')
  const draco3d = draco3dMod.default ?? draco3dMod
  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule(),
      'draco3d.decoder': await draco3d.createDecoderModule(),
    })
  const doc = await io.read(glb)

  let triangles = 0
  let storedVerts = 0
  const positions = new Set<string>()
  // edge key -> incident face count, over UNIQUE POSITIONS (so a UV/crease seam
  // isn't miscounted as a hole — a boundary here means a genuinely open edge).
  const edges = new Map<string, number>()
  const edgeEnds = new Map<string, [number, number]>()
  const posIndex = new Map<string, number>()

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const pArr = pos.getArray() as Float32Array
      storedVerts += pos.getCount()
      const idxAcc = prim.getIndices()
      const idx: ArrayLike<number> = idxAcc
        ? (idxAcc.getArray() as any)
        : Array.from({ length: pos.getCount() }, (_, i) => i)
      const F = idx.length / 3
      triangles += F

      // Canonical id per unique position (rounded to 1e-5 of a unit to absorb
      // float noise; source units are mm so this is 10 nanometres).
      const idOf = (v: number) => {
        const k =
          Math.round(pArr[v * 3] * 1e5) +
          ',' +
          Math.round(pArr[v * 3 + 1] * 1e5) +
          ',' +
          Math.round(pArr[v * 3 + 2] * 1e5)
        positions.add(k)
        let id = posIndex.get(k)
        if (id === undefined) {
          id = posIndex.size
          posIndex.set(k, id)
        }
        return id
      }

      for (let f = 0; f < F; f++) {
        const a = idOf(idx[f * 3]),
          b = idOf(idx[f * 3 + 1]),
          c = idOf(idx[f * 3 + 2])
        for (const [u, v] of [
          [a, b],
          [b, c],
          [c, a],
        ] as Array<[number, number]>) {
          if (u === v) continue
          const key = u < v ? `${u}_${v}` : `${v}_${u}`
          edges.set(key, (edges.get(key) ?? 0) + 1)
          edgeEnds.set(key, u < v ? [u, v] : [v, u])
        }
      }
    }
  }

  // Boundary loops: connected components of the boundary-edge graph. Each emboss
  // through-hole contributes (at least) one; so does the open base and each
  // stripped interior opening.
  const adj = new Map<number, number[]>()
  let boundaryEdges = 0
  for (const [key, count] of edges) {
    if (count !== 1) continue
    boundaryEdges++
    const [u, v] = edgeEnds.get(key)!
    ;(adj.get(u) ?? adj.set(u, []).get(u)!).push(v)
    ;(adj.get(v) ?? adj.set(v, []).get(v)!).push(u)
  }
  const seen = new Set<number>()
  let boundaryLoops = 0
  for (const start of adj.keys()) {
    if (seen.has(start)) continue
    boundaryLoops++
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const n = stack.pop()!
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m) }
    }
  }

  let textureBytes = 0
  for (const tex of doc.getRoot().listTextures()) textureBytes += tex.getImage()?.byteLength ?? 0

  return {
    triangles: Math.round(triangles),
    storedVerts,
    uniquePositions: positions.size,
    boundaryEdges,
    boundaryLoops,
    textureBytes,
    fileBytes: (await fsp.stat(glb)).size,
  }
}

function row(label: string, s: Stats, extra = '') {
  const geo = s.fileBytes - s.textureBytes
  console.log(
    [
      label.padEnd(26),
      String(s.triangles).padStart(9) + ' tris',
      (s.storedVerts / s.triangles).toFixed(2).padStart(5) + ' v/t',
      String(s.uniquePositions).padStart(8) + ' uniq',
      (s.fileBytes / 1024).toFixed(0).padStart(6) + ' KB',
      '(geo ' + (geo / 1024).toFixed(0).padStart(5) + ' KB, tex ' + (s.textureBytes / 1024).toFixed(0).padStart(5) + ' KB)',
      String(s.boundaryLoops).padStart(5) + ' loops',
      String(s.boundaryEdges).padStart(7) + ' bedges',
      extra,
    ].join('  '),
  )
}

async function main() {
  const rawGlb = process.argv[2]
  const outDir = process.argv[3] || path.dirname(rawGlb)
  if (!rawGlb) throw new Error('usage: lod-measure <rawGlb> [outDir]')
  await fsp.mkdir(outDir, { recursive: true })

  const cfg = loadBakeConfig()
  console.log(`\n### ${rawGlb}`)
  row('raw (Blender, no draco)', await inspect(rawGlb))

  const proxy = path.join(outDir, 'proxy.glb')
  await postProcessGlb(rawGlb, proxy, cfg)
  const proxyStats = await inspect(proxy)
  row('SHIPPED proxy', proxyStats)

  const budgets = (process.env.LOD_BUDGETS || '80000,60000,50000,40000,30000')
    .split(',')
    .map(Number)
  for (const lock of [true, false]) {
    for (const budget of budgets) {
      const out = path.join(outDir, `lod-${budget}-${lock ? 'lock' : 'free'}.glb`)
      const res = await buildPlannerLod(rawGlb, out, {
        ...cfg,
        plannerLodTriangleBudget: budget,
        plannerLodLockBorder: lock,
        plannerLodMinReduction: 0, // measure everything; the gate is a product decision
      })
      if (res.skipped) {
        console.log(`lod ${budget} ${lock ? 'lock' : 'free'}: SKIPPED — ${res.note}`)
        continue
      }
      const s = await inspect(out)
      row(
        `LOD ${budget} ${lock ? 'lockBorder' : 'free      '}`,
        s,
        `${((1 - s.fileBytes / proxyStats.fileBytes) * 100).toFixed(0)}% smaller, ` +
          `holes ${s.boundaryLoops === proxyStats.boundaryLoops ? 'INTACT' : `${s.boundaryLoops}/${proxyStats.boundaryLoops}`}`,
      )
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
