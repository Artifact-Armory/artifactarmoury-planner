// backend/src/services/fileProcessor.ts
import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
import { Document, NodeIO, Primitive } from '@gltf-transform/core'
import { dedup, prune, quantize, weld, draco } from '@gltf-transform/functions'
import logger from '../utils/logger'
import { STORAGE_PATHS } from './storage'
import type { AABB, Footprint, PrintStats, FilePaths, Vector3 } from '../types/shared'
import { PNG } from 'pngjs'

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
 * Parse STL file (supports both ASCII and binary formats)
 */
export async function parseSTL(filePath: string): Promise<ParsedSTL> {
  try {
    const buffer = await readFile(filePath)
    
    // Check if binary or ASCII
    const header = buffer.toString('ascii', 0, 5)
    const isBinary = header !== 'solid'
    
    if (isBinary) {
      return parseBinarySTL(buffer)
    } else {
      return parseASCIISTL(buffer.toString('utf8'))
    }
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
 *
 * STL files are typically in millimeters, but the frontend expects dimensions
 * in meters. This function converts from mm to meters (divide by 1000).
 */
export function calculateFootprint(aabb: AABB): Footprint {
  // Convert from millimeters to meters (divide by 1000)
  const MM_TO_METERS = 0.001

  return {
    width: Number(((aabb.max.x - aabb.min.x) * MM_TO_METERS).toFixed(4)),
    depth: Number(((aabb.max.y - aabb.min.y) * MM_TO_METERS).toFixed(4)),
    height: Number(((aabb.max.z - aabb.min.z) * MM_TO_METERS).toFixed(4))
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
// MESH DECIMATION (SIMPLIFICATION)
// ============================================================================

/**
 * Decimate (simplify) mesh by removing triangles
 *
 * @param stl - Parsed STL data
 * @param decimationLevel - Percentage to remove (0-90, where 90 = remove 90% of triangles)
 * @returns Decimated STL with reduced triangle count
 *
 * Uses a simple but effective approach:
 * - Sorts triangles by area (removes smallest first)
 * - Preserves overall shape while reducing complexity
 * - Suitable for tabletop terrain where small details are less critical
 */
function decimateMesh(stl: ParsedSTL, decimationLevel: number): ParsedSTL {
  if (decimationLevel <= 0 || decimationLevel >= 100) {
    return stl
  }

  // Calculate triangle areas and sort by size
  const trianglesWithArea = stl.triangles.map((triangle, index) => {
    const [v1, v2, v3] = triangle.vertices
    const edge1 = { x: v2.x - v1.x, y: v2.y - v1.y, z: v2.z - v1.z }
    const edge2 = { x: v3.x - v1.x, y: v3.y - v1.y, z: v3.z - v1.z }
    const cross = {
      x: edge1.y * edge2.z - edge1.z * edge2.y,
      y: edge1.z * edge2.x - edge1.x * edge2.z,
      z: edge1.x * edge2.y - edge1.y * edge2.x,
    }
    const area = Math.sqrt(cross.x ** 2 + cross.y ** 2 + cross.z ** 2) / 2
    return { triangle, area, index }
  })

  // Sort by area (smallest first)
  trianglesWithArea.sort((a, b) => a.area - b.area)

  // Calculate how many triangles to keep
  const targetCount = Math.ceil(stl.triangleCount * (1 - decimationLevel / 100))
  const trianglesToKeep = trianglesWithArea.slice(-targetCount)

  // Sort back to original order to maintain consistency
  trianglesToKeep.sort((a, b) => a.index - b.index)

  return {
    triangles: trianglesToKeep.map(t => t.triangle),
    triangleCount: trianglesToKeep.length,
    isBinary: stl.isBinary,
  }
}

// ============================================================================
// STL TO GLB CONVERSION
// ============================================================================

/**
 * Convert STL geometry to a GLB using @gltf-transform in-process.
 *
 * Compression pipeline:
 * 1. Weld: Merge nearby vertices (tolerance 1e-3)
 * 2. Dedup: Remove duplicate data
 * 3. Quantize: Reduce precision (10-bit positions, 8-bit normals)
 * 4. Prune: Remove unused buffers
 * 5. Draco: Apply mesh compression (optional, high compression)
 *
 * @param stlInput - STL file path or parsed STL data
 * @param outputPath - Output GLB file path
 * @param options - Compression options
 */
export async function convertSTLtoGLB(
  stlInput: string | ParsedSTL,
  outputPath: string,
  options?: {
    enableDraco?: boolean
    dracoCompressionLevel?: number // 0-10, default 7 (high compression)
  }
): Promise<void> {
  try {
    const stl = typeof stlInput === 'string' ? await parseSTL(stlInput) : stlInput

    if (!stl || stl.triangleCount === 0) {
      throw new Error('STL contains no geometry')
    }

    await mkdir(path.dirname(outputPath), { recursive: true })

    const document = new Document()
    const buffer = document.createBuffer('terrain-buffer')
    const scene = document.createScene('Scene')

    const vertexCount = stl.triangleCount * 3
    const positions = new Float32Array(vertexCount * 3)
    const normals = new Float32Array(vertexCount * 3)
    const IndexArrayCtor = vertexCount > 65_535 ? Uint32Array : Uint16Array
    const indices = new IndexArrayCtor(vertexCount)

    // Convert from millimeters to meters (divide by 1000)
    // STL files are typically in millimeters, but the frontend expects meters
    const MM_TO_METERS = 0.001

    let cursor = 0
    for (const triangle of stl.triangles) {
      const [v0, v1, v2] = triangle.vertices

      const edge1 = {
        x: v1.x - v0.x,
        y: v1.y - v0.y,
        z: v1.z - v0.z,
      }
      const edge2 = {
        x: v2.x - v0.x,
        y: v2.y - v0.y,
        z: v2.z - v0.z,
      }

      let nx = edge1.y * edge2.z - edge1.z * edge2.y
      let ny = edge1.z * edge2.x - edge1.x * edge2.z
      let nz = edge1.x * edge2.y - edge1.y * edge2.x

      let length = Math.hypot(nx, ny, nz)

      if (length === 0 || !Number.isFinite(length)) {
        nx = triangle.normal.x
        ny = triangle.normal.y
        nz = triangle.normal.z
        length = Math.hypot(nx, ny, nz) || 1
      }

      const invLength = length > 0 ? 1 / length : 1
      nx *= invLength
      ny *= invLength
      nz *= invLength

      for (const vertex of triangle.vertices) {
        // Swap Y and Z axes: Blender uses Z-up, glTF uses Y-up
        // Also scale from millimeters to meters
        positions[cursor * 3 + 0] = vertex.x * MM_TO_METERS
        positions[cursor * 3 + 1] = vertex.z * MM_TO_METERS
        positions[cursor * 3 + 2] = vertex.y * MM_TO_METERS

        normals[cursor * 3 + 0] = nx
        normals[cursor * 3 + 1] = nz
        normals[cursor * 3 + 2] = ny

        indices[cursor] = cursor
        cursor += 1
      }
    }

    const positionAccessor = document
      .createAccessor('positions')
      .setType('VEC3')
      .setArray(positions)
      .setBuffer(buffer)

    const normalAccessor = document
      .createAccessor('normals')
      .setType('VEC3')
      .setArray(normals)
      .setBuffer(buffer)

    const indexAccessor = document
      .createAccessor('indices')
      .setType('SCALAR')
      .setArray(indices)
      .setBuffer(buffer)

    const material = document
      .createMaterial('Default')
      .setBaseColorFactor([0.82, 0.82, 0.82, 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(0.85)

    const primitive = document
      .createPrimitive()
      .setAttribute('POSITION', positionAccessor)
      .setAttribute('NORMAL', normalAccessor)
      .setIndices(indexAccessor)
      .setMaterial(material)
      .setMode(Primitive.Mode.TRIANGLES)

    const mesh = document.createMesh('TerrainMesh').addPrimitive(primitive)
    const node = document.createNode('Terrain').setMesh(mesh)
    scene.addChild(node)
    document.getRoot().setDefaultScene(scene)

    // Apply compression pipeline
    const transformations = [
      weld({ tolerance: 0.0001 }),  // Merge vertices within 0.1mm (0.0001m)
      dedup(),                      // Remove duplicate data
      quantize({
        quantizePosition: 10,       // drop precision slightly for smaller payload
        quantizeNormal: 7,
        quantizeTexcoord: 8,
        quantizeColor: 8,
      }),
      prune(),                      // Remove unused buffers
    ]

    // Add Draco compression if enabled (default: enabled)
    const enableDraco = options?.enableDraco !== false
    const dracoLevel = options?.dracoCompressionLevel ?? 9

    if (enableDraco) {
      // Draco compression: highly effective for mesh data
      // Level 7 = high compression with reasonable speed
      // Achieves 85-95% additional reduction on top of quantization
      transformations.push(
        draco({
          method: 'edgebreaker',      // Best compression method
          encodeSpeed: 10 - dracoLevel, // 0-10 (lower = slower but better compression)
          decodeSpeed: 5,              // Decoder speed (less critical)
        })
      )
    }

    await document.transform(...transformations)

    // Write GLB binary
    const io = new NodeIO()
    const glbBinary = await io.writeBinary(document)
    await writeFile(outputPath, Buffer.from(glbBinary))

    logger.info('STL to GLB conversion successful', {
      outputPath,
      triangles: stl.triangleCount,
      vertices: vertexCount,
      dracoEnabled: enableDraco,
      dracoLevel: dracoLevel,
    })
  } catch (error) {
    logger.error('STL to GLB conversion failed', { error, outputPath })
    throw new Error('Failed to convert STL to GLB')
  }
}

// ============================================================================
// THUMBNAIL GENERATION
// ============================================================================

/**
 * Generate a top-down shaded thumbnail from STL geometry.
 */
export async function generateThumbnailFromSTL(
  stl: ParsedSTL,
  outputPath: string,
  size = 512
): Promise<void> {
  if (!stl || stl.triangleCount === 0) {
    throw new Error('Cannot generate thumbnail from empty STL')
  }

  const aabb = calculateAABB(stl)
  const width = Math.max(aabb.max.x - aabb.min.x, 1e-6)
  const depth = Math.max(aabb.max.y - aabb.min.y, 1e-6)
  const height = Math.max(aabb.max.z - aabb.min.z, 1e-6)

  await mkdir(path.dirname(outputPath), { recursive: true })

  const png = new PNG({ width: size, height: size })
  const zBuffer = new Float32Array(size * size).fill(Number.NEGATIVE_INFINITY)

  const toPixel = (x: number, y: number) => ({
    px: ((x - aabb.min.x) / width) * (size - 1),
    py: ((y - aabb.min.y) / depth) * (size - 1),
  })

  const testTriangle = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
  ) => {
    const v0x = bx - ax
    const v0y = by - ay
    const v1x = cx - ax
    const v1y = cy - ay
    const v2x = px - ax
    const v2y = py - ay

    const d00 = v0x * v0x + v0y * v0y
    const d01 = v0x * v1x + v0y * v1y
    const d11 = v1x * v1x + v1y * v1y
    const d20 = v2x * v0x + v2y * v0y
    const d21 = v2x * v1x + v2y * v1y
    const denom = d00 * d11 - d01 * d01

    if (denom === 0) {
      return { inside: false, u: 0, v: 0 }
    }

    const invDenom = 1 / denom
    const v = (d11 * d20 - d01 * d21) * invDenom
    const w = (d00 * d21 - d01 * d20) * invDenom
    const u = 1 - v - w
    const inside = u >= 0 && v >= 0 && w >= 0
    return { inside, u, v, w }
  }

  const clamp = (value: number) => Math.max(0, Math.min(size - 1, value))

  for (const triangle of stl.triangles) {
    const [a, b, c] = triangle.vertices
    const pa = toPixel(a.x, a.y)
    const pb = toPixel(b.x, b.y)
    const pc = toPixel(c.x, c.y)

    const minX = Math.floor(clamp(Math.min(pa.px, pb.px, pc.px)))
    const maxX = Math.ceil(clamp(Math.max(pa.px, pb.px, pc.px)))
    const minY = Math.floor(clamp(Math.min(pa.py, pb.py, pc.py)))
    const maxY = Math.ceil(clamp(Math.max(pa.py, pb.py, pc.py)))

    for (let iy = minY; iy <= maxY; iy++) {
      for (let ix = minX; ix <= maxX; ix++) {
        const { inside, u, v, w } = testTriangle(ix + 0.5, iy + 0.5, pa.px, pa.py, pb.px, pb.py, pc.px, pc.py)
        if (!inside) continue

        const interpolatedZ = u * a.z + v * b.z + w * c.z
        const bufferIndex = (size - 1 - iy) * size + ix
        if (interpolatedZ > zBuffer[bufferIndex]) {
          zBuffer[bufferIndex] = interpolatedZ
        }
      }
    }
  }

  const data = png.data
  const minZ = aabb.min.z
  for (let i = 0; i < size * size; i++) {
    const z = zBuffer[i]
    const offset = i * 4
    if (z === Number.NEGATIVE_INFINITY) {
      data[offset + 0] = 18
      data[offset + 1] = 22
      data[offset + 2] = 30
      data[offset + 3] = 255
      continue
    }
    const normalized = Math.min(Math.max((z - minZ) / height, 0), 1)
    const brightness = Math.round(60 + normalized * 180)
    data[offset + 0] = brightness
    data[offset + 1] = brightness
    data[offset + 2] = brightness
    data[offset + 3] = 255
  }

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(outputPath)
    stream.on('finish', resolve)
    stream.on('error', reject)
    png.pack().pipe(stream)
  })

  logger.info('Thumbnail generated', { outputPath })
}

// ============================================================================
// COMPRESSION STATISTICS
// ============================================================================

export interface CompressionStats {
  originalStlSize: number           // Original STL file size in bytes
  afterDecimation?: number          // Size after decimation (if applied)
  glbBeforeDraco: number            // GLB size before Draco compression
  glbAfterDraco: number             // GLB size after Draco compression
  estimatedDownloadSize: number     // Estimated size with Brotli compression
  decimationLevel?: number          // Decimation percentage applied (0-90)
  triangleCountBefore: number       // Triangle count before decimation
  triangleCountAfter: number        // Triangle count after decimation
  compressionRatio: number          // Final size / original size (0-1)
  downloadCompressionRatio: number  // Download size / original size (0-1)
}

// ============================================================================
// GLB TO STL CONVERSION (For customer downloads)
// ============================================================================

/**
 * Convert GLB file back to STL format for customer downloads
 *
 * @param glbPath - Path to GLB file
 * @param outputPath - Path where STL will be saved
 */
export async function convertGLBtoSTL(glbPath: string, outputPath: string): Promise<void> {
  try {
    const io = new NodeIO()
    const document = await io.read(glbPath)

    // Extract all mesh data
    const triangles: Triangle[] = []

    // Traverse all meshes in the document
    for (const mesh of document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const positionAccessor = primitive.getAttribute('POSITION')
        const indexAccessor = primitive.getIndices()

        if (!positionAccessor) continue

        const positions = positionAccessor.getArray() as Float32Array
        const indices = indexAccessor?.getArray() as (Uint32Array | Uint16Array) | undefined

        // If no indices, use positions directly
        if (!indices) {
          for (let i = 0; i < positions.length; i += 9) {
            const v1 = { x: positions[i], y: positions[i + 1], z: positions[i + 2] }
            const v2 = { x: positions[i + 3], y: positions[i + 4], z: positions[i + 5] }
            const v3 = { x: positions[i + 6], y: positions[i + 7], z: positions[i + 8] }

            // Calculate normal
            const e1 = { x: v2.x - v1.x, y: v2.y - v1.y, z: v2.z - v1.z }
            const e2 = { x: v3.x - v1.x, y: v3.y - v1.y, z: v3.z - v1.z }

            let nx = e1.y * e2.z - e1.z * e2.y
            let ny = e1.z * e2.x - e1.x * e2.z
            let nz = e1.x * e2.y - e1.y * e2.x

            const length = Math.hypot(nx, ny, nz)
            if (length > 0) {
              nx /= length
              ny /= length
              nz /= length
            }

            triangles.push({
              normal: { x: nx, y: ny, z: nz },
              vertices: [v1, v2, v3]
            })
          }
        } else {
          // Use indices to build triangles
          for (let i = 0; i < indices.length; i += 3) {
            const i1 = indices[i] * 3
            const i2 = indices[i + 1] * 3
            const i3 = indices[i + 2] * 3

            const v1 = { x: positions[i1], y: positions[i1 + 1], z: positions[i1 + 2] }
            const v2 = { x: positions[i2], y: positions[i2 + 1], z: positions[i2 + 2] }
            const v3 = { x: positions[i3], y: positions[i3 + 1], z: positions[i3 + 2] }

            // Calculate normal
            const e1 = { x: v2.x - v1.x, y: v2.y - v1.y, z: v2.z - v1.z }
            const e2 = { x: v3.x - v1.x, y: v3.y - v1.y, z: v3.z - v1.z }

            let nx = e1.y * e2.z - e1.z * e2.y
            let ny = e1.z * e2.x - e1.x * e2.z
            let nz = e1.x * e2.y - e1.y * e2.x

            const length = Math.hypot(nx, ny, nz)
            if (length > 0) {
              nx /= length
              ny /= length
              nz /= length
            }

            triangles.push({
              normal: { x: nx, y: ny, z: nz },
              vertices: [v1, v2, v3]
            })
          }
        }
      }
    }

    // Write binary STL
    const triangleCount = triangles.length
    const buffer = Buffer.alloc(84 + triangleCount * 50)

    // Header (80 bytes)
    buffer.write('Converted from GLB by Artifact Armoury', 0, 80, 'ascii')

    // Triangle count (4 bytes, little-endian)
    buffer.writeUInt32LE(triangleCount, 80)

    // Write triangles
    let offset = 84
    for (const triangle of triangles) {
      // Normal (3 floats)
      buffer.writeFloatLE(triangle.normal.x, offset)
      buffer.writeFloatLE(triangle.normal.y, offset + 4)
      buffer.writeFloatLE(triangle.normal.z, offset + 8)
      offset += 12

      // Vertices (3 vertices × 3 floats each)
      for (const vertex of triangle.vertices) {
        buffer.writeFloatLE(vertex.x, offset)
        buffer.writeFloatLE(vertex.y, offset + 4)
        buffer.writeFloatLE(vertex.z, offset + 8)
        offset += 12
      }

      // Attribute byte count (2 bytes, always 0)
      buffer.writeUInt16LE(0, offset)
      offset += 2
    }

    await writeFile(outputPath, buffer)
    logger.info('GLB to STL conversion successful', { glbPath, outputPath, triangles: triangleCount })
  } catch (error) {
    logger.error('GLB to STL conversion failed', { error, glbPath, outputPath })
    throw new Error('Failed to convert GLB to STL')
  }
}

// ============================================================================
// COMPLETE FILE PROCESSING PIPELINE
// ============================================================================

export interface ProcessFileResult {
  success: boolean
  file_paths?: FilePaths
  aabb?: AABB
  footprint?: Footprint
  print_stats?: PrintStats
  compression_stats?: CompressionStats
  error?: string
}

/**
 * Process uploaded STL file - complete pipeline with compression
 *
 * @param stlPath - Path to uploaded STL file
 * @param artistId - Artist ID for file organization
 * @param assetId - Asset ID for file naming
 * @param options - Processing options
 */
export async function processSTLFile(
  stlPath: string,
  artistId: string,
  assetId: string,
  options?: {
    decimationLevel?: number  // 0-90, default 0 (no decimation)
    enableDraco?: boolean     // default true
    dracoLevel?: number       // 0-10, default 7
  }
): Promise<ProcessFileResult> {
  const processingLogger = logger.child('FILE_PROCESSOR')

  try {
    processingLogger.info('Starting STL processing', { stlPath, artistId, assetId, options })

    // Get original STL file size
    const stlStats = await stat(stlPath)
    const originalStlSize = stlStats.size

    // 1. Parse STL
    processingLogger.debug('Parsing STL...')
    let stl = await parseSTL(stlPath)
    const triangleCountBefore = stl.triangleCount
    processingLogger.debug(`Parsed ${stl.triangleCount} triangles`)

    // 2. Apply decimation if requested
    let decimationLevel = options?.decimationLevel ?? 0
    if (decimationLevel > 0 && decimationLevel < 100) {
      processingLogger.debug(`Applying decimation: ${decimationLevel}%`)
      stl = decimateMesh(stl, decimationLevel)
      processingLogger.debug(`After decimation: ${stl.triangleCount} triangles (${((1 - stl.triangleCount / triangleCountBefore) * 100).toFixed(1)}% removed)`)
    }

    // 3. Calculate geometry (on decimated mesh if applicable)
    processingLogger.debug('Calculating geometry...')
    const aabb = calculateAABB(stl)
    const footprint = calculateFootprint(aabb)
    const printStats = calculatePrintStats(stl, aabb)

    // 4. Convert to GLB with compression
    processingLogger.debug('Converting to GLB with compression...')
    const glbFilename = `${assetId}.glb`
    const glbPath = path.join(STORAGE_PATHS.models, artistId, assetId, glbFilename)

    let glbBeforeDracoSize = 0
    let glbAfterDracoSize = 0

    try {
      // First pass: GLB without Draco to measure size
      const tempGlbPath = glbPath + '.tmp'
      await convertSTLtoGLB(stl, tempGlbPath, { enableDraco: false })
      const tempStats = await stat(tempGlbPath)
      glbBeforeDracoSize = tempStats.size

      // Second pass: GLB with Draco compression
      const enableDraco = options?.enableDraco !== false
      const dracoLevel = options?.dracoLevel ?? 7
      await convertSTLtoGLB(stl, glbPath, { enableDraco, dracoCompressionLevel: dracoLevel })

      // Clean up temp file
      try {
        await readFile(tempGlbPath).then(() => {
          // File exists, delete it
          const fs = require('fs')
          fs.unlinkSync(tempGlbPath)
        }).catch(() => {
          // File doesn't exist, ignore
        })
      } catch (e) {
        // Ignore cleanup errors
      }

      const glbStats = await stat(glbPath)
      glbAfterDracoSize = glbStats.size

      processingLogger.info('GLB conversion successful', {
        glbBeforeDraco: glbBeforeDracoSize,
        glbAfterDraco: glbAfterDracoSize,
        dracoReduction: ((1 - glbAfterDracoSize / glbBeforeDracoSize) * 100).toFixed(1) + '%',
      })
    } catch (error) {
      processingLogger.warn('GLB conversion failed, will use STL as fallback', { error })
      glbAfterDracoSize = 0
    }

    // 5. Generate standard thumbnail for library consistency
    let thumbnailRelative: string | undefined
    const thumbFilename = `${assetId}_thumb.png`
    const thumbTarget = path.join(STORAGE_PATHS.thumbnails, artistId, assetId, thumbFilename)
    try {
      await generateThumbnailFromSTL(stl, thumbTarget)
      thumbnailRelative = path.relative(STORAGE_PATHS.thumbnails, thumbTarget)
    } catch (error) {
      processingLogger.warn('Thumbnail generation failed', { error })
    }

    // 6. Build file paths
    const filePaths: FilePaths = {
      stl: path.relative(STORAGE_PATHS.models, stlPath),
      glb: path.relative(STORAGE_PATHS.models, glbPath),
      thumbnail: thumbnailRelative,
    }

    // 7. Calculate compression statistics
    // Estimate Brotli compression: typically 60-70% reduction for GLB
    const estimatedBrotliRatio = 0.65
    const estimatedDownloadSize = Math.round(glbAfterDracoSize * estimatedBrotliRatio)

    const compressionStats: CompressionStats = {
      originalStlSize,
      glbBeforeDraco: glbBeforeDracoSize,
      glbAfterDraco: glbAfterDracoSize,
      estimatedDownloadSize,
      decimationLevel: decimationLevel > 0 ? decimationLevel : undefined,
      triangleCountBefore,
      triangleCountAfter: stl.triangleCount,
      compressionRatio: glbAfterDracoSize / originalStlSize,
      downloadCompressionRatio: estimatedDownloadSize / originalStlSize,
    }

    processingLogger.info('STL processing completed successfully', {
      triangles: stl.triangleCount,
      volume: printStats.volume_mm3,
      weight: printStats.estimated_weight_g,
      compression: {
        original: originalStlSize,
        final: glbAfterDracoSize,
        ratio: (compressionStats.compressionRatio * 100).toFixed(1) + '%',
        downloadRatio: (compressionStats.downloadCompressionRatio * 100).toFixed(1) + '%',
      }
    })

    return {
      success: true,
      file_paths: filePaths,
      aabb,
      footprint,
      print_stats: printStats,
      compression_stats: compressionStats,
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

export async function generateGLB(
  stlPath: string,
  options?: {
    enableDraco?: boolean
    dracoLevel?: number
  }
): Promise<string> {
  const out = stlPath.replace(/\.stl$/i, '.glb')
  try {
    await convertSTLtoGLB(stlPath, out, options)
  } catch {
    // If conversion fails, return path anyway; caller may handle absence
  }
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
  generateThumbnailFromSTL,
  processSTLFile
}
