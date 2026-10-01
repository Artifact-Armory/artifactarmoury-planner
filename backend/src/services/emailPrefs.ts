// backend/src/services/emailPrefs.ts
// Stateless unsubscribe links for marketing-style emails (follower updates).
// The token is an HMAC of the user id, so a link can't be forged or used to
// unsubscribe someone else, and needs no table or expiry — an unsubscribe link in
// an old email must keep working.

import crypto from 'crypto'

const SECRET = () => process.env.EMAIL_PREFS_SECRET || process.env.JWT_SECRET || 'dev-email-prefs-secret'
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL || 'https://api.artifactarmoury.com').replace(/\/$/, '')

export function unsubscribeToken(userId: string): string {
  return crypto.createHmac('sha256', SECRET()).update(`unsubscribe:${userId}`).digest('hex').slice(0, 40)
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = unsubscribeToken(userId)
  if (typeof token !== 'string' || token.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}

export function unsubscribeUrl(userId: string): string {
  return `${API_PUBLIC_URL}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(userId)}`
}
