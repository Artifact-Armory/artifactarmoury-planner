// backend/src/services/email.ts
import { Resend } from 'resend'
import logger from '../utils/logger'

// Minimal local types to avoid cross-package imports during build
interface OrderLike {
  id: string
  order_number: string
  created_at: string | number | Date
  user_email?: string
  pricing?: any
  shipping_address?: any
}

interface ArtistLike {
  email: string
  name?: string
}

interface AssetLike {
  name: string
  base_price: number
}

// ============================================================================
// INITIALIZATION
// ============================================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.EMAIL_FROM || process.env.FROM_EMAIL || 'noreply@artifactarmoury.com'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

let resend: Resend | null = null

if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY)
  logger.info('✓ Resend email service initialized')
} else {
  logger.warn('RESEND_API_KEY not configured - emails will be logged only')
}

const emailLogger = logger.child('EMAIL')

// ============================================================================
// EMAIL SENDING
// ============================================================================

export interface SendEmailParams {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

/**
 * Send email via Resend or log if not configured
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const { to, subject, html, text } = params
  
  try {
    if (!resend) {
      emailLogger.warn('Email not sent (Resend not configured)', {
        to,
        subject
      })
      emailLogger.debug('Email content', { html, text })
      return
    }
    
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || stripHtml(html)
    })
    
    emailLogger.info('Email sent', {
      to,
      subject,
      messageId: result.data?.id
    })
  } catch (error) {
    emailLogger.error('Failed to send email', {
      error,
      to,
      subject
    })
    // Don't throw - email failures shouldn't break the application
  }
}

/**
 * Strip HTML tags for plain text version
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

// ============================================================================
// ORDER CONFIRMATION EMAIL
// ============================================================================

export interface OrderConfirmationParams {
  order: OrderLike
  items: Array<{
    asset: AssetLike
    quantity: number
  }>
}

/**
 * Send order confirmation email to customer
 */
export async function sendOrderConfirmation(
  params: OrderConfirmationParams
): Promise<void> {
  const { order, items } = params
  
  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
        <strong>${item.asset.name}</strong><br>
        <span style="color: #6b7280; font-size: 14px;">Quantity: ${item.quantity}</span>
      </td>
      <td style="padding: 12px; text-align: right; border-bottom: 1px solid #e5e7eb;">
        £${(item.asset.base_price * item.quantity).toFixed(2)}
      </td>
    </tr>
  `).join('')
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">
  
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 28px; margin: 0;">Artifact Armoury</h1>
    <p style="color: #6b7280; margin-top: 8px;">Order Confirmation</p>
  </div>
  
  <div style="background: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <h2 style="margin: 0 0 16px 0; font-size: 20px; color: #111827;">Thank you for your order!</h2>
    <p style="margin: 0; color: #4b5563;">
      We've received your order and will begin processing it shortly. 
      You'll receive another email once your items have been shipped.
    </p>
  </div>
  
  <div style="margin-bottom: 24px;">
    <h3 style="font-size: 16px; color: #111827; margin-bottom: 8px;">Order Details</h3>
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Order Number:</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 600;">${order.order_number}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Order Date:</td>
        <td style="padding: 8px 0; text-align: right;">${new Date(order.created_at).toLocaleDateString('en-GB')}</td>
      </tr>
    </table>
  </div>
  
  <div style="margin-bottom: 24px;">
    <h3 style="font-size: 16px; color: #111827; margin-bottom: 12px;">Items</h3>
    <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      ${itemsHtml}
    </table>
  </div>
  
  <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Models Subtotal:</td>
        <td style="padding: 8px 0; text-align: right;">£${order.pricing.model_subtotal.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Print & Materials:</td>
        <td style="padding: 8px 0; text-align: right;">£${order.pricing.print_subtotal.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Shipping:</td>
        <td style="padding: 8px 0; text-align: right;">£${order.pricing.shipping.toFixed(2)}</td>
      </tr>
      <tr style="border-top: 2px solid #e5e7eb;">
        <td style="padding: 12px 0; font-weight: 600; font-size: 18px;">Total:</td>
        <td style="padding: 12px 0; text-align: right; font-weight: 600; font-size: 18px;">£${order.pricing.total.toFixed(2)}</td>
      </tr>
    </table>
  </div>
  
  <div style="margin-bottom: 24px;">
    <h3 style="font-size: 16px; color: #111827; margin-bottom: 8px;">Shipping Address</h3>
    <p style="margin: 0; color: #4b5563; line-height: 1.8;">
      ${order.shipping_address.name}<br>
      ${order.shipping_address.line1}<br>
      ${order.shipping_address.line2 ? order.shipping_address.line2 + '<br>' : ''}
      ${order.shipping_address.city}, ${order.shipping_address.postal_code}<br>
      ${order.shipping_address.country}
    </p>
  </div>
  
  <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
    <p style="margin: 0; color: #1e40af; font-size: 14px;">
      <strong>Track your order:</strong> Visit your order status page at any time to see updates.
    </p>
    <a href="${FRONTEND_URL}/orders/${order.id}" style="display: inline-block; margin-top: 12px; padding: 8px 16px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
      View Order Status
    </a>
  </div>
  
  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0 0 8px 0;">Need help? Contact us at support@artifactarmoury.com</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>
  
</body>
</html>
  `
  
  await sendEmail({
    to: order.user_email,
    subject: `Order Confirmation - ${order.order_number}`,
    html
  })
}

// ============================================================================
// SHIPPING NOTIFICATION EMAIL
// ============================================================================

export interface ShippingNotificationParams {
  order: OrderLike
  trackingNumber: string
  carrier?: string
}

/**
 * Send shipping notification email to customer
 */
export async function sendShippingNotification(
  params: ShippingNotificationParams
): Promise<void> {
  const { order, trackingNumber, carrier = 'Royal Mail' } = params
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">
  
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 28px; margin: 0;">📦 Your order has shipped!</h1>
  </div>
  
  <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <p style="margin: 0 0 16px 0; color: #166534; font-size: 16px;">
      <strong>Great news!</strong> Your order #${order.order_number} has been shipped and is on its way.
    </p>
    <div style="background: white; border-radius: 6px; padding: 16px; margin-top: 16px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Carrier:</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">${carrier}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Tracking Number:</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; font-family: monospace;">${trackingNumber}</td>
        </tr>
      </table>
    </div>
  </div>
  
  <div style="margin-bottom: 24px;">
    <h3 style="font-size: 16px; color: #111827; margin-bottom: 8px;">Shipping To</h3>
    <p style="margin: 0; color: #4b5563; line-height: 1.8;">
      ${order.shipping_address.name}<br>
      ${order.shipping_address.line1}<br>
      ${order.shipping_address.line2 ? order.shipping_address.line2 + '<br>' : ''}
      ${order.shipping_address.city}, ${order.shipping_address.postal_code}<br>
      ${order.shipping_address.country}
    </p>
  </div>
  
  <div style="text-align: center; margin-bottom: 24px;">
    <a href="${FRONTEND_URL}/orders/${order.id}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
      Track Your Order
    </a>
  </div>
  
  <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
    <p style="margin: 0; color: #4b5563; font-size: 14px;">
      <strong>Delivery Time:</strong> Most UK orders arrive within 3-5 business days. 
      International orders may take 7-14 business days depending on customs processing.
    </p>
  </div>
  
  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0 0 8px 0;">Questions? Contact us at support@artifactarmoury.com</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>
  
</body>
</html>
  `
  
  await sendEmail({
    to: order.user_email,
    subject: `Your order has shipped! - ${order.order_number}`,
    html
  })
}

// ============================================================================
// ARTIST NOTIFICATION EMAIL
// ============================================================================

export interface ArtistSaleNotificationParams {
  artist: ArtistLike
  order: OrderLike
  earnings: number
  items: Array<{
    asset: AssetLike
    quantity: number
  }>
}

/**
 * Notify artist of new sale
 */
export async function sendArtistSaleNotification(
  params: ArtistSaleNotificationParams
): Promise<void> {
  const { artist, order, earnings, items } = params
  
  const itemsList = items.map(item => `
    <li style="margin-bottom: 8px;">
      <strong>${item.asset.name}</strong> × ${item.quantity}
    </li>
  `).join('')
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">
  
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 28px; margin: 0;">🎉 You made a sale!</h1>
  </div>
  
  <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 24px; margin-bottom: 24px; text-align: center;">
    <p style="margin: 0 0 8px 0; color: #166534; font-size: 16px;">Your earnings from this order:</p>
    <p style="margin: 0; color: #166534; font-size: 32px; font-weight: 700;">£${earnings.toFixed(2)}</p>
  </div>
  
  <div style="margin-bottom: 24px;">
    <h3 style="font-size: 16px; color: #111827; margin-bottom: 12px;">Order Details</h3>
    <table style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 8px; padding: 16px;">
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Order Number:</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 600;">${order.order_number}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Date:</td>
        <td style="padding: 8px 0; text-align: right;">${new Date(order.created_at).toLocaleDateString('en-GB')}</td>
      </tr>
    </table>
  </div>
  
  <div style="margin-bottom: 24px;">
    <h3 style="font-size: 16px; color: #111827; margin-bottom: 12px;">Items Sold</h3>
    <ul style="list-style: none; padding: 0; margin: 0; color: #4b5563;">
      ${itemsList}
    </ul>
  </div>
  
  <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
    <p style="margin: 0 0 8px 0; color: #1e40af; font-size: 14px;">
      <strong>💰 Payout Information:</strong>
    </p>
    <p style="margin: 0; color: #1e40af; font-size: 14px;">
      Your earnings will be automatically transferred to your Stripe account within 2-3 business days.
    </p>
  </div>
  
  <div style="text-align: center; margin-bottom: 24px;">
    <a href="${FRONTEND_URL}/artist/dashboard" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
      View Dashboard
    </a>
  </div>
  
  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>
  
</body>
</html>
  `
  
  await sendEmail({
    to: artist.email,
    subject: `You made a sale! - ${order.order_number}`,
    html
  })
}

// ============================================================================
// WELCOME EMAIL
// ============================================================================

/**
 * Send welcome email to new artist
 */
export async function sendArtistWelcome(artist: ArtistLike): Promise<void> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">
  
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 32px; margin: 0;">Welcome to Artifact Armoury!</h1>
    <p style="color: #6b7280; margin-top: 8px; font-size: 18px;">We're excited to have you, ${artist.name}!</p>
  </div>
  
