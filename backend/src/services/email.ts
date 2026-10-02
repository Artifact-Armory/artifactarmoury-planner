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
  /** Buyer agreed at checkout that the download starts now (waives the 14-day right to cancel). */
  downloadConsent?: boolean
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
const money = (n: unknown) => `£${Number(n ?? 0).toFixed(2)}`

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
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@artifactarmoury.com'

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
  /** Add the logo header + light colour scheme. Default true; off for plain person-to-person mail. */
  brand?: boolean
}

// Logo hosted with the storefront (frontend/public/email/logo.png) — a flat PNG,
// because Gmail and Outlook won't render SVG. Override the base for staging.
const EMAIL_ASSET_BASE = (process.env.EMAIL_ASSET_BASE || FRONTEND_URL).replace(/\/$/, '')

const LOGO_HEADER = `
  <div style="text-align: center; padding: 8px 0 24px 0; margin-bottom: 24px; border-bottom: 1px solid #e5e7eb;">
    <a href="${FRONTEND_URL}" style="text-decoration: none;">
      <img src="${EMAIL_ASSET_BASE}/email/logo.png" width="150" alt="Artifact Armoury" style="display: inline-block; width: 150px; max-width: 60%; height: auto; border: 0;">
    </a>
  </div>`

/**
 * Give an HTML email the site's look: white page, logo header on top, and a
 * "light only" colour-scheme hint so dark-mode clients don't invert the logo's
 * white tile into a muddle. Templates that have no <body> (plain internal
 * alerts) are returned untouched.
 */
