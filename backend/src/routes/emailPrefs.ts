// backend/src/routes/emailPrefs.ts
// Opt-out for follower-update emails.
//  - GET  /unsubscribe  public: shows a confirm button (a GET must not change state,
//                       or a mail scanner pre-fetching the link would unsubscribe people)
//  - POST /unsubscribe  public: performs it; also what a mail client's one-click
//                       "Unsubscribe" button calls (RFC 8058)
//  - GET/PATCH /preferences  signed-in: the same switch, for the profile page

import { Router } from 'express'
import { db } from '../db'
import { authenticate } from '../middleware/auth'
import { asyncHandler, ValidationError } from '../middleware/error'
import { verifyUnsubscribeToken } from '../services/emailPrefs'

const router = Router()

const page = (title: string, body: string) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#1f2937;text-align:center">
<h1 style="font-size:22px">${title}</h1>${body}</body></html>`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readLink(req: any): { u: string; t: string } | null {
  const u = String(req.query.u ?? '')
  const t = String(req.query.t ?? '')
  return UUID_RE.test(u) && verifyUnsubscribeToken(u, t) ? { u, t } : null
}

router.get('/unsubscribe', (req, res) => {
  const link = readLink(req)
  if (!link) return res.status(400).send(page('This link isn’t valid', '<p>Sign in and use Profile settings to manage your emails.</p>'))
  res.send(page('Unsubscribe from artist updates?', `
<p>You’ll stop getting emails when artists you follow release new models or start sales. You’ll still see them in your notifications on the site.</p>
<form method="POST" action="/api/email/unsubscribe?u=${link.u}&t=${link.t}">
<button type="submit" style="padding:12px 24px;background:#2563eb;color:#fff;border:0;border-radius:6px;font-size:16px;cursor:pointer">Unsubscribe</button></form>`))
})

router.post('/unsubscribe', asyncHandler(async (req, res) => {
  const link = readLink(req)
  if (!link) return res.status(400).send(page('This link isn’t valid', ''))
  await db.query('UPDATE users SET email_follow_updates = false WHERE id = $1', [link.u])
  res.send(page('You’re unsubscribed', '<p>You won’t get any more artist-update emails. You can turn them back on any time in your Profile settings.</p>'))
}))

router.get('/preferences', authenticate, asyncHandler(async (req, res) => {
  const r = await db.query('SELECT email_follow_updates FROM users WHERE id = $1', [(req as any).userId])
  res.json({ followUpdates: r.rows[0]?.email_follow_updates === true })
}))

router.patch('/preferences', authenticate, asyncHandler(async (req, res) => {
  const { followUpdates } = req.body ?? {}
  if (typeof followUpdates !== 'boolean') throw new ValidationError('followUpdates must be true or false')
  await db.query(
    `UPDATE users SET email_follow_updates = $1,
            marketing_consent_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE marketing_consent_at END
      WHERE id = $2`,
    [followUpdates, (req as any).userId],
  )
  res.json({ followUpdates })
}))

export default router
