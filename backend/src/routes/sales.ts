// backend/src/routes/sales.ts
// Artist-run temporary discounts (migration 034). Artists can put a model, a
// bundle, or their whole portfolio on sale for up to 14 days; on-sale items
// surface in the front-page carousel. Guard rails (see below) stop the system
// being gamed into a permanent front-page presence.

import { Router } from 'express'
import { db } from '../db'
import logger from '../utils/logger'
import { authenticate, requireArtist, requireVerifiedEmail, requireTwoFactor, AuthRequest } from '../middleware/auth'
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/error'
import {
  SALE_MAX_DAYS,
  SALE_COOLDOWN_DAYS,
  SALE_MIN_PERCENT,
  SALE_MAX_PERCENT,
  hasRecentPriceHike,
  getFeaturedSaleItems,
} from '../services/sales'

const router = Router()

const DAY_MS = 24 * 60 * 60 * 1000

// ============================================================================
// PUBLIC — front-page "on sale" carousel
// ============================================================================

router.get(
  '/featured',
  asyncHandler(async (_req, res) => {
    const items = await getFeaturedSaleItems()
    res.json({ items })
  }),
)

// ============================================================================
// ARTIST — list my sales
// ============================================================================

router.get(
  '/mine',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const artistId = req.userId!
    const { rows } = await db.query(
      `SELECT s.*,
              CASE
                WHEN s.canceled_at IS NOT NULL THEN 'canceled'
                WHEN NOW() < s.starts_at THEN 'scheduled'
                WHEN NOW() >= s.ends_at THEN 'ended'
                ELSE 'active'
              END AS state,
              CASE s.scope
                WHEN 'model' THEN (SELECT name FROM models WHERE id = s.target_id)
                WHEN 'bundle' THEN (SELECT name FROM bundles WHERE id = s.target_id)
                ELSE 'Entire portfolio'
              END AS target_name
       FROM sales s
       WHERE s.artist_id = $1
       ORDER BY s.created_at DESC`,
      [artistId],
    )
    res.json({ sales: rows })
  }),
)

// ============================================================================
// ARTIST — start a sale
// ============================================================================

