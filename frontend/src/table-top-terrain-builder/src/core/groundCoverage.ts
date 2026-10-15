import type { PaintMap } from './paintmap'

function hash(x: number, z: number) {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = x - ix, fz = z - iz
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
  return (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v) +
    (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v
}

// A bounded cache reuses the world-space warp stencil while painting a table.
let stencil: { key: string; indices: Uint32Array; weights: Float64Array } | undefined
function coverageStencil(pm: PaintMap, table: { width: number; height: number }) {
  const key = `${pm.cols}/${pm.rows}/${table.width}/${table.height}`
  if (stencil?.key === key) return stencil
  const indices = new Uint32Array(pm.cells.length * 4), weights = new Float64Array(indices.length)
  const dx = table.width / pm.cols, dz = table.height / pm.rows
  for (let j = 0; j < pm.rows; j++) for (let i = 0; i < pm.cols; i++) {
    const x = (i + 0.5) * dx - table.width / 2, z = (j + 0.5) * dz - table.height / 2
    const u = Math.max(0, Math.min(pm.cols - 1, i + (noise(x * 45, z * 45) - 0.5) * 0.009 / dx))
    const v = Math.max(0, Math.min(pm.rows - 1, j + (noise(x * 45 + 71, z * 45 - 31) - 0.5) * 0.009 / dz))
    const i0 = Math.floor(u), j0 = Math.floor(v), fx = u - i0, fz = v - j0
    const offset = (j * pm.cols + i) * 4
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      indices[offset + b * 2 + a] = Math.min(pm.rows - 1, j0 + b) * pm.cols + Math.min(pm.cols - 1, i0 + a)
      weights[offset + b * 2 + a] = (a ? fx : 1 - fx) * (b ? fz : 1 - fz)
    }
  }
  return stencil = { key, indices, weights }
}

/** Same partitioned edge weights, without trigonometry or per-cell Maps per dab. */
export function groundCoverage(pm: PaintMap, table: { width: number; height: number }) {
  const layers = new Map<number, Uint8ClampedArray>()
  for (const id of new Set(pm.cells)) layers.set(id, new Uint8ClampedArray(pm.cells.length))
  const { indices, weights } = coverageStencil(pm, table)
  for (let k = 0; k < pm.cells.length; k++) {
    const p = k * 4
    const a = pm.cells[indices[p]], b = pm.cells[indices[p+1]], c = pm.cells[indices[p+2]], d = pm.cells[indices[p+3]]
    const w0 = weights[p], w1 = weights[p+1], w2 = weights[p+2], w3 = weights[p+3]
    layers.get(a)![k] = Math.round((w0 + (b === a ? w1 : 0) + (c === a ? w2 : 0) + (d === a ? w3 : 0)) * 255)
    if (b !== a) layers.get(b)![k] = Math.round((w1 + (c === b ? w2 : 0) + (d === b ? w3 : 0)) * 255)
    if (c !== a && c !== b) layers.get(c)![k] = Math.round((w2 + (d === c ? w3 : 0)) * 255)
    if (d !== a && d !== b && d !== c) layers.get(d)![k] = Math.round(w3 * 255)
  }
  return layers
}
