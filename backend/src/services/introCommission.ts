// backend/src/services/introCommission.ts
// Introductory commission rates (migration 046): an admin can offer an artist a
// higher SHARE (lower platform cut) for their first N months of actually selling,
// then have it automatically revert to their standard rate. Three moving parts:
//
//   1. CREATE  — admin sets intro_commission_rate/months (+ the standard rate to
//                revert to) on the artist's account. Pending: nothing else changes
//                yet, users.commission_rate is untouched.
//   2. START   — the moment the artist's first-ever model is published,
//                maybeStartIntroOffer() stamps starts_at/ends_at and flips
//                commission_rate to the intro rate. Called from the model-publish
//                route, not on a timer — the whole point is the clock starts when
//                they actually go live, not when the admin sets it up.
//   3. REVERT  — a scheduler sweeps for artists whose ends_at has passed and flips
//                commission_rate back to standard_commission_rate.
//
// users.commission_rate stays the single value every earnings/payout code path
// reads to snapshot an artist's share at purchase time — this module only decides
// what that value should currently be.

import { db } from '../db'
import logger from '../utils/logger'
import { createNotification } from './notifications'
import { ValidationError, NotFoundError } from '../middleware/error'

const log = logger.child('INTRO_COMMISSION')

/**
 * Set (or replace) a pending introductory offer on an artist's account. Freely
 * editable while pending (not yet started) or after a previous one has already
 * ended (fresh offer). Blocked only while one is actively running — cancel it
 * first (cancelIntroOffer) if it needs to change; editing a live countdown
 * invites exactly the kind of off-by-one-month confusion this is trying to avoid.
 *
 * If the artist has ALREADY published a model, there's no future "first publish"
 * left for the clock to wait for — the offer starts immediately instead of
 * silently sitting pending forever.
 */
export async function setIntroOffer(
  artistId: string,
  introRate: number,
  months: number,
  standardRate: number,
): Promise<{ startedImmediately: boolean }> {
  const existing = await db.query(
    `SELECT role, intro_commission_starts_at, intro_commission_ends_at FROM users WHERE id = $1`,
    [artistId],
  )
  if (existing.rows.length === 0) {
    throw new NotFoundError('Artist')
  }
  if (existing.rows[0].role !== 'artist') {
    throw new ValidationError('Introductory rates only apply to artist accounts')
  }
  // Block only while an offer is genuinely pending or actively running — a lapsed
  // (ended) one shouldn't stop the admin setting up a fresh offer later.
  const startedAt = existing.rows[0].intro_commission_starts_at
  const endsAt = existing.rows[0].intro_commission_ends_at
  const stillRunning = startedAt && (!endsAt || new Date(endsAt) > new Date())
  if (stillRunning) {
    throw new ValidationError(
      'This artist already has an introductory offer running. Cancel it first if you want to change it.',
    )
  }

  // Reset starts_at/ends_at too — this is establishing a fresh PENDING offer, even
  // if an earlier one already ran its course and left those columns stamped.
  await db.query(
    `UPDATE users
     SET intro_commission_rate = $1,
         intro_commission_months = $2,
         standard_commission_rate = $3,
         intro_commission_starts_at = NULL,
         intro_commission_ends_at = NULL
     WHERE id = $4`,
    [introRate, months, standardRate, artistId],
  )

  log.info('Introductory commission offer set', { artistId, introRate, months, standardRate })

  const alreadyPublished = await db.query(
    `SELECT 1 FROM models WHERE artist_id = $1 AND published_at IS NOT NULL LIMIT 1`,
    [artistId],
  )
  const startedImmediately = alreadyPublished.rows.length > 0
  if (startedImmediately) {
    await startIntroNow(artistId, introRate, months)
  }
  return { startedImmediately }
}

/** Stamp the intro period as started right now and flip commission_rate to the intro rate. */
async function startIntroNow(artistId: string, introRate: number, months: number): Promise<void> {
  const result = await db.query(
    `UPDATE users
     SET commission_rate = intro_commission_rate,
         intro_commission_starts_at = CURRENT_TIMESTAMP,
         intro_commission_ends_at = CURRENT_TIMESTAMP + ($2 || ' months')::interval
     WHERE id = $1
     RETURNING intro_commission_ends_at`,
    [artistId, months],
  )
  const endsAt = result.rows[0]?.intro_commission_ends_at
  log.info('Introductory commission period started', { artistId, rate: introRate, months, endsAt })

  await createNotification({
    userId: artistId,
    type: 'intro_commission_started',
    title: `Your introductory rate is now active`,
    body: `You'll keep ${introRate}% of each sale for the next ${months} month${months === 1 ? '' : 's'}, then it'll return to your standard rate.`,
    link: '/artist/payouts',
  })
}

