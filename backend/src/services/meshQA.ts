// backend/src/services/meshQA.ts
// Automatic mesh-quality analysis run at upload. It reuses the same STL triangles
// the fingerprint/preview already parse and checks the topology a slicer cares
// about: is the mesh watertight (no holes) and 2-manifold (no edge shared by more
// than two faces)? Open or non-manifold edges are the usual cause of an
// "unprintable file" — the slicer can't tell inside from outside.
//
// Results are ADVISORY: they warn the artist and give buyers a "clean mesh"
// signal, but never block an upload or a publish (some intentionally open-shell
// props are still printable, and our analysis is a heuristic).
//
// FALSE ALARMS (artist feedback, 10 Nov 2026: "the site says my models have
// defects but they print fine"). The first version flagged ANY open edge. Sculpted
// and kit-bashed STLs routinely carry hairline cracks (two vertices a few
// thousandths of a millimetre apart) and pinholes a few triangles wide. Every
// slicer stitches those silently, so they never affect a print. Two passes now
// separate those from real holes:
//   1. Snap boundary vertices that sit within SNAP_REL of the model size together
//      (closes hairline cracks), then recount.
//   2. Group the remaining open edges into hole loops and measure each loop's
//      perimeter. Only a hole whose perimeter is at least SIGNIFICANT_HOLE_REL of
//      the model's diagonal counts as significant (`significantOpenEdges`).
// The artist only sees a warning for significant holes.

import { parseSTL } from './fileProcessor'
import logger from '../utils/logger'

// STL stores every triangle's vertices independently, so we weld coincident
// vertices on a quantised grid before building the edge map. Above this many
// triangles we skip detailed analysis to bound memory on the worker.
const MAX_QA_TRIANGLES = 1_200_000

/** Crack-closing tolerance, as a fraction of the bounding-box diagonal (~0.007 mm on a 28 mm figure). */
const SNAP_REL = 1e-4
/** A hole loop shorter than this fraction of the diagonal is a pinhole a slicer repairs (~4 mm round on a 28 mm figure, ~1.3 mm across). */
const SIGNIFICANT_HOLE_REL = 0.1

export interface MeshQAReport {
  analyzed: boolean
  status: 'clean' | 'issues' | 'skipped' | 'empty'
  triangleCount: number
  weldedVertices: number
  watertight: boolean | null
  manifold: boolean | null
  /** Boundary edges (shared by exactly one triangle) after hairline cracks are closed. */
  openEdges: number
  /** Open edges that belong to a significant hole (see SIGNIFICANT_HOLE_REL). Drives the artist warning. */
  significantOpenEdges: number
  /** Number of separate hole loops. */
  holes: number
  /** Perimeter of the biggest hole, in model units (mm for STL). */
  largestHolePerimeter: number
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
    significantOpenEdges: 0,
    holes: 0,
    largestHolePerimeter: 0,
    nonManifoldEdges: 0,
    degenerateTriangles: 0,
    note,
  }
}

/** Plain union-find over vertex ids. */
function makeUnionFind(size: number) {
  const parent = new Int32Array(size)
  for (let i = 0; i < size; i++) parent[i] = i
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  return { find, union }
}

/**
 * Count triangles per undirected edge. `remap` lets pass 2 merge snapped vertices.
 * Triangles that collapse (two corners on the same vertex) are skipped.
 */
