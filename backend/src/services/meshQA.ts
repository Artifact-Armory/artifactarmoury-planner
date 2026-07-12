// backend/src/services/meshQA.ts
// Automatic mesh-quality analysis run at upload. It reuses the same STL triangles
// the fingerprint/preview already parse and checks the topology a slicer cares
// about: is the mesh watertight (no holes) and 2-manifold (no edge shared by more
// than two faces)? Open or non-manifold edges are the usual cause of an
// "unprintable file" — the slicer can't tell inside from outside.
//
// Results are ADVISORY: they warn the artist and give buyers a "clean mesh"
// signal, but never block an upload (some intentionally open-shell props are
// still printable, and our analysis is a heuristic).

import { parseSTL } from './fileProcessor'
import logger from '../utils/logger'

// STL stores every triangle's vertices independently, so we weld coincident
// vertices on a quantised grid before building the edge map. Above this many
// triangles we skip detailed analysis to bound memory on the worker.
const MAX_QA_TRIANGLES = 1_200_000

export interface MeshQAReport {
  analyzed: boolean
  status: 'clean' | 'issues' | 'skipped' | 'empty'
  triangleCount: number
  weldedVertices: number
  watertight: boolean | null
  manifold: boolean | null
  /** Boundary edges (shared by exactly one triangle) — these are holes. */
  openEdges: number
  /** Edges shared by 3+ triangles — non-manifold. */
  nonManifoldEdges: number
  degenerateTriangles: number
  note?: string
}

function skipped(triangleCount: number, note: string): MeshQAReport {
  return {
    analyzed: false,
    status: 'skipped',
    triangleCount,
    weldedVertices: 0,
    watertight: null,
    manifold: null,
    openEdges: 0,
    nonManifoldEdges: 0,
    degenerateTriangles: 0,
    note,
  }
}

/**
 * Analyse the topology of an STL on disk. Never throws — on any failure it
 * returns a `skipped` report so the upload pipeline is unaffected.
 */
export async function analyzeMeshQuality(stlPath: string): Promise<MeshQAReport> {
  try {
    const stl = await parseSTL(stlPath)
    const tris = stl.triangles
    const n = tris.length

    if (n === 0) {
      return { ...skipped(0, 'No triangles found'), status: 'empty', analyzed: true }
    }
    if (n > MAX_QA_TRIANGLES) {
      return skipped(n, `Mesh too large for QA (${n.toLocaleString()} triangles)`)
    }

    // Bounding box → a relative weld epsilon (~5 significant figures of the model
    // size), so re-exported meshes with tiny float differences still weld.
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < n; i++) {
      for (const v of tris[i].vertices) {
        if (v.x < minX) minX = v.x
        if (v.y < minY) minY = v.y
        if (v.z < minZ) minZ = v.z
        if (v.x > maxX) maxX = v.x
        if (v.y > maxY) maxY = v.y
        if (v.z > maxZ) maxZ = v.z
      }
    }
    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1
    const eps = Math.max(diag * 1e-6, 1e-9)
    const q = (val: number) => Math.round(val / eps)

    // Weld vertices → integer indices.
    const vertexIndex = new Map<string, number>()
    const keyFor = (v: { x: number; y: number; z: number }) => `${q(v.x)},${q(v.y)},${q(v.z)}`
    const indexOf = (v: { x: number; y: number; z: number }): number => {
      const k = keyFor(v)
      let idx = vertexIndex.get(k)
      if (idx === undefined) {
        idx = vertexIndex.size
        vertexIndex.set(k, idx)
      }
      return idx
    }

    // Count triangles per undirected edge.
    const edgeCount = new Map<string, number>()
    let degenerate = 0
    const bump = (a: number, b: number) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
    }

    for (let i = 0; i < n; i++) {
      const [v0, v1, v2] = tris[i].vertices
      const i0 = indexOf(v0)
      const i1 = indexOf(v1)
      const i2 = indexOf(v2)
      // A triangle with a repeated welded vertex has zero area → degenerate.
      if (i0 === i1 || i1 === i2 || i0 === i2) {
        degenerate++
        continue
      }
      bump(i0, i1)
      bump(i1, i2)
      bump(i2, i0)
    }

    let openEdges = 0
    let nonManifoldEdges = 0
    for (const count of edgeCount.values()) {
      if (count === 1) openEdges++
      else if (count > 2) nonManifoldEdges++
    }

    const watertight = openEdges === 0 && nonManifoldEdges === 0
    const manifold = nonManifoldEdges === 0
    const status: MeshQAReport['status'] = watertight && degenerate === 0 ? 'clean' : 'issues'

    const report: MeshQAReport = {
      analyzed: true,
      status,
      triangleCount: n,
      weldedVertices: vertexIndex.size,
      watertight,
      manifold,
      openEdges,
      nonManifoldEdges,
      degenerateTriangles: degenerate,
    }

    logger.info('Mesh QA complete', {
      triangleCount: n,
      openEdges,
      nonManifoldEdges,
      degenerate,
      status,
    })
    return report
  } catch (err) {
    logger.warn('Mesh QA failed (non-fatal)', { error: err, stlPath })
    return skipped(0, 'Mesh analysis could not be completed')
  }
}