/** Cancel a pending or active offer. If active, reverts commission_rate immediately. */
export async function cancelIntroOffer(artistId: string): Promise<void> {
  const result = await db.query(
    `SELECT commission_rate, intro_commission_rate, standard_commission_rate, intro_commission_starts_at
     FROM users WHERE id = $1 AND role = 'artist'`,
    [artistId],
  )
  if (result.rows.length === 0) {
    throw new NotFoundError('Artist')
  }
  const row = result.rows[0]
  const isActive = !!row.intro_commission_starts_at
  const onIntroRate = row.intro_commission_rate != null && Number(row.commission_rate) === Number(row.intro_commission_rate)

  await db.query(
    `UPDATE users
     SET commission_rate = CASE WHEN $2 THEN COALESCE(standard_commission_rate, commission_rate) ELSE commission_rate END,
         intro_commission_rate = NULL,
         intro_commission_months = NULL,
         standard_commission_rate = NULL,
         intro_commission_starts_at = NULL,
         intro_commission_ends_at = NULL
     WHERE id = $1`,
    [artistId, isActive && onIntroRate],
  )

  log.info('Introductory commission offer cancelled', { artistId, wasActive: isActive })
}

/**
 * Called after a model is published. No-op unless this artist (a) has a pending
 * intro offer and (b) this was genuinely their first-ever published model.
 */
export async function maybeStartIntroOffer(artistId: string): Promise<void> {
  const userResult = await db.query(
    `SELECT intro_commission_rate, intro_commission_months, intro_commission_starts_at
     FROM users WHERE id = $1`,
    [artistId],
  )
  const user = userResult.rows[0]
  if (!user || user.intro_commission_rate == null || user.intro_commission_starts_at) {
    return // no pending offer
  }

  // "First-ever published model" — published_at is retained across unpublish, so a
  // count of exactly 1 (this one) means nothing from this artist has ever gone live before.
  const countResult = await db.query(
    `SELECT COUNT(*) FROM models WHERE artist_id = $1 AND published_at IS NOT NULL`,
    [artistId],
  )
  if (Number(countResult.rows[0].count) !== 1) return

  await startIntroNow(artistId, Number(user.intro_commission_rate), Number(user.intro_commission_months))
}

/** Sweep: revert any artist whose introductory period has lapsed. */
export async function revertExpiredIntroOffers(): Promise<number> {
  // Still on the intro rate is what makes this self-terminating — once reverted,
  // commission_rate no longer equals intro_commission_rate, so the same WHERE
  // won't match it again next sweep. No separate "already reverted" flag needed.
  const result = await db.query(
    `UPDATE users
     SET commission_rate = standard_commission_rate
     WHERE intro_commission_ends_at IS NOT NULL
       AND intro_commission_ends_at <= CURRENT_TIMESTAMP
       AND commission_rate = intro_commission_rate
     RETURNING id, standard_commission_rate`,
  )

  // createNotification is fire-and-forget (swallows + logs its own failures).
  for (const row of result.rows) {
    await createNotification({
      userId: row.id,
      type: 'intro_commission_ended',
      title: `Your introductory rate has ended`,
      body: `Your commission rate is now back to your standard ${Number(row.standard_commission_rate)}%.`,
      link: '/artist/payouts',
    })
  }

  const n = result.rowCount ?? 0
  if (n > 0) log.info('Reverted lapsed introductory commission offers', { rows: n })
  return n
}

const CHECK_INTERVAL_MS = Number(process.env.INTRO_COMMISSION_CHECK_INTERVAL_MS || 60 * 60 * 1000) // hourly

/** Kick off the recurring revert sweep. Runs a catch-up pass on boot, then on a timer. */
export function startIntroCommissionScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  const tick = () => {
    revertExpiredIntroOffers().catch(err => log.error('Intro commission revert sweep failed', { error: err }))
  }
  setTimeout(tick, 30_000)
  setInterval(tick, CHECK_INTERVAL_MS)
  log.info('Introductory commission scheduler started', { intervalMs: CHECK_INTERVAL_MS })
}
