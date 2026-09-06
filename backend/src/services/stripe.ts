// backend/src/services/stripe.ts
import Stripe from 'stripe'
import logger from '../utils/logger'
import { db } from '../db'
import { accrueEarningsForOrder } from './earnings'
import { recordTaxTransaction } from './stripeTax'

// ============================================================================
// INITIALIZATION
// ============================================================================

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET

// Payments are MOCKED by default and only go live when explicitly enabled with a
// real key. This fails safe for the pre-launch marketplace: no real charge is ever
// attempted unless PAYMENTS_ENABLED=true AND a STRIPE_SECRET_KEY is configured.
// STRIPE_MOCK=true / PAYMENTS_MOCK=true force mock even when a key is present.
// (Previously the presence of a secret key alone flipped it live, which broke the
// mock/test checkout with a "Payment not completed" error.)
const FORCE_MOCK = process.env.STRIPE_MOCK === 'true' || process.env.PAYMENTS_MOCK === 'true'
const PAYMENTS_LIVE = process.env.PAYMENTS_ENABLED === 'true' && !!STRIPE_SECRET_KEY
const STRIPE_MOCK = FORCE_MOCK || !PAYMENTS_LIVE

export const stripe: Stripe = STRIPE_MOCK
  // In mock mode, stripe SDK is not used
  ? (undefined as unknown as Stripe)
  : new Stripe(STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16',
      typescript: true
    })

const stripeLogger = logger.child('STRIPE')

stripeLogger.info(`Payments ${STRIPE_MOCK ? 'MOCKED (no real charges)' : 'LIVE'}`, {
  mock: STRIPE_MOCK,
  hasSecretKey: !!STRIPE_SECRET_KEY,
})

// ============================================================================
// STRIPE CONNECT - ARTIST ONBOARDING
// ============================================================================

/** Whether payments are running against the mock (no real Stripe calls happen). */
export const isStripeMock = (): boolean => STRIPE_MOCK

/** Prefix of the fake account ids handed out while payments are mocked. */
export const MOCK_ACCOUNT_PREFIX = 'acct_mock'

/**
 * Is this stored account id one Stripe will actually recognise?
 *
 * An artist who set up payouts while the site was in mock mode has a fake
 * `acct_mock_...` id saved against them. The moment real keys are switched on, every
 * call about that id fails — retrieving it, minting an onboarding link, transferring
 * to it — and the artist is stuck with no way to start again. Treating it as "no
 * account yet" instead sends them cleanly back through onboarding, which is exactly
 * what they need to do. Harmless in mock mode, where the id IS the real thing.
 */
export function isUsableAccountId(accountId?: string | null): boolean {
  if (!accountId) return false
  if (STRIPE_MOCK) return true
  return !accountId.startsWith(MOCK_ACCOUNT_PREFIX)
}

/**
 * The onboarding state of a connected account, as the artist's Payouts page needs to
 * see it. Stripe's three flags are kept separate rather than collapsed into one
 * boolean because they mean different things to the artist: `detailsSubmitted` false
 * means "you never finished the form", while `payoutsEnabled` false *with* details
 * submitted means "Stripe is still reviewing you, or wants more from you".
 */
export interface ConnectAccountStatus {
  accountId: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  /** What the payout job gates on: money can actually reach this account. */
  onboardingComplete: boolean
  /** Stripe's outstanding requirement ids, so the UI can say what is missing. */
  requirementsDue: string[]
  /**
   * True when Stripe could not be reached, so every flag above is a pessimistic
   * default rather than a fact. Callers that hold a previously-persisted status
   * should prefer it over these values — telling a fully onboarded artist they are
   * not set up because Stripe blipped is worse than showing a slightly stale state.
   */
  unavailable?: boolean
}

// ---------------------------------------------------------------------------
// MOCK CONNECT ACCOUNTS
// ---------------------------------------------------------------------------
// Under STRIPE_MOCK there is no Stripe to ask, so mock accounts keep their state
// here. New ones start INCOMPLETE on purpose: `checkOnboardingStatus` used to return
// true unconditionally, which made every mocked artist look fully onboarded and left
// the un-onboarded paths — the payout job's `no_account` hold, the "finish setup"
// banner — impossible to exercise locally. Set STRIPE_MOCK_ONBOARDING_COMPLETE=true
// for the old always-onboarded behaviour.
//
// In-memory, so it resets when the server restarts. That is fine for its only two
// consumers (local dev and test:connect-payouts) and keeps it out of the schema.

