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

/**
 * Escape free text before interpolating it into an HTML email template.
 *
 * Every string below that ultimately traces back to a model name (artist-controlled),
 * a contact-form field (anonymous-visitor-controlled), or any other value someone
 * other than the recipient can set, MUST go through this first — otherwise it's a
 * stored HTML-injection vector into whichever inbox renders the email (buyer, support
 * staff, or the artist themselves). Found in the 2026-09-05 security audit: model
 * names were being interpolated raw into the order-confirmation email, and contact-
 * form fields raw into the support-notification email.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
  /** Lets the recipient hit "Reply" and land in the sender's inbox, not ours. */
  replyTo?: string
  /** Overrides FROM_EMAIL (the generic noreply@ sender) — e.g. support@ for a support reply. */
  from?: string
}

/**
 * Send email via Resend or log if not configured
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const { to, subject, html, text, replyTo, from } = params

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
      from: from || FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || stripHtml(html),
      ...(replyTo ? { reply_to: replyTo } : {})
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
// EMAIL VERIFICATION EMAIL
// ============================================================================

export interface VerificationEmailParams {
  to: string
  name?: string
  /** The RAW (unhashed) token — goes in the link the user clicks. */
  token: string
}

/**
 * Send the "confirm your email address" email at signup (customer or artist).
 * The link lands on the frontend /verify-email page, which POSTs the token back.
 */
export async function sendVerificationEmail(
  params: VerificationEmailParams
): Promise<void> {
  const { to, name, token } = params
  const verifyUrl = `${FRONTEND_URL}/verify-email?token=${encodeURIComponent(token)}`
  const greeting = name ? `Hi ${name},` : 'Hi,'

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 28px; margin: 0;">Confirm your email</h1>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <p style="margin: 0 0 16px 0; color: #4b5563;">${greeting}</p>
    <p style="margin: 0; color: #4b5563;">
      Thanks for joining Artifact Armoury! Please confirm this email address to
      unlock uploading and purchasing. This link expires in 24 hours.
    </p>
  </div>

  <div style="text-align: center; margin-bottom: 24px;">
    <a href="${verifyUrl}" style="display: inline-block; padding: 14px 28px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
      Verify email address
    </a>
  </div>

  <div style="margin-bottom: 24px;">
    <p style="margin: 0; color: #6b7280; font-size: 14px;">
      If the button doesn't work, paste this link into your browser:
    </p>
    <p style="margin: 8px 0 0 0; word-break: break-all;">
      <a href="${verifyUrl}" style="color: #2563eb; font-size: 14px;">${verifyUrl}</a>
    </p>
  </div>

  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0 0 8px 0;">If you didn't create an account, you can safely ignore this email.</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>

</body>
</html>
  `

  await sendEmail({
    to,
    subject: 'Confirm your email address',
    html,
  })
}

// ============================================================================
// PASSWORD RESET EMAILS
// ============================================================================

export interface PasswordResetEmailParams {
  to: string
  name?: string
  /** The RAW (unhashed) token — goes in the link the user clicks. */
  token: string
}

/**
 * Send the "reset your password" email. The link lands on the frontend
 * /reset-password page, which reads the token from the query string and POSTs
 * it back with the new password. The token itself expires in 60 minutes
 * (enforced server-side in routes/auth.ts) regardless of whether this email
 * is ever opened.
 */
export async function sendPasswordResetEmail(
  params: PasswordResetEmailParams
): Promise<void> {
  const { to, name, token } = params
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`
  const greeting = name ? `Hi ${name},` : 'Hi,'

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 28px; margin: 0;">Reset your password</h1>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <p style="margin: 0 0 16px 0; color: #4b5563;">${greeting}</p>
    <p style="margin: 0; color: #4b5563;">
      We received a request to reset the password on your Artifact Armoury account.
      Click the button below to choose a new one. This link expires in 60 minutes.
    </p>
  </div>

  <div style="text-align: center; margin-bottom: 24px;">
    <a href="${resetUrl}" style="display: inline-block; padding: 14px 28px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
      Reset password
    </a>
  </div>

  <div style="margin-bottom: 24px;">
    <p style="margin: 0; color: #6b7280; font-size: 14px;">
      If the button doesn't work, paste this link into your browser:
    </p>
    <p style="margin: 8px 0 0 0; word-break: break-all;">
      <a href="${resetUrl}" style="color: #2563eb; font-size: 14px;">${resetUrl}</a>
    </p>
  </div>

  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0 0 8px 0;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>

</body>
</html>
  `

  await sendEmail({
    to,
    subject: 'Reset your password',
    html,
  })
}

/**
 * Confirmation sent once a password reset actually completes — lets the
 * account owner notice (and contact support) if they didn't do it themselves.
 */
export async function sendPasswordChangedEmail(params: { to: string; name?: string }): Promise<void> {
  const { to, name } = params
  const greeting = name ? `Hi ${name},` : 'Hi,'

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 26px; margin: 0;">Your password was changed</h1>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <p style="margin: 0 0 16px 0; color: #4b5563;">${greeting}</p>
    <p style="margin: 0; color: #4b5563;">
      This confirms the password on your Artifact Armoury account was just changed.
      If this was you, no action is needed.
    </p>
  </div>

  <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
    <p style="margin: 0; color: #991b1b; font-size: 14px;">
      <strong>Wasn't you?</strong> Reply to this email or contact
      support@artifactarmoury.com right away.
    </p>
  </div>

  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>

</body>
</html>
  `

  await sendEmail({
    to,
    subject: 'Your password was changed',
    html,
  })
}

