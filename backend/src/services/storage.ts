// backend/src/services/storage.ts
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import logger from '../utils/logger'

// Use process.cwd() instead of import.meta.url

// Storage configuration
// Prefer DEV_GUIDE's UPLOAD_DIR, fall back to STORAGE_ROOT, then ./uploads
const STORAGE_ROOT = process.env.UPLOAD_DIR || process.env.STORAGE_ROOT || path.join(process.cwd(), 'uploads')
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '104857600') // 100MB default

// Storage paths
export const STORAGE_PATHS = {
  temp: path.join(STORAGE_ROOT, 'temp'),
  models: path.join(STORAGE_ROOT, 'models'),
  thumbnails: path.join(STORAGE_ROOT, 'thumbnails'),
  images: path.join(STORAGE_ROOT, 'images'),
  exports: path.join(STORAGE_ROOT, 'exports')
}

// ============================================================================
// INITIALIZATION
// ============================================================================

export async function initializeStorage(): Promise<void> {
  try {
    logger.info('Initializing storage directories...')
    
    // Create all storage directories
    for (const [name, dirPath] of Object.entries(STORAGE_PATHS)) {
      await fs.mkdir(dirPath, { recursive: true })
      logger.debug(`Created storage directory: ${name}`)
    }
    
    logger.info('✓ Storage initialized successfully')
  } catch (error) {
    logger.error('Failed to initialize storage', { error })
    throw error
  }
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * Generate a unique filename with timestamp and random hash
 */
export function generateUniqueFilename(originalName: string): string {
  const ext = path.extname(originalName)
  const timestamp = Date.now()
  const hash = crypto.randomBytes(8).toString('hex')
  return `${timestamp}-${hash}${ext}`
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  return path.extname(filename).toLowerCase()
}

/**
 * Check if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Get file size in bytes
 */
export async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath)
  return stats.size
}

/**
 * Validate file size
 */
export function validateFileSize(size: number): void {
  if (size > MAX_FILE_SIZE) {
    const maxSizeMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(2)
    throw new Error(`File size exceeds maximum allowed size of ${maxSizeMB}MB`)
  }
}

// ============================================================================
// SAVE FILES
// ============================================================================

export interface SaveFileOptions {
  originalName: string
  buffer: Buffer
  category: 'temp' | 'models' | 'thumbnails' | 'images' | 'exports'
  artistId?: string
  assetId?: string
}

export interface SaveFileResult {
  filename: string
  filepath: string
  relativePath: string
  size: number
  mimetype: string
}

/**
 * Save a file to storage
 */
export async function saveFile(options: SaveFileOptions): Promise<SaveFileResult> {
  const { originalName, buffer, category, artistId, assetId } = options
  
  try {
    // Validate file size
    validateFileSize(buffer.length)
    
    // Generate unique filename
    const filename = generateUniqueFilename(originalName)
    
    // Build directory path
    let dirPath = STORAGE_PATHS[category]
    
    // Organize by artist/asset if provided
    if (artistId) {
      dirPath = path.join(dirPath, artistId)
    }
    if (assetId) {
      dirPath = path.join(dirPath, assetId)
    }
    
    // Ensure directory exists
    await fs.mkdir(dirPath, { recursive: true })
    
    // Full file path
    const filepath = path.join(dirPath, filename)
    
    // Write file
    await fs.writeFile(filepath, buffer)
    
    // Get relative path for storage in database
    const relativePath = path.relative(STORAGE_ROOT, filepath)
    
    // Determine mimetype
    const ext = getFileExtension(filename)
    const mimetype = getMimeType(ext)
    
    logger.debug('File saved', {
      filename,
      size: buffer.length,
      category,
      artistId,
      assetId
    })
    
    return {
      filename,
      filepath,
      relativePath,
      size: buffer.length,
      mimetype
    }
  } catch (error) {
    logger.error('Failed to save file', { error, originalName })
    throw error
  }
}

/**
 * Move file from temp to permanent storage
 */
export async function moveFile(
  tempPath: string,
  category: 'models' | 'thumbnails' | 'images',
  artistId: string,
  assetId: string
): Promise<SaveFileResult> {
  try {
    // Read file
    const buffer = await fs.readFile(tempPath)
    const originalName = path.basename(tempPath)
    
    // Save to permanent location
    const result = await saveFile({
      originalName,
      buffer,
      category,
      artistId,
      assetId
    })
    
    // Delete temp file
    await deleteFile(tempPath)
    
    logger.debug('File moved', {
      from: tempPath,
      to: result.filepath
    })
    
    return result
  } catch (error) {
    logger.error('Failed to move file', { error, tempPath })
    throw error
  }
}

// ============================================================================
// READ FILES
// ============================================================================

/**
 * Read file as buffer
 */
export async function readFile(filePath: string): Promise<Buffer> {
  try {
    // Resolve path if relative
    const fullPath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(STORAGE_ROOT, filePath)
    
    return await fs.readFile(fullPath)
  } catch (error) {
    logger.error('Failed to read file', { error, filePath })
    throw error
  }
}

/**
 * Get file stream for large files
 */
