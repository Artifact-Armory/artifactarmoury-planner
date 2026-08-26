// backend/src/routes/tax.ts
// Public VAT rate lookup, so the storefront can show tax-inclusive prices.

import { Router } from 'express'
import { asyncHandler } from '../middleware/error'
import { taxCountries, DEFAULT_TAX_COUNTRY } from '../services/vat'

const router = Router()

/**
 * GET /api/tax/countries
 *
 * The buyer's country picker and every tax-inclusive price on the storefront are
 * driven by this, so rates live in one place and a rate change ships with a backend
 * deploy — no frontend rebuild, and no chance of the two disagreeing about what a
 * buyer owes. Public and immutable enough to cache hard.
 */
router.get(
  '/countries',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600')
    res.json({
      defaultCountry: DEFAULT_TAX_COUNTRY,
      countries: taxCountries(),
    })
  })
)

export default router
