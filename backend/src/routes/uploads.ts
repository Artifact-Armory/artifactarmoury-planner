// backend/src/routes/uploads.ts
// Presigned R2 uploads: the browser PUTs bytes directly to R2, so large product
// assets / map blobs never pass through the Railway app.

import { Router } from 'express'
import crypto from 'crypto'
import path from 'path'
import { authenticate, requireArtist, AuthRequest } from '../middleware/auth'
import { asyncHandler, ValidationError } from '../middleware/error'
import { isR2Enabled, presignUpload } from '../services/r2'
import { contentTypeFor } from '../services/storage'

const router = Router()

// `raw` is the quarantine prefix for un-processed seller uploads (content-hashed,
// unguessable keys). Everything else is derived/public asset storage.
const SAFE_PREFIXES = ['raw', 'models', 'thumbnails', 'images', 'textures', 'maps']

/**
 * POST /api/uploads/presign  { filename, prefix }
 * → { uploadUrl, publicUrl, key, headers } ; client does PUT uploadUrl with the file.
 */
router.post(
  '/presign',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!isR2Enabled()) {
      throw new ValidationError('Direct uploads are not configured (R2 is disabled)')
    }
    const { filename, prefix = 'models' } = req.body ?? {}
    if (!filename || typeof filename !== 'string') {
      throw new ValidationError('filename is required')
    }
    if (!SAFE_PREFIXES.includes(prefix)) {
      throw new ValidationError(`prefix must be one of: ${SAFE_PREFIXES.join(', ')}`)
    }

    const ext = path.extname(filename).toLowerCase()
    const contentType = contentTypeFor(filename)
    // content-addressed key so objects are immutable and cacheable forever
    const hash = crypto.randomBytes(16).toString('hex')
    const key = `${prefix}/${hash}${ext}`

    // 1 hour: a large model (hundreds of MB) on a home upload can easily take
    // more than 5 minutes, and the URL must stay valid for the whole PUT or the
    // transfer 403s partway through.
    const EXPIRES_IN = 3600
    const presigned = await presignUpload(key, contentType, EXPIRES_IN)
    res.json({
      ...presigned,
      contentType,
      headers: { 'Content-Type': contentType },
      expiresIn: EXPIRES_IN,
    })
  }),
)

export default router
