// backend/src/routes/cart.ts
// Current, sale-aware prices for the items in a buyer's cart.
//
// The cart lives in the browser and snapshots each line's price at add-to-cart
// time, so a Sale that starts (or ends) afterwards never reached it: the cart and
// checkout kept showing the old price while POST /orders, which reads the price
// fresh, charged the new one. The storefront calls this on load to re-sync.
// Public (the cart works signed-out) and read-only.

import { Router } from 'express'
import { db } from '../db'
import { asyncHandler, ValidationError } from '../middleware/error'
import { annotateModelsWithSales, annotateBundlesWithSales } from '../services/sales'

const router = Router()

const MAX_LINES = 100
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

router.post(
  '/prices',
  asyncHandler(async (req, res) => {
    const items = req.body?.items
    if (!Array.isArray(items)) throw new ValidationError('items must be an array')
    if (items.length > MAX_LINES) throw new ValidationError('Too many items')

    const ids = (kind: string) =>
      [...new Set(
        items
          .filter((i: any) => i?.kind === kind && typeof i.id === 'string' && UUID_RE.test(i.id))
          .map((i: any) => i.id as string),
      )]
    const modelIds = ids('model')
    const bundleIds = ids('bundle')

    const out: { kind: 'model' | 'bundle'; id: string; price: number; originalPrice?: number }[] = []

    if (modelIds.length) {
      const { rows } = await db.query(
        'SELECT id, artist_id, base_price FROM models WHERE id = ANY($1::uuid[])',
        [modelIds],
      )
      await annotateModelsWithSales(rows)
      for (const r of rows) {
        const onSale = r.on_sale && r.sale_price != null
        out.push({
          kind: 'model',
          id: r.id,
          price: onSale ? Number(r.sale_price) : Number(r.base_price),
          originalPrice: onSale ? Number(r.original_price) : undefined,
        })
      }
    }

    if (bundleIds.length) {
      const { rows } = await db.query(
        'SELECT id, artist_id, price FROM bundles WHERE id = ANY($1::uuid[])',
        [bundleIds],
      )
      await annotateBundlesWithSales(rows)
      for (const r of rows) {
        const onSale = r.on_sale && r.sale_price != null
        out.push({
          kind: 'bundle',
          id: r.id,
          price: onSale ? Number(r.sale_price) : Number(r.price),
          originalPrice: onSale ? Number(r.original_price) : undefined,
        })
      }
    }

    res.json({ prices: out })
  }),
)

export default router
