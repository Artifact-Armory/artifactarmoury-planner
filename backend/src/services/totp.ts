// backend/src/services/totp.ts
// Time-based one-time passwords (RFC 6238) for optional two-factor auth on
// accounts — aimed at sellers, whose accounts hold earnings and are phishing
// targets. Implemented on Node's built-in crypto (HMAC-SHA1) so it needs no
// third-party runtime dependency. Compatible with Google Authenticator, Authy,
// 1Password, etc.
//
// The shared secret is stored ENCRYPTED at rest (AES-256-GCM) so a database leak
// alone does not hand an attacker working 2FA seeds.

import crypto from 'crypto'

const STEP_SECONDS = 30
const DIGITS = 6
// How many 30s windows either side of "now" we still accept, to tolerate clock
// drift between the server and the user's phone.
const VERIFY_WINDOW = 1

// ============================================================================
// BASE32 (RFC 4648, no padding) — the encoding authenticator apps expect
// ============================================================================

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return out
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

// ============================================================================
// HOTP / TOTP
// ============================================================================

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8)
  // 64-bit counter, big-endian. JS bitwise is 32-bit so split hi/lo.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter >>> 0, 4)

  const hmac = crypto.createHmac('sha1', secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, '0')
}

/** Generate a fresh base32 secret for a new enrolment (160-bit). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20))
}

/**
 * The otpauth:// URI an authenticator app scans (or that a QR encodes).
 * `account` is usually the user's email; `issuer` names the site.
 */
export function buildOtpauthUrl(secret: string, account: string, issuer = 'Artifact Armoury'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/**
 * Verify a user-supplied 6-digit code against the secret, allowing ±VERIFY_WINDOW
 * steps of clock drift. Uses constant-time comparison per candidate.
 */
export function verifyTotp(secret: string, token: string): boolean {
  const cleaned = (token || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(cleaned)) return false
  const key = base32Decode(secret)
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS)
  for (let w = -VERIFY_WINDOW; w <= VERIFY_WINDOW; w++) {
    const candidate = hotp(key, counter + w)
    // timingSafeEqual needs equal-length buffers; both are 6 ASCII digits.
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(cleaned))) {
      return true
    }
  }
  return false
}

// ============================================================================
// SECRET ENCRYPTION AT REST (AES-256-GCM)
// ============================================================================

function totpKey(): Buffer {
  const secret = process.env.TOTP_SECRET || process.env.JWT_SECRET
  if (!secret) throw new Error('TOTP_SECRET or JWT_SECRET must be set to use two-factor auth')
  return crypto.createHash('sha256').update(`totp-secret:${secret}`).digest() // 32 bytes
}

const IV_LEN = 12

/** Encrypt a base32 secret for storage → `iv:tag:ciphertext` (all base64). */
export function encryptSecret(plainBase32: string): string {
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv('aes-256-gcm', totpKey(), iv)
  const enc = Buffer.concat([cipher.update(plainBase32, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

/** Reverse of encryptSecret. Throws if the payload was tampered with. */
export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(':')
  const decipher = crypto.createDecipheriv('aes-256-gcm', totpKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
  return dec.toString('utf8')
}

// ============================================================================
// BACKUP CODES (single-use recovery codes shown once at enrolment)
// ============================================================================

/** Hash a backup code for storage (codes are compared by hash, never stored raw). */
export function hashBackupCode(code: string): string {
  return crypto.createHash('sha256').update(`backup:${code.replace(/\s+/g, '').toUpperCase()}`).digest('hex')
}

/**
 * Generate N human-friendly backup codes. Returns the plaintext codes (show to
 * the user ONCE) and their hashes (store these).
 */
export function generateBackupCodes(n = 10): { plain: string[]; hashed: string[] } {
  const plain: string[] = []
  for (let i = 0; i < n; i++) {
    // 10 hex chars, grouped as XXXXX-XXXXX for readability.
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase()
    plain.push(`${raw.slice(0, 5)}-${raw.slice(5)}`)
  }
  return { plain, hashed: plain.map(hashBackupCode) }
}
