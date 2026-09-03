// backend/src/services/fileProcessor.ts
import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import logger from '../utils/logger'
import { saveFile, STORAGE_PATHS } from './storage'
import type { AABB, Footprint, PrintStats, FilePaths, Vector3 } from '../types/shared'

const execAsync = promisify(exec)

// @gltf-transform/core is ESM-only (its `property-graph` dependency ships as
// .mjs), so a static import compiles to require() and throws ERR_REQUIRE_ESM
// under our CommonJS build. Load it via a genuine dynamic import() — wrapped in
// `new Function` so TypeScript doesn't downlevel it back into require().
const importESM = new Function('specifier', 'return import(specifier)') as <T = any>(
  specifier: string,
) => Promise<T>

// ============================================================================
// CONFIGURATION
// ============================================================================

let BLENDER_PATH = process.env.BLENDER_PATH || 'blender'
let HAS_BLENDER = false

async function checkTools() {
  try {
    await execAsync(`${BLENDER_PATH} --version`)
    HAS_BLENDER = true
    logger.info('✓ Blender found (optional, pure-Node GLB conversion active)')
  } catch {
    logger.info('Blender not found — using pure-Node STL→GLB conversion')
  }
}

if (process.env.NODE_ENV !== 'test') {
  checkTools().catch(err => logger.error('Tool check failed', { error: err }))
}

// ============================================================================
// FINGERPRINTING
// ============================================================================

/**
 * Compute SHA-256 digest of a file buffer for duplicate detection.
 */
export function computeFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// ============================================================================
// STL PARSING (ASCII & BINARY)
// ============================================================================

interface Triangle {
  normal: Vector3
  vertices: [Vector3, Vector3, Vector3]
}

interface ParsedSTL {
  triangles: Triangle[]
  triangleCount: number
  isBinary: boolean
}

/**
 * Meshes above this are rejected before the parse loop below runs. Unlike
 * fullGlb/build.ts's typed-array pipeline (which the same 1.1KB/source-triangle
 * measurement and MAX_TRIS pattern comes from), parseBinarySTL/parseASCIISTL
 * below build a full JS object graph — a Triangle object plus 4 nested Vector3
 * objects PER triangle — which is materially heavier per triangle than that.
 * The original 1M default used that pipeline's evidenced ~1.1GB-at-1M-tris
 * figure as a conservative anchor rather than inventing an unverified number.
 *
 * Raised 1M → 3M → 5M, all on 2026-09-03. The 1M→3M jump (MyMiniFactory source
 * models exceeding it — MMF's own limit is file size, not triangle count, so it
 * doesn't bound this) was UNPROFILED and genuinely risky at the time: this
 * pipeline costs more per triangle than the 1.1KB/tri fullGlb figure above, and
 * back then this parse still ran inline in the API server itself, so an OOM
 * here took out the web dyno. **That's no longer true** — as of the same day,
 * this parse runs in the separate worker service (services/modelIngest/,
 * migration 057, MODEL_INGEST_WORKER_ENABLED), with a cluster-wide single-
 * flight lock (queue.ts's LARGE_JOB_BYTES) stopping more than one heavy parse
 * from running anywhere at once. The 3M→5M bump (a real 4,084,184-triangle
 * upload — "Japan houses" — hit the 3M ceiling) leans on that: a spike here
 * now costs a worker restart, not a site outage, and can't stack with another
 * large upload's memory. Still an UNPROFILED number, still worth watching
 * Railway worker memory on the first real upload near this new ceiling — the
 * failure mode just changed from "site down" to "one upload retries slower".
 *
 * For binary STL (fixed 50 bytes/triangle) this ceiling — not
 * MAX_MODEL_FILE_BYTES — ends up the binding constraint well under that byte
 * cap (250MB); a dense binary STL anywhere near the byte cap will still be
 * rejected here. The higher byte cap mainly helps less triangle-dense uploads
 * (ASCII STL, OBJ, 3MF) and genuinely low-poly-but-physically-large terrain.
 */
export const MAX_INGEST_TRIANGLES = Number(process.env.MAX_INGEST_TRIANGLES ?? 5_000_000)

/**
 * Triangle count from a binary STL *without* parsing it — the format states it
 * in 4 bytes at offset 80. Must run BEFORE the parse loop: checking the count
 * afterwards guards nothing, since the memory is already spent building the
 * object graph the check was meant to prevent. Returns null when the header
 * count doesn't agree with the file's actual length (not a well-formed binary
 * STL — parseBinarySTL will surface that as its own error).
 */