function brandHtml(html: string): string {
  if (!/<body[^>]*>/i.test(html)) return html
  return html
    .replace(
      /<head>/i,
      '<head>\n  <meta name="color-scheme" content="light only">\n  <meta name="supported-color-schemes" content="light only">',
    )
    .replace(/<body style="/i, '<body style="background: #ffffff; ')
    .replace(/(<body[^>]*>)/i, `$1${LOGO_HEADER}`)
}

/**
 * Send email via Resend or log if not configured
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const { to, subject, text, replyTo, from, brand = true } = params
  const html = brand ? brandHtml(params.html) : params.html

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

export interface BatchMessage {
  to: string
  subject: string
  html: string
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>
}

/**
 * Send many individually-addressed emails via Resend's batch endpoint (100 per
 * request) instead of one request each — a follower fan-out can be hundreds. Each
 * message is its own email to one recipient (never a shared To/CC). Like
 * sendEmail, it never throws.
 */
export async function sendEmailBatch(messages: BatchMessage[]): Promise<void> {
  if (!messages.length) return
  if (!resend) {
    emailLogger.warn('Batch email not sent (Resend not configured)', { count: messages.length })
    return
  }
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100)
    try {
      await resend.batch.send(
        chunk.map((m) => ({
          from: FROM_EMAIL,
          to: [m.to],
          subject: m.subject,
          html: brandHtml(m.html),
          text: stripHtml(m.html),
          ...(m.headers ? { headers: m.headers } : {}),
        })),
      )
      emailLogger.info('Batch email sent', { count: chunk.length, subject: chunk[0].subject })
    } catch (error) {
      emailLogger.error('Failed to send batch email', { error, count: chunk.length })
    }
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
      <strong>Wasn't you?</strong> Email
      <a href="mailto:${SUPPORT_EMAIL}" style="color: #991b1b;">${SUPPORT_EMAIL}</a> right away.
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
      ? `<a href="${FRONTEND_URL}/models/${item.modelId}" style="color: #2563eb; font-weight: 600; font-size: 14px; text-decoration: none;">Download &rarr;</a>`
      : `<span style="color: #9ca3af; font-size: 14px;">Available in your account</span>`
    return `
    <tr>
      <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb;">
        <strong style="color: #111827;">${escapeHtml(item.asset.name)}</strong><br>
        <span style="color: #6b7280; font-size: 13px;">Digital STL &middot; download any time</span>
      </td>
      <td style="padding: 14px 16px; text-align: right; border-bottom: 1px solid #e5e7eb; white-space: nowrap;">
        ${money(item.asset.base_price)}<br>
        ${downloadLink}
      </td>
    </tr>`
  }).join('')

  const total = Number(order.pricing?.total ?? 0)
  const subtotal = order.pricing?.subtotal != null ? Number(order.pricing.subtotal) : null
  const tax = Number(order.pricing?.tax ?? 0)
  const taxRate = Number(order.pricing?.taxRate ?? 0)
  const summaryRow = (label: string, value: string) => `
      <tr>
        <td style="padding: 8px 16px; color: #6b7280; font-size: 14px;">${label}</td>
        <td style="padding: 8px 16px; text-align: right; color: #6b7280; font-size: 14px;">${value}</td>
      </tr>`
  // Line prices above are NET of VAT; these rows make the lines add up to the total.
  const breakdownHtml = subtotal != null
    ? summaryRow('Subtotal (excl. VAT)', money(subtotal)) +
      summaryRow(taxRate > 0 ? `VAT (${taxRate}%)` : 'VAT', money(tax))
    : ''
  const consentHtml = order.downloadConsent
    ? `<div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
    <p style="margin: 0; color: #4b5563; font-size: 13px;">
      <strong>Your right to cancel:</strong> when you placed this order you asked for your
      downloads to start immediately and agreed that, once a download begins, you lose the
      14-day right to cancel that digital file. This doesn't affect your rights if a file is
      faulty or not as described &mdash; email ${SUPPORT_EMAIL} and we'll put it right.
    </p>
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

  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 28px; margin: 0;">Order confirmation</h1>
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
      ${breakdownHtml}
      <tr style="background: #f9fafb;">
        <td style="padding: 14px 16px; font-weight: 600; font-size: 18px;">Total paid</td>
        <td style="padding: 14px 16px; text-align: right; font-weight: 600; font-size: 18px;">£${total.toFixed(2)}</td>
      </tr>
    </table>
  </div>

  <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
    <p style="margin: 0; color: #1e40af; font-size: 14px;">
      <strong>How to print:</strong> open your STL in your slicer of choice, scale
      to taste, and print. Multi-part sets download as a single ZIP with every part
      inside. Need help? Email <a href="mailto:${SUPPORT_EMAIL}" style="color: #1e40af;">${SUPPORT_EMAIL}</a>.
    </p>
  </div>

  ${consentHtml}

  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0 0 8px 0;">Questions about your order? Contact us at ${SUPPORT_EMAIL}</p>
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
  // Digital orders have no shipping address; there is nothing to notify about.
  if (!order.shipping_address) {
    emailLogger.warn('Shipping notification skipped: order has no shipping address', { orderId: order.id })
    return
  }

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
    <p style="margin: 0 0 8px 0;">Questions? Contact us at ${SUPPORT_EMAIL}</p>
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
  /** Days earnings are held before payout (earnings.ts PAYOUT_HOLD_DAYS). */
  holdDays?: number
  items: Array<{
    asset: AssetLike
    quantity?: number
  }>
}

/**
 * Notify artist of new sale
 */
export async function sendArtistSaleNotification(
  params: ArtistSaleNotificationParams
): Promise<void> {
  const { artist, order, earnings, items, holdDays = 21 } = params
  
  const itemsList = items.map(item => `
    <li style="margin-bottom: 8px;">
      <strong>${escapeHtml(item.asset.name)}</strong>
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
      Earnings are held for ${holdDays} days to cover the buyer&rsquo;s cancellation window, then paid out automatically to your connected Stripe account.
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
// CONTACT FORM
// ============================================================================

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
    replyTo: email,
    brand: false
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
    brand: false,
  })
}

// ============================================================================
// WELCOME EMAIL
// ============================================================================

/**
 * Send welcome email to new artist
 */