export function getFileStream(filePath: string): NodeJS.ReadableStream {
  const fullPath = path.isAbsolute(filePath) 
    ? filePath 
    : path.join(STORAGE_ROOT, filePath)
  
  const { createReadStream } = require('fs')
  return createReadStream(fullPath)
}

/**
 * Get file URL for public access
 */
export function getFileURL(relativePath: string): string {
  const baseURL = process.env.BASE_URL || 'http://localhost:3001'
  return `${baseURL}/uploads/${relativePath}`
}

// ============================================================================
// DELETE FILES
// ============================================================================

/**
 * Delete a single file
 */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    const fullPath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(STORAGE_ROOT, filePath)
    
    const exists = await fileExists(fullPath)
    if (!exists) {
      logger.warn('File does not exist, skipping deletion', { filePath })
      return
    }
    
    await fs.unlink(fullPath)
    logger.debug('File deleted', { filePath })
  } catch (error) {
    logger.error('Failed to delete file', { error, filePath })
    throw error
  }
}

/**
 * Delete multiple files
 */
export async function deleteFiles(filePaths: string[]): Promise<void> {
  const results = await Promise.allSettled(
    filePaths.map(filePath => deleteFile(filePath))
  )
  
  const failed = results.filter(r => r.status === 'rejected')
  if (failed.length > 0) {
    logger.warn('Some files failed to delete', { 
      total: filePaths.length,
      failed: failed.length 
    })
  }
}

// Compatibility helpers expected by some routes
export async function uploadToStorage(tempPath: string, category: 'models' | 'previews' | 'thumbnails' | 'images'): Promise<string> {
  // For 'previews', store under models by convention
  const targetCategory = category === 'previews' ? 'models' : category
  const filename = path.basename(tempPath)
  const buffer = await fs.readFile(tempPath)
  const saved = await saveFile({ originalName: filename, buffer, category: targetCategory as any })
  // best-effort cleanup
  try { await deleteFile(tempPath) } catch {}
  return saved.relativePath
}

export async function deleteFromStorage(relativePath: string): Promise<void> {
  await deleteFile(relativePath)
}

/**
 * Delete entire asset directory
 */
export async function deleteAssetFiles(artistId: string, assetId: string): Promise<void> {
  try {
    const assetDir = path.join(STORAGE_PATHS.models, artistId, assetId)
    
    const exists = await fileExists(assetDir)
    if (!exists) {
      logger.warn('Asset directory does not exist', { artistId, assetId })
      return
    }
    
    await fs.rm(assetDir, { recursive: true, force: true })
    logger.info('Asset files deleted', { artistId, assetId })
  } catch (error) {
    logger.error('Failed to delete asset files', { error, artistId, assetId })
    throw error
  }
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Clean up old temporary files
 */
export async function cleanupTempFiles(maxAgeHours = 24): Promise<number> {
  try {
    const maxAge = maxAgeHours * 60 * 60 * 1000 // Convert to milliseconds
    const now = Date.now()
    let deletedCount = 0
    
    const files = await fs.readdir(STORAGE_PATHS.temp)
    
    for (const file of files) {
      const filePath = path.join(STORAGE_PATHS.temp, file)
      const stats = await fs.stat(filePath)
      
      // Check if file is old enough to delete
      const age = now - stats.mtimeMs
      if (age > maxAge) {
        await fs.unlink(filePath)
        deletedCount++
      }
    }
    
    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} old temporary files`)
    }
    
    return deletedCount
  } catch (error) {
    logger.error('Failed to cleanup temp files', { error })
    return 0
  }
}

/**
 * Get storage statistics
 */
export async function getStorageStats(): Promise<{
  total: number
  byCategory: Record<string, number>
}> {
  const stats = {
    total: 0,
    byCategory: {} as Record<string, number>
  }
  
  for (const [category, dirPath] of Object.entries(STORAGE_PATHS)) {
    try {
      const size = await getDirectorySize(dirPath)
      stats.byCategory[category] = size
      stats.total += size
    } catch (error) {
      stats.byCategory[category] = 0
    }
  }
  
  return stats
}

/**
 * Get total size of a directory
 */
async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      
      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(fullPath)
      } else {
        const stats = await fs.stat(fullPath)
        totalSize += stats.size
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  
  return totalSize
}

// ============================================================================
// MIME TYPES
// ============================================================================

const MIME_TYPES: Record<string, string> = {
  '.stl': 'application/vnd.ms-pki.stl',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip'
}

function getMimeType(ext: string): string {
  return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream'
}

// ============================================================================
// SCHEDULED CLEANUP
// ============================================================================

// Run cleanup every 6 hours
if (process.env.NODE_ENV !== 'test') {
  const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000 // 6 hours
  
  setInterval(async () => {
    logger.info('Running scheduled temp file cleanup...')
    await cleanupTempFiles(24)
  }, CLEANUP_INTERVAL)
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  initializeStorage,
  generateUniqueFilename,
  getFileExtension,
  fileExists,
  getFileSize,
  validateFileSize,
  saveFile,
  moveFile,
  readFile,
  getFileStream,
  getFileURL,
  deleteFile,
  deleteFiles,
  uploadToStorage,
  deleteFromStorage,
  deleteAssetFiles,
  cleanupTempFiles,
  getStorageStats,
  STORAGE_PATHS
}
