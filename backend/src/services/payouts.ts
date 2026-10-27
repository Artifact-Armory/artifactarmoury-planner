// backend/src/services/payouts.ts
// The scheduled payout engine (migration 021). Two steps; clearing runs hourly and
// paying out runs once a month, on the 1st (UK time, migration 083):
//
//   1. CLEAR   — flip `pending` earnings whose hold window has elapsed to `cleared`.
//   2. PAY OUT — for each artist with a cleared balance over the minimum threshold and
//                a completed Stripe Connect account, create one batched transfer and
//                mark those earnings `paid`.
//
// Uses separate charges & transfers: the buyer already paid the platform, so a payout
// is a Stripe transfer from the platform balance to the artist's connected account.

import { db } from '../db'
import logger from '../utils/logger'
import {
  createTransfer,
  findTransferByGroup,
  isAmbiguousStripeError,
  isStripeMock,
  isUsableAccountId,
} from './stripe'
import { createNotification } from './notifications'

const log = logger.child('PAYOUTS')

// The pool or a single client. The reconcile step holds a row lock on one client, so
// everything it writes must go through that same client or it waits on itself.
type Queryable = { query: (text: string, params?: any[]) => Promise<any> }

// Don't fire a transfer for trivial balances — Stripe/payout overheads make tiny
// transfers wasteful, so sub-threshold balances roll into the next run.
export const MIN_PAYOUT_GBP = Number(process.env.MIN_PAYOUT_GBP || 10)

// How often the scheduler wakes. Each wake clears matured earnings; the payout itself
// only happens on the first wake of a new month. (A plain 30-day setInterval won't do:
// Node caps timers at ~24.8 days, and a redeploy would restart the count.)
const SCHEDULER_TICK_MS = 60 * 60 * 1000

/** Step 1: clear earnings past their hold window. Returns how many were cleared. */
export async function clearMaturedEarnings(): Promise<number> {
  const result = await db.query(
    `UPDATE artist_earnings
     SET status = 'cleared', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'pending' AND available_at <= CURRENT_TIMESTAMP`,
  )
  const n = result.rowCount ?? 0
  if (n > 0) log.info('Cleared matured earnings', { rows: n })
  return n
}

/**
 * Step 2: pay each eligible artist their cleared balance in one batch. An artist is
 * eligible if they have a completed Connect account and a cleared balance ≥ the minimum.
 * Returns a per-artist summary.
 */
export async function runPayouts(): Promise<Array<{ artistId: string; amount: number; status: string }>> {
  // Cleared, un-paid balances grouped by artist, joined to their Connect account.
  const balances = await db.query(
    `SELECT e.artist_id,
            u.stripe_account_id,
            u.stripe_onboarding_complete,
            COALESCE(SUM(e.artist_amount), 0) AS balance
     FROM artist_earnings e
     JOIN users u ON e.artist_id = u.id
     WHERE e.status = 'cleared' AND e.payout_id IS NULL
     GROUP BY e.artist_id, u.stripe_account_id, u.stripe_onboarding_complete
     HAVING COALESCE(SUM(e.artist_amount), 0) >= $1`,
    [MIN_PAYOUT_GBP],
  )

  const results: Array<{ artistId: string; amount: number; status: string }> = []

  for (const row of balances.rows) {
    const artistId = row.artist_id as string
    const amount = Number(row.balance)
    const accountId = row.stripe_account_id as string | null

    // No completed payout account yet → leave the balance cleared; it'll pay out once
    // they finish Stripe onboarding. `isUsableAccountId` also rejects a leftover
    // `acct_mock_...` from before real keys were switched on, which Stripe would
    // reject anyway — better to hold the money than to book a failed transfer.
    if (!isUsableAccountId(accountId) || !row.stripe_onboarding_complete) {
      log.warn('Artist has cleared balance but no active Connect account — holding', { artistId, amount })
      results.push({ artistId, amount, status: 'no_account' })
      continue
    }

    await payArtist(artistId, accountId, amount)
      .then(() => results.push({ artistId, amount, status: 'paid' }))
      .catch(err => {
        log.error('Payout to artist failed', { error: err, artistId, amount })
        results.push({ artistId, amount, status: 'failed' })
      })
  }

  return results
}