const MOCK_STARTS_COMPLETE = process.env.STRIPE_MOCK_ONBOARDING_COMPLETE === 'true'
const MOCK_REQUIREMENT = 'individual.verification.document'
const mockAccounts = new Map<string, ConnectAccountStatus>()

function mockAccount(accountId: string): ConnectAccountStatus {
  let state = mockAccounts.get(accountId)
  if (!state) {
    state = {
      accountId,
      chargesEnabled: MOCK_STARTS_COMPLETE,
      payoutsEnabled: MOCK_STARTS_COMPLETE,
      detailsSubmitted: MOCK_STARTS_COMPLETE,
      onboardingComplete: MOCK_STARTS_COMPLETE,
      requirementsDue: MOCK_STARTS_COMPLETE ? [] : [MOCK_REQUIREMENT],
    }
    mockAccounts.set(accountId, state)
  }
  return state
}

/**
 * Flip a mocked account's onboarding state — the local stand-in for an artist
 * actually completing Stripe's hosted form. Drives the dev-only
 * `POST /api/payouts/connect/mock-complete` route and test:connect-payouts.
 * Returns null when payments are live: real accounts are Stripe's to decide.
 */
export function setMockOnboardingState(
  accountId: string,
  complete: boolean
): ConnectAccountStatus | null {
  if (!STRIPE_MOCK) return null
  const state = mockAccount(accountId)
  state.chargesEnabled = complete
  state.payoutsEnabled = complete
  state.detailsSubmitted = complete
  state.onboardingComplete = complete
  state.requirementsDue = complete ? [] : [MOCK_REQUIREMENT]
  return { ...state }
}

export interface CreateConnectAccountResult {
  account_id: string
  onboarding_url: string
}

/**
 * Create Stripe Connect account for artist
 */
export async function createConnectAccount(
  artistId: string,
  email: string,
  returnUrl: string,
  refreshUrl: string
): Promise<CreateConnectAccountResult> {
  if (STRIPE_MOCK) {
    const accountId = `acct_mock_${Date.now()}`
    mockAccount(accountId)
    // Persist exactly as the live path does, so the artist's half-finished state
    // survives a reload in local dev instead of minting a fresh account each time.
    await db.query('UPDATE users SET stripe_account_id = $1 WHERE id = $2', [accountId, artistId])
    return { account_id: accountId, onboarding_url: returnUrl }
  }
  try {
    stripeLogger.info('Creating Stripe Connect account', { artistId, email })
    
    // Create connected account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'GB',
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      business_type: 'individual',
      metadata: {
        artist_id: artistId
      }
    })
    
    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding'
    })
    
    // Save account ID to database (artists ARE users with role='artist')
    await db.query(
      'UPDATE users SET stripe_account_id = $1 WHERE id = $2',
      [account.id, artistId]
    )
    
    stripeLogger.info('Connect account created', {
      artistId,
      accountId: account.id
    })
    
    return {
      account_id: account.id,
      onboarding_url: accountLink.url
    }
  } catch (error) {
    stripeLogger.error('Failed to create Connect account', { error, artistId })
    throw new Error('Failed to create Stripe Connect account')
  }
}

/**
 * Full onboarding state for one connected account (mock-aware).
 */
export async function getAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
  if (STRIPE_MOCK) return { ...mockAccount(accountId) }
  try {
    const account = await stripe.accounts.retrieve(accountId)
    return {
      accountId,
      chargesEnabled: !!account.charges_enabled,
      payoutsEnabled: !!account.payouts_enabled,
      detailsSubmitted: !!account.details_submitted,
      onboardingComplete: !!(account.charges_enabled && account.payouts_enabled),
      requirementsDue: account.requirements?.currently_due ?? [],
    }
  } catch (error) {
    stripeLogger.error('Failed to retrieve Connect account', { error, accountId })
    // An account we cannot read is treated as not-ready, which holds the artist's
    // balance rather than attempting a transfer that would fail anyway.
    return {
      accountId,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      onboardingComplete: false,
      requirementsDue: [],
      unavailable: true,
    }
  }
}

