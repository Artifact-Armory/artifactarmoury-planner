// backend/src/services/vat.ts
//
// Destination VAT for digital services (see CLAUDE.md "VAT: we are the deemed
// supplier"). Artist prices are stored and paid out **net**; the buyer pays
// net + the VAT rate of the country they're in, and every buyer-facing surface
// displays the gross figure so there is no surprise at checkout.
//
// ---------------------------------------------------------------------------
// RATES NEED MAINTAINING. These are standard rates for electronically supplied
// services, correct to the best of our knowledge but *not* authoritative — member
// states change them (Estonia, Finland, Romania and Slovakia all moved recently).
// Verify against the EU's "VAT rates applied in the Member States" publication
// before launch, and re-check periodically.
//
// The long-term answer is Stripe Tax (~0.5%/transaction): it maintains the rates
// and the customer-location evidence for you. This module is deliberately shaped as
// a single `rateFor()` lookup so it can be swapped for that call without touching
// anything downstream.
// ---------------------------------------------------------------------------

import logger from '../utils/logger'

const vatLogger = logger.child('VAT')

export interface TaxCountry {
  /** ISO 3166-1 alpha-2. */
  code: string
  name: string
  /** Standard VAT rate as a percentage, e.g. 20 for 20%. */
  rate: number
}

/**
 * UK + EU-27 standard rates. Countries absent from this table are zero-rated —
 * see `rateFor()` for what that does and does not mean.
 */
const VAT_TABLE: readonly TaxCountry[] = [
  { code: 'GB', name: 'United Kingdom', rate: 20 },
  { code: 'AT', name: 'Austria', rate: 20 },
  { code: 'BE', name: 'Belgium', rate: 21 },
  { code: 'BG', name: 'Bulgaria', rate: 20 },
  { code: 'HR', name: 'Croatia', rate: 25 },
  { code: 'CY', name: 'Cyprus', rate: 19 },
  { code: 'CZ', name: 'Czechia', rate: 21 },
  { code: 'DK', name: 'Denmark', rate: 25 },
  { code: 'EE', name: 'Estonia', rate: 24 },
  { code: 'FI', name: 'Finland', rate: 25.5 },
  { code: 'FR', name: 'France', rate: 20 },
  { code: 'DE', name: 'Germany', rate: 19 },
  { code: 'GR', name: 'Greece', rate: 24 },
  { code: 'HU', name: 'Hungary', rate: 27 },
  { code: 'IE', name: 'Ireland', rate: 23 },
  { code: 'IT', name: 'Italy', rate: 22 },
  { code: 'LV', name: 'Latvia', rate: 21 },
  { code: 'LT', name: 'Lithuania', rate: 21 },
  { code: 'LU', name: 'Luxembourg', rate: 17 },
  { code: 'MT', name: 'Malta', rate: 18 },
  { code: 'NL', name: 'Netherlands', rate: 21 },
  { code: 'PL', name: 'Poland', rate: 23 },
  { code: 'PT', name: 'Portugal', rate: 23 },
  { code: 'RO', name: 'Romania', rate: 21 },
  { code: 'SK', name: 'Slovakia', rate: 23 },
  { code: 'SI', name: 'Slovenia', rate: 22 },
  { code: 'ES', name: 'Spain', rate: 21 },
  { code: 'SE', name: 'Sweden', rate: 25 },
]

/**
 * Everywhere else the buyer can pick. Zero-rated *by us*, which is the right
 * default for a UK seller at launch scale but is NOT the same as "no tax exists
 * there" — US state sales tax on digital goods, Australian GST, Norwegian VAT and
 * others have their own registration thresholds that a growing seller can cross.
 * Listed explicitly so the picker isn't a UK/EU-only list that strands everyone else.
 */
const ZERO_RATED: readonly TaxCountry[] = [
  { code: 'US', name: 'United States', rate: 0 },
  { code: 'CA', name: 'Canada', rate: 0 },
  { code: 'AU', name: 'Australia', rate: 0 },
  { code: 'NZ', name: 'New Zealand', rate: 0 },
  { code: 'NO', name: 'Norway', rate: 0 },
  { code: 'CH', name: 'Switzerland', rate: 0 },
  { code: 'JP', name: 'Japan', rate: 0 },
  { code: 'SG', name: 'Singapore', rate: 0 },
  { code: 'ZA', name: 'South Africa', rate: 0 },
  { code: 'BR', name: 'Brazil', rate: 0 },
  { code: 'IN', name: 'India', rate: 0 },
  { code: 'MX', name: 'Mexico', rate: 0 },
]

/** Fallback when the buyer hasn't told us where they are. */
export const DEFAULT_TAX_COUNTRY = 'GB'

const BY_CODE = new Map<string, TaxCountry>(
  [...VAT_TABLE, ...ZERO_RATED].map((c) => [c.code, c])
)

