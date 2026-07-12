// backend/src/routes/payouts.ts
// Artist-facing payouts: earnings summary for the dashboard tile/page, and Stripe
// Connect (Express) onboarding so the artist can actually receive money.

import { Router } from 'express'
import { db } from '../db'
import logger from '../utils/logger'
import { authenticate, requireArtist, requireTwoFactor, AuthRequest } from '../middleware/auth'
import { asyncHandler, ValidationError } from '../middleware/error'
import {
  getArtistEarningsSummary, getArtistEarnings, PAYOUT_HOLD_DAYS,
} from '../services/earnings'
import { MIN_PAYOUT_GBP } from '../services/payouts'
import { createConnectAccount, createOnboardingLink, checkOnboardingStatus } from '../services/stripe'

const router = Router()

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

// Summary + recent earnings + Connect status for the Payouts tile/page.
router.get('/me',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const artistId = req.userId!
    const [summary, earnings, payoutsResult] = await Promise.all([
      getArtistEarningsSummary(artistId),
      getArtistEarnings(artistId, 50),
      db.query(
        `SELECT id, amount, currency, status, stripe_transfer_id, created_at, paid_at
         FROM payouts WHERE artist_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [artistId],
      ),
    ])

    res.json({
      summary,
      earnings,
      payouts: payoutsResult.rows.map((p: any) => ({ ...p, amount: Number(p.amount) })),
      connect: {
        accountId: req.user?.stripe_account_id ?? null,
        onboardingComplete: !!req.user?.stripe_onboarding_complete,
      },
      config: { holdDays: PAYOUT_HOLD_DAYS, minPayout: MIN_PAYOUT_GBP },
    })
  }),
)

// Start (or resume) Stripe Connect onboarding → returns a hosted onboarding URL.
router.post('/connect/onboard',
  authenticate,
  requireArtist,
  requireTwoFactor,
  asyncHandler(async (req: AuthRequest, res) => {
    const artistId = req.userId!
    const email = req.user!.email
    const returnUrl = `${FRONTEND_URL}/artist/payouts?onboarding=complete`
    const refreshUrl = `${FRONTEND_URL}/artist/payouts?onboarding=refresh`

    // Already has an account → just mint a fresh onboarding link to finish/update details.
    if (req.user?.stripe_account_id) {
      const url = await createOnboardingLink(req.user.stripe_account_id, returnUrl, refreshUrl)
      return res.json({ onboardingUrl: url, accountId: req.user.stripe_account_id })
    }

    const result = await createConnectAccount(artistId, email, returnUrl, refreshUrl)
    logger.info('Connect onboarding started', { artistId, accountId: result.account_id })
    res.json({ onboardingUrl: result.onboarding_url, accountId: result.account_id })
  }),
)

// Re-check onboarding status with Stripe and persist it (used on return from onboarding).
router.get('/connect/status',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const accountId = req.user?.stripe_account_id
    if (!accountId) return res.json({ onboardingComplete: false, accountId: null })

    const complete = await checkOnboardingStatus(accountId)
    await db.query('UPDATE users SET stripe_onboarding_complete = $1 WHERE id = $2', [complete, req.userId])
    res.json({ onboardingComplete: complete, accountId })
  }),
)

export default router