function binaryStlDeclaredTriangleCount(buffer: Buffer): number | null {
  if (buffer.length < 84) return null
  const n = buffer.readUInt32LE(80)
  return 84 + n * 50 === buffer.length ? n : null
}

/**
 * Cheap upper-bound triangle count for an ASCII STL, without allocating any
 * triangle objects: counts the "facet normal" marker each triangle starts
 * with (searched directly over the raw bytes, so this doesn't even pay for a
 * utf8 decode of the whole file). "facet" alone would double-count, since
 * "endfacet" also contains it.
 */
function countAsciiFacets(buffer: Buffer): number {
  const needle = 'facet normal'
  let count = 0
  let idx = buffer.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = buffer.indexOf(needle, idx + needle.length)
  }
  return count
}

/**
 * Parse STL file (supports both ASCII and binary formats)
 */
export async function parseSTL(filePath: string): Promise<ParsedSTL> {
  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch (error) {
    logger.error('Failed to read STL', { error, filePath })
    throw new Error('Failed to parse STL file')
  }

  // Check if binary or ASCII
  const header = buffer.toString('ascii', 0, 5)
  const isBinary = header !== 'solid'

  const declaredTriangles = isBinary ? binaryStlDeclaredTriangleCount(buffer) : countAsciiFacets(buffer)
  if (declaredTriangles !== null && declaredTriangles > MAX_INGEST_TRIANGLES) {
    throw new Error(
      `Mesh has ${declaredTriangles.toLocaleString()} triangles — the maximum is ` +
      `${MAX_INGEST_TRIANGLES.toLocaleString()}. Please decimate the model and upload again.`,
    )
  }

  try {
    return isBinary ? parseBinarySTL(buffer) : parseASCIISTL(buffer.toString('utf8'))
  } catch (error) {
    logger.error('Failed to parse STL', { error, filePath })
    throw new Error('Failed to parse STL file')
  }
}

/**
 * Parse binary STL format
 */
function parseBinarySTL(buffer: Buffer): ParsedSTL {
  // Binary STL structure:
  // 80 bytes header
  // 4 bytes (uint32) triangle count
  // For each triangle (50 bytes):
  //   - 12 bytes (3 floats) normal vector
  //   - 36 bytes (9 floats) vertices (3 vertices * 3 coords)
  //   - 2 bytes attribute byte count (unused)
  
  const triangleCount = buffer.readUInt32LE(80)
  const triangles: Triangle[] = []
  
  let offset = 84 // Start after header and count
  
  for (let i = 0; i < triangleCount; i++) {
    const normal: Vector3 = {
      x: buffer.readFloatLE(offset),
      y: buffer.readFloatLE(offset + 4),
      z: buffer.readFloatLE(offset + 8)
    }
    offset += 12
    
    const vertices: [Vector3, Vector3, Vector3] = [
      {
        x: buffer.readFloatLE(offset),
        y: buffer.readFloatLE(offset + 4),
        z: buffer.readFloatLE(offset + 8)
      },
      {
        x: buffer.readFloatLE(offset + 12),
        y: buffer.readFloatLE(offset + 16),
        z: buffer.readFloatLE(offset + 20)
      },
      {
        x: buffer.readFloatLE(offset + 24),
        y: buffer.readFloatLE(offset + 28),
        z: buffer.readFloatLE(offset + 32)
      }
    ]
    offset += 36
    
    offset += 2 // Skip attribute byte count
    
    triangles.push({ normal, vertices })
  }
  
  return { triangles, triangleCount, isBinary: true }
}

/**
 * Parse ASCII STL format
 */
function parseASCIISTL(content: string): ParsedSTL {
  const triangles: Triangle[] = []
  const lines = content.split('\n').map(l => l.trim())
  
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    
    if (line.startsWith('facet normal')) {
      // Parse normal
      const normalParts = line.split(/\s+/).slice(2)
      const normal: Vector3 = {
        x: parseFloat(normalParts[0]),
        y: parseFloat(normalParts[1]),
        z: parseFloat(normalParts[2])
      }
      
      // Skip "outer loop"
      i++
      
      // Parse 3 vertices
      const vertices: Vector3[] = []
      for (let j = 0; j < 3; j++) {
        i++
        const vertexLine = lines[i]
        if (vertexLine.startsWith('vertex')) {
          const parts = vertexLine.split(/\s+/).slice(1)
          vertices.push({
            x: parseFloat(parts[0]),
            y: parseFloat(parts[1]),
            z: parseFloat(parts[2])
          })
        }
      }
      
      if (vertices.length === 3) {
        triangles.push({
          normal,
          vertices: vertices as [Vector3, Vector3, Vector3]
        })
      }
      
      // Skip "endloop" and "endfacet"
      i += 2
    }
    
    i++
  }
  
  return { triangles, triangleCount: triangles.length, isBinary: false }
}

