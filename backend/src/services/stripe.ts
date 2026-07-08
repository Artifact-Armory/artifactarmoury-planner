// backend/src/services/stripe.ts
import Stripe from 'stripe'
import logger from '../utils/logger'
import { db } from '../db'
import { accrueEarningsForOrder } from './earnings'

// ============================================================================
// INITIALIZATION
// ============================================================================

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const STRIPE_MOCK = (process.env.STRIPE_MOCK === 'true') || (process.env.PAYMENTS_MOCK === 'true') || (process.env.PAYMENTS_ENABLED === 'false')

if (!STRIPE_MOCK && !STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY environment variable is required')
}

export const stripe: Stripe = STRIPE_MOCK
  // In mock mode, stripe SDK is not used
  ? (undefined as unknown as Stripe)
  : new Stripe(STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16',
      typescript: true
    })

const stripeLogger = logger.child('STRIPE')

// ============================================================================
// STRIPE CONNECT - ARTIST ONBOARDING
// ============================================================================

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
    return {
      account_id: `acct_mock_${Date.now()}`,
      onboarding_url: returnUrl,
    }
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
 * Check if artist has completed Stripe onboarding
 */
export async function checkOnboardingStatus(accountId: string): Promise<boolean> {
  if (STRIPE_MOCK) return true
  try {
    const account = await stripe.accounts.retrieve(accountId)
    
    const isComplete = account.charges_enabled && account.payouts_enabled
    
    stripeLogger.debug('Onboarding status checked', {
      accountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      isComplete
    })
    
    return isComplete
  } catch (error) {
    stripeLogger.error('Failed to check onboarding status', { error, accountId })
    return false
  }
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

// ============================================================================
// PAYMENT INTENTS
// ============================================================================

export interface CreatePaymentIntentParams {
  amount: number // In pounds (e.g., 15.99)
  currency?: string
  metadata?: Record<string, string>
  description?: string
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
    return {
      payment_intent_id: `pi_mock_${Date.now()}`,
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
    return {
      id: paymentIntentId,
      object: 'payment_intent',
      amount: 100,
      currency: 'gbp',
      status: 'succeeded',
      metadata: {},
    } as unknown as Stripe.PaymentIntent
  }
  try {
    return await stripe.paymentIntents.retrieve(paymentIntentId)
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
    // Mark paid + delivered (digital STLs fulfil instantly), then accrue the artists'
    // earnings into the ledger. Idempotent, so it's safe alongside the confirm route.
    await db.query(
      `UPDATE orders
       SET payment_status = 'succeeded',
           paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
           fulfillment_status = 'delivered'
       WHERE id = $1`,
      [orderId]
    )

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
