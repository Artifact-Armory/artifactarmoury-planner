// backend/src/services/stripeTax.ts
//
// Authoritative order tax via Stripe Tax — replaces the self-declared-country VAT
// estimate (services/vat.ts) as the figure an order is actually charged. Stripe
// derives the rate from the buyer's real billing address supplied at checkout, not
// from whatever country the buyer picked while browsing, which is what makes this
// non-gameable: the storefront-wide country picker (taxStore.ts / CountrySelect)
// still drives the pre-checkout *display estimate*, but no longer determines what
// anyone is charged.
//
// Requires Stripe Tax to be enabled, and at least one tax registration added, in the
// Stripe Dashboard (Settings → Tax) before it does anything live — see the
// "Prerequisite" note in the checkout tax plan. Until then everything runs through
// STRIPE_MOCK, below.

import { stripe, isStripeMock } from './stripe'
import { rateFor, vatOnLines } from './vat'
import logger from '../utils/logger'

const taxLogger = logger.child('STRIPE_TAX')

export interface TaxLine {
  /** Net amount for this cart line, in pence. */
  amountPence: number
  /** Unique within the calculation — lets a Stripe Tax report show which line was which. */
  reference: string
}

export interface BillingAddress {
  country: string
  postalCode?: string
}

export interface OrderTaxResult {
  /** Stripe Tax calculation id (or a synthetic mock id) — persist on the order so a
   *  transaction can be recorded from it once payment succeeds. */
  calculationId: string
  /** VAT/tax owed, in pence. */
  taxPence: number
  /** Net + tax, in pence. */
  totalPence: number
  /** Country whose rate was actually applied — for orders.tax_country. */
  country: string
  /** Percentage applied, e.g. 20 for 20%. 0 if zero-rated/unregistered/unknown. */
  ratePercent: number
}

/** Prefix on every mock calculation id, so recordTaxTransaction can recognise one
 *  even if STRIPE_MOCK were flipped between order-creation and payment (shouldn't
 *  happen, but this keeps it from ever attempting a live call against a fake id). */
const MOCK_CALC_PREFIX = 'taxcalc_mock_'

/**
 * Authoritative tax for an order, computed from a real billing address.
 *
 * Under STRIPE_MOCK there is no Stripe Tax to ask, so this reproduces exactly the
 * vat.ts calculation checkout used before Stripe Tax existed, keyed off the address's
 * country alone — same numbers as today, so local dev and the mock checkout flow are
 * unaffected. `lines` should be one entry per priced cart line (a bundle is one line
 * at its own price), matching how vatOnLines/the buyer's basket already work.
 */
export async function calculateOrderTax(
  lines: TaxLine[],
  address: BillingAddress
): Promise<OrderTaxResult> {
  const country = address.country.toUpperCase()

  if (isStripeMock()) {
    const netLines = lines.map((l) => l.amountPence / 100)
    const netTotal = netLines.reduce((s, n) => s + n, 0)
    const tax = vatOnLines(netLines, country)
    return {
      calculationId: `${MOCK_CALC_PREFIX}${Date.now()}`,
      taxPence: Math.round(tax * 100),
      totalPence: Math.round((netTotal + tax) * 100),
      country,
      ratePercent: rateFor(country),
    }
  }

  try {
    const calculation = await stripe.tax.calculations.create({
      currency: 'gbp',
      line_items: lines.map((l) => ({
        amount: l.amountPence,
        reference: l.reference,
      })),
      customer_details: {
        address: { country, postal_code: address.postalCode },
        address_source: 'billing',
      },
    })

    // Several breakdown entries can exist (e.g. state + county in the US); take the
    // first that actually carries a rate. `tax_rate_details` is null for exempt/
    // untaxed lines, which is the normal case for a country we hold no registration
    // in — that's a legitimate 0%, not a lookup failure.
    const withRate = calculation.tax_breakdown.find((b) => b.tax_rate_details)
    const ratePercent = withRate?.tax_rate_details
      ? Number(withRate.tax_rate_details.percentage_decimal)
      : 0

    return {
      calculationId: calculation.id as string,
      taxPence: calculation.tax_amount_exclusive,
      totalPence: calculation.amount_total,
      country: calculation.customer_details.address?.country ?? country,
      ratePercent,
    }
  } catch (error) {
    taxLogger.error('Tax calculation failed', { error, country })
    throw new Error('Could not calculate tax for this order')
  }
}

/**
 * Records a calculation as an actual sale with Stripe Tax, once payment has
 * succeeded — this is what makes it count towards an OSS/VAT filing; the calculation
 * alone is only ever a quote. Best-effort, matching accrueEarningsForOrder: a filing
 * record failing to save must never be the thing that blocks or unwinds a paid order.
 * Callers should log and move on rather than throw. No-ops (returns null) under mock,
 * or for a mock calculation id, since there is nothing real to record.
 */
export async function recordTaxTransaction(
  calculationId: string | null | undefined,
  reference: string
): Promise<string | null> {
  if (!calculationId || isStripeMock() || calculationId.startsWith(MOCK_CALC_PREFIX)) {
    return null
  }
  try {
    const transaction = await stripe.tax.transactions.createFromCalculation({
      calculation: calculationId,
      reference,
    })
    taxLogger.info('Tax transaction recorded', { transactionId: transaction.id, reference })
    return transaction.id
  } catch (error) {
    taxLogger.error('Failed to record tax transaction', { error, calculationId, reference })
    return null
  }
}

export default { calculateOrderTax, recordTaxTransaction }
