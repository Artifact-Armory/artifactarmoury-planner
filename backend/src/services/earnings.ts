// backend/src/services/earnings.ts
// The artist earnings ledger (migration 021). Separate charges & transfers model:
// the buyer pays the platform, and on a succeeded order we accrue one earning row per
// order_item at the artist's share. Rows sit `pending` through a hold window (UK
// consumer-cancellation cover), then clear and are paid out in batches by the payout
// job. Refunds/takedowns reverse un-paid rows so the money never leaves the platform.

import { db } from '../db'
import logger from '../utils/logger'

const log = logger.child('EARNINGS')

// 21-day hold: the buyer waives their 14-day cancellation right at download, so 21
// days gives a comfortable clearance margin before we pay the artist. Tunable.
export const PAYOUT_HOLD_DAYS = Number(process.env.PAYOUT_HOLD_DAYS || 21)

export interface ArtistEarningsSummary {
  pending: number   // accrued, still inside the hold window
  cleared: number   // past the hold, awaiting the next payout run
  paid: number      // already transferred to the artist
  reversed: number  // voided by a refund/takedown
  currency: string
}

/**
 * Accrue earnings for every artist line on a paid order. Idempotent — the UNIQUE
 * (order_item_id) constraint + ON CONFLICT means calling this twice (e.g. from both
 * the confirm route and the webhook) never double-pays.
 *
 * artist_amount is taken from order_items.artist_commission_amount, which is the
 * artist's share snapshotted at purchase time (commission_rate = artist share %).
 */
export async function accrueEarningsForOrder(orderId: string): Promise<number> {
  try {
    const result = await db.query(
      `INSERT INTO artist_earnings
         (artist_id, order_id, order_item_id, model_id,
          gross_amount, artist_amount, platform_amount, currency, status, available_at)
       SELECT oi.artist_id, oi.order_id, oi.id, oi.model_id,
              oi.total_price,
              oi.artist_commission_amount,
              (oi.total_price - oi.artist_commission_amount),
              'GBP', 'pending',
              COALESCE(o.paid_at, CURRENT_TIMESTAMP) + ($2 || ' days')::interval
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.order_id = $1 AND oi.artist_id IS NOT NULL
       ON CONFLICT (order_item_id) DO NOTHING`,
      [orderId, String(PAYOUT_HOLD_DAYS)],
    )
    const accrued = result.rowCount ?? 0
    if (accrued > 0) log.info('Accrued artist earnings', { orderId, rows: accrued })
    return accrued
  } catch (err) {
    log.error('accrueEarningsForOrder failed', { error: err, orderId })
    throw err
  }
}

/**
 * Reverse (void) all un-paid earnings for an order — used on refund. Rows already
 * `paid` cannot be voided here (the money is gone); we return how many were already
 * paid so the caller can decide on a clawback / negative future balance.
 */
export async function reverseEarningsForOrder(orderId: string, reason: string): Promise<{ reversed: number; alreadyPaid: number }> {
  try {
    const reversed = await db.query(
      `UPDATE artist_earnings
       SET status = 'reversed', reversed_reason = $2, updated_at = CURRENT_TIMESTAMP
       WHERE order_id = $1 AND status IN ('pending', 'cleared')`,
      [orderId, reason],
    )
    const paid = await db.query(
      `SELECT COUNT(*)::int AS n FROM artist_earnings WHERE order_id = $1 AND status = 'paid'`,
      [orderId],
    )
    const alreadyPaid = paid.rows[0]?.n ?? 0
    log.info('Reversed order earnings', { orderId, reversed: reversed.rowCount, alreadyPaid })
    return { reversed: reversed.rowCount ?? 0, alreadyPaid }
  } catch (err) {
    log.error('reverseEarningsForOrder failed', { error: err, orderId })
    throw err
  }
}

/**
 * Reverse un-paid earnings tied to a specific model — used on a copyright/inappropriate
 * takedown so the artist isn't paid for a model that has been removed.
 */
export async function reverseEarningsForModel(modelId: string, reason: string): Promise<{ reversed: number; alreadyPaid: number }> {
  try {
    const reversed = await db.query(
      `UPDATE artist_earnings
       SET status = 'reversed', reversed_reason = $2, updated_at = CURRENT_TIMESTAMP
       WHERE model_id = $1 AND status IN ('pending', 'cleared')`,
      [modelId, reason],
    )
    const paid = await db.query(
      `SELECT COUNT(*)::int AS n FROM artist_earnings WHERE model_id = $1 AND status = 'paid'`,
      [modelId],
    )
    const alreadyPaid = paid.rows[0]?.n ?? 0
    log.info('Reversed model earnings', { modelId, reversed: reversed.rowCount, alreadyPaid })
    return { reversed: reversed.rowCount ?? 0, alreadyPaid }
  } catch (err) {
    log.error('reverseEarningsForModel failed', { error: err, modelId })
    throw err
  }
}

/** Money-by-status summary for an artist's Payouts tile. */
export async function getArtistEarningsSummary(artistId: string): Promise<ArtistEarningsSummary> {
  const result = await db.query(
    `SELECT status, COALESCE(SUM(artist_amount), 0) AS total
     FROM artist_earnings
     WHERE artist_id = $1
     GROUP BY status`,
    [artistId],
  )
  const summary: ArtistEarningsSummary = { pending: 0, cleared: 0, paid: 0, reversed: 0, currency: 'GBP' }
  for (const row of result.rows) {
    const key = row.status as keyof ArtistEarningsSummary
    if (key in summary && key !== 'currency') summary[key] = Number(row.total)
  }
  return summary
}

/** Recent earning lines for the artist's Payouts page (most recent first). */
export async function getArtistEarnings(artistId: string, limit = 50): Promise<any[]> {
  const result = await db.query(
    `SELECT e.id, e.gross_amount, e.artist_amount, e.platform_amount, e.currency,
            e.status, e.available_at, e.created_at,
            e.model_id, m.name AS model_name, m.thumbnail_path,
            o.order_number
     FROM artist_earnings e
     LEFT JOIN models m ON e.model_id = m.id
     JOIN orders o ON e.order_id = o.id
     WHERE e.artist_id = $1
     ORDER BY e.created_at DESC
     LIMIT $2`,
    [artistId, limit],
  )
  return result.rows.map((r: any) => ({
    ...r,
    gross_amount: Number(r.gross_amount),
    artist_amount: Number(r.artist_amount),
    platform_amount: Number(r.platform_amount),
  }))
}