/** Create a payout batch for one artist, transfer via Stripe, mark earnings paid. */
async function payArtist(artistId: string, accountId: string, amount: number): Promise<void> {
  const client = await db.connect()
  let payout: { id: string; amount: number; transferGroup: string }
  try {
    await client.query('BEGIN')

    // Re-read the exact cleared rows inside the tx and lock them so a concurrent run
    // can't double-pay. Recompute the amount from the locked rows.
    const rows = await client.query(
      `SELECT id, artist_amount FROM artist_earnings
       WHERE artist_id = $1 AND status = 'cleared' AND payout_id IS NULL
       FOR UPDATE`,
      [artistId],
    )
    if (rows.rows.length === 0) { await client.query('ROLLBACK'); return }

    const total = rows.rows.reduce((s: number, r: any) => s + Number(r.artist_amount), 0)
    const roundedTotal = Math.round(total * 100) / 100
    const earningIds = rows.rows.map((r: any) => r.id)

    // Create the payout batch (pending) first so we have an id to stamp on the earnings.
    const inserted = await client.query(
      `INSERT INTO payouts (artist_id, amount, currency, stripe_account_id, status)
       VALUES ($1, $2, 'GBP', $3, 'pending')
       RETURNING id`,
      [artistId, roundedTotal, accountId],
    )
    const payoutId = inserted.rows[0].id
    const transferGroup = `payout_${payoutId}`
    await client.query(`UPDATE payouts SET transfer_group = $1 WHERE id = $2`, [transferGroup, payoutId])

    await client.query(
      `UPDATE artist_earnings SET status = 'paid', payout_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($2::uuid[])`,
      [payoutId, earningIds],
    )

    await client.query('COMMIT')
    payout = { id: payoutId, amount: roundedTotal, transferGroup }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  // Do the actual money movement AFTER committing the ledger, so a Stripe hiccup
  // can't leave earnings marked paid inside an open transaction.
  await transferPayout(db, payout.id, artistId, accountId, payout.amount, payout.transferGroup)
}

/**
 * Send one payout's money and record the outcome.
 *
 * - Stripe confirms the transfer → payout `paid`.
 * - Stripe definitely refused it → payout `failed`, earnings back to `cleared` for the
 *   next run (no money moved, so nothing can be paid twice).
 * - The answer is unknown (timeout, dropped connection, 5xx) → the transfer may well
 *   have gone through, so NOTHING is released: the payout stays `pending` with its
 *   earnings held, and reconcilePendingPayouts settles it on the next run by looking
 *   the transfer up. This used to release the earnings, and the next run paid them
 *   again — a double payout whenever Stripe's response was lost.
 */
async function transferPayout(
  q: Queryable,
  payoutId: string,
  artistId: string,
  accountId: string,
  amount: number,
  transferGroup: string,
): Promise<void> {
  let transferId: string
  try {
    transferId = await createTransfer({
      accountId,
      amount,
      currency: 'gbp',
      description: `Artifact Armoury payout ${payoutId}`,
      metadata: { payout_id: payoutId, artist_id: artistId },
      transferGroup,
      idempotencyKey: transferGroup,
    })
  } catch (transferErr) {
    const message = (transferErr as Error).message
    if (isAmbiguousStripeError(transferErr)) {
      await q.query(
        `UPDATE payouts SET failure_reason = $2 WHERE id = $1`,
        [payoutId, `Transfer unconfirmed, will be checked on the next run: ${message}`],
      )
      log.error('Payout transfer outcome unknown — holding earnings for reconciliation', {
        error: transferErr, payoutId, artistId, amount,
      })
    } else {
      // Roll the ledger back to cleared and mark the payout failed for retry next run.
      await q.query(
        `UPDATE artist_earnings SET status = 'cleared', payout_id = NULL WHERE payout_id = $1`,
        [payoutId],
      )
      await q.query(
        `UPDATE payouts SET status = 'failed', failure_reason = $2 WHERE id = $1`,
        [payoutId, message],
      )
    }
    throw transferErr
  }
  await markPayoutPaid(q, payoutId, artistId, amount, transferId)
}

async function markPayoutPaid(
  q: Queryable,
  payoutId: string,
  artistId: string,
  amount: number,
  transferId: string,
): Promise<void> {
  await q.query(
    `UPDATE payouts SET status = 'paid', stripe_transfer_id = $1, paid_at = CURRENT_TIMESTAMP, failure_reason = NULL
     WHERE id = $2`,
    [transferId, payoutId],
  )
  await createNotification({
    userId: artistId,
    type: 'payout_paid',
    title: `You've been paid £${amount.toFixed(2)}`,
    body: 'Your cleared earnings have been sent to your connected account.',
    link: '/artist/payouts',
  })
  log.info('Artist paid out', { artistId, payoutId, amount })
}

// A payout younger than this may still be mid-transfer in another request, so it is
// left alone.
const RECONCILE_MIN_AGE_MINUTES = 10

/**
 * Settle payouts whose transfer outcome was never confirmed (see transferPayout). For
 * each, ask Stripe whether a transfer exists under its transfer_group: if so, record
 * it; if not, send it now. Each row is locked while it's handled so two servers can't
 * both send it. Payouts from before migration 071 have no transfer_group and can't be
 * checked this way, so they are only logged for a manual look in the Stripe dashboard.
 */
export async function reconcilePendingPayouts(): Promise<number> {
  const legacy = await db.query(
    `SELECT id, artist_id, amount FROM payouts
     WHERE status = 'pending' AND stripe_transfer_id IS NULL AND transfer_group IS NULL
       AND created_at < NOW() - make_interval(mins => $1)`,
    [RECONCILE_MIN_AGE_MINUTES],
  )
  if (legacy.rows.length) {
    log.warn('Pending payouts with no transfer on record — check them in the Stripe dashboard', {
      payouts: legacy.rows,
    })
  }

  const candidates = await db.query(
    `SELECT id FROM payouts
     WHERE status = 'pending' AND stripe_transfer_id IS NULL AND transfer_group IS NOT NULL
       AND created_at < NOW() - make_interval(mins => $1)
     ORDER BY created_at`,
    [RECONCILE_MIN_AGE_MINUTES],
  )

  let settled = 0
  for (const { id } of candidates.rows) {
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      // Re-check under a row lock: another server may have settled it meanwhile.
      const { rows } = await client.query(
        `SELECT id, artist_id, amount, stripe_account_id, transfer_group FROM payouts
         WHERE id = $1 AND status = 'pending' AND stripe_transfer_id IS NULL
         FOR UPDATE SKIP LOCKED`,
        [id],
      )
      const p = rows[0]
      if (p) {
        const amount = Number(p.amount)
        try {
          const existing = await findTransferByGroup(p.transfer_group)
          if (existing) {
            await markPayoutPaid(client, p.id, p.artist_id, amount, existing)
          } else {
            await transferPayout(client, p.id, p.artist_id, p.stripe_account_id, amount, p.transfer_group)
          }
          settled++
        } catch (err) {
          // transferPayout has already recorded the outcome; an unknown one stays
          // pending and is tried again on the next run.
          log.error('Could not reconcile payout', { error: err, payoutId: p.id })
        }
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      log.error('Payout reconciliation step failed', { error: err, payoutId: id })
    } finally {
      client.release()
    }
  }
  if (settled) log.info('Reconciled pending payouts', { settled })
  return settled
}

// Paying out under STRIPE_MOCK would mark earnings `paid` against a fake `tr_mock_`
// transfer id while no money moved — and `paid` is terminal: refund reversal only
// touches pending/cleared rows, so the ledger would be permanently wrong about what
// the artist is owed. Production has run live payments since 2026-08-31; the guard
// is for local/dev and any future mock deploy. Clearing is still safe and still runs.
// PAYOUTS_ALLOW_MOCK_TRANSFERS=true opts back in for a deliberate dry run.
const ALLOW_MOCK_TRANSFERS = process.env.PAYOUTS_ALLOW_MOCK_TRANSFERS === 'true'

/** Run both steps once. Exposed for the scheduler and for a manual admin trigger. */
export async function runPayoutCycle(): Promise<{ cleared: number; payouts: Array<{ artistId: string; amount: number; status: string }>; skipped?: string }> {
  const cleared = await clearMaturedEarnings()

  if (isStripeMock() && !ALLOW_MOCK_TRANSFERS) {
    log.warn('Payments are mocked — clearing earnings but NOT transferring', {
      cleared,
      hint: 'set PAYMENTS_ENABLED=true with a real STRIPE_SECRET_KEY to pay artists',
    })
    return { cleared, payouts: [], skipped: 'payments_mocked' }
  }

  await reconcilePendingPayouts().catch(err => log.error('Payout reconciliation failed', { error: err }))
  const payouts = await runPayouts()
  return { cleared, payouts }
}

/**
 * Claim this month's scheduled payout run (UK time). True for exactly one caller per
 * month, across restarts and replicas, thanks to payout_runs' primary key.
 */
async function claimMonthlyRun(): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO payout_runs (run_month)
     VALUES (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Europe/London')::date)
     ON CONFLICT (run_month) DO NOTHING
     RETURNING run_month`,
  )
  return (result.rowCount ?? 0) > 0
}

/** Kick off the recurring payout job: clear hourly, pay out on the 1st of each month. */
export function startPayoutScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  const tick = async () => {
    try {
      if (await claimMonthlyRun()) {
        log.info('Monthly payout run starting')
        await runPayoutCycle()
      } else {
        // Keeps the artist's "cleared" figure current between monthly runs.
        await clearMaturedEarnings()
      }
    } catch (err) {
      log.error('Payout cycle failed', { error: err })
    }
  }
  // Small delay on boot so the DB/pool is warm.
  setTimeout(tick, 30_000)
  setInterval(tick, SCHEDULER_TICK_MS)
  log.info('Payout scheduler started', { schedule: 'monthly, 1st (UK time)', minPayout: MIN_PAYOUT_GBP })
}
