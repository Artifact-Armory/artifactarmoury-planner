// backend/src/services/stripe.ts
import Stripe from 'stripe'
import logger from '../utils/logger.js'
import { db } from '../db/index.js'

// ============================================================================
// INITIALIZATION
// ============================================================================

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET

if (!STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY environment variable is required')
}

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
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
    
    // Save account ID to database
    await db.query(
      'UPDATE artists SET stripe_account_id = $1 WHERE id = $2',
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
    'UPDATE artists SET stripe_onboarding_complete = $1 WHERE id = $2',
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

export interface CreateTransferParams {
  orderId: string
  artistId: string
  accountId: string
  amount: number // In pounds
  description?: string
}

/**
 * Transfer funds to artist's connected account
 */
export async function transferToArtist(
  params: CreateTransferParams
): Promise<string> {
  try {
    const { orderId, artistId, accountId, amount, description } = params
    
    // Convert to pence
    const amountInPence = Math.round(amount * 100)
    
    stripeLogger.info('Creating transfer to artist', {
      orderId,
      artistId,
      accountId,
      amount,
      amountInPence
    })
    
    // Create transfer
    const transfer = await stripe.transfers.create({
      amount: amountInPence,
      currency: 'gbp',
      destination: accountId,
      description: description || `Payment for order ${orderId}`,
      metadata: {
        order_id: orderId,
        artist_id: artistId
      }
    })
    
    // Record transfer in database
    await db.query(
      `INSERT INTO stripe_transfers 
       (order_id, artist_id, stripe_transfer_id, amount, status)
       VALUES ($1, $2, $3, $4, 'completed')`,
      [orderId, artistId, transfer.id, amount]
    )
    
    stripeLogger.info('Transfer completed', {
      transferId: transfer.id,
      orderId,
      artistId,
      amount
    })
    
    return transfer.id
  } catch (error) {
    stripeLogger.error('Failed to transfer to artist', { error, params })
    
    // Record failed transfer
    await db.query(
      `INSERT INTO stripe_transfers 
       (order_id, artist_id, stripe_transfer_id, amount, status)
       VALUES ($1, $2, $3, $4, 'failed')`,
      [params.orderId, params.artistId, 'failed', params.amount]
    ).catch(() => {})
    
    throw new Error('Failed to transfer funds to artist')
  }
}

/**
 * Process artist payouts for completed order
 */
export async function processOrderPayouts(orderId: string): Promise<void> {
  try {
    stripeLogger.info('Processing order payouts', { orderId })
    
    // Get order details with artist earnings
    const orderResult = await db.query(
      `SELECT 
        o.id,
        o.pricing,
        o.items,
        a.id as artist_id,
        a.stripe_account_id,
        a.commission_rate
       FROM orders o
       JOIN LATERAL jsonb_array_elements(o.items) AS item ON true
       JOIN assets ast ON (item->>'asset_id')::uuid = ast.id
       JOIN artists a ON ast.artist_id = a.id
       WHERE o.id = $1
       GROUP BY o.id, a.id, a.stripe_account_id, a.commission_rate`,
      [orderId]
    )
    
    if (orderResult.rows.length === 0) {
      stripeLogger.warn('Order not found for payouts', { orderId })
      return
    }
    
    // Calculate payout per artist
    const artistPayouts = new Map<string, { accountId: string; amount: number }>()
    
    for (const row of orderResult.rows) {
      const artistId = row.artist_id
      const accountId = row.stripe_account_id
      const commissionRate = parseFloat(row.commission_rate)
      const pricing = row.pricing
      
      // Artist gets their commission rate (typically 80%)
      const artistEarnings = pricing.model_subtotal * commissionRate
      
      if (!artistPayouts.has(artistId)) {
        artistPayouts.set(artistId, { accountId, amount: 0 })
      }
      
      const current = artistPayouts.get(artistId)!
      current.amount += artistEarnings
    }
    
    // Process transfers
    for (const [artistId, { accountId, amount }] of artistPayouts) {
      if (!accountId) {
        stripeLogger.warn('Artist has no Stripe account, skipping payout', {
          artistId,
          orderId
        })
        continue
      }
      
      await transferToArtist({
        orderId,
        artistId,
        accountId,
        amount,
        description: `Payment for order ${orderId}`
      })
    }
    
    stripeLogger.info('Order payouts completed', {
      orderId,
      artistCount: artistPayouts.size
    })
  } catch (error) {
    stripeLogger.error('Failed to process order payouts', { error, orderId })
    throw error
  }
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
  stripeLogger.info('Processing webhook event', {
    type: event.type,
    id: event.id
  })
  
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent)
        break
      
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent)
        break
      
      case 'account.updated':
        await handleAccountUpdated(event.data.object as Stripe.Account)
        break
      
      case 'transfer.created':
        stripeLogger.info('Transfer created', {
          transferId: (event.data.object as Stripe.Transfer).id
        })
        break
      
      case 'transfer.failed':
        await handleTransferFailed(event.data.object as Stripe.Transfer)
        break
      
      default:
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
  stripeLogger.info('Payment succeeded', {
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount / 100
  })
  
  const orderId = paymentIntent.metadata.order_id
  
  if (orderId) {
    // Update order status
    await db.query(
      `UPDATE orders 
       SET status = 'paid', stripe_payment_id = $1 
       WHERE id = $2`,
      [paymentIntent.id, orderId]
    )
    
    // Process artist payouts
    await processOrderPayouts(orderId)
    
    stripeLogger.info('Order updated to paid', { orderId })
  }
}

async function handlePaymentIntentFailed(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
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
  const artistId = account.metadata.artist_id
  
  if (artistId) {
    await updateOnboardingStatus(artistId, account.id)
  }
}

async function handleTransferFailed(transfer: Stripe.Transfer): Promise<void> {
  stripeLogger.error('Transfer failed', {
    transferId: transfer.id,
    orderId: transfer.metadata.order_id,
    artistId: transfer.metadata.artist_id
  })
  
  // Update transfer status in database
  await db.query(
    `UPDATE stripe_transfers 
     SET status = 'failed' 
     WHERE stripe_transfer_id = $1`,
    [transfer.id]
  )
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
  transferToArtist,
  processOrderPayouts,
  constructWebhookEvent,
  handleWebhookEvent,
  createRefund
}