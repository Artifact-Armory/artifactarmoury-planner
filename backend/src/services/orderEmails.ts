// backend/src/services/orderEmails.ts
// The one-time side effects of an order turning `succeeded`: buyer receipt, artist
// sale emails, and model sale counts. Shared by POST /orders/:id/confirm and the
// payment_intent.succeeded webhook — previously only the confirm route did any of
// this, so an order that settled via the webhook alone (async PayPal, or a buyer
// who closed the tab mid-redirect) got no receipt and no sale count at all.
//
// Callers must only invoke this from the request that won the atomic
// `UPDATE orders ... WHERE payment_status <> 'succeeded'` claim, so it runs once.

import { db } from '../db'
import logger from '../utils/logger'
import { sendOrderConfirmation, sendArtistSaleNotification } from './email'
import { PAYOUT_HOLD_DAYS } from './earnings'

const log = logger.child('ORDER_EMAILS')

export async function runOrderPaidSideEffects(orderId: string): Promise<void> {
  try {
    const order = (await db.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0]
    if (!order) return

    const items = (await db.query(
      `SELECT model_id, model_name, artist_id, quantity, unit_price, total_price, artist_commission_amount
       FROM order_items WHERE order_id = $1`,
      [orderId],
    )).rows

    // Buyer receipt. Line prices are NET (total_price, after any promo); the
    // subtotal/VAT rows in the template make them add up to the gross total.
    sendOrderConfirmation({
      order: {
        id: order.id,
        order_number: order.order_number,
        created_at: order.created_at,
        user_email: order.customer_email,
        pricing: {
          subtotal: Number(order.subtotal),
          tax: Number(order.tax),
          taxRate: Number(order.tax_rate),
          total: Number(order.total),
        },
        downloadConsent: !!order.download_consent_at,
      },
      items: items.map((r: any) => ({
        asset: { name: r.model_name, base_price: Number(r.total_price) },
        quantity: Number(r.quantity),
        modelId: r.model_id,
      })),
    }).catch((err) => log.error('Failed to send confirmation email', { error: err, orderId }))

    // One "you made a sale" email per artist, with their own share for this order.
    const byArtist = new Map<string, { names: string[]; earnings: number }>()
    for (const r of items) {
      if (!r.artist_id) continue
      const a = byArtist.get(r.artist_id) ?? { names: [], earnings: 0 }
      a.names.push(r.model_name)
      a.earnings += Number(r.artist_commission_amount) || 0
      byArtist.set(r.artist_id, a)
    }
    if (byArtist.size) {
      const artists = (await db.query(
        `SELECT id, email, COALESCE(NULLIF(artist_name, ''), display_name) AS name
         FROM users WHERE id = ANY($1::uuid[])`,
        [[...byArtist.keys()]],
      )).rows
      for (const u of artists) {
        const a = byArtist.get(u.id)!
        sendArtistSaleNotification({
          artist: { email: u.email, name: u.name },
          order: { id: order.id, order_number: order.order_number, created_at: order.created_at },
          earnings: a.earnings,
          holdDays: PAYOUT_HOLD_DAYS,
          items: a.names.map((name) => ({ asset: { name, base_price: 0 } })),
        }).catch((err) => log.error('Failed to send artist sale email', { error: err, orderId, artistId: u.id }))
      }
    }

    for (const r of items) {
      db.query('UPDATE models SET sale_count = sale_count + $1 WHERE id = $2', [r.quantity, r.model_id])
        .catch((err) => log.error('Failed to update sale count', { error: err, orderId }))
    }
  } catch (err) {
    log.error('runOrderPaidSideEffects failed', { error: err, orderId })
  }
}
