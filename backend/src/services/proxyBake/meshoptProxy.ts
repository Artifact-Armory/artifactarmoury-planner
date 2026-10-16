// backend/src/services/proxyBake/meshoptProxy.ts
//
// Decimates a bake source with meshoptimizer BEFORE Blender runs, and hands the
// result to bake_proxy.py as a ready-made proxy (--proxy-input). Blender then
// skips its own DECIMATE(COLLAPSE) and only does the unwrap, the normal/AO bake
// from the FULL source, the emboss and the poison pills, exactly as before.
//
// Why: on the Tiger I (5.12M triangles) Blender's collapse shredded the road
// wheels, tracks and muzzle brake even at a 1M budget, while meshopt at 240k (the
// owner-GLB path, convertSTLtoGLBFull) was hard to tell from the source. Blender's
// preprocess also welds at weldMergeDistanceMm (0.05 mm), which on that model
// merged 5.12M triangles down to 1.91M before decimation began. This path welds
// only bitwise-identical positions, like the owner GLB, so nothing moves.
//
// Binary STL only; anything else (ASCII STL, OBJ) returns null and the bake falls
// back to Blender's decimation.

import { promises as fsp } from 'fs'
import type { ProxyBakeConfig } from './config'

const importESM = new Function('specifier', 'return import(specifier)') as <T = any>(
  specifier: string,
) => Promise<T>

export interface MeshoptProxyResult {
  sourceTriangles: number
  budget: number
  triangles: number
  /** meshopt's reported error, relative to the mesh extent. */
  error: number
  seconds: number
}

/** Same formula as bake_proxy.py's compute_adaptive_budget. Keep them in step. */
export function adaptiveBudget(srcTris: number, cfg: ProxyBakeConfig): number {
  const floor = cfg.triangleBudget
  const ceiling = Math.max(floor, cfg.triangleBudgetCeiling)
  const ratioBudget = Math.round(srcTris * cfg.triangleRetainRatio)
  return Math.max(floor, Math.min(ratioBudget, ceiling))
}

/** Triangle count of a binary STL, or null if the file isn't one. */
async function binaryStlTriangles(buf: Buffer): Promise<number | null> {
  if (buf.length < 84) return null
  const n = buf.readUInt32LE(80)
  return 84 + n * 50 === buf.length ? n : null
}

/**
 * Index the triangle soup by merging bitwise-identical positions, with an
 * open-addressing table over the raw float bits (a Map of string keys is far too
 * slow and memory-hungry at 15M corners).
 */
function weldExact(buf: Buffer, tris: number): { positions: Float32Array; indices: Uint32Array } {
  const corners = tris * 3
  const bits = new Uint32Array(corners * 3)
  for (let t = 0, off = 84 + 12, o = 0; t < tris; t++, off += 50) {
    for (let k = 0; k < 9; k++) bits[o++] = buf.readUInt32LE(off + k * 4)
  }
  let size = 1
  while (size < corners * 2) size <<= 1
  const mask = size - 1
  const table = new Int32Array(size).fill(-1)
  const uniq = new Uint32Array(corners * 3)
  const indices = new Uint32Array(corners)
  let count = 0
  for (let c = 0; c < corners; c++) {
    const x = bits[c * 3], y = bits[c * 3 + 1], z = bits[c * 3 + 2]
    let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)) >>> 0
    let slot = h & mask
    for (;;) {
      const v = table[slot]
      if (v === -1) {
        table[slot] = count
        uniq[count * 3] = x; uniq[count * 3 + 1] = y; uniq[count * 3 + 2] = z
        indices[c] = count++
        break
      }
      if (uniq[v * 3] === x && uniq[v * 3 + 1] === y && uniq[v * 3 + 2] === z) {
        indices[c] = v
        break
      }
      slot = (slot + 1) & mask
    }
  }
  const positions = new Float32Array(uniq.buffer, 0, count * 3).slice()
  return { positions, indices }
}

function writeBinaryStl(positions: Float32Array, indices: Uint32Array): Buffer {
  const tris = indices.length / 3
  const out = Buffer.alloc(84 + tris * 50)
  out.write('aa meshopt proxy', 0, 'ascii')
  out.writeUInt32LE(tris, 80)
  for (let t = 0, off = 84; t < tris; t++, off += 50) {
    // Normal left zero; Blender recomputes it from the winding.
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k] * 3
      const o = off + 12 + k * 12
      out.writeFloatLE(positions[v], o)
      out.writeFloatLE(positions[v + 1], o + 4)
      out.writeFloatLE(positions[v + 2], o + 8)
    }
  }
  return out
}

/**
 * Write a meshopt-decimated copy of `srcPath` to `outPath` when the source is a
 * binary STL over its budget. Returns null (and writes nothing) when Blender
 * should handle the source as before.
 */
export async function buildMeshoptProxy(
  srcPath: string,
  outPath: string,
  cfg: ProxyBakeConfig,
): Promise<MeshoptProxyResult | null> {
  if (!cfg.proxyDecimationEnabled || cfg.remeshStrategy === 'voxel' || cfg.proxyDecimator !== 'meshopt') {
    return null
  }
  const t0 = Date.now()
  const buf = await fsp.readFile(srcPath)
  const tris = await binaryStlTriangles(buf)
  if (tris == null) return null
  const budget = adaptiveBudget(tris, cfg)
  if (tris <= budget) return null

  const { positions, indices } = weldExact(buf, tris)

  const meshopt: any = await importESM('meshoptimizer')
  const Simplifier = meshopt.MeshoptSimplifier ?? meshopt.default?.MeshoptSimplifier
  await Simplifier.ready
  const [simplified, error] = Simplifier.simplify(
    indices,
    positions,
    3,
    budget * 3,
    cfg.proxyMeshoptError,
    [],
  ) as [Uint32Array, number]

  await fsp.writeFile(outPath, writeBinaryStl(positions, simplified))
  return {
    sourceTriangles: tris,
    budget,
    triangles: simplified.length / 3,
    error,
    seconds: (Date.now() - t0) / 1000,
  }
}
