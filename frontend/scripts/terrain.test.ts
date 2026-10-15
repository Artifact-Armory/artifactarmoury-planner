// Planner terrain + ground-paint regression checks. Run: npm run test:terrain
// Adapted from the planner topography lab's manufacturing suite (the parts that
// apply to the main planner: paint, coverage, bake queue, landforms, store
// history and save/load). Bundled by scripts/run-terrain-tests.mjs.
import assert from 'node:assert/strict'

// The store imports the cart/auth stores and API clients; give them a browser-ish shell.
const storage = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, v) },
    removeItem: (k: string) => { storage.delete(k) },
  },
  window: {
    dispatchEvent: () => true,
    location: { pathname: '/', origin: 'http://localhost', href: 'http://localhost/' },
    addEventListener: () => {},
    removeEventListener: () => {},
  },
})

let count = 0
function check(label: string, fn: () => void) {
  fn()
  count++
  console.log(`PASS ${label}`)
}

const { FrameQueue } = await import('../src/table-top-terrain-builder/src/core/frameQueue')
const { LatestPaintJob } = await import('../src/table-top-terrain-builder/src/scene/latestPaintJob')
const paintmap = await import('../src/table-top-terrain-builder/src/core/paintmap')
const { createPaintMap, applyPaintBrush, paintDims, serializePaint, deserializePaint } = paintmap
const { groundCoverage } = await import('../src/table-top-terrain-builder/src/core/groundCoverage')
const tf = await import('../src/table-top-terrain-builder/src/core/terrainFeatures')
const { defaultFeature, featurePoint, featureDistance, featureBounds, featureContribution, featuresHeightAt, compositeHeightmap, deserializeFeatures } = tf
const { serializeHeightmap, createHeightmap } = await import('../src/table-top-terrain-builder/src/core/heightmap')
const { useAppStore } = await import('../src/table-top-terrain-builder/src/state/store')
const { serializeLayout, deserializeLayout } = await import('../src/table-top-terrain-builder/src/state/tableMapping')

const T = (width: number, height: number) => ({ width, height, unitDisplay: 'cm' as const, gridSize: 0.0127 })

check('frame queue keeps only the latest input and flushes the last dab once', () => {
  let id = 0
  const callbacks = new Map<number, FrameRequestCallback>(), values: number[] = []
  const queue = new FrameQueue((fn) => { callbacks.set(++id, fn); return id }, (n) => { callbacks.delete(n) })
  for (let i = 0; i < 500; i++) queue.enqueue(() => values.push(i))
  assert.equal(callbacks.size, 1)
  const callback = [...callbacks.values()][0]; callbacks.clear(); callback(0)
  assert.deepEqual(values, [499])
  queue.enqueue(() => values.push(500)); queue.flush(); assert.equal(callbacks.size, 0)
  queue.flush(); assert.deepEqual(values, [499, 500])
  queue.enqueue(() => values.push(501)); queue.clear(); assert.equal(callbacks.size, 0)
  assert.deepEqual(values, [499, 500])
})

check('paint baking keeps one active job, dispatches only the latest state and stops cleanly', () => {
  const queue = new LatestPaintJob()
  assert.equal(queue.take(), null)
  queue.request()
  const first = queue.take()!
  for (let i = 0; i < 100; i++) queue.request()
  assert.equal(queue.take(), null)          // one active job at a time
  assert.equal(queue.finish(first + 99), false) // obsolete id rejected
  assert.equal(queue.finish(first), true)
  const latest = queue.take()!               // 100 requests collapsed into one
  assert.equal(latest, first + 1)
  assert.equal(queue.finish(latest), true)
  assert.equal(queue.take(), null)
  queue.request(); queue.stop()
  assert.equal(queue.take(), null)
  assert.equal(queue.finish(latest), false)
})

check('fine paint strokes cover fast motion, erase continuously and stay inside the brush', () => {
  const table = T(0.4, 0.2)
  const pm = createPaintMap(table)
  assert.equal(pm.cols, 80)
  assert.equal(pm.rows, 40)
  // One fast segment, 30 cm in a single event with a 1.2 cm brush.
  applyPaintBrush(pm, table, 0.15, 0, 'sand', 0.012, { x: -0.15, z: 0 })
  for (let i = 12; i < 68; i++) assert.equal(pm.cells[20 * pm.cols + i], 1, `gap at ${i}`)
  assert.equal(pm.cells[25 * pm.cols + 40], 0)  // 2.5 cm off the line: untouched
  applyPaintBrush(pm, table, 0.15, 0, null, 0.012, { x: -0.15, z: 0 })
  assert.ok(pm.cells.every((v) => v === 0))
  const bounded = paintDims({ width: 20, height: 20 })
  assert.ok(bounded.cols * bounded.rows <= 512 * 512)
})

