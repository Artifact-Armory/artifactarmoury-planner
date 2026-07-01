// backend/src/services/r2.ts
//
// Cloudflare R2 object storage (S3-compatible) for heavy/static assets — GLB
// catalogue, thumbnails, table textures, and any future map blobs. Serving these
// from R2 behind Cloudflare's CDN keeps Railway egress near zero (R2 has no egress
// fees) and survives Railway's ephemeral filesystem.
//
// All credentials come from environment variables — never hard-coded:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
//
// Public reads go over R2_PUBLIC_BASE_URL (a Cloudflare custom domain mapped to the
// bucket). Writes use the S3 endpoint. Objects are immutable + content-hashed, so a
// 1-year immutable Cache-Control is safe.

import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import logger from '../utils/logger'

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
const BUCKET = process.env.R2_BUCKET
const PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '')

const ENABLED = Boolean(
  ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET && PUBLIC_BASE_URL,
)

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

let _client: S3Client | null = null
function client(): S3Client {
  if (!ENABLED) throw new Error('R2 is not configured (missing R2_* env vars)')
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY_ID!, secretAccessKey: SECRET_ACCESS_KEY! },
    })
  }
  return _client
}

/** True when every R2_* var is present. Callers fall back to local serving otherwise. */
export function isR2Enabled(): boolean {
  return ENABLED
}

/** Normalise a storage key (no leading slash). */
export function normalizeKey(key: string): string {
  return key.replace(/^\/+/, '')
}

/** Public CDN URL for an object key. */
export function publicUrl(key: string): string {
  return `${PUBLIC_BASE_URL}/${normalizeKey(key)}`
}

/** Upload bytes to R2 with an immutable cache header (content-hashed keys are safe). */
export async function uploadObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
  opts: { immutable?: boolean } = {},
): Promise<string> {
  const k = normalizeKey(key)
  await client().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: k,
    Body: body,
    ContentType: contentType,
    CacheControl: opts.immutable === false ? undefined : IMMUTABLE_CACHE,
  }))
  logger.debug('R2 upload complete', { key: k, contentType })
  return publicUrl(k)
}

/** Does an object already exist? (used by the migration script to skip re-uploads) */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: normalizeKey(key) }))
    return true
  } catch {
    return false
  }
}

/**
 * Presigned PUT URL so the browser uploads bytes directly to R2 (never through
 * Railway). Returns the upload URL, the final public URL, and the object key.
 */
export async function presignUpload(
  key: string,
  contentType: string,
  expiresInSeconds = 300,
): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  const k = normalizeKey(key)
  const uploadUrl = await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: BUCKET, Key: k, ContentType: contentType, CacheControl: IMMUTABLE_CACHE }),
    { expiresIn: expiresInSeconds },
  )
  return { uploadUrl, publicUrl: publicUrl(k), key: k }
}

/** Presigned GET URL (only needed for private objects; public assets use publicUrl). */
export async function presignDownload(key: string, expiresInSeconds = 300): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: BUCKET, Key: normalizeKey(key) }),
    { expiresIn: expiresInSeconds },
  )
}