/**
 * Countries we are *actually registered* to charge VAT in, right now. Empty as of
 * 2026-08-31: the business has no UK VAT number (below the UK threshold, no
 * registration filed) and no EU non-Union OSS registration either — see the "VAT: we
 * are the deemed supplier" note in CLAUDE.md / project memory.
 *
 * VAT_TABLE above is reference data (what a country's rate *would* be if we were
 * registered there) — it deliberately stays accurate even while this set is empty,
 * so switching a country on later is a one-line change here, not a rewrite of the
 * rate table. This set is the separate, harder gate: charging a rate without holding
 * the matching registration isn't "safely conservative", it's not something we're
 * allowed to do — so `rateFor()` (and therefore the country list served to the
 * storefront, and every VAT calculation that goes through it) zero-rates anything not
 * listed here, no matter how live payments currently are.
 *
 * ADD A CODE ONLY ONCE THE REGISTRATION ACTUALLY EXISTS:
 *   - `'GB'` once a UK VAT number is issued.
 *   - the rest of VAT_TABLE's codes, all at once, once the EU non-Union OSS
 *     registration is done (one registration covers every EU state — see the memory
 *     note on why there's no "just add France" step):
 *     `...VAT_TABLE.map((c) => c.code).filter((c) => c !== 'GB')`
 */
const REGISTERED_COUNTRIES: ReadonlySet<string> = new Set<string>([])

/** The rate we can *actually* charge for a country — 0 if we hold no registration
 *  there, regardless of what VAT_TABLE says that country's rate nominally is. */
function effectiveRate(code: string, nominalRate: number): number {
  return REGISTERED_COUNTRIES.has(code) ? nominalRate : 0
}

/** Every country the buyer can choose, VAT-charging ones first, then A–Z. Rates are
 *  already gated by REGISTERED_COUNTRIES, so the storefront never displays a rate we
 *  can't actually charge. */
export function taxCountries(): TaxCountry[] {
  const sortByName = (a: TaxCountry, b: TaxCountry) => a.name.localeCompare(b.name)
  const gated = (c: TaxCountry): TaxCountry => ({ ...c, rate: effectiveRate(c.code, c.rate) })
  return [...[...VAT_TABLE].sort(sortByName), ...[...ZERO_RATED].sort(sortByName)].map(gated)
}

export function isKnownTaxCountry(code?: string | null): boolean {
  return !!code && BY_CODE.has(code.toUpperCase())
}

/**
 * VAT percentage for a country. Unknown or missing codes are zero-rated rather
 * than defaulting to a UK 20% — over-charging a buyer we can't place is worse than
 * under-collecting, and the checkout always sends a code it got from `taxCountries()`.
 * Also zero-rated: any country we don't currently hold a registration for, even one
 * with a nonzero rate in VAT_TABLE — see REGISTERED_COUNTRIES above.
 */
export function rateFor(code?: string | null): number {
  if (!code) return 0
  const upper = code.toUpperCase()
  const found = BY_CODE.get(upper)
  if (!found) {
    vatLogger.warn('Unknown tax country; zero-rating', { code })
    return 0
  }
  return effectiveRate(upper, found.rate)
}

/**
 * VAT owed on a net amount, in pounds, rounded to the penny.
 *
 * Rounds the tax on the **order total**, not per line: rounding each line then
 * summing drifts away from the figure the buyer was shown (and from what a tax
 * authority recomputes from the invoice total).
 *
 * All arithmetic goes through integer pence. Doing it in pounds meant the storefront
 * (which grossed up in one step) and this (which adds a rounded VAT line) could
 * disagree by 1p on floating-point ties — at 25% VAT a £4.10 model displayed as
 * £5.13 and charged £5.12. `vatPenceOn` below is the single definition of that
 * rounding, and `frontend/src/store/taxStore.ts` mirrors it exactly; the two must be
 * changed together or the displayed price stops matching the charged one.
 */
export function vatPenceOn(netPence: number, rate: number): number {
  if (rate <= 0) return 0
  return Math.round((netPence * rate) / 100)
}

export function vatOn(netTotal: number, code?: string | null): number {
  const netPence = Math.round(netTotal * 100)
  return vatPenceOn(netPence, rateFor(code)) / 100
}

/** Net + VAT, i.e. what the buyer actually pays. */
export function grossOf(netTotal: number, code?: string | null): number {
  const netPence = Math.round(netTotal * 100)
  return (netPence + vatPenceOn(netPence, rateFor(code))) / 100
}

/**
 * VAT for a whole basket: **per line, then summed** — not the rate applied to the
 * basket total.
 *
 * Both are lawful, but only this one reconciles on screen. The cart shows a gross
 * price per line, so if the total were taxed as one lump the lines would visibly
 * fail to add up: two models at £4.10 and £0.58 with Swedish 25% display as £5.13
 * and £0.73, which sum to £5.86, while 25% of £4.68 gives £5.85. A buyer reading a
 * basket whose numbers don't add up has exactly the "where did that come from?"
 * moment this feature exists to prevent.
 */
export function vatOnLines(netLines: number[], code?: string | null): number {
  const rate = rateFor(code)
  if (rate <= 0) return 0
  const pence = netLines.reduce(
    (sum, net) => sum + vatPenceOn(Math.round(net * 100), rate),
    0
  )
  return pence / 100
}

export default { taxCountries, rateFor, vatOn, grossOf, isKnownTaxCountry, DEFAULT_TAX_COUNTRY }