check('legacy 4 cm paint upsamples without losing materials; RLE round-trips exactly', () => {
  const table = T(0.08, 0.08)
  const old = { cols: 2, rows: 2, cells: [1, 0, 2, 1], palette: ['sand', 'stone'] }
  const fine = deserializePaint(old, table)!
  assert.equal(fine.cols, 16)
  assert.equal(fine.cells[0], 1)
  assert.equal(fine.cells[15], 0)
  assert.equal(fine.cells[15 * 16], 2)
  const saved = serializePaint(fine)!
  assert.ok(saved.rle && !saved.cells)
  assert.ok(saved.rle!.length <= fine.cells.length / 2, 'RLE is compact')
  assert.deepEqual(deserializePaint(saved, table), fine)
  assert.deepEqual(deserializePaint(JSON.parse(JSON.stringify(saved)), table), fine)
  assert.equal(deserializePaint({ ...old, cols: 3 }, table), null)
  assert.equal(deserializePaint({ ...saved, rle: saved.rle!.slice(0, -1) }, table), null)
  assert.equal(deserializePaint({ ...saved, rle: [0, 5] }, table), null) // wrong total
})

check('dirt and water survive save, load and paint round-trip', () => {
  const table = T(0.08, 0.08)
  const pm = createPaintMap(table)
  applyPaintBrush(pm, table, -0.02, 0, 'dirt', 0.03)
  applyPaintBrush(pm, table, 0.02, 0, 'water', 0.02)
  assert.deepEqual(deserializePaint(serializePaint(pm), table), pm)
  assert.deepEqual(pm.palette, ['dirt', 'water'])
})

// Uncached reference for the coverage stencil (straight from the lab).
function hash(x: number, z: number) { const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return v - Math.floor(v) }
function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
  return (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v) + (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v
}
function referenceCoverage(pm: import('../src/table-top-terrain-builder/src/core/paintmap').PaintMap, table: { width: number; height: number }) {
  const layers = new Map<number, Uint8ClampedArray>()
  for (const id of new Set(pm.cells)) layers.set(id, new Uint8ClampedArray(pm.cells.length))
  const dx = table.width / pm.cols, dz = table.height / pm.rows
  for (let j = 0; j < pm.rows; j++) for (let i = 0; i < pm.cols; i++) {
    const x = (i + 0.5) * dx - table.width / 2, z = (j + 0.5) * dz - table.height / 2
    const u = Math.max(0, Math.min(pm.cols - 1, i + (noise(x * 45, z * 45) - 0.5) * 0.009 / dx))
    const v = Math.max(0, Math.min(pm.rows - 1, j + (noise(x * 45 + 71, z * 45 - 31) - 0.5) * 0.009 / dz))
    const i0 = Math.floor(u), j0 = Math.floor(v), fx = u - i0, fz = v - j0
    const totals = new Map<number, number>()
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const id = pm.cells[Math.min(pm.rows - 1, j0 + b) * pm.cols + Math.min(pm.cols - 1, i0 + a)]
      totals.set(id, (totals.get(id) ?? 0) + (a ? fx : 1 - fx) * (b ? fz : 1 - fz))
    }
    for (const [id, w] of totals) layers.get(id)![j * pm.cols + i] = Math.round(w * 255)
  }
  return layers
}

check('soft coverage is deterministic, partitions materials and leaves solid paint solid', () => {
  const table = T(0.2, 0.2)
  const pm = createPaintMap(table)
  applyPaintBrush(pm, table, -0.04, 0, 'sand', 0.035)
  applyPaintBrush(pm, table, 0.02, 0, 'dirt', 0.035)
  const snapshot = new Uint8Array(pm.cells)
  const first = groundCoverage(pm, table), second = groundCoverage(pm, table)
  assert.deepEqual(first, second)
  assert.deepEqual(pm.cells, snapshot) // baking never mutates authored paint
  let mixed = 0
  for (let k = 0; k < pm.cells.length; k++) {
    const values = [...first.values()].map((layer) => layer[k])
    assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 255) <= 2)
    if (values.some((v) => v > 0 && v < 255)) mixed++
  }
  assert.ok(mixed > 0, 'boundaries are blended, not blocky')
  assert.equal(first.get(0)![0], 255)
  assert.equal(first.get(pm.palette.indexOf('dirt') + 1)![20 * pm.cols + 24], 255)
})

