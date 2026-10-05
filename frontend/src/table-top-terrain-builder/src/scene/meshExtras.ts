// src/scene/meshExtras.ts
//
// Planner LODs and picking BVHs, computed in the browser after a model loads.
//
// WHY LODs, AND WHY THEY ARE INVISIBLE
// ------------------------------------
// Zoomed out over a full table a dense proxy lands ~10 triangles on every pixel:
// GPU work for detail nobody can see, and the main cause of the planner lagging
// on busy tables. Each LOD here is an index buffer over the part's OWN vertex
// buffer (shared on the GPU, so nothing is re-uploaded), simplified by meshopt
// with UV/crease seams preserved, and tagged with its geometric error.
// InstancedScene draws a LOD only while that error projects to under
// LOD_MAX_ERROR_PX of a pixel; closer than that, the full mesh is drawn.
//
// That threshold is measured, not guessed (2026-10-05, a 332k-triangle production
// proxy, rendered with the planner's own three.js build and lighting): at 0.12 px a
// LOD was indistinguishable from the full mesh even enlarged, and changed fewer
// pixels than moving the camera a QUARTER of a pixel does. Two approaches that
// looked like bigger wins were rejected on those renders: collapsing across UV
// seams scrambles the baked normal map, and bounding normal drift as well leaves
// almost nothing to cut (these meshes carry their detail in their normals).
//
// WHY IN THE BROWSER
// ------------------
// The obvious place is the backend, shipped inside the GLB. Measured: the only
// lossless way to carry shared-vertex LODs is a non-Draco GLB, and storing this
// geometry losslessly outside Draco costs 4.7-5.6 MB gzipped against Draco's
// 2.8 MB. That would make every table slower to LOAD to make it faster to DRAW.
// Computing here costs a few hundred ms of worker time per unique model, off the
// main thread, after the table is already visible — and needs no backfill.
//
// WHY A BVH
// ---------
// Hover picking ran on every pointer move and walked every triangle of every
// piece under the cursor in JavaScript (300k+ per proxy, more for an owner's
// copy). A BVH makes that a fraction of a millisecond.

import * as THREE from 'three'
import { MeshBVH, type SerializedBVH } from 'three-mesh-bvh'

/** A LOD is drawn only while its error projects to less than this many device pixels. */
export const LOD_MAX_ERROR_PX = 0.1

/** `?lod=0` in the URL turns LODs off, for side-by-side checks. */
export const LOD_ENABLED = (() => {
  try {
    return new URLSearchParams(window.location.search).get('lod') !== '0'
  } catch {
    return true
  }
})()

export interface MeshLod {
  geometry: THREE.BufferGeometry
  /** Geometric error in the part's LOCAL units (multiply by the part matrix scale). */
  error: number
}

export interface MeshExtras {
  lods: MeshLod[]
  /** Geometry carrying the BVH: the full mesh's own position + index, local units. */
  pickGeometry: THREE.BufferGeometry
  bvh: MeshBVH
}

interface WorkerReply {
  id: number
  error?: string
  extent?: number
  lods?: { index: Uint32Array; relError: number }[]
  pick?: SerializedBVH
}

/**
 * Worker lanes. Each runs one job at a time (they're CPU-bound, and a queue keeps
 * memory flat); a second lane on machines with the cores halves how long a big
 * table waits for its LODs — ~1 s of worker time per dense model.
 */
interface Lane { worker: Worker | null; chain: Promise<unknown>; queued: number }
const LANE_COUNT = (navigator.hardwareConcurrency || 4) >= 8 ? 2 : 1
const lanes: Lane[] = []
let workerBroken = false
let nextId = 1
const pending = new Map<number, (reply: WorkerReply) => void>()

