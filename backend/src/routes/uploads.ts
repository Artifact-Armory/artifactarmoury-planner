// backend/src/routes/uploads.ts
// Presigned R2 uploads: the browser PUTs bytes directly to R2, so large product
// assets / map blobs never pass through the Railway app.

import { Router } from 'express'
import crypto from 'crypto'
import path from 'path'
import { authenticate, requireArtist, AuthRequest } from '../middleware/auth'
import { asyncHandler, ValidationError } from '../middleware/error'
import {
  isR2Enabled, presignUpload,
  createMultipartUpload, presignUploadPart, completeMultipartUpload, abortMultipartUpload,
} from '../services/r2'
import { contentTypeFor } from '../services/storage'
import { MAX_MODEL_FILE_BYTES, MAX_MODEL_FILE_MB } from '../services/meshConvert'

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

// R2/S3 multipart caps: max 10,000 parts. We also bound part count so a client
// can't ask us to sign an unreasonable number of URLs.
const MAX_PARTS = 10_000

/**
 * POST /api/uploads/multipart/create  { filename, prefix, partCount }
 * → { key, uploadId, contentType, parts: [{ partNumber, url }] }
 * Starts a multipart upload and hands back a presigned PUT URL for every part.
 * The client PUTs each chunk, collects the ETag response header, then calls
 * /complete (or /abort on failure).
 */
router.post(
  '/multipart/create',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!isR2Enabled()) {
      throw new ValidationError('Direct uploads are not configured (R2 is disabled)')
    }
    const { filename, prefix = 'raw', partCount, fileSize } = req.body ?? {}
    if (!filename || typeof filename !== 'string') {
      throw new ValidationError('filename is required')
    }
    if (!SAFE_PREFIXES.includes(prefix)) {
      throw new ValidationError(`prefix must be one of: ${SAFE_PREFIXES.join(', ')}`)
    }
    // Reject an oversized model up-front so we never start a multipart upload
    // that from-upload would reject anyway (and that would crash processing).
    if (prefix === 'raw' && Number(fileSize) > MAX_MODEL_FILE_BYTES) {
      throw new ValidationError(
        `Model file is too large (${(Number(fileSize) / (1024 * 1024)).toFixed(0)}MB). The maximum is ${MAX_MODEL_FILE_MB}MB — please reduce the model's detail (e.g. decimate it in Blender) and upload again.`,
      )
    }
    const n = Number(partCount)
    if (!Number.isInteger(n) || n < 1 || n > MAX_PARTS) {
      throw new ValidationError(`partCount must be an integer between 1 and ${MAX_PARTS}`)
    }

    const ext = path.extname(filename).toLowerCase()
    const contentType = contentTypeFor(filename)
    const hash = crypto.randomBytes(16).toString('hex')
    const key = `${prefix}/${hash}${ext}`

    const uploadId = await createMultipartUpload(key, contentType)
    const parts = await Promise.all(
      Array.from({ length: n }, (_, i) => i + 1).map(async (partNumber) => ({
        partNumber,
        url: await presignUploadPart(key, uploadId, partNumber, 3600),
      })),
    )

    res.json({ key, uploadId, contentType, parts })
  }),
)

/**
 * POST /api/uploads/multipart/complete  { key, uploadId, parts: [{ partNumber, etag }] }
 * → { key, publicUrl }
 */
router.post(
  '/multipart/complete',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!isR2Enabled()) {
      throw new ValidationError('Direct uploads are not configured (R2 is disabled)')
    }
    const { key, uploadId, parts } = req.body ?? {}
    if (!key || typeof key !== 'string') throw new ValidationError('key is required')
    if (!uploadId || typeof uploadId !== 'string') throw new ValidationError('uploadId is required')
    if (!Array.isArray(parts) || parts.length < 1) throw new ValidationError('parts is required')
    for (const p of parts) {
      if (!Number.isInteger(p?.partNumber) || !p?.etag || typeof p.etag !== 'string') {
        throw new ValidationError('each part needs a partNumber and etag')
      }
    }

    const publicUrl = await completeMultipartUpload(key, uploadId, parts)
    res.json({ key, publicUrl })
  }),
)

/**
 * POST /api/uploads/multipart/abort  { key, uploadId }
 * Best-effort cleanup of a failed multipart upload.
 */
router.post(
  '/multipart/abort',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const { key, uploadId } = req.body ?? {}
    if (!key || typeof key !== 'string') throw new ValidationError('key is required')
    if (!uploadId || typeof uploadId !== 'string') throw new ValidationError('uploadId is required')
    try {
      await abortMultipartUpload(key, uploadId)
    } catch {
      // best-effort — the upload will be garbage-collected by R2 lifecycle anyway
    }
    res.json({ ok: true })
  }),
)

export default router