check('cached coverage stencil matches uncached blending across edits, palettes and resizes', () => {
  for (const [width, height] of [[0.2, 0.2], [0.31, 0.14], [0.2, 0.2]]) {
    const table = T(width, height), pm = createPaintMap(table)
    for (let stroke = 0; stroke < 6; stroke++) {
      applyPaintBrush(pm, table, -width / 4 + stroke * width / 12, 0, ['sand', 'water', 'dirt', null][stroke % 4], 0.035)
      assert.deepEqual(groundCoverage(pm, table), referenceCoverage(pm, table))
    }
  }
})

check('rotated elliptical landforms keep profile, footprint picking and bounds consistent', () => {
  const f = { ...defaultFeature('plateau', 0.02, -0.01), radius: 0.2, radiusZ: 0.06, height: 0.04, rotationDeg: 57, flatTop: 0.4 }
  const b = featureBounds(f)
  for (let i = 0; i < 100; i++) {
    const a = i / 100 * Math.PI * 2, p = featurePoint(f, Math.cos(a), Math.sin(a))
    assert.ok(Math.abs(featureDistance(f, p.x, p.z) - 1) < 1e-12)
    assert.ok(p.x >= b.minX - 1e-12 && p.x <= b.maxX + 1e-12 && p.z >= b.minZ - 1e-12 && p.z <= b.maxZ + 1e-12)
  }
  const top = featurePoint(f, 0.39, 0), rim = featurePoint(f, 0.99, 0), outside = featurePoint(f, 0, 1.1)
  assert.equal(featureContribution(f, top.x, top.z), 0.04)
  assert.ok(featureContribution(f, rim.x, rim.z) < 0.0001)
  assert.equal(featureContribution(f, outside.x, outside.z), 0)
})

check('merge is order-independent and does not stack shared summits; add still sums', () => {
  const f = { ...defaultFeature('hill', 0, 0), height: 0.08, blend: 'merge' as const }
  const g = { ...f, id: 'other', height: 0.12, radiusZ: 0.15 }
  assert.equal(featuresHeightAt([f, g], 0, 0), 0.12)
  assert.equal(featuresHeightAt([g, f], 0, 0), 0.12)
  assert.equal(featuresHeightAt([{ ...f, blend: 'add' }, g], 0, 0), 0.2)
  assert.equal(featuresHeightAt([{ ...f, height: -0.02 }, { ...g, height: -0.04 }], 0, 0), -0.04)
  const old = defaultFeature('hill', 0, 0) // no blend field = original additive behaviour
  assert.equal(featuresHeightAt([old, { ...old, id: 'copy' }], 0, 0), 0.16)
})

check('old circular landforms round-trip without gaining fields; bad ones are dropped', () => {
  const old = { id: 'tf_old', type: 'hill', x: 0.1, z: -0.2, radius: 0.3, height: 0.08 }
  assert.deepEqual(deserializeFeatures([old]), [old])
  const shaped = { ...old, radiusZ: 0.1, rotationDeg: 400, flatTop: 2, blend: 'merge' }
  assert.deepEqual(deserializeFeatures([shaped])[0], { ...old, radiusZ: 0.1, rotationDeg: 40, flatTop: 0.9, blend: 'merge' })
  assert.deepEqual(deserializeFeatures([{ ...old, radius: 0 }, { ...old, type: 'depression' }, { ...old, x: 'nope' }]), [])
})

const st = () => useAppStore.getState()
function start(width = 0.8, height = 0.6) {
  st().setTable({ width, height })
  st().actions.resetToScratch()
}
function checkSurfaceCache() {
  const s = st(), full = compositeHeightmap(s.terrainFeatures, s.terrainDetail, s.table)
  if (!full) { assert.ok(!s.heightmap || s.heightmap.heights.every((v) => Math.abs(v) < 1e-8)); return }
  assert.ok(s.heightmap)
  for (let i = 0; i < full.heights.length; i++) assert.ok(Math.abs(full.heights[i] - s.heightmap!.heights[i]) < 1e-7, 'cache differs at ' + i)
}

