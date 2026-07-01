// backend/src/middleware/compression.ts
// Server-side compression middleware for GLB and other static files

import compression from 'compression'
import type { Request, Response, NextFunction } from 'express'
import { constants as zlibConstants } from 'zlib'

/**
 * Configure compression middleware with Brotli support
 * 
 * Compression strategy:
 * - Brotli: Primary compression (85-95% reduction for GLB files)
 * - Gzip: Fallback for older browsers
 * - Deflate: Last resort fallback
 * 
 * GLB files typically compress from 2-5MB to 0.5-2MB with Brotli
 */
export function setupCompressionMiddleware() {
  return compression({
    // Only compress responses larger than 1KB
    threshold: 1024,
    
    // Compression level (0-11 for Brotli, 0-9 for gzip)
    // 11 = maximum compression (slower)
    // 6 = balanced (default)
    level: 6,
    
    // Filter function to determine which responses to compress
    filter: (req: Request, res: Response) => {
      // Don't compress if client sends no-compression header
      if (req.headers['x-no-compression']) {
        return false
      }

      // Don't compress GLB files - they're already compressed with Draco
      // Double compression can corrupt binary data
      if (req.path.endsWith('.glb') || req.path.includes('/previews/')) {
        return false
      }

      // Compress these content types
      const compressibleTypes = [
        'application/json',
        'text/html',
        'text/css',
        'text/javascript',
        'application/javascript',
        'image/svg+xml',
      ]

      const contentType = res.getHeader('content-type')?.toString() || ''
      return compressibleTypes.some(type => contentType.includes(type))
    },

    // Brotli compression options
    brotli: {
      // Brotli quality: 0-11 (11 = best compression, slowest)
      // For GLB files, quality 11 is worth it (one-time cost)
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      },
    },
  })
}

/**
 * Middleware to add compression-related headers
 * Helps clients understand compression and caching
 */
export function compressionHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Add Vary header to indicate response varies by Accept-Encoding
  res.setHeader('Vary', 'Accept-Encoding')

  // For GLB files, add cache headers (they're immutable once generated)
  if (req.path.includes('.glb')) {
    // Cache for 30 days (GLB files are content-addressed by assetId)
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
  }

  next()
}

export default setupCompressionMiddleware