// ============================================================================
// ORDER CONFIRMATION EMAIL
// ============================================================================

export interface OrderConfirmationParams {
  order: OrderLike
  items: Array<{
    asset: AssetLike
    quantity: number
    /** Model id — used to deep-link the buyer straight to the download button. */
    modelId?: string
  }>
}

/**
 * Send the order confirmation for a DIGITAL STL order. There is no shipping and
 * no print step — the files are available to download the moment payment
 * succeeds, so the email confirms the order number + total and links the buyer
 * straight to each model's download page.
 */
export async function sendOrderConfirmation(
  params: OrderConfirmationParams
): Promise<void> {
  const { order, items } = params

  const itemsHtml = items.map(item => {
    const downloadLink = item.modelId
      ? `<a href="${FRONTEND_URL}/models/${item.modelId}" style="color: #bf6a15; font-weight: 600; font-size: 14px; text-decoration: none;">Download &rarr;</a>`
      : `<span style="color: #9ca3af; font-size: 14px;">Available in your account</span>`
    return `
    <tr>
      <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb;">
        <strong style="color: #111827;">${escapeHtml(item.asset.name)}</strong><br>
        <span style="color: #6b7280; font-size: 13px;">Digital STL &middot; download any time</span>
      </td>
      <td style="padding: 14px 16px; text-align: right; border-bottom: 1px solid #e5e7eb; white-space: nowrap;">
        £${Number(item.asset.base_price).toFixed(2)}<br>
        ${downloadLink}
      </td>
    </tr>`
  }).join('')

  const total = Number(order.pricing?.total ?? 0)

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
    <p style="color: #6b7280; margin-top: 8px;">Order confirmation</p>
  </div>

  <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <h2 style="margin: 0 0 8px 0; font-size: 20px; color: #166534;">Your files are ready to download</h2>
    <p style="margin: 0; color: #166534;">
      Payment received &mdash; thank you! Your STL files are available now. Download
      them from each model below, as many times as you like. Every file is
      watermarked to your account.
    </p>
  </div>

  <div style="margin-bottom: 24px;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Order number:</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 600; font-family: monospace;">${order.order_number}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Order date:</td>
        <td style="padding: 8px 0; text-align: right;">${new Date(order.created_at).toLocaleDateString('en-GB')}</td>
      </tr>
    </table>
  </div>

  <div style="margin-bottom: 24px;">
    <h3 style="font-size: 16px; color: #111827; margin-bottom: 12px;">Your downloads</h3>
    <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      ${itemsHtml}
      <tr style="background: #f9fafb;">
        <td style="padding: 14px 16px; font-weight: 600; font-size: 18px;">Total paid</td>
        <td style="padding: 14px 16px; text-align: right; font-weight: 600; font-size: 18px;">£${total.toFixed(2)}</td>
      </tr>
    </table>
  </div>

  <div style="background: #fbf3e8; border: 1px solid #e7c79a; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
    <p style="margin: 0; color: #7c4a12; font-size: 14px;">
      <strong>How to print:</strong> open your STL in your slicer of choice, scale
      to taste, and print. Multi-part sets download as a single ZIP with every part
      inside. Need help? Just reply to this email.
    </p>
  </div>

  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0 0 8px 0;">Questions about your order? Contact us at support@artifactarmoury.com</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>

</body>
</html>
  `

  await sendEmail({
    to: order.user_email,
    subject: `Your Artifact Armoury order - ${order.order_number}`,
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
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Planner. All rights reserved.</p>
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
      <strong>${escapeHtml(item.asset.name)}</strong> × ${item.quantity}
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
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Planner. All rights reserved.</p>
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
// CONTACT FORM
// ============================================================================

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@artifactarmoury.com'

export interface ContactMessageParams {
  name: string
  email: string
  subject: string
  message: string
  /** Signed-in sender, if any — lets support cross-reference their account. */
  userId?: string
  /** Public CDN URLs for any files the sender attached, for support to review. */
  attachmentUrls?: string[]
}

/**
 * Notify support@ of a new Contact page submission. `replyTo` is set to the
 * sender's own address, so support can just hit Reply in their inbox.
 */
export async function sendContactMessageToSupport(params: ContactMessageParams): Promise<void> {
  const { name, email, subject, message, userId, attachmentUrls = [] } = params

  const attachmentsHtml = attachmentUrls.length
    ? `<div style="margin-top: 16px;">
         <strong style="color: #111827;">Attachments:</strong>
         <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #2563eb;">
           ${attachmentUrls.map((u) => `<li><a href="${u}" style="color: #2563eb;">${u}</a></li>`).join('')}
         </ul>
       </div>`
    : ''

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="margin-bottom: 24px;">
    <h1 style="color: #111827; font-size: 22px; margin: 0;">New contact form message</h1>
  </div>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
    <tr>
      <td style="padding: 6px 0; color: #6b7280; width: 90px;">From:</td>
      <td style="padding: 6px 0; font-weight: 600;">${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</td>
    </tr>
    <tr>
      <td style="padding: 6px 0; color: #6b7280;">Account:</td>
      <td style="padding: 6px 0;">${userId ? `Signed in (user ${escapeHtml(userId)})` : 'Not signed in'}</td>
    </tr>
    <tr>
      <td style="padding: 6px 0; color: #6b7280;">Subject:</td>
      <td style="padding: 6px 0; font-weight: 600;">${escapeHtml(subject)}</td>
    </tr>
  </table>

  <div style="background: #f9fafb; border-radius: 8px; padding: 16px; white-space: pre-wrap;">${escapeHtml(message)}</div>

  ${attachmentsHtml}

  <p style="margin-top: 24px; color: #6b7280; font-size: 13px;">Reply to this email to respond directly to ${escapeHtml(name)}.</p>

</body>
</html>
  `

  await sendEmail({
    to: SUPPORT_EMAIL,
    subject: `[Contact] ${subject}`,
    html,
    replyTo: email
  })
}