// ============================================================================
// GEOMETRY ANALYSIS
// ============================================================================

/**
 * Calculate bounding box (AABB) from STL data
 */
export function calculateAABB(stl: ParsedSTL): AABB {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  
  for (const triangle of stl.triangles) {
    for (const vertex of triangle.vertices) {
      minX = Math.min(minX, vertex.x)
      minY = Math.min(minY, vertex.y)
      minZ = Math.min(minZ, vertex.z)
      maxX = Math.max(maxX, vertex.x)
      maxY = Math.max(maxY, vertex.y)
      maxZ = Math.max(maxZ, vertex.z)
    }
  }
  
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ }
  }
}

/**
 * Calculate footprint (dimensions) from AABB
 */
export function calculateFootprint(aabb: AABB): Footprint {
  return {
    width: Number((aabb.max.x - aabb.min.x).toFixed(2)),
    depth: Number((aabb.max.y - aabb.min.y).toFixed(2)),
    height: Number((aabb.max.z - aabb.min.z).toFixed(2))
  }
}

/**
 * Calculate mesh volume using divergence theorem
 */
function calculateVolume(stl: ParsedSTL): number {
  let volume = 0
  
  for (const triangle of stl.triangles) {
    const [v1, v2, v3] = triangle.vertices
    
    // Calculate signed volume of tetrahedron formed by triangle and origin
    const v321 = v3.x * v2.y * v1.z
    const v231 = v2.x * v3.y * v1.z
    const v312 = v3.x * v1.y * v2.z
    const v132 = v1.x * v3.y * v2.z
    const v213 = v2.x * v1.y * v3.z
    const v123 = v1.x * v2.y * v3.z
    
    volume += (-v321 + v231 + v312 - v132 - v213 + v123) / 6
  }
  
  return Math.abs(volume)
}

/**
 * Calculate surface area
 */
function calculateSurfaceArea(stl: ParsedSTL): number {
  let area = 0
  
  for (const triangle of stl.triangles) {
    const [v1, v2, v3] = triangle.vertices
    
    // Calculate triangle area using cross product
    const edge1 = {
      x: v2.x - v1.x,
      y: v2.y - v1.y,
      z: v2.z - v1.z
    }
    
    const edge2 = {
      x: v3.x - v1.x,
      y: v3.y - v1.y,
      z: v3.z - v1.z
    }
    
    // Cross product
    const cross = {
      x: edge1.y * edge2.z - edge1.z * edge2.y,
      y: edge1.z * edge2.x - edge1.x * edge2.z,
      z: edge1.x * edge2.y - edge1.y * edge2.x
    }
    
    // Magnitude of cross product / 2 = triangle area
    const magnitude = Math.sqrt(cross.x ** 2 + cross.y ** 2 + cross.z ** 2)
    area += magnitude / 2
  }
  
  return area
}

/**
 * Calculate print statistics from STL
 */
export function calculatePrintStats(stl: ParsedSTL, aabb: AABB): PrintStats {
  const volume = calculateVolume(stl)
  const surfaceArea = calculateSurfaceArea(stl)
  
  // Estimate weight (assuming PLA density of 1.24 g/cm³)
  const volumeCm3 = volume / 1000 // Convert mm³ to cm³
  const estimatedWeightG = volumeCm3 * 1.24
  
  // Estimate print time (very rough: 1g takes ~2 minutes at standard quality)
  const estimatedPrintTimeMinutes = estimatedWeightG * 2
  
  return {
    estimated_weight_g: Number(estimatedWeightG.toFixed(2)),
    estimated_print_time_minutes: Number(estimatedPrintTimeMinutes.toFixed(0)),
    surface_area_mm2: Number(surfaceArea.toFixed(2)),
    volume_mm3: Number(volume.toFixed(2)),
    triangle_count: stl.triangleCount
  }
}

// ============================================================================
// STL TO GLB CONVERSION
// ============================================================================

/**
 * Convert parsed STL geometry to a GLB binary using @gltf-transform/core.
 * No external tools required — runs entirely in Node.js.
 */
