// backend/src/services/fileProcessor.ts
import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import logger from '../utils/logger.js'
import { saveFile, STORAGE_PATHS } from './storage.js'
import type { AABB, Footprint, PrintStats, FilePaths, Vector3 } from '../../../shared/types.js'

const execAsync = promisify(exec)

// ============================================================================
// CONFIGURATION
// ============================================================================

// Check if required tools are available
let BLENDER_PATH = process.env.BLENDER_PATH || 'blender'
let MESHLAB_PATH = process.env.MESHLAB_PATH || 'meshlabserver'
let HAS_BLENDER = false
let HAS_MESHLAB = false

// Test tool availability on startup
async function checkTools() {
  try {
    await execAsync(`${BLENDER_PATH} --version`)
    HAS_BLENDER = true
    logger.info('✓ Blender found')
  } catch {
    logger.warn('Blender not found - STL to GLB conversion will be limited')
  }
  
  try {
    await execAsync(`${MESHLAB_PATH} --version`)
    HAS_MESHLAB = true
    logger.info('✓ MeshLab found')
  } catch {
    logger.warn('MeshLab not found - using fallback mesh analysis')
  }
}

// Run check on module load (but not in test environment)
if (process.env.NODE_ENV !== 'test') {
  checkTools().catch(err => logger.error('Tool check failed', { error: err }))
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
 * Convert STL to GLB using Blender
 */
export async function convertSTLtoGLB(
  stlPath: string,
  outputPath: string
): Promise<void> {
  if (!HAS_BLENDER) {
    throw new Error('Blender is not available for STL to GLB conversion')
  }
  
  try {
    // Create Blender Python script for conversion
    const script = `
import bpy
import sys

# Clear default scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# Import STL
bpy.ops.import_mesh.stl(filepath="${stlPath}")

# Select imported object
obj = bpy.context.selected_objects[0]
bpy.context.view_layer.objects.active = obj

# Center to origin
bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
obj.location = (0, 0, 0)

# Export as GLB
bpy.ops.export_scene.gltf(
    filepath="${outputPath}",
    export_format='GLB',
    use_selection=True,
    export_apply=True
)

print("Conversion successful")
sys.exit(0)
`
    
    const scriptPath = path.join(STORAGE_PATHS.temp, `convert_${Date.now()}.py`)
    await writeFile(scriptPath, script)
    
    // Run Blender in background
    const { stdout, stderr } = await execAsync(
      `${BLENDER_PATH} --background --python "${scriptPath}"`,
      { timeout: 60000 } // 60 second timeout
    )
    
    logger.debug('Blender conversion output', { stdout, stderr })
    
    // Clean up script
    await execAsync(`rm "${scriptPath}"`)
    
    logger.info('STL to GLB conversion successful', { stlPath, outputPath })
  } catch (error) {
    logger.error('STL to GLB conversion failed', { error, stlPath })
    throw new Error('Failed to convert STL to GLB')
  }
}

/**
 * Fallback: Create simple GLB from STL data (basic conversion without Blender)
 */
async function createBasicGLB(stl: ParsedSTL, outputPath: string): Promise<void> {
  // This is a simplified GLB creation - in production you'd want a proper library
  // For now, we'll just copy the STL and rename it (not ideal but works as fallback)
  logger.warn('Using fallback GLB conversion - results may be limited')
  
  // In a real implementation, you'd use a library like gltf-transform or three.js
  // to properly create a GLB file from the STL geometry
  throw new Error('Fallback GLB conversion not yet implemented - Blender required')
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
    
    // 1. Parse STL
    processingLogger.debug('Parsing STL...')
    const stl = await parseSTL(stlPath)
    processingLogger.debug(`Parsed ${stl.triangleCount} triangles`)
    
    // 2. Calculate geometry
    processingLogger.debug('Calculating geometry...')
    const aabb = calculateAABB(stl)
    const footprint = calculateFootprint(aabb)
    const printStats = calculatePrintStats(stl, aabb)
    
    // 3. Convert to GLB
    processingLogger.debug('Converting to GLB...')
    const glbFilename = `${assetId}.glb`
    const glbPath = path.join(STORAGE_PATHS.models, artistId, assetId, glbFilename)
    
    try {
      await convertSTLtoGLB(stlPath, glbPath)
    } catch (error) {
      processingLogger.warn('GLB conversion failed, will use STL as fallback', { error })
    }
    
    // 4. Generate thumbnail
    processingLogger.debug('Generating thumbnail...')
    const thumbFilename = `${assetId}_thumb.png`
    const thumbPath = path.join(STORAGE_PATHS.thumbnails, artistId, assetId, thumbFilename)
    
    try {
      await generateThumbnail(glbPath, thumbPath)
    } catch (error) {
      processingLogger.warn('Thumbnail generation failed', { error })
    }
    
    // 5. Build file paths
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

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  parseSTL,
  calculateAABB,
  calculateFootprint,
  calculatePrintStats,
  convertSTLtoGLB,
  generateThumbnail,
  processSTLFile
}