/**
 * Can this account actually receive money? The single boolean the payout job and
 * `users.stripe_onboarding_complete` are keyed on.
 */
export async function checkOnboardingStatus(accountId: string): Promise<boolean> {
  const status = await getAccountStatus(accountId)
  stripeLogger.debug('Onboarding status checked', status)
  return status.onboardingComplete
}

/**
 * Update artist onboarding status in database
 */
export async function updateOnboardingStatus(
  artistId: string,
  accountId: string
): Promise<void> {
  const isComplete = await checkOnboardingStatus(accountId)

  await db.query(
    'UPDATE users SET stripe_onboarding_complete = $1 WHERE id = $2',
    [isComplete, artistId]
  )
  
  stripeLogger.info('Artist onboarding status updated', {
    artistId,
    isComplete
  })
}

/**
 * Generate new onboarding link for existing account
 */
export async function createOnboardingLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<string> {
  if (STRIPE_MOCK) return returnUrl
  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding'
    })
    
    return accountLink.url
  } catch (error) {
    stripeLogger.error('Failed to create onboarding link', { error, accountId })
    throw new Error('Failed to create onboarding link')
  }
}

/**
 * A one-time link into the artist's Stripe Express dashboard, where they can see
 * their own payout history, bank details and tax documents — everything AA would
 * otherwise have to rebuild. Stripe rejects login links for accounts that never
 * submitted their details, so callers should gate on `detailsSubmitted` first.
 */
export async function createLoginLink(accountId: string): Promise<string> {
  if (STRIPE_MOCK) return `https://connect.stripe.com/mock/express/${accountId}`
  try {
    const link = await stripe.accounts.createLoginLink(accountId)
    return link.url
  } catch (error) {
    stripeLogger.error('Failed to create Express dashboard login link', { error, accountId })
    throw new Error('Failed to create dashboard link')
  }
}

// ============================================================================
// PAYMENT INTENTS
// ============================================================================

/**
 * How the buyer paid, in the vocabulary of `orders.payment_method` (which is
 * CHECK-constrained to 'stripe' | 'paypal'). PayPal is accepted *through* Stripe —
 * one integration, one settlement, one webhook — so everything that isn't PayPal is
 * recorded as plain 'stripe'.
 */
export type OrderPaymentMethod = 'stripe' | 'paypal'

/**
 * Read the method actually used off a PaymentIntent.
 *
 * NB `payment_method_types` is NOT a usable signal here: with
 * `automatic_payment_methods` it lists every method *enabled on the account*, so
 * `[0]` would label plain card orders as PayPal the moment PayPal is switched on.
 * Only the attached PaymentMethod (or the charge's method details) says what the
 * buyer actually used, and neither is expanded on a raw webhook payload — hence
 * `resolvePaymentMethod()` below for that path. Anything we can't positively
 * identify as PayPal is recorded as plain 'stripe'.
 */
export function paymentMethodOf(intent: Stripe.PaymentIntent): OrderPaymentMethod {
  const pm = intent.payment_method
  if (pm && typeof pm === 'object' && pm.type) {
    return pm.type === 'paypal' ? 'paypal' : 'stripe'
  }

  const charge = intent.latest_charge
  if (charge && typeof charge === 'object' && charge.payment_method_details?.type) {
    return charge.payment_method_details.type === 'paypal' ? 'paypal' : 'stripe'
  }

  // Single-entry list means the intent was pinned to one method, so it is reliable.
  if (intent.payment_method_types?.length === 1) {
    return intent.payment_method_types[0] === 'paypal' ? 'paypal' : 'stripe'
  }

  return 'stripe'
}

/**
 * Same, but for objects that arrive unexpanded (webhook payloads). Re-fetches the
 * intent so the attached PaymentMethod is readable, and degrades to whatever the
 * raw object can tell us if that call fails — recording the wrong method must never
 * be the thing that stops an order being marked paid.
 */
async function resolvePaymentMethod(
  intent: Stripe.PaymentIntent
): Promise<OrderPaymentMethod> {
  if (intent.payment_method && typeof intent.payment_method === 'object') {
    return paymentMethodOf(intent)
  }
  try {
    return paymentMethodOf(await getPaymentIntent(intent.id))
  } catch (error) {
    stripeLogger.warn('Could not resolve payment method; recording as stripe', {
      error,
      paymentIntentId: intent.id,
    })
    return paymentMethodOf(intent)
  }
}

