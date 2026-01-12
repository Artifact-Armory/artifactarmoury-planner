// backend/src/routes/webhooks.ts
// Webhook endpoints (Stripe, etc.)

import express from 'express'
import { constructWebhookEvent, handleWebhookEvent } from '../services/stripe'
import logger from '../utils/logger'

const router = express.Router()

// Stripe webhook: must use raw body to verify signature
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'] as string | undefined
    if (!signature) {
      return res.status(400).send('Missing stripe-signature header')
    }

    const event = constructWebhookEvent(req.body as Buffer, signature)
    await handleWebhookEvent(event)
    res.json({ received: true })
  } catch (error) {
    logger.error('Stripe webhook error', { error })
    res.status(400).send((error as Error).message)
  }
})

export default router