export async function sendArtistWelcome(
  artist: ArtistLike,
  /** The artist's share of each sale, from users.commission_rate. */
  sharePercent = 85,
  holdDays = 21,
): Promise<void> {
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
    <p style="color: #6b7280; margin-top: 8px; font-size: 18px;">We're excited to have you${artist.name ? `, ${escapeHtml(artist.name)}` : ''}!</p>
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
      <li style="margin-bottom: 12px;"><strong>Start Earning:</strong> You keep ${sharePercent}% of every sale (before VAT), paid out after a ${holdDays}-day hold</li>
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
    <p style="margin: 0 0 8px 0;">Need help? We're here for you at ${SUPPORT_EMAIL}</p>
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
// GENERIC NOTICE EMAIL
// ============================================================================

export interface NoticeEmailParams {
  to: string
  subject: string
  heading: string
  /** Plain-text paragraphs; escaped here. */
  paragraphs: string[]
  /** Optional button; `path` is relative to the frontend (e.g. '/artist/models'). */
  cta?: { label: string; path: string }
  /** Red "if this wasn't you" style box, plain text. */
  warning?: string
}

/**
 * One shared layout for the short transactional notices (payment processing,
 * payout sent, upload failed, 2FA changed) so each doesn't carry its own copy of
 * the boilerplate. All caller-supplied text is escaped.
 */
export async function sendNoticeEmail(params: NoticeEmailParams): Promise<void> {
  const { to, subject, heading, paragraphs, cta, warning } = params

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 26px; margin: 0;">${escapeHtml(heading)}</h1>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    ${paragraphs.map((p, i) => `<p style="margin: ${i === paragraphs.length - 1 ? '0' : '0 0 12px 0'}; color: #4b5563;">${escapeHtml(p)}</p>`).join('\n    ')}
  </div>

  ${cta ? `<div style="text-align: center; margin-bottom: 24px;">
    <a href="${FRONTEND_URL}${cta.path}" style="display: inline-block; padding: 14px 28px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">${escapeHtml(cta.label)}</a>
  </div>` : ''}

  ${warning ? `<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
    <p style="margin: 0; color: #991b1b; font-size: 14px;">${escapeHtml(warning)} Email <a href="mailto:${SUPPORT_EMAIL}" style="color: #991b1b;">${SUPPORT_EMAIL}</a> right away.</p>
  </div>` : ''}

  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0 0 8px 0;">Questions? Email ${SUPPORT_EMAIL}</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>

</body>
</html>
  `

  await sendEmail({ to, subject, html })
}

// ============================================================================
// REFUND EMAIL
// ============================================================================

export interface RefundNotificationParams {
  to: string
  orderNumber: string
  itemName: string
  /** Gross amount refunded (net + VAT share). */
  amount: number
  /** Why — shown to the buyer, e.g. "following a moderation review". */
  reason?: string
}

/**
 * Tell a buyer a refund has been issued for one item. Until this existed a
 * refund only produced an in-app bell notification, so a buyer who wasn't
 * signed in saw nothing and had only their bank statement to go on.
 */
export async function sendRefundNotification(params: RefundNotificationParams): Promise<void> {
  const { to, orderNumber, itemName, amount, reason } = params

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 26px; margin: 0;">Your refund has been issued</h1>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <p style="margin: 0 0 12px 0; color: #4b5563;">
      We've refunded <strong>${money(amount)}</strong> for <strong>${escapeHtml(itemName)}</strong>
      from order ${escapeHtml(orderNumber)}${reason ? ` ${escapeHtml(reason)}` : ''}.
    </p>
    <p style="margin: 0; color: #4b5563;">
      The money goes back to the payment method you used and usually appears within 5&ndash;10
      working days, depending on your bank. Access to that file has been removed from your account.
    </p>
  </div>

  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0 0 8px 0;">Questions? Email ${SUPPORT_EMAIL}</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>

</body>
</html>
  `

  await sendEmail({
    to,
    subject: `Refund issued - order ${orderNumber}`,
    html,
  })
}

// ============================================================================
// ARTIST APPLICATION EMAILS (migration 068)
// ============================================================================

/** Courtesy "we've got your application" to the applicant. */
export async function sendApplicationReceived(params: { to: string; name: string }): Promise<void> {
  await sendNoticeEmail({
    to: params.to,
    subject: 'We received your artist application',
    heading: 'Application received',
    paragraphs: [
      `Hi ${params.name}, thanks for applying to sell on Artifact Armoury.`,
      'Our team will review your portfolio and email you with a decision. We will explain our reasoning either way.',
    ],
  })
}

/** Heads-up to support that a new application is waiting in the admin panel. */
export async function sendApplicationToSupport(params: {
  applicantName: string
  applicantEmail: string
  artistName: string
  imageCount: number
}): Promise<void> {
  await sendEmail({
    to: SUPPORT_EMAIL,
    subject: `New artist application: ${params.artistName}`,
    html: `
<p>${escapeHtml(params.applicantName)} &lt;${escapeHtml(params.applicantEmail)}&gt; has applied to sell as
<strong>${escapeHtml(params.artistName)}</strong> (${params.imageCount} portfolio image${params.imageCount === 1 ? '' : 's'}).</p>
<p><a href="${FRONTEND_URL}/admin/artist-applications">Review it in the admin panel</a></p>`,
    brand: false,
  })
}

/** Approval: carries the single-use invite code and the reviewer's message. */
export async function sendApplicationApproved(params: {
  to: string
  name: string
  code: string
  expiresInDays: number
  message?: string
}): Promise<void> {
  const { to, name, code, expiresInDays, message } = params

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111827; font-size: 26px; margin: 0;">You're in, welcome to Artifact Armoury</h1>
  </div>

  <div style="background: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <p style="margin: 0 0 12px 0; color: #4b5563;">Hi ${escapeHtml(name)}, we've reviewed your portfolio and we'd love to have you selling with us.</p>
    ${message ? `<p style="margin: 0 0 12px 0; color: #4b5563; white-space: pre-wrap;">${escapeHtml(message)}</p>` : ''}
    <p style="margin: 0; color: #4b5563;">Your invite code is below. Enter it on the artist page while signed in to the account you applied with.</p>
  </div>

  <div style="text-align: center; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
    <p style="margin: 0 0 6px 0; color: #1e40af; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Your invite code</p>
    <p style="margin: 0; font-family: monospace; font-size: 28px; font-weight: 700; color: #1e3a8a; letter-spacing: 0.1em;">${escapeHtml(code)}</p>
    <p style="margin: 8px 0 0 0; color: #1e40af; font-size: 13px;">Single use. Valid for ${expiresInDays} days.</p>
  </div>

  <div style="text-align: center; margin-bottom: 24px;">
    <a href="${FRONTEND_URL}/apply-artist" style="display: inline-block; padding: 14px 28px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Redeem your code</a>
  </div>

  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p style="margin: 0 0 8px 0;">Questions? Email ${SUPPORT_EMAIL}</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Artifact Armoury. All rights reserved.</p>
  </div>

</body>
</html>
  `

  await sendEmail({ to, subject: 'Your Artifact Armoury artist application was approved', html })
}

/** Rejection: always carries the reviewer's reason. */
export async function sendApplicationRejected(params: {
  to: string
  name: string
  reason: string
}): Promise<void> {
  await sendNoticeEmail({
    to: params.to,
    subject: 'Your Artifact Armoury artist application',
    heading: 'About your application',
    paragraphs: [
      `Hi ${params.name}, thank you for applying to sell on Artifact Armoury and for the time you put into your application.`,
      'After reviewing your portfolio we are not able to offer you a place right now.',
      `Our reasoning: ${params.reason}`,
      `You are welcome to apply again in the future. If you would like to talk it through, reply to ${SUPPORT_EMAIL}.`,
    ],
  })
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  sendNoticeEmail,
  sendRefundNotification,
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
