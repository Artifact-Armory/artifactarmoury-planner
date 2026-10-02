// backend/src/routes/artistApplications.ts
// In-app artist applications (migration 068). A signed-in customer submits their
// details and portfolio images; an admin reviews them in /admin/artist-applications
// (routes/admin.ts) and either approves (mints + emails an invite code) or rejects
// (emails the reason). Replaces "email a portfolio to artists@".
//
// Images go straight to R2 via a presigned PUT under the `applications/` prefix,
// the same pattern as the Contact page, so a batch of portfolio shots never ties
// up the API server.

import { Router } from 'express'
import crypto from 'crypto'
import path from 'path'
import { db } from '../db'
import logger from '../utils/logger'
import { authenticate, AuthRequest } from '../middleware/auth'
import { asyncHandler, ValidationError } from '../middleware/error'
import { isR2Enabled, presignUpload } from '../services/r2'
import { uploadRateLimit, emailRateLimit } from '../middleware/security'
import { validateArtistName } from '../services/artistOnboarding'
import { sendApplicationReceived, sendApplicationToSupport } from '../services/email'

const router = Router()

const IMAGE_PREFIX = 'applications'
const MIN_IMAGES = 3
const MAX_IMAGES = 10
const MAX_SOCIALS = 5

function imageContentType(filename: string): string | null {
  switch (path.extname(filename).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    default: return null
  }
}

function cleanText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.trim().length < min) {
    throw new ValidationError(`${field} must be at least ${min} characters`)
  }
  const trimmed = value.trim()
  if (trimmed.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`)
  return trimmed
}

function cleanUrl(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a link`)
  const trimmed = value.trim()
  if (trimmed.length > 500) throw new ValidationError(`${field} is too long`)
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new ValidationError(`${field} must be a full link starting with https://`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ValidationError(`${field} must be an http(s) link`)
  }
  return parsed.toString()
}

// ============================================================================
// PRESIGN A PORTFOLIO IMAGE UPLOAD
// ============================================================================

router.post(
  '/presign-image',
  authenticate,
  uploadRateLimit,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!isR2Enabled()) throw new ValidationError('File uploads are not configured (R2 is disabled)')
    const { filename } = req.body ?? {}
    if (!filename || typeof filename !== 'string') throw new ValidationError('filename is required')
    const contentType = imageContentType(filename)
    if (!contentType) throw new ValidationError('Portfolio images must be PNG, JPG or WebP')
    const key = `${IMAGE_PREFIX}/${crypto.randomBytes(16).toString('hex')}${path.extname(filename).toLowerCase()}`
    const presigned = await presignUpload(key, contentType, 300)
    res.json({ ...presigned, contentType, headers: { 'Content-Type': contentType }, expiresIn: 300 })
  }),
)

// ============================================================================
// MY APPLICATION (most recent), so the page can show its state
// ============================================================================

router.get(
  '/mine',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const result = await db.query(
      `SELECT a.id, a.status, a.artist_name, a.decision_reason, a.created_at, a.reviewed_at,
              ic.code AS invite_code, ic.expires_at AS invite_expires_at,
              ic.current_uses AS invite_uses, ic.max_uses AS invite_max_uses
         FROM artist_applications a
         LEFT JOIN invite_codes ic ON ic.id = a.invite_code_id
        WHERE a.user_id = $1
        ORDER BY a.created_at DESC
        LIMIT 1`,
      [req.userId],
    )
    const row = result.rows[0]
    if (!row) return res.json({ application: null })

    // Only hand the code back while it can still be redeemed.
    const codeUsable =
      row.status === 'approved' &&
      row.invite_code &&
      Number(row.invite_uses) < Number(row.invite_max_uses) &&
      !(row.invite_expires_at && new Date(row.invite_expires_at) < new Date())

    res.json({
      application: {
        id: row.id,
        status: row.status,
        artistName: row.artist_name,
        decisionReason: row.status === 'rejected' ? row.decision_reason : null,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        inviteCode: codeUsable ? row.invite_code : null,
      },
    })
  }),
)

