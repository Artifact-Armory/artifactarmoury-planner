// backend/src/services/stripe.ts
import Stripe from 'stripe'
import logger from '../utils/logger'
import { db } from '../db'

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
    
    // Save account ID to database
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

export interface CreateTransferParams {
  orderId: string
  orderItemId?: string
  artistId: string
  accountId: string
  amount: number // In pounds
  description?: string
}

/**
 * Transfer funds to artist's connected account
 */
async function recordArtistPayment(params: {
  artistId: string
  orderItemId?: string | null
  amount: number
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded'
  stripeTransferId?: string | null
}) {
  const { artistId, orderItemId, amount, status, stripeTransferId } = params

  if (orderItemId && status === 'completed' && stripeTransferId) {
    const updateResult = await db.query(
      `
      UPDATE payments
      SET status = 'completed',
          stripe_transfer_id = $1,
          paid_at = CURRENT_TIMESTAMP
      WHERE order_item_id = $2
      RETURNING id
    `,
      [stripeTransferId, orderItemId]
    )

    if (updateResult.rowCount > 0) {
      await db.query(
        `
        UPDATE order_items
        SET commission_paid = true,
            commission_paid_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
        [orderItemId]
      )
      return
    }
  }

  await db.query(
    `
    INSERT INTO payments (
      artist_id,
      order_item_id,
      amount,
      currency,
      stripe_transfer_id,
      status,
      paid_at
    )
    VALUES ($1, $2, $3, 'GBP', $4, $5, CASE WHEN $5 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END)
  `,
    [artistId, orderItemId ?? null, amount, stripeTransferId ?? null, status]
  )

  if (orderItemId && status === 'completed') {
    await db.query(
      `
      UPDATE order_items
      SET commission_paid = true,
          commission_paid_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
      [orderItemId]
    )
  }
}

export async function transferToArtist(params: CreateTransferParams): Promise<string> {
  const { orderId, orderItemId, artistId, accountId, amount, description } = params

  const amountInPence = Math.round(amount * 100)

  try {
    stripeLogger.info('Creating transfer to artist', {
      orderId,
      orderItemId,
      artistId,
      accountId,
      amount,
      amountInPence,
    })

    let transferId: string

    if (STRIPE_MOCK) {
      transferId = `tr_mock_${Date.now()}`
    } else {
      const transfer = await stripe.transfers.create({
        amount: amountInPence,
        currency: 'gbp',
        destination: accountId,
        description: description || `Payment for order ${orderId}`,
        metadata: {
          order_id: orderId,
          artist_id: artistId,
          order_item_id: orderItemId ?? '',
        },
      })
      transferId = transfer.id
    }

    await recordArtistPayment({
      artistId,
      orderItemId: orderItemId ?? null,
      amount,
      status: 'completed',
      stripeTransferId: transferId,
    })

    stripeLogger.info('Transfer completed', {
      transferId,
      orderId,
      orderItemId,
      artistId,
      amount,
    })

    return transferId
  } catch (error) {
    stripeLogger.error('Failed to transfer to artist', { error, params })

    await recordArtistPayment({
      artistId,
      orderItemId: orderItemId ?? null,
      amount,
      status: 'failed',
      stripeTransferId: null,
    })

    throw new Error('Failed to transfer funds to artist')
  }
}

/**
 * Process artist payouts for completed order
 */
export async function processOrderPayouts(orderId: string): Promise<void> {
  try {
    stripeLogger.info('Processing order payouts', { orderId })

    const itemsResult = await db.query(
      `
      SELECT
        oi.id AS order_item_id,
        oi.artist_id,
        oi.artist_commission_amount,
        oi.commission_paid,
        u.stripe_account_id
      FROM order_items oi
      LEFT JOIN users u ON u.id = oi.artist_id
      WHERE oi.order_id = $1
    `,
      [orderId]
    )

    if (itemsResult.rowCount === 0) {
      stripeLogger.warn('No order items found for payouts', { orderId })
      return
    }

    for (const row of itemsResult.rows) {
      const artistId: string | null = row.artist_id
      if (!artistId) {
        continue
      }

      const amount = Number(row.artist_commission_amount ?? 0)
      if (amount <= 0) {
        continue
      }

      if (row.commission_paid) {
        stripeLogger.debug('Commission already paid, skipping', {
          orderId,
          orderItemId: row.order_item_id,
          artistId,
        })
        continue
      }

      const accountId: string | null = row.stripe_account_id

      if (!accountId) {
        stripeLogger.warn('Artist missing Stripe account, marking payout pending', {
          orderId,
          orderItemId: row.order_item_id,
          artistId,
        })

        await recordArtistPayment({
          artistId,
          orderItemId: row.order_item_id,
          amount,
          status: 'pending',
          stripeTransferId: null,
        })
        continue
      }

      await transferToArtist({
        orderId,
        orderItemId: row.order_item_id,
        artistId,
        accountId,
        amount,
        description: `Payout for order ${orderId}`,
      })
    }

    stripeLogger.info('Order payouts completed', {
      orderId,
      itemCount: itemsResult.rowCount,
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
    // Update order status
    await db.query(
      `
      UPDATE orders 
      SET payment_status = 'succeeded',
          fulfillment_status = CASE 
            WHEN fulfillment_status = 'pending' THEN 'processing'
            ELSE fulfillment_status
          END,
          payment_intent_id = $1,
          paid_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `,
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
  if (STRIPE_MOCK) return
  stripeLogger.warn('Payment failed', {
    paymentIntentId: paymentIntent.id,
    error: paymentIntent.last_payment_error?.message
  })
  
  const orderId = paymentIntent.metadata.order_id
  
  if (orderId) {
    await db.query(
      `
      UPDATE orders 
      SET payment_status = 'failed',
          internal_notes = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `,
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
    orderId: transfer.metadata.order_id,
    artistId: transfer.metadata.artist_id
  })
  
  // Update payment status in database and reset commission flag
  const paymentResult = await db.query(
    `
    UPDATE payments
    SET status = 'failed'
    WHERE stripe_transfer_id = $1
    RETURNING order_item_id
  `,
    [transfer.id]
  )

  const orderItemId = paymentResult.rows[0]?.order_item_id
  if (orderItemId) {
    await db.query(
      `
      UPDATE order_items
      SET commission_paid = false,
          commission_paid_at = NULL
      WHERE id = $1
    `,
      [orderItemId]
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
  transferToArtist,
  processOrderPayouts,
  constructWebhookEvent,
  handleWebhookEvent,
  createRefund
}