/**
 * Build a single-primitive glTF Document holding the STL's raw triangle soup.
 *
 * STL uses Z-up (the 3D-printing convention); glTF/GLB is Y-up. Without this
 * conversion the model renders lying on its side. Rotate -90° about X so the
 * STL's +Z becomes glTF's +Y:  (x, y, z) → (x, z, -y). (Blender's glTF exporter
 * does the same; this keeps the pure-Node path consistent with it.)
 *
 * We deliberately do NOT emit the STL's flat per-face normals: they give every
 * triangle its own normals, which blocks welding (every edge becomes a seam) and
 * therefore blocks both decimation and Draco's vertex sharing. Normals are
 * recomputed with a crease angle after welding, in both the preview and the
 * full-fidelity paths.
 *
 * Shared by the decimated preview GLB and the owner full-fidelity GLB so the two
 * can never disagree about orientation or units.
 */
function stlToDocument(Document: any, stl: ParsedSTL): { doc: any; buf: any } {
  const positions = new Float32Array(stl.triangles.length * 9)
  let i = 0
  for (const tri of stl.triangles) {
    for (const v of tri.vertices) {
      positions[i++] = v.x
      positions[i++] = v.z
      positions[i++] = -v.y
    }
  }

  const doc = new Document()
  const buf = doc.createBuffer()

  const posAccessor = doc.createAccessor()
    .setType('VEC3')
    .setArray(positions)
    .setBuffer(buf)

  const prim = doc.createPrimitive()
    .setAttribute('POSITION', posAccessor)

  const mesh = doc.createMesh('mesh').addPrimitive(prim)
  const node = doc.createNode('node').setMesh(mesh)
  const scene = doc.createScene('scene').addChild(node)
  doc.getRoot().setDefaultScene(scene)
  return { doc, buf }
}

async function convertSTLtoGLBPure(stl: ParsedSTL, outputPath: string): Promise<void> {
  const { Document, NodeIO } = await importESM<typeof import('@gltf-transform/core')>('@gltf-transform/core')

  const { doc } = stlToDocument(Document, stl)

  // Shrink the PREVIEW GLB (the STL that buyers download/print is never touched):
  // weld+dedup, decimate to a triangle budget so the planner stays smooth on heavy
  // print-resolution meshes, then Draco-compress (the planner's loader decodes it).
  const io = await optimizeAndBuildIO(NodeIO, doc, stl.triangleCount)
  const glbBytes = await io.writeBinary(doc)

  await writeFile(outputPath, Buffer.from(glbBytes))
  logger.info('STL→GLB conversion complete (pure Node, optimised)', {
    outputPath,
    srcTriangles: stl.triangleCount,
  })
}

// Preview meshes above this get decimated down toward it (print STLs are often
// 100k–1M+ triangles, which crush real-time rendering). Higher = more detail.
const TARGET_PREVIEW_TRIS = Number(process.env.PREVIEW_TARGET_TRIS ?? 80000)
// Edges sharper than this stay hard (crisp); smoother than this get smoothed.
const CREASE_ANGLE_DEG = Number(process.env.PREVIEW_CREASE_ANGLE ?? 45)

/**
 * Rebuild an indexed primitive's normals using a crease angle: a vertex's normal
 * averages only the incident faces within CREASE_ANGLE of that face, so sharp
 * edges stay hard while curved/flat surfaces read smooth. Produces an expanded
 * (per-corner) primitive; a following weld() re-indexes it, keeping crease seams.
 */