check('a draft stays off the table; placement carries its dimensions into one undo step', () => {
  start()
  const history = st().historyIndex
  st().setLandformArmed('hill')
  st().setLandformDraft({ radius: 0.3, radiusZ: 0.09, height: 0.06, rotationDeg: 35, flatTop: 0.25 })
  assert.equal(st().terrainFeatures.length, 0)
  assert.equal(st().historyIndex, history)
  const id = st().actions.addTerrainFeature('hill', 0.1, 0.03)
  st().setLandformArmed(null)
  assert.equal(st().selectedFeatureId, id) // stays selected after placing
  assert.equal(st().historyIndex, history + 1)
  const f = st().terrainFeatures[0]
  assert.equal(f.radiusZ, 0.09); assert.equal(f.rotationDeg, 35); assert.equal(f.flatTop, 0.25); assert.equal(f.blend, 'merge')
  checkSurfaceCache()
  st().actions.undo(); assert.equal(st().terrainFeatures.length, 0)
  st().actions.redo(); assert.deepEqual(st().terrainFeatures, [f])
  // A whole slider interaction = live updates + one commit = one undo step.
  for (let r = 0.2; r <= 0.25; r += 0.01) st().actions.updateTerrainFeatureLive(id, { radius: r })
  st().actions.updateTerrainFeatureLive(id, { radiusZ: 0.12, rotationDeg: 120, flatTop: 0.6 })
  st().actions.commitHistory()
  st().setSelectedFeature(id)
  st().actions.undo()
  assert.equal(st().selectedFeatureId, id) // selection survives the edit's undo
  assert.deepEqual(st().terrainFeatures, [f])
  checkSurfaceCache()
})

check('Escape-style cancel and placing a model both clear a pending landform', () => {
  start()
  st().setLandformArmed('plateau')
  assert.ok(st().landformDraft)
  st().setLandformArmed(null)
  assert.equal(st().landformDraft, null)
  st().setLandformArmed('hill')
  st().setSelectedAsset('some-model')
  assert.equal(st().landformArmed, null)
  st().setSelectedAsset(null)
  st().setLandformArmed('hill')
  st().setLandformEditing(false) // closing the panel
  assert.equal(st().landformArmed, null)
})

check('regional landform updates match a full recomposite after move, reshape and delete', () => {
  start(1, 0.8)
  const id = st().actions.addTerrainFeature('hill', -0.2, -0.1); checkSurfaceCache()
  const buffer = st().heightmap!.heights
  for (const patch of [{ x: 0.3, z: 0.2, radius: 0.12 }, { rotationDeg: 95, radiusZ: 0.3 }, { flatTop: 0.7, blend: 'add' as const }, { radius: 0.4, height: -0.04 }]) {
    st().actions.updateTerrainFeatureLive(id, patch); checkSurfaceCache()
  }
  assert.equal(st().heightmap!.heights, buffer) // updated in place, not reallocated
  st().actions.removeTerrainFeature(id); checkSurfaceCache()
})

check('sculpting on top of a landform edits only the detail layer', () => {
  start()
  st().actions.addTerrainFeature('plateau', 0, 0)
  st().setBrush({ radius: 0.1, strength: 0.5 })
  st().setTerrainTool('raise')
  assert.equal(st().selectedFeatureId, null)
  assert.ok(st().actions.sculptTerrain(0.2, 0.1))
  st().setTerrainTool('smooth')
  st().actions.sculptTerrain(0.15, 0.1)
  st().setTerrainTool('none')
  checkSurfaceCache()
  const detailMax = Math.max(...st().terrainDetail!.heights)
  assert.ok(detailMax > 0 && detailMax < 0.06, 'plateau height was not baked into the detail layer')
})

