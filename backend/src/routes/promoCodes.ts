// backend/src/routes/promoCodes.ts
// Artist-run promo codes (migration 048). See services/promoCodes.ts for the
// economics: the discount comes entirely from the artist's own commission
// share, never the platform's — routes/orders.ts is where that's enforced at
// the money-moving point. This file is just create/list/pause + a buyer-side
// preview so checkout can show the discount before the order is placed.

import { Router } from 'express'
import { db } from '../db'
import logger from '../utils/logger'
import { authenticate, requireArtist, requireVerifiedEmail, requireTwoFactor, AuthRequest } from '../middleware/auth'
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/error'
import { activeDiscountForModel } from '../services/sales'
import {
  PROMO_MIN_PERCENT,
  PROMO_MAX_PERCENT,
  findActiveCode,
  normalizeCode,
  codeAppliesToModel,
  createPromoApplier,
  remainingRedemptions,
  remainingForCustomer,
} from '../services/promoCodes'

const router = Router()

// ============================================================================
// ARTIST — list my codes
// ============================================================================

router.get(
  '/mine',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const artistId = req.userId!
    const { rows } = await db.query(
      `SELECT pc.*,
              CASE WHEN pc.scope = 'model' THEN (SELECT name FROM models WHERE id = pc.target_id) ELSE NULL END AS target_name
       FROM promo_codes pc
       WHERE pc.artist_id = $1
       ORDER BY pc.created_at DESC`,
      [artistId],
    )
    res.json({ codes: rows })
  }),
)

// ============================================================================
// ARTIST — create a code
// ============================================================================

router.post(
  '/',
  authenticate,
  requireArtist,
  requireVerifiedEmail,
  requireTwoFactor,
  asyncHandler(async (req: AuthRequest, res) => {
    const artistId = req.userId!
    const {
      code: rawCode,
      scope,
      targetId,
      discountType,
      discountValue,
      maxRedemptions,
      maxRedemptionsPerCustomer,
      endsAt,
    } = req.body ?? {}

    const code = normalizeCode(rawCode)
    if (!code || code.length < 3 || code.length > 40 || !/^[A-Z0-9-]+$/.test(code)) {
      throw new ValidationError('Code must be 3–40 characters: letters, numbers and hyphens only')
    }
    if (!['portfolio', 'model'].includes(scope)) {
      throw new ValidationError('Scope must be "portfolio" or "model"')
    }
    if (!['percent', 'fixed'].includes(discountType)) {
      throw new ValidationError('Discount type must be "percent" or "fixed"')
    }
    const value = Number(discountValue)
    if (discountType === 'percent') {
      if (!Number.isFinite(value) || value < PROMO_MIN_PERCENT || value > PROMO_MAX_PERCENT) {
        throw new ValidationError(`Percent discount must be between ${PROMO_MIN_PERCENT}% and ${PROMO_MAX_PERCENT}%`)
      }
    } else if (!Number.isFinite(value) || value <= 0) {
      throw new ValidationError('Fixed discount must be a positive amount')
    }

    let normTarget: string | null = null
    if (scope === 'model') {
      if (!targetId) throw new ValidationError('Select a model for this code')
      const m = (
        await db.query(`SELECT id FROM models WHERE id = $1 AND artist_id = $2 AND status = 'published'`, [
          targetId,
          artistId,
        ])
      ).rows[0]
      if (!m) throw new NotFoundError('Published model')
      normTarget = targetId
    }

    let maxRed: number | null = null
    if (maxRedemptions !== undefined && maxRedemptions !== null && maxRedemptions !== '') {
      maxRed = Number(maxRedemptions)
      if (!Number.isInteger(maxRed) || maxRed < 1) {
        throw new ValidationError('Max total redemptions must be a positive whole number')
      }
    }
    let maxPerCustomer: number | null = null
    if (
      maxRedemptionsPerCustomer !== undefined &&
      maxRedemptionsPerCustomer !== null &&
      maxRedemptionsPerCustomer !== ''
    ) {
      maxPerCustomer = Number(maxRedemptionsPerCustomer)
      if (!Number.isInteger(maxPerCustomer) || maxPerCustomer < 1) {
        throw new ValidationError('Max redemptions per customer must be a positive whole number')
      }
    }
    let ends: Date | null = null
    if (endsAt) {
      ends = new Date(endsAt)
      if (Number.isNaN(ends.getTime()) || ends.getTime() <= Date.now()) {
        throw new ValidationError('Expiry date must be in the future')
      }
    }

    try {
      const { rows } = await db.query(
        `INSERT INTO promo_codes
          (artist_id, code, discount_type, discount_value, scope, target_id, max_redemptions, max_redemptions_per_customer, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [artistId, code, discountType, value, scope, normTarget, maxRed, maxPerCustomer, ends],
      )
      logger.info('Promo code created', { artistId, code, scope, discountType, value })
      res.status(201).json({ code: rows[0] })
    } catch (err: any) {
      if (err?.code === '23505') throw new ValidationError('That code is already taken — try another.')
      throw err
    }
  }),
)

// ============================================================================
// ARTIST — pause / resume a code (never hard-deleted — redemptions reference it)
// ============================================================================

router.patch(
  '/:id/toggle',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const artistId = req.userId!
    const { id } = req.params
    const result = await db.query(
      `UPDATE promo_codes SET active = NOT active, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND artist_id = $2 RETURNING *`,
      [id, artistId],
    )
    if (result.rows.length === 0) throw new NotFoundError('Promo code')
    res.json({ code: result.rows[0] })
  }),
)

// ============================================================================
// BUYER — preview a code against the cart before checkout. Never trusted as
// the actual charge — routes/orders.ts re-resolves and re-applies the code
// itself when the order is placed.
// ============================================================================

router.post(
  '/validate',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.userId!
    const { code: rawCode, items } = req.body ?? {}
    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError('No items to check the code against')
    }

    const code = await findActiveCode(db, rawCode)
    if (!code) throw new NotFoundError('Promo code')

    const totalRemaining = remainingRedemptions(code)
    const perCustomerRemaining = await remainingForCustomer(db, code, userId)
    const applier = createPromoApplier(code, totalRemaining, perCustomerRemaining)

    const lines: Array<{ modelId: string; name: string; originalPrice: number; discountAmount: number }> = []
    let totalDiscount = 0

    for (const it of items) {
      // v1: promo codes don't apply to bundles.
      if (!it?.modelId) continue
      const m = (
        await db.query(`SELECT id, name, base_price, artist_id FROM models WHERE id = $1 AND status = 'published'`, [
          it.modelId,
        ])
      ).rows[0]
      if (!m) continue
      if (!codeAppliesToModel(code, m.id, m.artist_id)) continue

      const saleDiscount = await activeDiscountForModel(db, m.id, m.artist_id)
      const price = Math.round(parseFloat(m.base_price) * (100 - saleDiscount.percent)) / 100

      const discount = applier.apply(price)
      if (discount <= 0) continue
      totalDiscount = Math.round((totalDiscount + discount) * 100) / 100
      lines.push({ modelId: m.id, name: m.name, originalPrice: price, discountAmount: discount })
    }

    if (lines.length === 0) {
      throw new ValidationError("This code doesn't apply to anything in your basket right now.")
    }

    res.json({
      code: {
        id: code.id,
        code: code.code,
        discountType: code.discount_type,
        discountValue: Number(code.discount_value),
      },
      lines,
      totalDiscount,
      limitReached:
        (totalRemaining != null && applier.usedCount() >= totalRemaining) ||
        (perCustomerRemaining != null && applier.usedCount() >= perCustomerRemaining),
    })
  }),
)

export default router