function applyCreaseNormals(doc: any, prim: any, angleDeg: number): void {
  const idxAcc = prim.getIndices()
  if (!idxAcc) return
  const pos: Float32Array = prim.getAttribute('POSITION').getArray()
  const idx: ArrayLike<number> = idxAcc.getArray()
  const F = idx.length / 3

  // Per-face unit normals.
  const fN = new Float32Array(F * 3)
  for (let f = 0; f < F; f++) {
    const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2]
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    fN[f * 3] = nx / l; fN[f * 3 + 1] = ny / l; fN[f * 3 + 2] = nz / l
  }

  // Faces incident to each vertex.
  const vFaces = new Map<number, number[]>()
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < 3; k++) {
      const v = idx[f * 3 + k]
      const arr = vFaces.get(v)
      if (arr) arr.push(f); else vFaces.set(v, [f])
    }
  }

  const cosT = Math.cos((angleDeg * Math.PI) / 180)
  const outPos = new Float32Array(F * 9)
  const outNrm = new Float32Array(F * 9)
  for (let f = 0; f < F; f++) {
    const fnx = fN[f * 3], fny = fN[f * 3 + 1], fnz = fN[f * 3 + 2]
    for (let k = 0; k < 3; k++) {
      const v = idx[f * 3 + k]
      let nx = 0, ny = 0, nz = 0
      for (const g of vFaces.get(v)!) {
        const gx = fN[g * 3], gy = fN[g * 3 + 1], gz = fN[g * 3 + 2]
        if (gx * fnx + gy * fny + gz * fnz >= cosT) { nx += gx; ny += gy; nz += gz }
      }
      const l = Math.hypot(nx, ny, nz) || 1
      const o = (f * 3 + k) * 3
      outPos[o] = pos[v * 3]; outPos[o + 1] = pos[v * 3 + 1]; outPos[o + 2] = pos[v * 3 + 2]
      outNrm[o] = nx / l; outNrm[o + 1] = ny / l; outNrm[o + 2] = nz / l
    }
  }

  const b = doc.getRoot().listBuffers()[0]
  prim.setIndices(null)
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(outPos).setBuffer(b))
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(outNrm).setBuffer(b))
}

/**
 * Run the lossy-but-near-identical preview optimisation on the document and
 * return a NodeIO configured to write Draco-compressed GLB.
 * - weld: index the mesh (STL verts are unshared) so it can be simplified.
 * - simplify: decimate toward TARGET_PREVIEW_TRIS with a small error bound.
 * - dedup: drop any duplicate accessors/meshes.
 * - Draco: compress the geometry (KHRDracoMeshCompression; decoder is at /draco/).
 */
async function optimizeAndBuildIO(NodeIO: any, doc: any, triangleCount: number): Promise<any> {
  const { weld, simplify, dedup } = await importESM<typeof import('@gltf-transform/functions')>(
    '@gltf-transform/functions',
  )
  const meshopt: any = await importESM('meshoptimizer')
  const MeshoptSimplifier = meshopt.MeshoptSimplifier ?? meshopt.default?.MeshoptSimplifier
  if (MeshoptSimplifier?.ready) await MeshoptSimplifier.ready

  const transforms: any[] = [weld()]
  if (triangleCount > TARGET_PREVIEW_TRIS && MeshoptSimplifier) {
    transforms.push(
      simplify({ simplifier: MeshoptSimplifier, ratio: TARGET_PREVIEW_TRIS / triangleCount, error: 0.004 }),
    )
  }
  await doc.transform(...transforms)

  // Rebuild normals with a crease angle so sharp edges stay crisp (pure smooth
  // shading over-softened the models), then weld+dedup to re-index for Draco —
  // crease seams keep distinct normals, so hard edges survive.
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) applyCreaseNormals(doc, prim, CREASE_ANGLE_DEG)
  }
  await doc.transform(weld(), dedup())

  const { KHRDracoMeshCompression } = await importESM<typeof import('@gltf-transform/extensions')>(
    '@gltf-transform/extensions',
  )
  doc.createExtension(KHRDracoMeshCompression).setRequired(true)

  const draco3dMod: any = await importESM('draco3dgltf')
  const draco3d = draco3dMod.default ?? draco3dMod
  return new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({ 'draco3d.encoder': await draco3d.createEncoderModule() })
}

// ============================================================================
// OWNER GLB (buyer/artist/admin only)
// ============================================================================
// A buyer already holds the STL, so there is nothing left to protect from them:
// they get a much higher-fidelity mesh than the public preview, with no
// watermark. This is the same STL→GLB conversion as the preview above, with:
//
//   - a MUCH LIGHTER simplify(): only meshes denser than OWNER_GLB_TARGET_TRIS
//     get decimated at all (most listings never hit it and pass through with
//     every triangle intact), and when it does trigger it aims for a budget
//     several times the public preview's, at a much tighter error bound — so an
//     owner still sees visibly more detail than a buyer who hasn't purchased,
//     without the framerate a genuinely unbounded million-triangle mesh cost
//     the planner (see FULL_GLB_MAX_TRIS above this used to make "unbounded" a
//     real possibility for outlier uploads).
//   - NO watermark: the emboss lives in the Blender bake (blender/bake_proxy.py),
//     which this path never touches.
//
// weld() merges only BITWISE-IDENTICAL vertices, so on its own it changes vertex
// *sharing*, never vertex positions. Draco is the other approximation: it
// quantizes coordinates to a fixed grid over the mesh bounding box. At the
// default 14 bits a 300 mm model lands on an ~18 µm grid; POSITION is raised to
// 16 bits here (~4.6 µm on the same model), which is far below both FDM and
// resin resolution — and this GLB is a *viewer* asset, not a printable
// deliverable. The STL the buyer downloads is untouched by all of it, always.

