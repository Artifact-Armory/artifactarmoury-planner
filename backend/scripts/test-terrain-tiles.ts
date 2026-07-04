// Quick manifold/watertightness check for the terrain tile generator.
// Run: npx ts-node -r ts-node/register/transpile-only scripts/test-terrain-tiles.ts
import { generateTerrainTiles, quoteTiles, HeightField } from '../src/services/terrainTiles'

function makeField(cols: number, rows: number, fn: (i: number, j: number) => number): HeightField {
  const mm: number[] = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) mm.push(fn(i, j))
  return { cols, rows, mm }
}

// Read triangles back out of a binary STL buffer.
function readTris(stl: Buffer): Array<[number[], number[], number[]]> {
  const count = stl.readUInt32LE(80)
  const tris: Array<[number[], number[], number[]]> = []
  let o = 84
  for (let t = 0; t < count; t++) {
    const rd = (k: number) => stl.readFloatLE(o + k)
    const v1 = [rd(12), rd(16), rd(20)]
    const v2 = [rd(24), rd(28), rd(32)]
    const v3 = [rd(36), rd(40), rd(44)]
    tris.push([v1, v2, v3])
    o += 50
  }
  return tris
}

function key(v: number[]) { return v.map((x) => Math.round(x * 1000)).join(',') }
function edgeKey(a: number[], b: number[]) {
  const ka = key(a), kb = key(b)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

function checkManifold(stl: Buffer, label: string) {
  const tris = readTris(stl)
  const edges = new Map<string, number>()
  let degenerate = 0
  for (const [a, b, c] of tris) {
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      if (key(p) === key(q)) degenerate++
      const e = edgeKey(p, q)
      edges.set(e, (edges.get(e) ?? 0) + 1)
    }
  }
  let nonManifold = 0, boundary = 0
  for (const n of edges.values()) {
    if (n === 2) continue
    if (n === 1) boundary++
    else nonManifold++
  }
  const ok = boundary === 0 && nonManifold === 0 && degenerate === 0
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}: tris=${tris.length} edges=${edges.size} ` +
    `boundary=${boundary} nonManifold=${nonManifold} degenerate=${degenerate}`,
  )
  return ok
}

const opts = { tableWidthMm: 1828.8, tableDepthMm: 1219.2, bedSizeMm: 200, baseThicknessMm: 3 }
let allOk = true

// 1) Flat field → no relief → zero tiles (nothing to print).
const flat = makeField(74, 49, () => 0)
const flatTiles = generateTerrainTiles(flat, opts)
const flatOk = flatTiles.length === 0
console.log(`${flatOk ? 'PASS' : 'FAIL'}  flat field → ${flatTiles.length} tiles (expected 0)`)
allOk = flatOk && allOk

// 2) Hill (raised bump) in one corner → only the sculpted tiles are generated.
const hilly = makeField(74, 49, (i, j) => {
  const dx = i - 18, dy = j - 12
  return 60 * Math.exp(-(dx * dx + dy * dy) / 120)
})
const q = quoteTiles(hilly, opts)
const hillTiles = generateTerrainTiles(hilly, opts)
console.log(`\nhilly quote: full grid ${q.tilesX}x${q.tilesY} = ${q.tilesX * q.tilesY} cells, printed tiles = ${q.tileCount}`)
const fewer = hillTiles.length > 0 && hillTiles.length < q.tilesX * q.tilesY
console.log(`${fewer ? 'PASS' : 'FAIL'}  localized hill prints ${hillTiles.length} tiles (fewer than full grid)`)
allOk = fewer && allOk
for (const t of hillTiles) allOk = checkManifold(t.stl, `hilly ${t.name}`) && allOk

console.log(`\n${allOk ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`)
process.exit(allOk ? 0 : 1)