function countEdges(tri: Int32Array, vertexCount: number, remap?: (i: number) => number) {
  const edgeCount = new Map<number, number>()
  for (let t = 0; t < tri.length; t += 3) {
    if (tri[t] < 0) continue
    let a = tri[t], b = tri[t + 1], c = tri[t + 2]
    if (remap) { a = remap(a); b = remap(b); c = remap(c) }
    if (a === b || b === c || a === c) continue
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const key = x < y ? x * vertexCount + y : y * vertexCount + x
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
    }
  }
  return edgeCount
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

    // Weld vertices → integer indices; keep one position per welded vertex.
    const vertexIndex = new Map<string, number>()
    const pos: number[] = []
    const indexOf = (v: { x: number; y: number; z: number }): number => {
      const k = `${q(v.x)},${q(v.y)},${q(v.z)}`
      let idx = vertexIndex.get(k)
      if (idx === undefined) {
        idx = vertexIndex.size
        vertexIndex.set(k, idx)
        pos.push(v.x, v.y, v.z)
      }
      return idx
    }

    const tri = new Int32Array(n * 3)
    let degenerate = 0
    for (let i = 0; i < n; i++) {
      const [v0, v1, v2] = tris[i].vertices
      const i0 = indexOf(v0)
      const i1 = indexOf(v1)
      const i2 = indexOf(v2)
      // A triangle with a repeated welded vertex has zero area → degenerate.
      if (i0 === i1 || i1 === i2 || i0 === i2) {
        degenerate++
        tri[i * 3] = -1
        continue
      }
      tri[i * 3] = i0
      tri[i * 3 + 1] = i1
      tri[i * 3 + 2] = i2
    }
    const V = vertexIndex.size

    // Pass 1: exact topology.
    let edgeCount = countEdges(tri, V)
    let openEdges = 0
    let nonManifoldEdges = 0
    for (const count of edgeCount.values()) {
      if (count === 1) openEdges++
      else if (count > 2) nonManifoldEdges++
    }

    let significantOpenEdges = 0
    let holes = 0
    let largestHolePerimeter = 0

    if (openEdges > 0) {
      // Pass 2: snap boundary vertices that are within tolerance of each other
      // (hairline cracks), then recount open edges.
      const boundary = new Set<number>()
      for (const [key, count] of edgeCount) {
        if (count !== 1) continue
        boundary.add(Math.floor(key / V))
        boundary.add(key % V)
      }
      const tol = diag * SNAP_REL
      const snap = makeUnionFind(V)
      const cells = new Map<string, number[]>()
      for (const v of boundary) {
        const cx = Math.floor(pos[v * 3] / tol)
        const cy = Math.floor(pos[v * 3 + 1] / tol)
        const cz = Math.floor(pos[v * 3 + 2] / tol)
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const near = cells.get(`${cx + dx},${cy + dy},${cz + dz}`)
          if (!near) continue
          for (const u of near) {
            const d = Math.hypot(
              pos[v * 3] - pos[u * 3], pos[v * 3 + 1] - pos[u * 3 + 1], pos[v * 3 + 2] - pos[u * 3 + 2],
            )
            if (d <= tol) snap.union(u, v)
          }
        }
        const key = `${cx},${cy},${cz}`
        const list = cells.get(key)
        if (list) list.push(v)
        else cells.set(key, [v])
      }
      edgeCount = countEdges(tri, V, snap.find)
      openEdges = 0
      const open: number[] = []
      for (const [key, count] of edgeCount) {
        if (count === 1) {
          openEdges++
          open.push(key)
        }
      }

      // Pass 3: group what's left into hole loops and measure each perimeter.
      if (openEdges > 0) {
        const loops = makeUnionFind(V)
        for (const key of open) loops.union(Math.floor(key / V), key % V)
        const perimeter = new Map<number, number>()
        const edgesPerLoop = new Map<number, number>()
        for (const key of open) {
          const a = Math.floor(key / V)
          const b = key % V
          const len = Math.hypot(
            pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2],
          )
          const root = loops.find(a)
          perimeter.set(root, (perimeter.get(root) ?? 0) + len)
          edgesPerLoop.set(root, (edgesPerLoop.get(root) ?? 0) + 1)
        }
        holes = perimeter.size
        const minSignificant = diag * SIGNIFICANT_HOLE_REL
        for (const [root, p] of perimeter) {
          if (p > largestHolePerimeter) largestHolePerimeter = p
          if (p >= minSignificant) significantOpenEdges += edgesPerLoop.get(root) ?? 0
        }
      }
    }

    const watertight = openEdges === 0 && nonManifoldEdges === 0
    const manifold = nonManifoldEdges === 0
    const status: MeshQAReport['status'] = watertight && degenerate === 0 ? 'clean' : 'issues'

    const report: MeshQAReport = {
      analyzed: true,
      status,
      triangleCount: n,
      weldedVertices: V,
      watertight,
      manifold,
      openEdges,
      significantOpenEdges,
      holes,
      largestHolePerimeter: Math.round(largestHolePerimeter * 100) / 100,
      nonManifoldEdges,
      degenerateTriangles: degenerate,
    }

    logger.info('Mesh QA complete', {
      triangleCount: n,
      openEdges,
      significantOpenEdges,
      holes,
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