/** Draco POSITION quantization for the owner GLB. 16 ≈ 4.6 µm on a 300 mm model. */
const FULL_GLB_POSITION_BITS = Number(process.env.FULL_GLB_POSITION_BITS ?? 16)

/**
 * Triangle budget for the owner GLB. A mesh at or under this passes through with
 * every triangle intact (true "full fidelity") — the overwhelming majority of
 * listings never approach it. Only denser meshes get decimated, and only down
 * toward this number, which defaults to several times the public preview's
 * budget (PREVIEW_TARGET_TRIS) so a buyer's copy is still visibly more detailed
 * than what a non-owner sees.
 */
const OWNER_GLB_TARGET_TRIS = Number(process.env.FULL_GLB_TARGET_TRIS ?? TARGET_PREVIEW_TRIS * 3)
/**
 * Simplifier error bound for the owner GLB's light decimation — much tighter
 * than the public preview's 0.004 (which has to hit a small budget from
 * anything up to 1M+ source triangles) since this only ever trims the excess
 * above OWNER_GLB_TARGET_TRIS.
 */
const OWNER_GLB_SIMPLIFY_ERROR = Number(process.env.FULL_GLB_SIMPLIFY_ERROR ?? 0.001)

/** Sum of triangle counts across every primitive in the document. */
function countTriangles(doc: any): number {
  let n = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices()
      const pos = prim.getAttribute('POSITION')
      n += (idx ? idx.getCount() : pos.getCount()) / 3
    }
  }
  return n
}

export interface FullGlbResult {
  /** Triangles actually written to the GLB, after any light decimation. */
  triangles: number
  /** Triangles in the source STL, before decimation. */
  sourceTriangles: number
  /** Size of the Draco-compressed GLB in bytes. */
  bytes: number
}

/**
 * Convert a canonical STL to an un-watermarked, near-full-fidelity GLB — every
 * triangle survives unless the source is denser than OWNER_GLB_TARGET_TRIS, in
 * which case it's lightly decimated toward that budget (still well above the
 * public preview's).
 *
 * Returns the triangle counts and output size so the caller can record them; the
 * caller decides where the bytes go (they are owner-gated, so never a public key).
 */
export async function convertSTLtoGLBFull(
  stlPath: string,
  outputPath: string,
): Promise<FullGlbResult> {
  const { Document, NodeIO } = await importESM<typeof import('@gltf-transform/core')>('@gltf-transform/core')
  const { weld, dedup, simplify } = await importESM<typeof import('@gltf-transform/functions')>(
    '@gltf-transform/functions',
  )

  const stl = await parseSTL(stlPath)
  const { doc } = stlToDocument(Document, stl)

  // Index the mesh (STL verts are unshared) before anything else can act on it.
  await doc.transform(weld())

  // Light decimation: only meshes denser than the owner budget get touched, and
  // with a much tighter error bound than the public preview uses (that one has to
  // hit a small budget from anything up to 1M+ source triangles; this one only
  // ever trims the excess above a much larger number). Most listings are already
  // under budget and this is a no-op for them — true full fidelity.
  if (stl.triangleCount > OWNER_GLB_TARGET_TRIS) {
    const meshopt: any = await importESM('meshoptimizer')
    const MeshoptSimplifier = meshopt.MeshoptSimplifier ?? meshopt.default?.MeshoptSimplifier
    if (MeshoptSimplifier?.ready) await MeshoptSimplifier.ready
    if (MeshoptSimplifier) {
      await doc.transform(
        simplify({
          simplifier: MeshoptSimplifier,
          ratio: OWNER_GLB_TARGET_TRIS / stl.triangleCount,
          error: OWNER_GLB_SIMPLIFY_ERROR,
        }),
      )
    }
  }

  // Rebuild normals with the same crease angle the preview uses so an owner's
  // model doesn't suddenly shade differently from the one they were looking at
  // before they bought it. The following weld re-indexes the crease-expanded
  // primitive; crease seams keep their distinct normals, so hard edges survive.
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) applyCreaseNormals(doc, prim, CREASE_ANGLE_DEG)
  }
  await doc.transform(weld(), dedup())

  const outputTriangles = countTriangles(doc)

  const { KHRDracoMeshCompression } = await importESM<typeof import('@gltf-transform/extensions')>(
    '@gltf-transform/extensions',
  )
  doc.createExtension(KHRDracoMeshCompression)
    .setRequired(true)
    .setEncoderOptions({
      // Higher position precision than the preview default (14): this mesh is
      // meant to read as "the actual model", so the quantization grid should be
      // well under anything a printer could resolve.
      quantizationBits: { POSITION: FULL_GLB_POSITION_BITS, NORMAL: 10, TEX_COORD: 12 },
    })

  const draco3dMod: any = await importESM('draco3dgltf')
  const draco3d = draco3dMod.default ?? draco3dMod
  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({ 'draco3d.encoder': await draco3d.createEncoderModule() })

  const glbBytes = await io.writeBinary(doc)
  await writeFile(outputPath, Buffer.from(glbBytes))

  logger.info('STL→GLB conversion complete (owner copy)', {
    outputPath,
    sourceTriangles: stl.triangleCount,
    triangles: outputTriangles,
    decimated: outputTriangles < stl.triangleCount,
    bytes: glbBytes.byteLength,
  })
  return { triangles: outputTriangles, sourceTriangles: stl.triangleCount, bytes: glbBytes.byteLength }
}

