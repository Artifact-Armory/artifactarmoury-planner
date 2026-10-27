// backend/src/services/cardFee.ts
//
// The card fee artists pay on each sale: a percent of the line's price before VAT,
// taken out of the artist's share at checkout. The platform covers Stripe's fixed
// 20p per order, so nothing per-order is charged to artists. Founding artists (an
// artist account before FOUNDING_ARTIST_CUTOFF) pay none. users.card_fee_percent
// overrides the rule for a single account.

import { isEuCountry } from './vat'

export const ARTIST_CARD_FEE_PERCENT = Number(process.env.ARTIST_CARD_FEE_PERCENT ?? 1.5)

// Midnight UK time on 1 Nov 2026 (GMT, so the same as UTC).
export const FOUNDING_ARTIST_CUTOFF = new Date('2026-11-01T00:00:00Z')

export interface CardFeeRow {
  card_fee_percent?: string | number | null
  became_artist_at?: string | Date | null
  created_at?: string | Date | null
}

export function isFoundingArtist(row: CardFeeRow): boolean {
  const joined = row.became_artist_at ?? row.created_at
  return !!joined && new Date(joined).getTime() < FOUNDING_ARTIST_CUTOFF.getTime()
}

/** The card fee percent for this artist. DECIMAL comes back from pg as a string. */
export function cardFeePercentFor(row: CardFeeRow): number {
  if (row.card_fee_percent != null && row.card_fee_percent !== '') {
    const override = Number(row.card_fee_percent)
    if (Number.isFinite(override) && override >= 0) return override
  }
  if (isFoundingArtist(row)) return 0
  return ARTIST_CARD_FEE_PERCENT
}

/** The fee in £ on a line priced `netPrice` (before VAT), rounded to the penny. */
export function cardFeeOn(netPrice: number, percent: number): number {
  if (!(netPrice > 0) || !(percent > 0)) return 0
  return Math.round(netPrice * percent) / 100
}

// Stripe UK's standard card pricing (checked by Callum on 2026-10-27), used only to
// ESTIMATE what an order cost us on the admin dashboard: the real fee depends on the
// card used, which we don't record. The buyer's tax country stands in for the card's.
const STRIPE_FIXED_FEE_GBP = 0.2
const STRIPE_PERCENT_UK = 1.5
const STRIPE_PERCENT_EU = 2.5
const STRIPE_PERCENT_OTHER = 3.25

export function estimateStripeFee(orderTotal: number, country: string | null): number {
  if (!(orderTotal > 0)) return 0
  const c = (country || 'GB').toUpperCase()
  const percent = c === 'GB' ? STRIPE_PERCENT_UK : isEuCountry(c) ? STRIPE_PERCENT_EU : STRIPE_PERCENT_OTHER
  return Math.round(orderTotal * percent + STRIPE_FIXED_FEE_GBP * 100) / 100
}
