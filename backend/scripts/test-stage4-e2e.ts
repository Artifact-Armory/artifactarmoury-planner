// backend/scripts/test-stage4-e2e.ts
//
// Stage 4 end-to-end proof of the anti-theft pipeline, exercising the SAME
// service functions production uses — no browser, no DB, no network. It proves:
//
//   1. WATERMARK TRACE  — a downloaded STL's 80-byte header decrypts to the exact
//      (model, buyer, order) it was issued to.
//   2. RE-UPLOAD REJECT — the watermarked file a buyer receives, if re-uploaded,
//      still matches the original's geometry fingerprint (geometry bytes 84+ are
//      untouched by the watermark), so findGeometryDuplicate would block it.
//   3. STRIPPED-HEADER FALLBACK — a thief who zeroes the header defeats the trace
//      (header no longer decodes) but the geometry fingerprint STILL matches, so
//      the re-upload is rejected anyway. This is the whole point: the fingerprint,
//      not the watermark, is the real gate.
//   4. NEGATIVE — a genuinely different model does NOT match (no false positive).
//
//   node -r ts-node/register/transpile-only scripts/test-stage4-e2e.ts
//
// Uses the local WATERMARK_SECRET/JWT_SECRET (both stamp and trace), so it is
// self-consistent. Tracing a file that PRODUCTION watermarked needs prod's key:
//   railway run npm run trace:watermark -- "C:\path\to\downloaded.stl"

import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import 'dotenv/config'
import { buildWatermarkHeader, readWatermarkHeader, isBinarySTL } from '../src/services/watermark'
import { computeGeometryFingerprint, fingerprintDistance, isLikelyDuplicate, MATCH_THRESHOLD } from '../src/services/fingerprint'

const DIR = path.resolve(__dirname, '../../frontend/public/assets/pre converted/kieran_s/terrain-kieran_s')
const ORIGINAL = 'floor.stl'   // the "uploaded" model
const OTHER = 'barrell.stl'    // an unrelated model (negative control)

// A fake order: the values the download route would embed for a real purchase.
const MODEL_ID = '11111111-1111-4111-8111-111111111111'
const BUYER_ID = '22222222-2222-4222-8222-222222222222'
const ORDER_ID = '33333333-3333-4333-8333-333333333333'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

/**
 * Reproduce exactly what streamWatermarkedSTL() does to a binary STL: overwrite
 * the ignored 80-byte header with the encrypted payload, leave bytes 80+ intact.
 */
function watermarkBinarySTL(buf: Buffer): Buffer {
  const out = Buffer.from(buf) // copy
  buildWatermarkHeader({ modelId: MODEL_ID, buyerId: BUYER_ID, orderId: ORDER_ID }).copy(out, 0)
  return out
}

async function main() {
  const origPath = path.join(DIR, ORIGINAL)
  const otherPath = path.join(DIR, OTHER)
  const origBuf = await fs.readFile(origPath)

  console.log(`\nStage 4 anti-theft end-to-end proof`)
  console.log(`  match threshold = ${MATCH_THRESHOLD}, watermark key from ${process.env.WATERMARK_SECRET ? 'WATERMARK_SECRET' : 'JWT_SECRET'}\n`)

  // Sanity: the sample is a real binary STL (the header-swap path).
  check(`${ORIGINAL} is a binary STL`, isBinarySTL(origBuf.length, origBuf.subarray(0, 84)),
    `(${origBuf.length} bytes)`)

  // --- 0. Artist upload: fingerprint stored in models.geometry_fingerprint ---
  const originalFp = await computeGeometryFingerprint(origPath)
  console.log(`\n[0] Original model fingerprinted (tris=${originalFp.tris}, compactness=${originalFp.compactness.toFixed(3)})`)

  // --- 1. Buyer download: watermarked copy, then trace the header ---------
  console.log(`\n[1] WATERMARK TRACE — download stamps the header, trace decodes it`)
  const downloaded = watermarkBinarySTL(origBuf)
  check('watermarked file is the same size (0 bytes added)', downloaded.length === origBuf.length)
  check('geometry bytes 84+ are byte-for-byte identical',
    downloaded.subarray(84).equals(origBuf.subarray(84)))
  const traced = readWatermarkHeader(downloaded.subarray(0, 80))
  check('header decodes to the issued buyer/model/order', !!traced &&
    traced.modelId === MODEL_ID && traced.buyerId === BUYER_ID && traced.orderId === ORDER_ID,
    traced ? `→ buyer ${traced.buyerId.slice(0, 8)}… order ${traced.orderId.slice(0, 8)}…` : '(no payload)')

  // Forged/tampered header must fail the GCM auth tag.
  const forged = Buffer.from(downloaded)
  forged[10] ^= 0xff
  check('a tampered header is rejected (GCM auth tag)', readWatermarkHeader(forged.subarray(0, 80)) === null)

  // --- 2. Re-upload of the downloaded file is caught by the fingerprint ---
  console.log(`\n[2] RE-UPLOAD REJECT — re-uploading the downloaded file trips the fingerprint`)
  const dlPath = path.join(__dirname, '_stage4_downloaded.stl')
  await fs.writeFile(dlPath, downloaded)
  const downloadedFp = await computeGeometryFingerprint(dlPath)
  const dDl = fingerprintDistance(originalFp, downloadedFp)
  check('downloaded file matches original fingerprint (would be rejected)',
    isLikelyDuplicate(originalFp, downloadedFp), `distance ${dDl.toFixed(4)} ≤ ${MATCH_THRESHOLD}`)

  // --- 3. Stripped-header thief: trace fails, fingerprint still catches it -
  console.log(`\n[3] STRIPPED-HEADER FALLBACK — thief zeroes the header`)
  const stripped = Buffer.from(downloaded)
  Buffer.alloc(80).copy(stripped, 0) // wipe the header
  check('trace now fails (header is gone)', readWatermarkHeader(stripped.subarray(0, 80)) === null)
  const strippedPath = path.join(__dirname, '_stage4_stripped.stl')
  await fs.writeFile(strippedPath, stripped)
  const strippedFp = await computeGeometryFingerprint(strippedPath)
  check('but the geometry fingerprint STILL matches (re-upload rejected)',
    isLikelyDuplicate(originalFp, strippedFp),
    `distance ${fingerprintDistance(originalFp, strippedFp).toFixed(4)}`)

  // --- 4. Negative control: a different model must NOT match --------------
  console.log(`\n[4] NEGATIVE CONTROL — an unrelated model must not match`)
  const otherFp = await computeGeometryFingerprint(otherPath)
  check(`${OTHER} does NOT match ${ORIGINAL} (no false positive)`,
    !isLikelyDuplicate(originalFp, otherFp),
    `distance ${fingerprintDistance(originalFp, otherFp).toFixed(4)}`)

  await Promise.all([
    fs.rm(dlPath, { force: true }),
    fs.rm(strippedPath, { force: true }),
  ])

  console.log(`\n${failures === 0 ? '✅ ALL STAGE 4 CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