  <div style="background: #f0fdf4; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <h2 style="margin: 0 0 16px 0; font-size: 20px; color: #166534;">🎨 Start Selling Your Terrain</h2>
    <p style="margin: 0; color: #166534;">
      Your artist account is ready. Upload your 3D models and start earning from your creative work.
    </p>
  </div>
  
  <div style="margin-bottom: 24px;">
    <h3 style="font-size: 18px; color: #111827; margin-bottom: 16px;">Getting Started</h3>
    <ol style="color: #4b5563; padding-left: 20px;">
      <li style="margin-bottom: 12px;"><strong>Complete Stripe Setup:</strong> Connect your Stripe account to receive payouts</li>
      <li style="margin-bottom: 12px;"><strong>Upload Models:</strong> Upload your STL files with descriptions and pricing</li>
      <li style="margin-bottom: 12px;"><strong>Create Examples:</strong> Build example tables to showcase your work</li>
      <li style="margin-bottom: 12px;"><strong>Start Earning:</strong> You keep 80% of all sales!</li>
    </ol>
  </div>
  
  <div style="text-align: center; margin-bottom: 24px;">
    <a href="${FRONTEND_URL}/artist/dashboard" style="display: inline-block; padding: 14px 28px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
      Go to Dashboard
    </a>
  </div>
  
  <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
    <p style="margin: 0 0 8px 0; color: #4b5563; font-size: 14px;">
      <strong>💡 Tip:</strong> Models with detailed descriptions and good preview images sell better!
    </p>
  </div>
  
  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0 0 8px 0;">Need help? We're here for you at support@artifactarmoury.com</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>
  
</body>
</html>
  `
  
  await sendEmail({
    to: artist.email,
    subject: 'Welcome to Artifact Armoury! 🎉',
    html
  })
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  sendOrderConfirmation,
  sendShippingNotification,
  sendArtistSaleNotification,
  sendArtistWelcome
}
