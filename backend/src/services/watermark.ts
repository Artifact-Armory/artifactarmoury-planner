// backend/src/services/watermark.ts
//
// Encrypted-in-header STL watermark. A binary STL begins with an 80-byte header
// that slicers and printers completely ignore. We overwrite it with an
// AES-256-GCM payload encoding (modelId, buyerId, orderId), so a leaked file can
// be traced to the exact buyer by decrypting the header alone — no database
// lookup required — while the printed geometry stays bit-for-bit identical (we
// never touch the triangle data that starts at byte 84). 0 bytes are added.
//
// 80-byte header layout:  IV(12) || ciphertext(48) || auth tag(16) || pad(4).
// The GCM auth tag also serves as the "is this one of ours?" check on extraction.

import crypto from 'crypto'

const HEADER_SIZE = 80
const IV_LEN = 12
const PAYLOAD_LEN = 48 // three 16-byte UUIDs (model, buyer, order)
const TAG_LEN = 16
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

export interface WatermarkPayload {
  modelId: string
  buyerId: string
  /** Purchase order id; ZERO_UUID for an artist downloading their own model. */
  orderId: string
}

function watermarkKey(): Buffer {
  const secret = process.env.WATERMARK_SECRET || process.env.JWT_SECRET
  if (!secret) throw new Error('WATERMARK_SECRET or JWT_SECRET must be set to watermark downloads')
  return crypto.createHash('sha256').update(`stl-watermark:${secret}`).digest() // 32 bytes
}

function uuidToBytes(uuid: string): Buffer {
  const hex = (uuid || '').replace(/-/g, '')
  if (hex.length !== 32) throw new Error(`invalid uuid: ${uuid}`)
  return Buffer.from(hex, 'hex')
}
function bytesToUuid(buf: Buffer): string {
  const h = buf.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/** Build a watermarked 80-byte binary-STL header encoding the payload. */
export function buildWatermarkHeader(p: WatermarkPayload): Buffer {
  const plain = Buffer.concat([uuidToBytes(p.modelId), uuidToBytes(p.buyerId), uuidToBytes(p.orderId || ZERO_UUID)])
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv('aes-256-gcm', watermarkKey(), iv)
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]) // 48 bytes (GCM: ct len == plaintext len)
  const tag = cipher.getAuthTag() // 16 bytes
  const header = Buffer.alloc(HEADER_SIZE) // zero-padded to 80
  iv.copy(header, 0)
  ct.copy(header, IV_LEN)
  tag.copy(header, IV_LEN + PAYLOAD_LEN)
  return header
}

/** Decrypt a watermarked 80-byte header, or null if it isn't one of ours. */
export function readWatermarkHeader(header: Buffer): WatermarkPayload | null {
  if (!header || header.length < IV_LEN + PAYLOAD_LEN + TAG_LEN) return null
  try {
    const iv = header.subarray(0, IV_LEN)
    const ct = header.subarray(IV_LEN, IV_LEN + PAYLOAD_LEN)
    const tag = header.subarray(IV_LEN + PAYLOAD_LEN, IV_LEN + PAYLOAD_LEN + TAG_LEN)
    const decipher = crypto.createDecipheriv('aes-256-gcm', watermarkKey(), iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ct), decipher.final()])
    return {
      modelId: bytesToUuid(plain.subarray(0, 16)),
      buyerId: bytesToUuid(plain.subarray(16, 32)),
      orderId: bytesToUuid(plain.subarray(32, 48)),
    }
  } catch {
    return null // auth-tag failure → not watermarked by us (or tampered)
  }
}

/** Is this a binary STL? (size must equal 84 + 50*triangleCount). */
export function isBinarySTL(size: number, head: Buffer): boolean {
  if (size < 84 || head.length < 84) return false
  const triCount = head.readUInt32LE(80)
  return size === 84 + triCount * 50
}

/**
 * Watermark an ASCII STL by encoding the payload into the `solid <name>` token
 * (also ignored by slicers). Buffered — ASCII STLs are rare and much smaller in
 * practice than their binary equivalents.
 */
export function watermarkAsciiSTL(buffer: Buffer, p: WatermarkPayload): Buffer {
  const header = buildWatermarkHeader(p).toString('base64').replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' } as any)[c])
  const text = buffer.toString('utf8')
  const nl = text.indexOf('\n')
  const rest = nl >= 0 ? text.slice(nl) : '\n'
  return Buffer.from(`solid AAWM_${header}${rest}`, 'utf8')
}

export const WATERMARK_ZERO_ORDER = ZERO_UUID
