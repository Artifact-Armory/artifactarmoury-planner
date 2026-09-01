// backend/src/routes/reports.ts
// Model reports (migration 021). Any signed-in user can report a model; admins triage
// them in the moderation queue (routes/admin.ts). Copyright / not-as-advertised /
// broken-file reports must carry proof uploads.

import { Router } from 'express'
import crypto from 'crypto'
import path from 'path'
import { db } from '../db'
import logger from '../utils/logger'
import { authenticate, AuthRequest, requireArtist } from '../middleware/auth'
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/error'
import { isR2Enabled, presignUpload } from '../services/r2'
import { createNotification } from '../services/notifications'

const router = Router()

// Reasons that legally/practically need evidence attached.
const PROOF_REQUIRED = new Set(['copyright', 'not_as_advertised', 'broken_file'])
const VALID_REASONS = new Set([
  'copyright', 'offensive', 'not_as_advertised', 'no_printed_photo', 'broken_file', 'other',
])

function proofContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  switch (ext) {
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.pdf': return 'application/pdf'
    default: return 'application/octet-stream'
  }
}

// ============================================================================
// PRESIGN PROOF UPLOAD  (any signed-in user — buyers report too)
// ============================================================================

router.post(
  '/presign-proof',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!isR2Enabled()) {
      throw new ValidationError('Proof uploads are not configured (R2 is disabled)')
    }
    const { filename } = req.body ?? {}
    if (!filename || typeof filename !== 'string') {
      throw new ValidationError('filename is required')
    }
    const ext = path.extname(filename).toLowerCase()
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf']
    if (!allowed.includes(ext)) {
      throw new ValidationError(`Proof must be an image or PDF (${allowed.join(', ')})`)
    }
    const contentType = proofContentType(filename)
    const key = `report-proof/${crypto.randomBytes(16).toString('hex')}${ext}`
    const presigned = await presignUpload(key, contentType, 300)
    res.json({ ...presigned, contentType, headers: { 'Content-Type': contentType }, expiresIn: 300 })
  }),
)

// ============================================================================
// SUBMIT A REPORT
// ============================================================================

router.post(
  '/',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.userId!
    const { modelId, reason, detail, attachments } = req.body ?? {}

    if (!modelId) throw new ValidationError('modelId is required')
    if (!reason || !VALID_REASONS.has(reason)) throw new ValidationError('A valid reason is required')

    const atts: Array<{ key: string; filename?: string; contentType?: string }> = Array.isArray(attachments) ? attachments : []
    if (PROOF_REQUIRED.has(reason) && atts.length === 0) {
      throw new ValidationError('This report type requires at least one photo or document as proof')
    }
    // Proof keys must come from our presign path.
    for (const a of atts) {
      if (!a?.key || typeof a.key !== 'string' || !a.key.startsWith('report-proof/')) {
        throw new ValidationError('Invalid proof attachment')
      }
    }

    // Model must exist. Grab its owner for the report + ownership checks.
    const modelResult = await db.query('SELECT id, artist_id, name FROM models WHERE id = $1', [modelId])
    if (modelResult.rows.length === 0) throw new NotFoundError('Model')
    const model = modelResult.rows[0]

    if (model.artist_id === userId) {
      throw new ValidationError('You cannot report your own model')
    }

    // Shadow-banned users can only report a model they actually OWN (they keep their
    // consumer rights on purchases); all other reporting is blocked.
    if (req.user?.shadow_banned) {
      const owns = await db.query(
        `SELECT 1 FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         WHERE oi.model_id = $1 AND o.user_id = $2 AND o.payment_status = 'succeeded' AND oi.refunded_at IS NULL
         LIMIT 1`,
        [modelId, userId],
      )
      if (owns.rows.length === 0) {
        throw new ValidationError('You can only report models you have purchased')
      }
    }

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      let report
      try {
        const r = await client.query(
          `INSERT INTO model_reports (model_id, artist_id, reporter_id, reason, detail)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [modelId, model.artist_id, userId, reason, detail || null],
        )
        report = r.rows[0]
      } catch (err: any) {
        // Unique partial index → an open report from this user on this model already exists.
        if (err?.code === '23505') {
          await client.query('ROLLBACK')
          throw new ValidationError('You already have an open report on this model')
        }
        throw err
      }

      for (const a of atts) {
        await client.query(
          `INSERT INTO model_report_attachments (report_id, file_path, file_name, content_type)
           VALUES ($1, $2, $3, $4)`,
          [report.id, a.key, a.filename || null, a.contentType || null],
        )
      }

      await client.query('COMMIT')

      // Confirm receipt to the reporter (the artist is only told once it's resolved).
      createNotification({
        userId,
        type: 'report_received',
        title: 'Report received',
        body: `Thanks — we've received your report about "${model.name}" and will review it.`,
        link: '/dashboard',
      })

      logger.info('Model report submitted', { reportId: report.id, modelId, reporterId: userId, reason })
      res.status(201).json({ message: 'Report submitted', reportId: report.id })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }),
)

