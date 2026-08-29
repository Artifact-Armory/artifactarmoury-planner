// backend/src/services/payouts.ts
// The scheduled payout engine (migration 021). Two steps, run on a timer:
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
import { createTransfer, isStripeMock, isUsableAccountId } from './stripe'
import { createNotification } from './notifications'

const log = logger.child('PAYOUTS')

// Don't fire a transfer for trivial balances — Stripe/payout overheads make tiny
// transfers wasteful, so sub-threshold balances roll into the next run.
export const MIN_PAYOUT_GBP = Number(process.env.MIN_PAYOUT_GBP || 10)

// How often the payout job runs (weekly by default).
const PAYOUT_INTERVAL_MS = Number(process.env.PAYOUT_INTERVAL_MS || 7 * 24 * 60 * 60 * 1000)

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
    const payout = await client.query(
      `INSERT INTO payouts (artist_id, amount, currency, stripe_account_id, status)
       VALUES ($1, $2, 'GBP', $3, 'pending')
       RETURNING id`,
      [artistId, roundedTotal, accountId],
    )
    const payoutId = payout.rows[0].id

    await client.query(
      `UPDATE artist_earnings SET status = 'paid', payout_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($2::uuid[])`,
      [payoutId, earningIds],
    )

    await client.query('COMMIT')

    // Do the actual money movement AFTER committing the ledger, so a Stripe hiccup
    // can't leave earnings marked paid inside an open transaction. If the transfer
    // fails we flip the payout to 'failed' and release the earnings back to cleared.
    try {
      const transferId = await createTransfer({
        accountId,
        amount: roundedTotal,
        currency: 'gbp',
        description: `Artifact Armoury payout ${payoutId}`,
        metadata: { payout_id: payoutId, artist_id: artistId },
      })
      await db.query(
        `UPDATE payouts SET status = 'paid', stripe_transfer_id = $1, paid_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [transferId, payoutId],
      )
      await createNotification({
        userId: artistId,
        type: 'payout_paid',
        title: `You've been paid £${roundedTotal.toFixed(2)}`,
        body: 'Your cleared earnings have been sent to your connected account.',
        link: '/artist/payouts',
      })
      log.info('Artist paid out', { artistId, payoutId, amount: roundedTotal })
    } catch (transferErr) {
      // Roll the ledger back to cleared and mark the payout failed for retry next run.
      await db.query(
        `UPDATE artist_earnings SET status = 'cleared', payout_id = NULL WHERE payout_id = $1`,
        [payoutId],
      )
      await db.query(
        `UPDATE payouts SET status = 'failed', failure_reason = $2 WHERE id = $1`,
        [payoutId, (transferErr as Error).message],
      )
      throw transferErr
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// Paying out under STRIPE_MOCK would mark earnings `paid` against a fake `tr_mock_`
// transfer id while no money moved — and `paid` is terminal: refund reversal only
// touches pending/cleared rows, so the ledger would be permanently wrong about what
// the artist is owed. This deployment currently runs STRIPE_MOCK=true in production,
// so the guard is not hypothetical. Clearing is still safe and still runs.
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

  const payouts = await runPayouts()
  return { cleared, payouts }
}

/** Kick off the recurring payout job. Runs a catch-up cycle on boot, then on a timer. */
export function startPayoutScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  const tick = () => {
    runPayoutCycle().catch(err => log.error('Payout cycle failed', { error: err }))
  }
  // Small delay on boot so the DB/pool is warm.
  setTimeout(tick, 30_000)
  setInterval(tick, PAYOUT_INTERVAL_MS)
  log.info('Payout scheduler started', { intervalMs: PAYOUT_INTERVAL_MS, minPayout: MIN_PAYOUT_GBP })
}