check('paint-only strokes leave the surface alone and commit as one undo step', () => {
  start()
  st().actions.addTerrainFeature('hill', 0, 0)
  const rev = st().terrainRev, heights = st().heightmap!.heights.slice()
  const before = st().historyIndex
  st().setPaintMaterial('sand')
  st().setTerrainTool('paint')
  st().setBrush({ radius: 0.02 })
  let last: { x: number; z: number } | undefined
  for (let i = 0; i <= 10; i++) { const p = { x: -0.3 + i * 0.06, z: 0 }; st().actions.paintTerrain(p.x, p.z, last); last = p }
  st().actions.commitHistory()
  assert.equal(st().terrainRev, rev)
  assert.deepEqual(st().heightmap!.heights, heights)
  assert.equal(st().historyIndex, before + 1)
  const pm = st().paint!
  const row = Math.floor(pm.rows / 2)
  for (let i = Math.round(pm.cols * 0.15); i < Math.round(pm.cols * 0.85); i++) assert.equal(pm.cells[row * pm.cols + i], 1, `gap at ${i}`)
  // Continuous erase over the same line, then undo restores the paint.
  st().setTerrainTool('erase'); last = undefined
  for (let i = 0; i <= 10; i++) { const p = { x: -0.3 + i * 0.06, z: 0 }; st().actions.paintTerrain(p.x, p.z, last); last = p }
  st().actions.commitHistory()
  assert.ok(st().paint!.cells.every((v) => v === 0))
  st().actions.undo()
  assert.equal(st().paint!.cells[row * pm.cols + Math.round(pm.cols / 2)], 1)
  st().setTerrainTool('none')
})

check('save and reopen keeps landforms, detail and paint; the saved heightmap is the full surface', () => {
  start()
  const id = st().actions.addTerrainFeature('plateau', 0.1, 0)
  st().actions.updateTerrainFeatureLive(id, { radiusZ: 0.12, rotationDeg: 30, flatTop: 0.4, blend: 'merge' })
  st().actions.commitHistory()
  st().setTerrainTool('raise'); st().actions.sculptTerrain(-0.3, -0.2); st().setTerrainTool('none')
  st().setTerrainTool('paint'); st().actions.paintTerrain(0, 0); st().setTerrainTool('none')
  const s = st()
  const { tableConfig, layoutData } = serializeLayout(s.table, s.tableMaterial, s.instances, {
    terrainDetail: s.terrainDetail, terrainFeatures: s.terrainFeatures, paint: s.paint,
  })
  const wire = JSON.parse(JSON.stringify({ tableConfig, layoutData }))
  assert.equal(wire.layoutData.version, 4)
  // Backend tile export / older planners read `heightmap`: it must include the landform.
  assert.deepEqual(wire.layoutData.heightmap, serializeHeightmap(s.heightmap))
  const loaded = deserializeLayout(wire.tableConfig, wire.layoutData)
  assert.deepEqual(loaded.terrainFeatures, s.terrainFeatures)
  assert.deepEqual(loaded.paint, s.paint)
  start()
  st().actions.applyLayout(loaded)
  assert.deepEqual(st().terrainFeatures, s.terrainFeatures)
  assert.equal(st().historyIndex, 0)
  checkSurfaceCache()
  for (let i = 0; i < s.heightmap!.heights.length; i++) assert.ok(Math.abs(st().heightmap!.heights[i] - s.heightmap!.heights[i]) < 0.0006)
})

check('pre-landform tables load unchanged and save in their original format', () => {
  const table = T(0.8, 0.6)
  const hm = createHeightmap(table)
  hm.heights[100] = 0.012; hm.heights[101] = 0.007
  const legacy = { version: 3, models: [], heightmap: serializeHeightmap(hm), paint: null }
  const loaded = deserializeLayout({ width: 0.8, height: 0.6, unitDisplay: 'cm', gridSize: 0.0127 }, legacy)
  assert.deepEqual(loaded.terrainFeatures, [])
  start()
  st().actions.applyLayout(loaded)
  assert.deepEqual(Array.from(st().heightmap!.heights), Array.from(hm.heights))
  const s = st()
  const again = serializeLayout(s.table, s.tableMaterial, s.instances, { terrainDetail: s.terrainDetail, terrainFeatures: s.terrainFeatures, paint: s.paint })
  assert.equal(again.layoutData.version, 3)
  assert.ok(!('terrainFeatures' in again.layoutData))
  assert.deepEqual(again.layoutData.heightmap, legacy.heightmap)
})

check('reset terrain and clear paint are single undoable steps', () => {
  start()
  st().actions.addTerrainFeature('hill', 0, 0)
  st().setTerrainTool('paint'); st().actions.paintTerrain(0, 0); st().actions.commitHistory(); st().setTerrainTool('none')
  st().actions.resetTerrain(); assert.equal(st().terrainFeatures.length, 0)
  st().actions.undo(); assert.equal(st().terrainFeatures.length, 1)
  st().actions.resetPaint(); assert.ok(st().paint!.cells.every((v) => v === 0))
  st().actions.undo(); assert.ok(st().paint!.cells.some((v) => v !== 0))
})

console.log(`\n${count} terrain checks passed`)