// ============================================================================
// REPORTS AGAINST MY MODELS  (artist dashboard "Reports" tab)
// ============================================================================

router.get(
  '/against-me',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const artistId = req.userId!
    const result = await db.query(
      `SELECT r.id, r.reason, r.status, r.created_at, r.resolved_at,
              r.resolution_action, r.resolution_summary,
              r.model_id, m.name AS model_name, m.thumbnail_path
       FROM model_reports r
       LEFT JOIN models m ON r.model_id = m.id
       WHERE r.artist_id = $1
       ORDER BY r.created_at DESC`,
      [artistId],
    )

    const reportIds = result.rows.map((r: any) => r.id)
    const repliesByReport: Record<string, any[]> = {}
    if (reportIds.length > 0) {
      const repliesResult = await db.query(
        `SELECT rr.id, rr.report_id, rr.is_admin, rr.body, rr.created_at, u.display_name AS sender_name
         FROM model_report_replies rr
         LEFT JOIN users u ON rr.sender_id = u.id
         WHERE rr.report_id = ANY($1::uuid[])
         ORDER BY rr.created_at ASC`,
        [reportIds],
      )
      for (const row of repliesResult.rows) {
        (repliesByReport[row.report_id] ??= []).push(row)
      }
    }

    res.json({ reports: result.rows.map((r: any) => ({ ...r, replies: repliesByReport[r.id] ?? [] })) })
  }),
)

// ============================================================================
// REPLY TO A REPORT AGAINST MY MODEL  (artist responding to a decision)
// ============================================================================

router.post(
  '/:id/reply',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const artistId = req.userId!
    const { id } = req.params
    const { message } = req.body ?? {}
    if (!message || typeof message !== 'string' || !message.trim()) {
      throw new ValidationError('A message is required')
    }
    const trimmed = message.trim().slice(0, 5000)

    const reportResult = await db.query(
      `SELECT r.id, r.artist_id, r.resolved_by, m.name AS model_name
       FROM model_reports r LEFT JOIN models m ON r.model_id = m.id
       WHERE r.id = $1`,
      [id],
    )
    if (reportResult.rows.length === 0) throw new NotFoundError('Report')
    const report = reportResult.rows[0]
    // Not this artist's report — 404 rather than 403 so its existence isn't confirmed either way.
    if (report.artist_id !== artistId) throw new NotFoundError('Report')

    const inserted = await db.query(
      `INSERT INTO model_report_replies (report_id, sender_id, is_admin, body)
       VALUES ($1, $2, false, $3)
       RETURNING id, report_id, is_admin, body, created_at`,
      [id, artistId, trimmed],
    )

    if (report.resolved_by) {
      createNotification({
        userId: report.resolved_by,
        type: 'report_reply',
        title: `${req.user?.artist_name || req.user?.display_name || 'An artist'} replied about "${report.model_name || 'a model'}"`,
        body: trimmed,
        link: '/admin/moderation',
      })
    }

    logger.info('Artist replied to a report', { reportId: id, artistId })
    res.status(201).json({ reply: inserted.rows[0] })
  }),
)

export default router