/**
 * Convert STL file to GLB. Tries pure Node.js conversion first;
 * falls back to Blender CLI if available and pure conversion fails.
 */
export async function convertSTLtoGLB(stlPath: string, outputPath: string): Promise<void> {
  try {
    const stl = await parseSTL(stlPath)
    await convertSTLtoGLBPure(stl, outputPath)
    return
  } catch (pureError) {
    logger.warn('Pure Node STL→GLB failed, trying Blender', { error: pureError })
  }

  if (!HAS_BLENDER) {
    throw new Error('STL→GLB conversion failed: pure Node conversion failed and Blender is not available')
  }

  try {
    const script = `
import bpy, sys
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
bpy.ops.import_mesh.stl(filepath="${stlPath.replace(/\\/g, '/')}")
obj = bpy.context.selected_objects[0]
bpy.context.view_layer.objects.active = obj
bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
obj.location = (0, 0, 0)
bpy.ops.export_scene.gltf(filepath="${outputPath.replace(/\\/g, '/')}", export_format='GLB', use_selection=True, export_apply=True)
sys.exit(0)
`
    const scriptPath = path.join(STORAGE_PATHS.temp, `convert_${Date.now()}.py`)
    await writeFile(scriptPath, script)
    await execAsync(`"${BLENDER_PATH}" --background --python "${scriptPath}"`, { timeout: 60000 })
    try { await execAsync(`del "${scriptPath}"`) } catch {}
    logger.info('STL→GLB conversion complete (Blender)', { outputPath })
  } catch (blenderError) {
    logger.error('Blender STL→GLB conversion failed', { error: blenderError, stlPath })
    throw new Error('Failed to convert STL to GLB')
  }
}

// ============================================================================
// THUMBNAIL GENERATION
// ============================================================================

/**
 * Generate thumbnail image from GLB file
 */
export async function generateThumbnail(
  glbPath: string,
  outputPath: string,
  size = 512
): Promise<void> {
  if (!HAS_BLENDER) {
    logger.warn('Blender not available - cannot generate thumbnail')
    throw new Error('Blender required for thumbnail generation')
  }
  
  try {
    const script = `
import bpy
import sys

# Clear scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# Import GLB
bpy.ops.import_scene.gltf(filepath="${glbPath}")

# Set up camera
cam_data = bpy.data.cameras.new('Camera')
cam = bpy.data.objects.new('Camera', cam_data)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

# Position camera to frame object
obj = bpy.context.selected_objects[0]
cam.location = (obj.dimensions.x * 2, -obj.dimensions.y * 2, obj.dimensions.z * 1.5)
cam.rotation_euler = (1.1, 0, 0.785)

# Set up lighting
light_data = bpy.data.lights.new('Light', 'SUN')
light = bpy.data.objects.new('Light', light_data)
bpy.context.scene.collection.objects.link(light)
light.location = (5, -5, 10)

# Render settings
bpy.context.scene.render.resolution_x = ${size}
bpy.context.scene.render.resolution_y = ${size}
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.context.scene.render.filepath = "${outputPath}"

# Render
bpy.ops.render.render(write_still=True)

print("Thumbnail generated")
sys.exit(0)
`
    
    const scriptPath = path.join(STORAGE_PATHS.temp, `thumb_${Date.now()}.py`)
    await writeFile(scriptPath, script)
    
    await execAsync(
      `${BLENDER_PATH} --background --python "${scriptPath}"`,
      { timeout: 60000 }
    )
    
    await execAsync(`rm "${scriptPath}"`)
    
    logger.info('Thumbnail generated', { glbPath, outputPath })
  } catch (error) {
    logger.error('Thumbnail generation failed', { error, glbPath })
    throw new Error('Failed to generate thumbnail')
  }
}

