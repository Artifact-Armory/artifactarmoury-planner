// backend/src/services/fx.ts
// Exchange rates for the storefront's "about this much in your currency" guide price.
//
// DISPLAY ONLY. Every order is still priced, taxed and charged in GBP. These rates
// never touch orders, VAT, payouts or Stripe: they only let a buyer outside the UK
// see roughly what a pound price means to them. The buyer's bank does the real
// conversion at its own rate, which is why the storefront labels the figure "about".

import logger from '../utils/logger'

/** European Central Bank reference rates, republished free with no key. Updated once each working day. */
const FX_URL = 'https://api.frankfurter.dev/v1/latest?base=GBP'
const REFRESH_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000

/**
 * The currency a buyer in each tax country would think in. Countries missing here
 * (and the UK) just see pounds. Every code must be one the ECB publishes.
 */
export const COUNTRY_CURRENCY: Record<string, string> = {
  // Euro area (Bulgaria joined 1 Jan 2026, Croatia 2023)
  AT: 'EUR', BE: 'EUR', BG: 'EUR', HR: 'EUR', CY: 'EUR', EE: 'EUR', FI: 'EUR',
  FR: 'EUR', DE: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR', LV: 'EUR', LT: 'EUR',
  LU: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR', SK: 'EUR', SI: 'EUR', ES: 'EUR',
  // Rest of the EU
  CZ: 'CZK', DK: 'DKK', HU: 'HUF', PL: 'PLN', RO: 'RON', SE: 'SEK',
  // Elsewhere
  US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', NO: 'NOK', CH: 'CHF', JP: 'JPY',
  SG: 'SGD', ZA: 'ZAR', BR: 'BRL', IN: 'INR', MX: 'MXN',
}

type FxSnapshot = { date: string; rates: Record<string, number> }

let cache: FxSnapshot | null = null
let fetchedAt = 0
let inFlight: Promise<void> | null = null

async function refresh(): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(FX_URL, { signal: controller.signal })
    if (!res.ok) throw new Error(`FX fetch failed: HTTP ${res.status}`)
    const body: any = await res.json()
    const wanted = new Set(Object.values(COUNTRY_CURRENCY))
    const rates: Record<string, number> = {}
    for (const [code, value] of Object.entries(body?.rates ?? {})) {
      const n = Number(value)
      if (wanted.has(code) && Number.isFinite(n) && n > 0) rates[code] = n
    }
    if (!Object.keys(rates).length) throw new Error('FX fetch returned no usable rates')
    cache = { date: String(body?.date ?? ''), rates }
    fetchedAt = Date.now()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Latest rates from GBP, refreshed every few hours. If the source is down we keep
 * serving the last good set (a day-old rate is fine for a guide price) and, with
 * none at all, return empty rates so the storefront simply shows pounds.
 */
export async function getFxRates(): Promise<FxSnapshot> {
  if (!cache || Date.now() - fetchedAt > REFRESH_MS) {
    if (!inFlight) {
      inFlight = refresh()
        .catch((error) => {
          logger.warn('Could not refresh exchange rates; using last known set', { error: String(error) })
          // Back off so a dead source isn't hit on every request.
          fetchedAt = Date.now() - REFRESH_MS + 10 * 60 * 1000
        })
        .finally(() => { inFlight = null })
    }
    await inFlight
  }
  return cache ?? { date: '', rates: {} }
}
