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
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Readable } from 'stream'
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

/** Stream an object from R2 (used to watermark large STLs without buffering). */
export async function getObjectStream(key: string): Promise<{ stream: Readable; size: number }> {
  const res = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: normalizeKey(key) }))
  if (!res.Body) throw new Error(`R2 object has no body: ${key}`)
  return { stream: res.Body as Readable, size: Number(res.ContentLength ?? 0) }
}

/** Download an object's bytes into memory (used by the async upload processor). */
export async function downloadObject(key: string): Promise<Buffer> {
  const res = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: normalizeKey(key) }))
  const body = res.Body as unknown as AsyncIterable<Uint8Array> | undefined
  if (!body) throw new Error(`R2 object has no body: ${key}`)
  const chunks: Uint8Array[] = []
  for await (const chunk of body) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** Delete an object (e.g. clearing a rejected/quarantined raw upload). */
export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: normalizeKey(key) }))
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
  // Only sign Content-Type (not Cache-Control): every signed header must be
  // reproduced exactly by the browser's PUT or R2 rejects it with 403. Derived
  // public assets get their immutable cache header via uploadObject instead.
  const uploadUrl = await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: BUCKET, Key: k, ContentType: contentType }),
    { expiresIn: expiresInSeconds },
  )
  return { uploadUrl, publicUrl: publicUrl(k), key: k }
}

// ---------------------------------------------------------------------------
// Multipart upload (for large models). The browser uploads the file in chunks:
// each part is PUT to its own presigned URL and can be retried independently, so
// a single network blip no longer fails a whole 300MB+ upload. R2 speaks the S3
// multipart API. Parts must be >= 5MB (except the last); max 10,000 parts.
// ---------------------------------------------------------------------------

/** Begin a multipart upload; returns the uploadId that ties the parts together. */
export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const res = await client().send(new CreateMultipartUploadCommand({
    Bucket: BUCKET,
    Key: normalizeKey(key),
    ContentType: contentType,
  }))
  if (!res.UploadId) throw new Error('R2 did not return an UploadId')
  return res.UploadId
}

/**
 * Presigned PUT URL for one part. The browser PUTs the chunk here and must read
 * the returned `ETag` response header (requires R2 CORS to expose ETag) to pass
 * back to completeMultipartUpload.
 */
export async function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  expiresInSeconds = 3600,
): Promise<string> {
  return getSignedUrl(
    client(),
    new UploadPartCommand({
      Bucket: BUCKET,
      Key: normalizeKey(key),
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn: expiresInSeconds },
  )
}

/** Finish a multipart upload by stitching the uploaded parts (in order). */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>,
): Promise<string> {
  const k = normalizeKey(key)
  await client().send(new CompleteMultipartUploadCommand({
    Bucket: BUCKET,
    Key: k,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts
        .slice()
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
    },
  }))
  return publicUrl(k)
}

/** Discard an incomplete multipart upload (frees the staged parts). */
export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  await client().send(new AbortMultipartUploadCommand({
    Bucket: BUCKET,
    Key: normalizeKey(key),
    UploadId: uploadId,
  }))
}

/** Presigned GET URL (only needed for private objects; public assets use publicUrl). */
export async function presignDownload(key: string, expiresInSeconds = 300): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: BUCKET, Key: normalizeKey(key) }),
    { expiresIn: expiresInSeconds },
  )
}