// ============================================================================
// SUBMIT
// ============================================================================

interface ImageInput { key: string; filename?: string; contentType?: string }

router.post(
  '/',
  authenticate,
  emailRateLimit,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = req.body ?? {}

    const user = (await db.query(
      `SELECT email, display_name, role FROM users WHERE id = $1`,
      [req.userId],
    )).rows[0]
    if (!user) throw new ValidationError('Account not found')
    if (user.role === 'artist' || user.role === 'admin') {
      throw new ValidationError('This account can already sell on Artifact Armoury')
    }

    const artistName = validateArtistName(body.artistName)
    const about = cleanText(body.about, 'About you', 20, 2000)
    const whatYouMake = cleanText(body.whatYouMake, 'What you make', 10, 1000)
    const websiteUrl = body.websiteUrl ? cleanUrl(body.websiteUrl, 'Website') : null
    const sellsElsewhere =
      typeof body.sellsElsewhere === 'string' && body.sellsElsewhere.trim()
        ? cleanText(body.sellsElsewhere, 'Where else you sell', 1, 500)
        : null

    const rawSocials: unknown[] = Array.isArray(body.socialLinks) ? body.socialLinks : []
    const socialLinks = rawSocials
      .filter((s) => typeof s === 'string' && s.trim())
      .slice(0, MAX_SOCIALS)
      .map((s, i) => cleanUrl(s, `Social link ${i + 1}`))

    const images: ImageInput[] = Array.isArray(body.images) ? body.images : []
    if (images.length < MIN_IMAGES) {
      throw new ValidationError(`Please add at least ${MIN_IMAGES} portfolio images`)
    }
    if (images.length > MAX_IMAGES) {
      throw new ValidationError(`Please add no more than ${MAX_IMAGES} portfolio images`)
    }
    for (const img of images) {
      if (!img?.key || typeof img.key !== 'string' || !img.key.startsWith(`${IMAGE_PREFIX}/`)) {
        throw new ValidationError('Invalid image')
      }
    }

    const client = await db.connect()
    let applicationId: string
    try {
      await client.query('BEGIN')
      const existing = await client.query(
        `SELECT 1 FROM artist_applications WHERE user_id = $1 AND status = 'pending'`,
        [req.userId],
      )
      if (existing.rows.length > 0) {
        throw new ValidationError('You already have an application under review')
      }
      const inserted = await client.query(
        `INSERT INTO artist_applications
           (user_id, applicant_name, applicant_email, artist_name, about, what_you_make,
            website_url, social_links, sells_elsewhere)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         RETURNING id`,
        [
          req.userId,
          (user.display_name || artistName).slice(0, 200),
          user.email,
          artistName,
          about,
          whatYouMake,
          websiteUrl,
          JSON.stringify(socialLinks),
          sellsElsewhere,
        ],
      )
      applicationId = inserted.rows[0].id
      for (const img of images) {
        await client.query(
          `INSERT INTO artist_application_images (application_id, file_path, file_name, content_type)
           VALUES ($1, $2, $3, $4)`,
          [applicationId, img.key, img.filename?.slice(0, 255) || null, img.contentType || null],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }

    // Best-effort emails: the application is saved either way.
    sendApplicationReceived({ to: user.email, name: user.display_name || artistName })
      .catch((err) => logger.error('Failed to send application receipt', { error: err, applicationId }))
    sendApplicationToSupport({
      applicantName: user.display_name || artistName,
      applicantEmail: user.email,
      artistName,
      imageCount: images.length,
    }).catch((err) => logger.error('Failed to notify support of application', { error: err, applicationId }))

    logger.info('Artist application submitted', { applicationId, userId: req.userId })
    res.status(201).json({ message: 'Application submitted', id: applicationId })
  }),
)

export default router