router.post(
  '/',
  authenticate,
  requireArtist,
  requireVerifiedEmail,
  requireTwoFactor,
  asyncHandler(async (req: AuthRequest, res) => {
    const artistId = req.userId!
    const { scope, targetId, discountPercent, durationDays } = req.body ?? {}

    if (!['model', 'bundle', 'portfolio'].includes(scope)) {
      throw new ValidationError('scope must be model, bundle or portfolio')
    }
    const percent = Number(discountPercent)
    if (!Number.isInteger(percent) || percent < SALE_MIN_PERCENT || percent > SALE_MAX_PERCENT) {
      throw new ValidationError(`Discount must be a whole number between ${SALE_MIN_PERCENT}% and ${SALE_MAX_PERCENT}%`)
    }
    const days = Number(durationDays)
    if (!Number.isInteger(days) || days < 1 || days > SALE_MAX_DAYS) {
      throw new ValidationError(`A sale can run for 1 to ${SALE_MAX_DAYS} days`)
    }

    // Validate the target belongs to this artist + anti-inflation reference check.
    if (scope === 'model') {
      if (!targetId) throw new ValidationError('Select a model to put on sale')
      const m = (await db.query(
        `SELECT id, base_price FROM models WHERE id = $1 AND artist_id = $2 AND status = 'published'`,
        [targetId, artistId],
      )).rows[0]
      if (!m) throw new NotFoundError('Published model')
      if (await hasRecentPriceHike('model', m.id, Number(m.base_price))) {
        throw new ValidationError(
          "You raised this model's price in the last 30 days — you can't discount off a just-increased price. Let the price settle before running a sale.",
        )
      }
    } else if (scope === 'bundle') {
      if (!targetId) throw new ValidationError('Select a bundle to put on sale')
      const b = (await db.query(
        `SELECT id, price FROM bundles WHERE id = $1 AND artist_id = $2 AND status = 'published'`,
        [targetId, artistId],
      )).rows[0]
      if (!b) throw new NotFoundError('Published bundle')
      if (await hasRecentPriceHike('bundle', b.id, Number(b.price))) {
        throw new ValidationError(
          "You raised this bundle's price in the last 30 days — you can't discount off a just-increased price. Let the price settle before running a sale.",
        )
      }
    } else {
      // Portfolio: block if ANY published model/bundle was just marked up.
      const hikedModel = (await db.query(
        `SELECT m.id FROM models m
         WHERE m.artist_id = $1 AND m.status = 'published'
           AND m.base_price > COALESCE(
             (SELECT MIN(price) FROM price_history ph
              WHERE ph.entity_type = 'model' AND ph.entity_id = m.id
                AND ph.recorded_at >= NOW() - INTERVAL '30 days'), m.base_price) + 0.001
         LIMIT 1`,
        [artistId],
      )).rows[0]
      const hikedBundle = (await db.query(
        `SELECT b.id FROM bundles b
         WHERE b.artist_id = $1 AND b.status = 'published'
           AND b.price > COALESCE(
             (SELECT MIN(price) FROM price_history ph
              WHERE ph.entity_type = 'bundle' AND ph.entity_id = b.id
                AND ph.recorded_at >= NOW() - INTERVAL '30 days'), b.price) + 0.001
         LIMIT 1`,
        [artistId],
      )).rows[0]
      if (hikedModel || hikedBundle) {
        throw new ValidationError(
          "One or more of your items had a price increase in the last 30 days. A portfolio sale can't discount off just-raised prices — let them settle first.",
        )
      }
    }

    const normTarget = scope === 'portfolio' ? null : targetId

    // Cooldown / one-live check: look at the most recent sale for this exact scope+target.
    const last = (await db.query(
      `SELECT starts_at, ends_at, canceled_at, COALESCE(canceled_at, ends_at) AS effective_end
       FROM sales
       WHERE artist_id = $1 AND scope = $2
         AND COALESCE(target_id::text, '') = COALESCE($3::text, '')
       ORDER BY created_at DESC
       LIMIT 1`,
      [artistId, scope, normTarget],
    )).rows[0]

    const now = Date.now()
    if (last) {
      const startsAt = new Date(last.starts_at).getTime()
      const endsAt = new Date(last.ends_at).getTime()
      const effectiveEnd = new Date(last.effective_end).getTime()
      const live = !last.canceled_at && now >= startsAt && now < endsAt
      const scheduled = !last.canceled_at && now < startsAt
      if (live) throw new ValidationError('This is already on sale.')
      if (scheduled) throw new ValidationError('A sale is already scheduled for this.')
      const cooldownEnds = effectiveEnd + SALE_COOLDOWN_DAYS * DAY_MS
      if (now < cooldownEnds) {
        const daysLeft = Math.ceil((cooldownEnds - now) / DAY_MS)
        throw new ValidationError(
          `You recently ran a sale on this. To keep sales meaningful there's a ${SALE_COOLDOWN_DAYS}-day cooldown — try again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
        )
      }
    }

    const endsAt = new Date(now + days * DAY_MS)
    try {
      const { rows } = await db.query(
        `INSERT INTO sales (artist_id, scope, target_id, discount_percent, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, NOW(), $5)
         RETURNING *`,
        [artistId, scope, normTarget, percent, endsAt],
      )
      logger.info('Sale started', { artistId, scope, targetId: normTarget, percent, days })
      res.status(201).json({ sale: rows[0] })
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ValidationError('A sale for this is already running.')
      }
      throw err
    }
  }),
)

// ============================================================================
// ARTIST — cancel a sale
// ============================================================================

router.post(
  '/:id/cancel',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const artistId = req.userId!
    const { id } = req.params
    const result = await db.query(
      `UPDATE sales SET canceled_at = NOW()
       WHERE id = $1 AND artist_id = $2 AND canceled_at IS NULL AND NOW() < ends_at
       RETURNING id`,
      [id, artistId],
    )
    if (result.rows.length === 0) {
      throw new NotFoundError('Active sale')
    }
    logger.info('Sale canceled', { artistId, saleId: id })
    res.json({ message: 'Sale ended.' })
  }),
)

export default router
