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

/** How many times this user has already redeemed this code. */
export async function customerRedemptionCount(q: Queryable, codeId: string, userId: string): Promise<number> {
  const { rows } = await q.query(
    `SELECT COUNT(*) FROM promo_code_redemptions WHERE promo_code_id = $1 AND user_id = $2`,
    [codeId, userId],
  )
  return parseInt(rows[0].count, 10)
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

/** Remaining total redemptions for a code, or null = unlimited. */
export function remainingRedemptions(code: PromoCode): number | null {
  if (code.max_redemptions == null) return null
  return Math.max(0, code.max_redemptions - code.redemption_count)
}

/** Remaining redemptions for one customer, or null = unlimited. */
export async function remainingForCustomer(q: Queryable, code: PromoCode, userId: string): Promise<number | null> {
  if (code.max_redemptions_per_customer == null) return null
  const used = await customerRedemptionCount(q, code.id, userId)
  return Math.max(0, code.max_redemptions_per_customer - used)
}

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
  await q.query(`UPDATE promo_codes SET redemption_count = redemption_count + 1 WHERE id = $1`, [args.promoCodeId])
  logger.info('Promo code redeemed', args)
}