// ============================================================================
// COMPLETE FILE PROCESSING PIPELINE
// ============================================================================

export interface ProcessFileResult {
  success: boolean
  file_hash?: string
  file_paths?: FilePaths
  aabb?: AABB
  footprint?: Footprint
  print_stats?: PrintStats
  error?: string
}

/**
 * Process uploaded STL file - complete pipeline
 */
export async function processSTLFile(
  stlPath: string,
  artistId: string,
  assetId: string
): Promise<ProcessFileResult> {
  const processingLogger = logger.child('FILE_PROCESSOR')

  try {
    processingLogger.info('Starting STL processing', { stlPath, artistId, assetId })

    // 1. Hash raw bytes for duplicate detection
    const rawBuffer = await readFile(stlPath)
    const file_hash = computeFileHash(rawBuffer)
    processingLogger.debug('File hash computed', { file_hash })

    // 2. Parse STL
    processingLogger.debug('Parsing STL...')
    const stl = await parseSTL(stlPath)
    processingLogger.debug(`Parsed ${stl.triangleCount} triangles`)
    
    // 3. Calculate geometry
    processingLogger.debug('Calculating geometry...')
    const aabb = calculateAABB(stl)
    const footprint = calculateFootprint(aabb)
    const printStats = calculatePrintStats(stl, aabb)
    
    // 4. Convert to GLB
    processingLogger.debug('Converting to GLB...')
    const glbFilename = `${assetId}.glb`
    const glbPath = path.join(STORAGE_PATHS.models, artistId, assetId, glbFilename)
    
    try {
      await convertSTLtoGLB(stlPath, glbPath)
    } catch (error) {
      processingLogger.warn('GLB conversion failed, will use STL as fallback', { error })
    }
    
    // 5. Generate thumbnail
    processingLogger.debug('Generating thumbnail...')
    const thumbFilename = `${assetId}_thumb.png`
    const thumbPath = path.join(STORAGE_PATHS.thumbnails, artistId, assetId, thumbFilename)
    
    try {
      await generateThumbnail(glbPath, thumbPath)
    } catch (error) {
      processingLogger.warn('Thumbnail generation failed', { error })
    }
    
    // 6. Build file paths
    const filePaths: FilePaths = {
      stl: path.relative(STORAGE_PATHS.models, stlPath),
      glb: path.relative(STORAGE_PATHS.models, glbPath),
      thumbnail: path.relative(STORAGE_PATHS.thumbnails, thumbPath)
    }
    
    processingLogger.info('STL processing completed successfully', {
      triangles: stl.triangleCount,
      volume: printStats.volume_mm3,
      weight: printStats.estimated_weight_g
    })
    
    return {
      success: true,
      file_hash,
      file_paths: filePaths,
      aabb,
      footprint,
      print_stats: printStats
    }
  } catch (error) {
    processingLogger.error('STL processing failed', { error, stlPath })
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Backward-compatible helpers expected by some routes
export async function processSTL(stlPath: string): Promise<{
  volume: number
  surfaceArea: number
  dimensions: { x: number; y: number; z: number }
  needsSupports: boolean
}> {
  const stl = await parseSTL(stlPath)
  const aabb = calculateAABB(stl)
  const footprint = calculateFootprint(aabb)
  const stats = calculatePrintStats(stl, aabb)
  return {
    volume: stats.volume_mm3 ?? 0,
    surfaceArea: stats.surface_area_mm2 ?? 0,
    dimensions: { x: footprint.width, y: footprint.depth, z: footprint.height },
    needsSupports: false,
  }
}

export async function generateGLB(stlPath: string): Promise<string> {
  const out = stlPath.replace(/\.stl$/i, '.glb')
  await convertSTLtoGLB(stlPath, out) // throws on failure — caller handles
  return out
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  parseSTL,
  calculateAABB,
  calculateFootprint,
  calculatePrintStats,
  convertSTLtoGLB,
  processSTL,
  generateGLB,
  generateThumbnail,
  processSTLFile
}