export interface CreatePaymentIntentParams {
  amount: number // In pounds (e.g., 15.99)
  currency?: string
  metadata?: Record<string, string>
  description?: string
  /**
   * What the buyer picked at checkout. Only used to shape the *mock* intent id so
   * the test flow can exercise the PayPal redirect path; on live Stripe the method
   * is chosen inside the Payment Element and read back off the intent, so this is
   * advisory only and never restricts what the buyer can actually use.
   */
  preferredMethod?: OrderPaymentMethod
}

export interface CreatePaymentIntentResult {
  payment_intent_id: string
  client_secret: string
  amount: number
}

/**
 * Create payment intent for order
 */
export async function createPaymentIntent(
  params: CreatePaymentIntentParams
): Promise<CreatePaymentIntentResult> {
  if (STRIPE_MOCK) {
    const amount = Math.round((params.amount || 0) * 100) / 100
    const suffix = params.preferredMethod === 'paypal' ? '_paypal' : ''
    // Encode the order id into the mock intent id itself (mirroring how the method
    // is already encoded via the `_paypal` suffix) so getPaymentIntent's mock branch
    // can hand it back as `metadata.order_id` below — real Stripe metadata is set
    // server-side and read back the same way, and routes/orders.ts's confirm route
    // (2026-09-05 security fix) now requires that binding to match in every mode,
    // mock included, or a real PaymentIntent could be replayed against a different
    // order's confirm call.
    const orderId = params.metadata?.order_id ?? 'noorder'
    return {
      payment_intent_id: `pi_mock${suffix}_${orderId}_${Date.now()}`,
      client_secret: `cs_mock_${Math.random().toString(36).slice(2)}`,
      amount,
    }
  }
  try {
    const { amount, currency = 'gbp', metadata, description } = params
    
    // Convert to smallest currency unit (pence)
    const amountInPence = Math.round(amount * 100)
    
    stripeLogger.info('Creating payment intent', {
      amount,
      amountInPence,
      currency,
      metadata
    })
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInPence,
      currency,
      metadata,
      description,
      // Every method enabled on the Stripe account shows up in the Payment Element,
      // PayPal included — activate it under Settings → Payment methods (marketplaces
      // on Connect must submit the onboarding request first). `allow_redirects`
      // defaults to 'always', which PayPal needs: it hands off to a hosted approval
      // page and returns to our `return_url`.
      automatic_payment_methods: {
        enabled: true
      }
    })
    
    stripeLogger.info('Payment intent created', {
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount
    })
    
    return {
      payment_intent_id: paymentIntent.id,
      client_secret: paymentIntent.client_secret!,
      amount: paymentIntent.amount / 100
    }
  } catch (error) {
    stripeLogger.error('Failed to create payment intent', { error, params })
    throw new Error('Failed to create payment intent')
  }
}

/**
 * Retrieve payment intent
 */
export async function getPaymentIntent(
  paymentIntentId: string
): Promise<Stripe.PaymentIntent> {
  if (STRIPE_MOCK) {
    // Mock intent ids carry the method the test checkout picked (see
    // createPaymentIntent), so the PayPal path can be exercised without live keys.
    const method = paymentIntentId.includes('_paypal') ? 'paypal' : 'card'
    // ...and the order id, in the same encoded-in-the-id fashion, so mock mode's
    // `metadata.order_id` is just as real a binding check as live Stripe's.
    const orderId = paymentIntentId
      .replace(/^pi_mock(_paypal)?_/, '')
      .replace(/_\d+$/, '')
    return {
      id: paymentIntentId,
      object: 'payment_intent',
      amount: 100,
      currency: 'gbp',
      status: 'succeeded',
      metadata: { order_id: orderId },
      payment_method_types: [method],
      payment_method: { type: method },
    } as unknown as Stripe.PaymentIntent
  }
  try {
    // `payment_method` is an id string unless expanded, and we need its `type` to
    // record how the buyer actually paid.
    return await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['payment_method', 'latest_charge'],
    })
  } catch (error) {
    stripeLogger.error('Failed to retrieve payment intent', {
      error,
      paymentIntentId
    })
    throw new Error('Failed to retrieve payment intent')
  }
}

/**
 * Cancel payment intent
 */
