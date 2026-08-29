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
import {
  createConnectAccount, createOnboardingLink, createLoginLink,
  getAccountStatus, setMockOnboardingState, isStripeMock, isUsableAccountId,
} from '../services/stripe'

const router = Router()

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

// The artist's share of each sale, as a percent. `users.commission_rate` means the
// ARTIST'S share (see migration 021), defaulting to 85 = a 15% platform fee — but it
// is per-artist, so a negotiated rate must be read from the row rather than assumed.
// The Payouts page used to hard-code 15%, which lied to anyone on a different deal.
const DEFAULT_ARTIST_SHARE = 85

async function artistSharePercent(artistId: string): Promise<number> {
  const result = await db.query('SELECT commission_rate FROM users WHERE id = $1', [artistId])
  // DECIMAL comes back from pg as a string, and DB_MOCK returns no rows at all.
  const rate = Number(result.rows[0]?.commission_rate)
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_ARTIST_SHARE
}

// Summary + recent earnings + Connect status for the Payouts tile/page.
router.get('/me',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const artistId = req.userId!
    // A leftover `acct_mock_...` from mock mode is not a real account: treat it as
    // "not started" so the artist is offered onboarding rather than a dead link.
    const accountId = isUsableAccountId(req.user?.stripe_account_id)
      ? req.user!.stripe_account_id!
      : null

    const [summary, earnings, payoutsResult, sharePercent, status] = await Promise.all([
      getArtistEarningsSummary(artistId),
      getArtistEarnings(artistId, 50),
      db.query(
        `SELECT id, amount, currency, status, stripe_transfer_id, created_at, paid_at
         FROM payouts WHERE artist_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [artistId],
      ),
      artistSharePercent(artistId),
      accountId ? getAccountStatus(accountId) : Promise.resolve(null),
    ])

    // If Stripe was unreachable, fall back to the status we last persisted rather
    // than telling an onboarded artist their payouts are not set up.
    const persisted = !!req.user?.stripe_onboarding_complete
    const stale = !!status?.unavailable
    const onboardingComplete = stale ? persisted : !!status?.onboardingComplete

    res.json({
      summary,
      earnings,
      payouts: payoutsResult.rows.map((p: any) => ({ ...p, amount: Number(p.amount) })),
      connect: {
        accountId,
        // Kept as the flat boolean the page has always read, alongside the finer
        // grained flags so the banner can tell "never started" from "under review".
        onboardingComplete,
        detailsSubmitted: stale ? persisted : !!status?.detailsSubmitted,
        payoutsEnabled: stale ? persisted : !!status?.payoutsEnabled,
        chargesEnabled: stale ? persisted : !!status?.chargesEnabled,
        requirementsDue: status?.requirementsDue ?? [],
      },
      config: {
        holdDays: PAYOUT_HOLD_DAYS,
        minPayout: MIN_PAYOUT_GBP,
        artistSharePercent: sharePercent,
        // Lets the dashboard offer the mock-complete shortcut only where it exists.
        mockMode: isStripeMock(),
      },
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

    // Already has a REAL account → just mint a fresh onboarding link to finish or
    // update details. A stale mock id falls through to creating a genuine account.
    if (isUsableAccountId(req.user?.stripe_account_id)) {
      const accountId = req.user!.stripe_account_id!
      const url = await createOnboardingLink(accountId, returnUrl, refreshUrl)
      return res.json({ onboardingUrl: url, accountId })
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
    const accountId = isUsableAccountId(req.user?.stripe_account_id)
      ? req.user!.stripe_account_id!
      : null
    if (!accountId) {
      return res.json({
        accountId: null, onboardingComplete: false, detailsSubmitted: false,
        payoutsEnabled: false, chargesEnabled: false, requirementsDue: [],
      })
    }

    const status = await getAccountStatus(accountId)
    // Never persist a `false` that only means "Stripe was unreachable" — that would
    // stop the payout job paying an artist who is in fact fully onboarded.
    if (!status.unavailable) {
      await db.query(
        'UPDATE users SET stripe_onboarding_complete = $1 WHERE id = $2',
        [status.onboardingComplete, req.userId],
      )
    }
    res.json(status)
  }),
)

// One-time link into the artist's own Stripe Express dashboard (payout history, bank
// details, tax documents), so AA doesn't have to rebuild any of it.
router.post('/connect/dashboard-link',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const accountId = isUsableAccountId(req.user?.stripe_account_id)
      ? req.user!.stripe_account_id!
      : null
    if (!accountId) throw new ValidationError('Set up payouts before opening the Stripe dashboard')

    // Stripe rejects login links for accounts that never submitted details, so check
    // first and return the actionable error rather than a raw Stripe failure.
    const status = await getAccountStatus(accountId)
    if (!status.detailsSubmitted) {
      throw new ValidationError('Finish Stripe onboarding before opening the dashboard')
    }

    res.json({ url: await createLoginLink(accountId) })
  }),
)

// DEV/MOCK ONLY. Stands in for the artist actually completing Stripe's hosted form,
// which is unreachable under STRIPE_MOCK — without it the un-onboarded state is the
// only state local dev can ever produce. 404s unless payments are mocked AND this is
// not production, so it can never become a way to self-certify a real account.
router.post('/connect/mock-complete',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!isStripeMock() || process.env.NODE_ENV === 'production') {
      return res.status(404).json({ message: 'Not found' })
    }
    const accountId = req.user?.stripe_account_id
    if (!accountId) throw new ValidationError('Start onboarding first')

    const complete = req.body?.complete !== false
    const status = setMockOnboardingState(accountId, complete)
    await db.query(
      'UPDATE users SET stripe_onboarding_complete = $1 WHERE id = $2',
      [complete, req.userId],
    )
    logger.warn('Mock Connect onboarding state set', { artistId: req.userId, accountId, complete })
    res.json(status)
  }),
)

export default router
