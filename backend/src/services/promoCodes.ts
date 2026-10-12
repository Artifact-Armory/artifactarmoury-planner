// backend/src/services/promoCodes.ts
// Artist-run promo codes (migration 048). Distinct from services/sales.ts:
// a Sale is automatic/public and shares its cost proportionally with the
// platform; a promo code is private (a buyer must be given the code) and its
// entire cost comes out of the artist's own commission share — see
// routes/orders.ts pushModelRow, which computes commission off
// `originalPrice` (pre-code) rather than the discounted price actually
// charged. v1 scope: model or portfolio-wide only, no bundles.

import logger from '../utils/logger'

export const PROMO_MIN_PERCENT = 1
export const PROMO_MAX_PERCENT = 95
// After any discount, a line must still cost at least this much — keeps the
// charge above Stripe's practical minimum and stops a code being effectively
// a free giveaway of the whole marketplace fee, not just the artist's cut.
export const PROMO_MIN_ITEM_PRICE = 0.5

type Queryable = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

export interface PromoCode {
  id: string
  artist_id: string
  code: string
  discount_type: 'percent' | 'fixed'
  discount_value: string | number
  scope: 'model' | 'portfolio'
  target_id: string | null
  active: boolean
  starts_at: string | Date
  ends_at: string | Date | null
  max_redemptions: number | null
  redemption_count: number
  max_redemptions_per_customer: number | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function normalizeCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase()
}

/**
 * An active, in-window code by its text (case-insensitive). Null if not
 * found, paused, or outside its start/expiry window. Pass the transaction
 * client and `forUpdate: true` from an order-creation flow to lock the row
 * for the duration of the transaction, closing the race where two
 * simultaneous orders both read the last remaining redemption as available.
 */
export async function findActiveCode(
  q: Queryable,
  codeRaw: unknown,
  opts: { forUpdate?: boolean } = {},
): Promise<PromoCode | null> {
  const code = normalizeCode(codeRaw)
  if (!code) return null
  const { rows } = await q.query(
    `SELECT * FROM promo_codes
     WHERE UPPER(code) = $1 AND active = true
       AND NOW() >= starts_at AND (ends_at IS NULL OR NOW() < ends_at)
     ${opts.forUpdate ? 'FOR UPDATE' : ''}`,
    [code],
  )
  return rows[0] ?? null
}

/** Whether this code discounts a given model, per its scope. */
export function codeAppliesToModel(code: PromoCode, modelId: string, artistId: string): boolean {
  if (code.artist_id !== artistId) return false
  if (code.scope === 'portfolio') return true
  return code.target_id === modelId
}

/**
 * Discount amount (£, net) for one line at `originalPrice`, clamped so the
 * resulting price never drops below PROMO_MIN_ITEM_PRICE (or the original
 * price itself, for an already-cheap line).
 */
export function computeDiscountAmount(code: PromoCode, originalPrice: number): number {
  if (originalPrice <= PROMO_MIN_ITEM_PRICE) return 0
  const raw =
    code.discount_type === 'percent'
      ? originalPrice * (Number(code.discount_value) / 100)
      : Number(code.discount_value)
  const maxDiscount = originalPrice - PROMO_MIN_ITEM_PRICE
  return round2(Math.max(0, Math.min(raw, maxDiscount)))
}

/**
 * Stateful helper that applies a code across several cart lines in order,
 * respecting the code's total and per-customer redemption limits as it goes
 * (first-come within the cart/order — a line beyond the remaining allowance
 * simply isn't discounted, rather than failing the whole cart). Used
 * identically by the checkout preview and the real order-creation route so
 * the two can never disagree about what a code does.
 */
export function createPromoApplier(
  code: PromoCode,
  totalRemaining: number | null,
  perCustomerRemaining: number | null,
) {
  let used = 0
  return {
    apply(originalPrice: number): number {
      if (totalRemaining != null && used >= totalRemaining) return 0
      if (perCustomerRemaining != null && used >= perCustomerRemaining) return 0
      const discount = computeDiscountAmount(code, originalPrice)
      if (discount > 0) used += 1
      return discount
    },
    usedCount: () => used,
  }
}

// How long an unpaid order holds on to the redemptions it reserved. A redemption row
// is written when the order is created (inside the transaction that locks the code
// row, which is what stops two buyers racing for the last use), but an order that
// never gets paid must not use the code up for ever. Before 2026-10-12 it did: an
// abandoned checkout — or "Back to cart" then "Continue", which creates a new order —
// burned a limited code, and the same buyer was then charged full price with no
// warning. Long enough to cover a PayPal round trip.
export const PROMO_RESERVATION_MINUTES = 60

/**
 * What is left of a code's total and per-customer allowance, for `userId`, or null
 * for "unlimited". Counted live from the redemption rows and their orders' state:
 * paid (or refunded, or settling) orders always count; another buyer's unpaid order
 * counts only while its reservation is fresh; the caller's OWN unpaid orders never
 * count — a new checkout supersedes them (POST /orders cancels them).
 */
export async function remainingAllowance(
  q: Queryable,
  code: PromoCode,
  userId: string,
): Promise<{ totalRemaining: number | null; perCustomerRemaining: number | null }> {
  if (code.max_redemptions == null && code.max_redemptions_per_customer == null) {
    return { totalRemaining: null, perCustomerRemaining: null }
  }
  const { rows } = await q.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE r.user_id = $2) AS mine
     FROM promo_code_redemptions r
     JOIN orders o ON o.id = r.order_id
     WHERE r.promo_code_id = $1
       AND (o.payment_status IN ('succeeded', 'refunded', 'processing')
            OR (o.payment_status = 'pending'
                AND o.user_id IS DISTINCT FROM $2
                AND o.created_at > NOW() - make_interval(mins => $3)))`,
    [code.id, userId, PROMO_RESERVATION_MINUTES],
  )
  const total = parseInt(rows[0]?.total ?? '0', 10)
  const mine = parseInt(rows[0]?.mine ?? '0', 10)
  return {
    totalRemaining: code.max_redemptions == null ? null : Math.max(0, code.max_redemptions - total),
    perCustomerRemaining:
      code.max_redemptions_per_customer == null ? null : Math.max(0, code.max_redemptions_per_customer - mine),
  }
}

/**
 * Reserve one discounted line against a code. `promo_codes.redemption_count` is NOT
 * bumped here — it means "used on a paid order" and is incremented by
 * countPaidRedemptions once the order is actually paid.
 */
export async function recordRedemption(
  q: Queryable,
  args: {
    promoCodeId: string
    orderId: string
    orderItemId: string
    userId: string
    modelId: string
    discountAmount: number
  },
): Promise<void> {
  await q.query(
    `INSERT INTO promo_code_redemptions (promo_code_id, order_id, order_item_id, user_id, model_id, discount_amount)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [args.promoCodeId, args.orderId, args.orderItemId, args.userId, args.modelId, args.discountAmount],
  )
  logger.info('Promo code reserved', args)
}

/**
 * An order has just been paid: count its reserved redemptions as used. Call only from
 * the request that won the order's payment claim (see services/orderEmails.ts), so it
 * runs once per order.
 */
export async function countPaidRedemptions(q: Queryable, orderId: string): Promise<void> {
  await q.query(
    `UPDATE promo_codes pc
     SET redemption_count = pc.redemption_count + x.n
     FROM (SELECT promo_code_id, COUNT(*)::int AS n
           FROM promo_code_redemptions WHERE order_id = $1
           GROUP BY promo_code_id) x
     WHERE pc.id = x.promo_code_id`,
    [orderId],
  )
}