/**
 * Courtesy "we got your message" reply to the sender's own address.
 */
export async function sendContactConfirmation(params: { name: string; email: string; subject: string }): Promise<void> {
  const { name, email, subject } = params

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 24px; margin: 0;">We've got your message</h1>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <p style="margin: 0 0 12px 0; color: #4b5563;">Hi ${escapeHtml(name)},</p>
    <p style="margin: 0; color: #4b5563;">
      Thanks for reaching out about "${escapeHtml(subject)}". Our support team has received your
      message and will get back to you at this address as soon as they can.
    </p>
  </div>

  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>

</body>
</html>
  `

  await sendEmail({
    to: email,
    subject: `We've received your message — ${subject}`,
    html
  })
}

export interface ContactReplyParams {
  to: string
  name: string
  subject: string
  /** The sender's original message, quoted underneath the reply for context. */
  originalMessage: string
  replyBody: string
}

/**
 * An admin's in-app reply to a Contact page submission (AdminContactMessages.tsx).
 * Sent — and reply-able — as SUPPORT_EMAIL rather than the noreply@ FROM_EMAIL used
 * everywhere else, and never the replying admin's own address, which is the whole
 * point of this function existing instead of a `mailto:` link.
 */
export async function sendContactReply(params: ContactReplyParams): Promise<void> {
  const { to, name, subject, originalMessage, replyBody } = params
  const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">

  <p style="margin: 0 0 16px 0; color: #4b5563;">Hi ${escapeHtml(name)},</p>

  <div style="white-space: pre-wrap; margin-bottom: 24px;">${escapeHtml(replyBody)}</div>

  <div style="margin-top: 8px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 13px;">
    <p style="margin: 0 0 8px 0;">On your message to Artifact Armoury support:</p>
    <blockquote style="margin: 0; padding-left: 12px; border-left: 3px solid #e5e7eb; white-space: pre-wrap; color: #6b7280;">${escapeHtml(originalMessage)}</blockquote>
  </div>

  <div style="text-align: center; padding-top: 24px; margin-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>

</body>
</html>
  `

  await sendEmail({
    to,
    subject: replySubject,
    html,
    from: SUPPORT_EMAIL,
    replyTo: SUPPORT_EMAIL,
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
    <h1 style="color: #111827; font-size: 32px; margin: 0;">Welcome to Artifact Planner!</h1>
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
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Planner. All rights reserved.</p>
  </div>
  
</body>
</html>
  `
  
  await sendEmail({
    to: artist.email,
    subject: 'Welcome to Artifact Planner! 🎉',
    html
  })
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendOrderConfirmation,
  sendShippingNotification,
  sendArtistSaleNotification,
  sendArtistWelcome,
  sendContactMessageToSupport,
  sendContactConfirmation
}
