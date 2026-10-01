// backend/src/services/followerEmails.ts
// Emails to the people who follow an artist, when that artist releases a model or
// starts a sale. Sits alongside the in-app bell notifications (services/
// notifications.ts), which are still written for every follower regardless of
// these email settings.
//
// Rules, all enforced in one query so they can't drift apart:
//  - the follower has OPTED IN (users.email_follow_updates = true — default false;
//    set by the sign-up box or the profile toggle) and hasn't since unsubscribed
//  - the address is verified and the account is active
//  - THROTTLE: at most one email per (follower, artist, kind) per
//    FOLLOWER_EMAIL_THROTTLE_HOURS (default 6). An artist publishing ten models in
//    one go emails each follower once; the bell still lists every model.
//  - for a model sale, followers who already own that model are skipped
// Every email carries the unsubscribe link, List-Unsubscribe headers (so Gmail /
// Apple Mail show their own one-click button) and the company's postal address.

import { db } from '../db'
import logger from '../utils/logger'
import { sendEmailBatch, BatchMessage } from './email'
import { unsubscribeUrl } from './emailPrefs'

const log = logger.child('FOLLOWER_EMAIL')

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'
const THROTTLE_HOURS = Number(process.env.FOLLOWER_EMAIL_THROTTLE_HOURS || 6)
const MAX_RECIPIENTS = Number(process.env.FOLLOWER_EMAIL_MAX_RECIPIENTS || 5000)
const COMPANY_ADDRESS = 'Artifact Armoury Ltd, Unit A, 82 James Carter Road, Mildenhall, IP28 7DE, UK'

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

interface FollowerEmail {
  kind: 'release' | 'sale'
  artistId: string
  subject: string
  heading: string
  /** Plain-text lines, escaped here. */
  lines: string[]
  ctaLabel: string
  ctaPath: string
  /** If set, followers who already own this model are skipped (sale on a model they bought). */
  excludeOwnersOfModelId?: string | null
}

function render(f: FollowerEmail, name: string | null, userId: string): BatchMessage['html'] {
  const unsub = unsubscribeUrl(userId)
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 26px; margin: 0;">${esc(f.heading)}</h1>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <p style="margin: 0 0 12px 0; color: #4b5563;">Hi${name ? ` ${esc(name)}` : ''},</p>
    ${f.lines.map((l, i) => `<p style="margin: ${i === f.lines.length - 1 ? '0' : '0 0 12px 0'}; color: #4b5563;">${esc(l)}</p>`).join('\n    ')}
  </div>

  <div style="text-align: center; margin-bottom: 24px;">
    <a href="${FRONTEND_URL}${f.ctaPath}" style="display: inline-block; padding: 14px 28px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">${esc(f.ctaLabel)}</a>
  </div>

  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 13px;">
    <p style="margin: 0 0 8px 0;">You're getting this because you follow this artist on Artifact Armoury.
      <a href="${unsub}" style="color: #6b7280;">Unsubscribe from artist updates</a></p>
    <p style="margin: 0 0 4px 0;">&copy; ${new Date().getFullYear()} ${esc(COMPANY_ADDRESS)}</p>
  </div>

</body>
</html>
  `
}

/** Claim eligible followers (writing the throttle log), then send. Best-effort. */
async function emailFollowers(f: FollowerEmail): Promise<void> {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.display_name
         FROM follows fo
         JOIN users u ON u.id = fo.follower_id
        WHERE fo.artist_id = $1
          AND u.email_follow_updates = true
          AND u.email_verified = true
          AND u.account_status = 'active'
          AND NOT EXISTS (
                SELECT 1 FROM follower_email_log l
                 WHERE l.follower_id = u.id AND l.artist_id = $1 AND l.kind = $2
                   AND l.sent_at > NOW() - ($3 || ' hours')::interval)
          AND ($4::uuid IS NULL OR NOT EXISTS (
                SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
                 WHERE oi.model_id = $4 AND o.user_id = u.id
                   AND o.payment_status = 'succeeded' AND oi.refunded_at IS NULL))
        LIMIT $5`,
      [f.artistId, f.kind, String(THROTTLE_HOURS), f.excludeOwnersOfModelId ?? null, MAX_RECIPIENTS],
    )
    if (!rows.length) return

    // Record BEFORE sending: if the send fails we under-send rather than risk
    // double-emailing people on a retry or an overlapping publish.
    await db.query(
      `INSERT INTO follower_email_log (follower_id, artist_id, kind)
       SELECT unnest($1::uuid[]), $2, $3`,
      [rows.map((r: any) => r.id), f.artistId, f.kind],
    )

    const messages: BatchMessage[] = rows.map((r: any) => ({
      to: r.email,
      subject: f.subject,
      html: render(f, r.display_name, r.id),
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl(r.id)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }))
    await sendEmailBatch(messages)
    log.info('Follower emails sent', { kind: f.kind, artistId: f.artistId, recipients: messages.length })
  } catch (err) {
    log.error('emailFollowers failed', { error: err, kind: f.kind, artistId: f.artistId })
  }
}

export function emailFollowersOfRelease(p: { artistId: string; artistName: string; modelId: string; modelName: string }) {
  return emailFollowers({
    kind: 'release',
    artistId: p.artistId,
    subject: `${p.artistName} just released “${p.modelName}”`,
    heading: 'New from an artist you follow',
    lines: [`${p.artistName} has released a new model: ${p.modelName}.`],
    ctaLabel: 'See the new model',
    ctaPath: `/models/${p.modelId}`,
  })
}

export function emailFollowersOfSale(p: {
  artistId: string
  artistName: string
  what: string
  percent: number
  endsOn: string
  ctaPath: string
  modelId: string | null
}) {
  return emailFollowers({
    kind: 'sale',
    artistId: p.artistId,
    subject: `${p.artistName} has a sale: ${p.percent}% off`,
    heading: `${p.percent}% off from ${p.artistName}`,
    lines: [`${p.artistName} has started a sale: ${p.percent}% off ${p.what}. It ends ${p.endsOn}.`],
    ctaLabel: 'View the sale',
    ctaPath: p.ctaPath,
    excludeOwnersOfModelId: p.modelId,
  })
}
