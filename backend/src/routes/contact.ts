// backend/src/routes/contact.ts
// Public "Contact us" page (frontend/src/pages/Contact.tsx). Anyone can send a
// message to support — signed in or not — optionally with file attachments
// (a screenshot of a bug, proof of a broken download, etc.). Mirrors the
// report-proof presign pattern in routes/reports.ts.

import { Router } from 'express'
import crypto from 'crypto'
import path from 'path'
import { db } from '../db'
import logger from '../utils/logger'
import { optionalAuth, AuthRequest } from '../middleware/auth'
import { asyncHandler, ValidationError } from '../middleware/error'
import { isR2Enabled, presignUpload, publicUrl } from '../services/r2'
import { uploadRateLimit, emailRateLimit } from '../middleware/security'
import { sendContactMessageToSupport, sendContactConfirmation } from '../services/email'

const router = Router()

const MAX_ATTACHMENTS = 5
const ATTACHMENT_PREFIX = 'contact'

function attachmentContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  switch (ext) {
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.pdf': return 'application/pdf'
    case '.zip': return 'application/zip'
    case '.txt': return 'text/plain'
    default: return 'application/octet-stream'
  }
}

// ============================================================================
// PRESIGN AN ATTACHMENT UPLOAD  (anonymous or signed in)
// ============================================================================

router.post(
  '/presign-attachment',
  optionalAuth,
  uploadRateLimit,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!isR2Enabled()) {
      throw new ValidationError('File uploads are not configured (R2 is disabled)')
    }
    const { filename } = req.body ?? {}
    if (!filename || typeof filename !== 'string') {
      throw new ValidationError('filename is required')
    }
    const ext = path.extname(filename).toLowerCase()
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.zip', '.txt']
    if (!allowed.includes(ext)) {
      throw new ValidationError(`Attachment must be one of: ${allowed.join(', ')}`)
    }
    const contentType = attachmentContentType(filename)
    const key = `${ATTACHMENT_PREFIX}/${crypto.randomBytes(16).toString('hex')}${ext}`
    const presigned = await presignUpload(key, contentType, 300)
    res.json({ ...presigned, contentType, headers: { 'Content-Type': contentType }, expiresIn: 300 })
  }),
)

// ============================================================================
// SUBMIT THE CONTACT FORM
// ============================================================================

interface AttachmentInput { key: string; filename?: string; contentType?: string }

router.post(
  '/',
  optionalAuth,
  emailRateLimit,
  asyncHandler(async (req: AuthRequest, res) => {
    const { name, email, subject, message, attachments } = req.body ?? {}

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('Your name is required')
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw new ValidationError('A valid email address is required')
    }
    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      throw new ValidationError('A subject is required')
    }
    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      throw new ValidationError('Message must be at least 10 characters')
    }

    const atts: AttachmentInput[] = Array.isArray(attachments) ? attachments.slice(0, MAX_ATTACHMENTS) : []
    for (const a of atts) {
      if (!a?.key || typeof a.key !== 'string' || !a.key.startsWith(`${ATTACHMENT_PREFIX}/`)) {
        throw new ValidationError('Invalid attachment')
      }
    }

    const trimmedName = name.trim().slice(0, 200)
    const trimmedEmail = email.trim().slice(0, 255)
    const trimmedSubject = subject.trim().slice(0, 200)
    const trimmedMessage = message.trim()
    const userId = req.userId ?? null

    // Persist first so the message survives even if the email send fails —
    // sendEmail() logs and swallows errors rather than throwing (see services/email.ts).
    const client = await db.connect()
    let messageId: string
    try {
      await client.query('BEGIN')
      const r = await client.query(
        `INSERT INTO contact_messages (user_id, name, email, subject, message)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [userId, trimmedName, trimmedEmail, trimmedSubject, trimmedMessage],
      )
      messageId = r.rows[0].id

      for (const a of atts) {
        await client.query(
          `INSERT INTO contact_message_attachments (contact_message_id, file_path, file_name, content_type)
           VALUES ($1, $2, $3, $4)`,
          [messageId, a.key, a.filename || null, a.contentType || null],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }

    const attachmentUrls = atts.map((a) => publicUrl(a.key))

    // Best-effort notifications — a failure here must not fail the request, the
    // message is already saved.
    sendContactMessageToSupport({
      name: trimmedName,
      email: trimmedEmail,
      subject: trimmedSubject,
      message: trimmedMessage,
      userId: userId ?? undefined,
      attachmentUrls,
    }).catch((err) => logger.error('Failed to email support about contact message', { error: err, messageId }))

    sendContactConfirmation({ name: trimmedName, email: trimmedEmail, subject: trimmedSubject })
      .catch((err) => logger.error('Failed to send contact confirmation', { error: err, messageId }))

    logger.info('Contact message submitted', { messageId, userId, attachmentCount: atts.length })
    res.status(201).json({ message: 'Message sent', id: messageId })
  }),
)

export default router
