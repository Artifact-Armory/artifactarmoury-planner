// src/scene/meshExtras.worker.ts
//
// Off-main-thread mesh work for one loaded part: planner LOD index buffers and a
// picking BVH. See meshExtras.ts for what they are for and why they are invisible.
//
// In:  { id, positions: Float32Array (xyz), index: Uint32Array | null }
// Out: { id, extent, lods: [{ index, relError }], pick: SerializedBVH } | { id, error }
//
// Everything is transferred, not copied, in both directions.

import { BufferAttribute, BufferGeometry } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { MeshoptSimplifier } from 'meshoptimizer/simplifier'

/**
 * LOD error targets, as fractions of the mesh's largest extent (meshopt's own
 * relative error — 0.0002 of a 250 mm model is 0.05 mm). A level is kept only
 * if it is at most MIN_STEP of the previous level's triangles, so near-duplicate
 * levels don't cost index memory for nothing.
 */
const RELATIVE_ERRORS = [0.0002, 0.0005, 0.001, 0.002, 0.004]
const MIN_STEP = 0.75
const MAX_LEVELS = 3
/** Below this a mesh is cheap enough that LODs aren't worth their memory. */
const MIN_TRIANGLES = 20_000

interface Request {
  id: number
  positions: Float32Array
  index: Uint32Array | null
}

function largestExtent(p: Float32Array): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ)
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, positions } = e.data
  try {
    await MeshoptSimplifier.ready
    const vertexCount = positions.length / 3
    let index = e.data.index
    if (!index) {
      index = new Uint32Array(vertexCount)
      for (let i = 0; i < vertexCount; i++) index[i] = i
    }

    // ---- LODs -------------------------------------------------------------
    // Seams (UV and crease splits) are preserved: no 'Permissive'. Crossing them
    // reaches far fewer triangles but visibly scrambles the baked normal map.
    const lods: { index: Uint32Array; relError: number }[] = []
    if (index.length / 3 >= MIN_TRIANGLES) {
      let previous = index.length
      for (const target of RELATIVE_ERRORS) {
        if (lods.length >= MAX_LEVELS) break
        const [lod, error] = MeshoptSimplifier.simplify(index, positions, 3, 0, target, [])
        if (lod.length === 0 || lod.length > previous * MIN_STEP) continue
        previous = lod.length
        // Record the error actually reached, never less than the target asked for.
        lods.push({ index: lod, relError: Math.max(target, error) })
      }
    }

    // ---- picking BVH --------------------------------------------------------
    // Over the FULL mesh, so a pick hits exactly what the brute-force raycast it
    // replaces would have. `indirect` leaves the index untouched and orders a
    // separate per-triangle buffer instead, so the main thread can use the
    // geometry's own index rather than holding a reordered copy of it.
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setIndex(new BufferAttribute(index, 1))
    const bvh = new MeshBVH(geometry, { indirect: true })
    const serialized = MeshBVH.serialize(bvh, { cloneBuffers: false })

    const transfer: Transferable[] = [...lods.map((l) => l.index.buffer), ...serialized.roots]
    if (serialized.indirectBuffer) transfer.push(serialized.indirectBuffer.buffer)
    // The index only goes back when it was generated here (non-indexed input).
    const generatedIndex = e.data.index ? null : index
    if (generatedIndex) transfer.push(generatedIndex.buffer)
    ;(self as unknown as Worker).postMessage(
      {
        id,
        extent: largestExtent(positions),
        lods,
        // Keep the serialized `version`: without it deserialize() "fixes up"
        // (i.e. corrupts) roots it takes for an older format.
        pick: { ...serialized, index: generatedIndex },
      },
      transfer,
    )
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
