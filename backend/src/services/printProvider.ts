// backend/src/services/printProvider.ts
//
// Provider-agnostic "get me a print quote" abstraction. The artist dashboard's
// Print button calls this to price up a physical print of a model. Today it is
// backed by a deterministic MockPrintProvider; when a real outsourced print
// service is chosen, add an adapter class implementing `PrintProvider` and wire
// it into `getPrintProvider()` — the route, pricing maths and UI don't change.
//
// Final customer-facing print price = provider cost + artist fee + site fee,
// where the artist fee is the model's existing digital base_price and the site
// fee is a flat SITE_PRINT_FEE (£1).

import logger from '../utils/logger'

// Flat fee the site adds on top of every print (GBP).
export const SITE_PRINT_FEE = 1.0

export interface PrintQuoteRequest {
  modelId: string
  modelName: string
  /** Bounding-box dimensions in millimetres (from the model row). */
  widthMm?: number | null
  depthMm?: number | null
  heightMm?: number | null
  /** Material to price against; providers may ignore/normalise. */
  material?: string
  quantity?: number
}

export interface PrintQuote {
  /** What the print service charges us to print the model (GBP, ex-fees). */
  providerCost: number
  currency: 'GBP'
  /** Which provider produced this quote (for display/audit). */
  provider: string
  /** Rough production/dispatch lead time, if the provider reports one. */
  estimatedDays?: number
  /** Opaque provider payload, kept for debugging real integrations. */
  raw?: Record<string, unknown>
}

export interface PrintProvider {
  readonly name: string
  getQuote(req: PrintQuoteRequest): Promise<PrintQuote>
}

// ---------------------------------------------------------------------------
// Mock provider — deterministic, plausible quote derived from bounding volume.
// A real provider would upload/reference the STL and return the true price;
// this exists so the whole button → quote → price flow works end-to-end today.
// ---------------------------------------------------------------------------

// PLA density (~1.24 g/cm³) in g/mm³.
const PLA_DENSITY_G_PER_MM3 = 0.00124
// Fraction of the bounding box a typical terrain print actually fills (walls +
// ~20% infill). Bounding-box volume massively overstates real material.
const EFFECTIVE_FILL_FRACTION = 0.18
// Blended material + machine cost per gram the provider charges us (GBP).
const PROVIDER_COST_PER_GRAM = 0.05
// Per-model setup/handling the provider charges (GBP).
const PROVIDER_SETUP_COST = 2.5
// Floor so tiny models still cost something sane.
const MIN_PROVIDER_COST = 3.0

class MockPrintProvider implements PrintProvider {
  readonly name = 'mock'

  async getQuote(req: PrintQuoteRequest): Promise<PrintQuote> {
    const w = Number(req.widthMm) || 0
    const d = Number(req.depthMm) || 0
    const h = Number(req.heightMm) || 0
    const quantity = Math.max(1, Number(req.quantity) || 1)

    // Bounding-box volume (mm³) → effective material volume → weight → cost.
    const boundingVolume = w > 0 && d > 0 && h > 0 ? w * d * h : 0
    const materialVolume = boundingVolume * EFFECTIVE_FILL_FRACTION
    const weightG = materialVolume * PLA_DENSITY_G_PER_MM3
    const materialCost = weightG * PROVIDER_COST_PER_GRAM

    const perUnit = Math.max(MIN_PROVIDER_COST, PROVIDER_SETUP_COST + materialCost)
    const providerCost = Number((perUnit * quantity).toFixed(2))

    return {
      providerCost,
      currency: 'GBP',
      provider: this.name,
      estimatedDays: 5,
      raw: { boundingVolumeMm3: boundingVolume, weightG: Number(weightG.toFixed(1)), quantity },
    }
  }
}

let cached: PrintProvider | null = null

/**
 * Resolve the configured print provider. Controlled by PRINT_FARM_PROVIDER
 * (default 'mock'). Add real providers here as adapter classes.
 */
export function getPrintProvider(): PrintProvider {
  if (cached) return cached
  const configured = (process.env.PRINT_FARM_PROVIDER || 'mock').toLowerCase()

  switch (configured) {
    case 'mock':
      cached = new MockPrintProvider()
      break
    default:
      // A provider name is set but no adapter exists yet — fail loud rather than
      // silently pricing prints with the mock in production.
      throw new Error(
        `PRINT_FARM_PROVIDER='${configured}' has no adapter. Add one in services/printProvider.ts.`,
      )
  }

  logger.info('Print provider initialised', { provider: cached.name })
  return cached
}

export interface PrintPriceBreakdown {
  providerCost: number
  artistFee: number
  siteFee: number
  total: number
  currency: 'GBP'
  provider: string
  estimatedDays?: number
}

/**
 * Combine a provider quote with the model's artist fee (its digital base price)
 * and the flat site fee into the customer-facing print price.
 */
export function buildPrintPrice(quote: PrintQuote, artistFee: number): PrintPriceBreakdown {
  const artist = Number(artistFee) || 0
  const total = Number((quote.providerCost + artist + SITE_PRINT_FEE).toFixed(2))
  return {
    providerCost: quote.providerCost,
    artistFee: Number(artist.toFixed(2)),
    siteFee: SITE_PRINT_FEE,
    total,
    currency: quote.currency,
    provider: quote.provider,
    estimatedDays: quote.estimatedDays,
  }
}

export default { getPrintProvider, buildPrintPrice, SITE_PRINT_FEE }