function startWorker(): Worker | null {
  try {
    const w = new Worker(new URL('./meshExtras.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const done = pending.get(e.data.id)
      pending.delete(e.data.id)
      done?.(e.data)
    }
    w.onerror = (e) => {
      console.warn('[planner] mesh worker failed; LODs and fast picking disabled', e.message)
      workerBroken = true
      for (const done of pending.values()) done({ id: -1, error: 'worker failed' })
      pending.clear()
    }
    return w
  } catch (err) {
    console.warn('[planner] could not start mesh worker; LODs and fast picking disabled', err)
    workerBroken = true
    return null
  }
}

/** The least-busy lane, starting lanes lazily. */
function pickLane(): Lane {
  if (lanes.length < LANE_COUNT && lanes.every((l) => l.queued > 0)) {
    lanes.push({ worker: null, chain: Promise.resolve(), queued: 0 })
  }
  if (lanes.length === 0) lanes.push({ worker: null, chain: Promise.resolve(), queued: 0 })
  return lanes.reduce((a, b) => (b.queued < a.queued ? b : a))
}

/** Positions as a fresh, tightly packed Float32Array (the GPU copy stays untouched). */
function packedPositions(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  const out = new Float32Array(attr.count * 3)
  if (!(attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute &&
      !attr.normalized && attr.array instanceof Float32Array && attr.itemSize === 3) {
    out.set(attr.array.subarray(0, attr.count * 3))
    return out
  }
  for (let i = 0; i < attr.count; i++) {
    out[i * 3] = attr.getX(i)
    out[i * 3 + 1] = attr.getY(i)
    out[i * 3 + 2] = attr.getZ(i)
  }
  return out
}

/** A geometry that draws `index` over `base`'s own attributes (shared, not copied). */
function shareAttributes(base: THREE.BufferGeometry, index: THREE.BufferAttribute): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.getAttribute(name))
  g.setIndex(index)
  if (!base.boundingBox) base.computeBoundingBox()
  if (!base.boundingSphere) base.computeBoundingSphere()
  // Same vertex buffer, so the base bounds are correct (if slightly loose) here.
  g.boundingBox = base.boundingBox!.clone()
  g.boundingSphere = base.boundingSphere!.clone()
  return g
}

/**
 * Compute LODs + a picking BVH for one geometry, in the worker. Resolves to null
 * when the worker is unavailable or fails — callers then simply keep drawing and
 * picking the full mesh, which is exactly the behaviour before this existed.
 */
export function computeMeshExtras(geometry: THREE.BufferGeometry): Promise<MeshExtras | null> {
  const lane = pickLane()
  lane.queued++
  const run = async (): Promise<MeshExtras | null> => {
    if (!lane.worker && !workerBroken) lane.worker = startWorker()
    const w = workerBroken ? null : lane.worker
    const pos = geometry.getAttribute('position')
    if (!w || !pos) return null
    const idx = geometry.getIndex()
    const index = idx ? Uint32Array.from(idx.array as ArrayLike<number>) : null
    const positions = packedPositions(pos)
    const id = nextId++
    const reply = await new Promise<WorkerReply>((resolve) => {
      pending.set(id, resolve)
      const transfer: Transferable[] = [positions.buffer]
      if (index) transfer.push(index.buffer)
      w.postMessage({ id, positions, index }, transfer)
    })
    if (reply.error || !reply.pick || !reply.lods || !reply.extent) {
      if (reply.error) console.warn('[planner] mesh extras failed', reply.error)
      return null
    }
    const extent = reply.extent
    const lods = LOD_ENABLED
      ? reply.lods.map((l) => ({
          geometry: shareAttributes(geometry, new THREE.BufferAttribute(l.index, 1)),
          error: l.relError * extent,
        }))
      : []
    // The BVH is "indirect" over the full mesh's own index, so the pick geometry
    // shares both position and index with what is drawn — no copy of either.
    const pickGeometry = new THREE.BufferGeometry()
    pickGeometry.setAttribute('position', pos)
    if (idx) pickGeometry.setIndex(idx)
    const bvh = MeshBVH.deserialize(reply.pick, pickGeometry, { setIndex: !idx })
    return { lods, pickGeometry, bvh }
  }
  const p = lane.chain
    .then(run, run)
    .catch((err) => {
      console.warn('[planner] mesh extras failed', err)
      return null
    })
    .finally(() => { lane.queued-- })
  lane.chain = p
  return p
}