export async function cancelPaymentIntent(
  paymentIntentId: string
): Promise<void> {
  if (STRIPE_MOCK) return
  try {
    await stripe.paymentIntents.cancel(paymentIntentId)
    stripeLogger.info('Payment intent cancelled', { paymentIntentId })
  } catch (error) {
    stripeLogger.error('Failed to cancel payment intent', {
      error,
      paymentIntentId
    })
    throw new Error('Failed to cancel payment intent')
  }
}

// ============================================================================
// TRANSFERS TO ARTISTS
// ============================================================================
//
// Artist earnings are accrued into the `artist_earnings` ledger on payment (see
// services/earnings.ts) and paid out in scheduled batches (services/payouts.ts).
// This is the low-level Stripe call the payout job uses to move a cleared batch to
// one artist's connected account. In mock mode it returns a fake transfer id.

export interface CreateTransferParams {
  accountId: string
  amount: number // In pounds
  currency?: string
  metadata?: Record<string, string>
  description?: string
}

/** Create a Stripe Connect transfer to an artist's connected account (mock-aware). */
export async function createTransfer(params: CreateTransferParams): Promise<string> {
  const { accountId, amount, currency = 'gbp', metadata, description } = params
  const amountInPence = Math.round(amount * 100)

  if (STRIPE_MOCK) {
    return `tr_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  const transfer = await stripe.transfers.create({
    amount: amountInPence,
    currency,
    destination: accountId,
    description,
    metadata,
  })
  stripeLogger.info('Transfer created', { transferId: transfer.id, accountId, amount })
  return transfer.id
}

// ============================================================================
// WEBHOOK HANDLING
// ============================================================================

/**
 * Verify and construct webhook event
 */
export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  if (STRIPE_MOCK) {
    try {
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : JSON.parse((payload as Buffer).toString('utf8'))
      return (parsed as Stripe.Event) || ({ id: `evt_mock_${Date.now()}`, type: 'payment_intent.succeeded', data: { object: { id: 'pi_mock', amount: 100 } } } as any)
    } catch {
      return { id: `evt_mock_${Date.now()}`, type: 'payment_intent.succeeded', data: { object: { id: 'pi_mock', amount: 100 } } } as any
    }
  }
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET not configured')
  }
  try {
    return stripe.webhooks.constructEvent(
      payload,
      signature,
      STRIPE_WEBHOOK_SECRET
    )
  } catch (error) {
    stripeLogger.error('Webhook signature verification failed', { error })
    throw new Error('Invalid webhook signature')
  }
}

/**
 * Handle webhook event
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  if (STRIPE_MOCK) {
    stripeLogger.info('Mock webhook event received', { type: event?.type })
    return
  }
  stripeLogger.info('Processing webhook event', {
    type: event.type,
    id: event.id
  })

  try {
    if (event.type === 'payment_intent.succeeded') {
      await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent)
    } else if (event.type === 'payment_intent.payment_failed') {
      await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent)
    } else if (event.type === 'account.updated') {
      await handleAccountUpdated(event.data.object as Stripe.Account)
    } else if (event.type === 'transfer.created') {
      stripeLogger.info('Transfer created', {
        transferId: (event.data.object as Stripe.Transfer).id
      })
    } else if ((event.type as string) === 'transfer.failed') {
      await handleTransferFailed(event.data.object as Stripe.Transfer)
    } else {
      stripeLogger.debug('Unhandled webhook event type', { type: event.type })
    }
  } catch (error) {
    stripeLogger.error('Error handling webhook event', {
      error,
      eventType: event.type,
      eventId: event.id
    })
    throw error
  }
}

async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  if (STRIPE_MOCK) return
  stripeLogger.info('Payment succeeded', {
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount / 100
  })
  
  const orderId = paymentIntent.metadata.order_id

  if (orderId) {
    // Read first so the atomic claim below can tell us whether *this* call is the one
    // that actually marked the order paid (the confirm route may have already won
    // that race), and so a Stripe Tax transaction is only ever recorded once.
    const existing = await db.query(
      `SELECT order_number, payment_status, stripe_tax_calculation_id, stripe_tax_transaction_id
       FROM orders WHERE id = $1`,
      [orderId]
    )
    const order = existing.rows[0]

    // Mark paid + delivered (digital STLs fulfil instantly). The method is taken from
    // the intent rather than from whatever the client said at checkout — the buyer
    // can switch to PayPal inside the Payment Element after the order row was written.
    // `AND payment_status <> 'succeeded'` is the same atomic claim the confirm route
    // uses, so whichever of the two actually wins the race is the one that runs the
    // one-time side effects below.
    const claim = await db.query(
      `UPDATE orders
       SET payment_status = 'succeeded',
           paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
           fulfillment_status = 'delivered',
           payment_method = $2
       WHERE id = $1 AND payment_status <> 'succeeded'`,
      [orderId, await resolvePaymentMethod(paymentIntent)]
    )
    const firstConfirm = (claim.rowCount ?? 0) > 0

    if (firstConfirm && order?.stripe_tax_calculation_id && !order.stripe_tax_transaction_id) {
      const transactionId = await recordTaxTransaction(order.stripe_tax_calculation_id, order.order_number)
      if (transactionId) {
        await db.query('UPDATE orders SET stripe_tax_transaction_id = $1 WHERE id = $2', [transactionId, orderId])
      }
    }

    await accrueEarningsForOrder(orderId).catch(err =>
      stripeLogger.error('Failed to accrue earnings from webhook', { error: err, orderId })
    )

    stripeLogger.info('Order updated to paid', { orderId })
  }
}

async function handlePaymentIntentFailed(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  if (STRIPE_MOCK) return
  stripeLogger.warn('Payment failed', {
    paymentIntentId: paymentIntent.id,
    error: paymentIntent.last_payment_error?.message
  })
  
  const orderId = paymentIntent.metadata.order_id
  
  if (orderId) {
    await db.query(
      `UPDATE orders 
       SET status = 'payment_failed', notes = $1 
       WHERE id = $2`,
      [paymentIntent.last_payment_error?.message || 'Payment failed', orderId]
    )
  }
}

async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  if (STRIPE_MOCK) return
  const artistId = account.metadata.artist_id
  
  if (artistId) {
    await updateOnboardingStatus(artistId, account.id)
  }
}

async function handleTransferFailed(transfer: Stripe.Transfer): Promise<void> {
  if (STRIPE_MOCK) return
  stripeLogger.error('Transfer failed', {
    transferId: transfer.id,
    payoutId: transfer.metadata?.payout_id,
    artistId: transfer.metadata?.artist_id,
  })

  // Mark the payout batch failed and release its earnings back to `cleared` so the next
  // payout run retries them.
  const payout = await db.query(
    `UPDATE payouts SET status = 'failed', failure_reason = 'Stripe transfer.failed webhook'
     WHERE stripe_transfer_id = $1 RETURNING id`,
    [transfer.id],
  )
  const payoutId = payout.rows[0]?.id
  if (payoutId) {
    await db.query(
      `UPDATE artist_earnings SET status = 'cleared', payout_id = NULL WHERE payout_id = $1`,
      [payoutId],
    )
  }
}

// ============================================================================
// REFUNDS
// ============================================================================

/**
 * Create refund for payment intent
 */
export async function createRefund(
  paymentIntentId: string,
  amount?: number, // In pounds, optional for partial refund
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer'
): Promise<string> {
  if (STRIPE_MOCK) {
    return `re_mock_${Date.now()}`
  }
  try {
    stripeLogger.info('Creating refund', {
      paymentIntentId,
      amount,
      reason
    })
    
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId,
      reason
    }
    
    if (amount !== undefined) {
      refundParams.amount = Math.round(amount * 100) // Convert to pence
    }
    
    const refund = await stripe.refunds.create(refundParams)
    
    stripeLogger.info('Refund created', {
      refundId: refund.id,
      amount: refund.amount / 100
    })
    
    return refund.id
  } catch (error) {
    stripeLogger.error('Failed to create refund', { error, paymentIntentId })
    throw new Error('Failed to create refund')
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  stripe,
  createConnectAccount,
  checkOnboardingStatus,
  getAccountStatus,
  setMockOnboardingState,
  createLoginLink,
  isStripeMock,
  isUsableAccountId,
  updateOnboardingStatus,
  createOnboardingLink,
  createPaymentIntent,
  getPaymentIntent,
  cancelPaymentIntent,
  createTransfer,
  constructWebhookEvent,
  handleWebhookEvent,
  createRefund
}
