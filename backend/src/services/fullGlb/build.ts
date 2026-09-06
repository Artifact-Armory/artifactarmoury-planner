// backend/src/services/fullGlb/build.ts
//
// Builds ONE owner GLB: pull the canonical STL from R2, convert it with no
// watermark and — for all but the densest outlier meshes — no decimation either,
// and upload the result under a key only the database knows.
//
// Why the key is random
// ---------------------
// The R2 bucket is served publicly through assets.artifactplanner.com, and model
// ids appear in every marketplace URL. A predictable key like
// `previews/<modelId>/full.glb` would therefore be a public, un-watermarked,
// full-resolution copy of a paid mesh — the exact thing the proxy-bake pipeline
// exists to prevent. So the key carries 128 bits of randomness, is stored only in
// models.full_glb_path / model_parts.full_glb_path, and is never returned by any
// API. The bytes are reachable only through the entitlement-checked route in
// routes/models.ts. (Locking the bucket down is still the proper fix — see the
// "Asset key exposure" note — this just means the feature isn't waiting on it.)

import { promises as fsp } from 'fs'
import crypto from 'crypto'
import os from 'os'
import path from 'path'
import logger from '../../utils/logger'
import { downloadObject, uploadObject } from '../r2'
import { convertSTLtoGLBFull } from '../fileProcessor'

/**
 * Meshes above this are not built at all (job → 'skipped', owner keeps the proxy).
 *
 * This is a MEMORY ceiling ONLY, not a framerate one — convertSTLtoGLBFull
 * (fileProcessor.ts) parses the FULL source mesh into memory before any
 * decimation runs, so the cost below is paid against the SOURCE triangle count
 * regardless of what OWNER_GLB_TARGET_TRIS ends up trimming it down to. Raising
 * this number does NOT change what lands in the planner (still capped at
 * OWNER_GLB_TARGET_TRIS, 240k by default) — it only decides how dense a source
 * the worker is willing to ATTEMPT to parse at all before giving up and leaving
 * the owner on the proxy. Measured peak RSS of the conversion, on the real
 * pipeline:
 *
 *     307k tris →  419 MB      614k tris →  704 MB      1.23M tris → 1318 MB
 *
 * i.e. roughly **1.1 KB of resident memory per source triangle**, near enough
 * linear, and the build is only ~8.6s even at 1.23M — so time is not the binding
 * constraint, memory is. Set this from the memory limit of whatever is building:
 * the bake worker normally, but the API server itself when the inline drainer is
 * on (see inline.ts), where a spike is far more disruptive.
 *
 * Raised 1M -> 3.5M (2026-09-04, at the artist's request): a 10-model grouped
 * upload ("South East Pacific houses") had several parts between 1M and 3.4M
 * source triangles, all permanently 'skipped' under the old 1M gate even though
 * each is comfortably decimated down to 240k once admitted. 3.5M ≈ 3.9 GB peak
 * on this pipeline's measured per-triangle cost — matches
 * MAX_PREVIEW_PART_TRIANGLES (routes/models.ts), the ceiling already used
 * elsewhere for "is this too dense to safely parse for a preview". Confirmed
 * this build runs on the dedicated worker service (PROXY_BAKE_ENABLED=true),
 * never inline in the API server, so a spike here can't take down checkout/
 * storefront. Not proven against a real 3.4M-triangle build yet — watch worker
 * memory (`railway logs`) on the next upload that exercises this range.
 */
export const FULL_GLB_MAX_TRIS = Number(process.env.FULL_GLB_MAX_TRIS ?? 3_500_000)

/** Refuse a source file this large outright, before parsing it. */
const MAX_SOURCE_BYTES = Number(process.env.FULL_GLB_MAX_SOURCE_BYTES ?? 400 * 1024 * 1024)

/**
 * Triangle count from an STL *without* parsing it — a binary STL states it in the
 * 4 bytes at offset 80. Returns null when the file isn't binary STL (ASCII STLs
 * have no header count; those fall back to the byte-size guard).
 *
 * This has to be cheap and it has to happen BEFORE conversion: the whole point of
 * the cap is to avoid allocating gigabytes, so checking the count afterwards —
 * which is what the first cut of this did — guards nothing. The process would be
 * OOM-killed during the conversion it was supposed to prevent.
 */
function binaryStlTriangleCount(buf: Buffer): number | null {
  if (buf.length < 84) return null
  const n = buf.readUInt32LE(80)
  // The header count is only trustworthy if it agrees with the file length.
  return 84 + n * 50 === buf.length ? n : null
}

export interface FullGlbBuildInput {
  jobId: string
  modelId: string
  /** NULL for the model's primary mesh; otherwise the model_parts id. */
  partId: string | null
  /** R2 key of the canonical STL. */
  sourceKey: string
}

export interface FullGlbBuildResult {
  /** R2 key of the built GLB, or null when the build was deliberately skipped. */
  glbKey: string | null
  /** Why it was skipped, when glbKey is null. */
  skippedReason: string | null
  triangles: number
  bytes: number
  durationMs: number
}

/** Unguessable, per-build key. A rebuild gets a NEW key (see cleanup in queue.ts). */
function ownerGlbKey(modelId: string, partId: string | null): string {
  const secret = crypto.randomBytes(16).toString('hex')
  const leaf = partId ? `part-${partId}` : 'primary'
  return `owner-glb/${modelId}/${leaf}-${secret}.glb`
}

export async function runFullGlbBuild(input: FullGlbBuildInput): Promise<FullGlbBuildResult> {
  const started = Date.now()
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'aa-fullglb-'))
  const log = logger.child('FULL_GLB')
  try {
    const srcBuf = await downloadObject(input.sourceKey)

    // Both guards run BEFORE any parsing or allocation — an over-cap mesh must
    // cost nothing, because an OOM here is worse than a skip: the container dies
    // mid-job, the row sits 'running' until the stale lock expires, and the retry
    // OOMs identically. On the bake worker that would also take out the preview
    // bakes this queue is supposed to stay out of the way of.
    const skip = (reason: string, triangles: number): FullGlbBuildResult => {
      log.info('Full GLB skipped', { jobId: input.jobId, modelId: input.modelId, reason })
      return { glbKey: null, skippedReason: reason, triangles, bytes: 0, durationMs: Date.now() - started }
    }
    if (srcBuf.length > MAX_SOURCE_BYTES) {
      return skip(`source file is ${(srcBuf.length / 1024 / 1024).toFixed(0)} MB (limit ${(MAX_SOURCE_BYTES / 1024 / 1024).toFixed(0)} MB)`, 0)
    }
    const declaredTris = binaryStlTriangleCount(srcBuf)
    if (declaredTris !== null && declaredTris > FULL_GLB_MAX_TRIS) {
      return skip(`mesh has ${declaredTris} triangles (limit ${FULL_GLB_MAX_TRIS})`, declaredTris)
    }

    const stlPath = path.join(work, 'source.stl')
    await fsp.writeFile(stlPath, srcBuf)

    const outPath = path.join(work, 'full.glb')
    const { triangles, sourceTriangles, bytes } = await convertSTLtoGLBFull(stlPath, outPath)

    // Backstop for ASCII STLs, whose triangle count isn't knowable without
    // parsing. Rare, and the byte-size guard above already bounds the damage.
    // Checked against the SOURCE count — the memory cost was paid parsing and
    // building the full-resolution document, before any decimation trims it.
    if (sourceTriangles > FULL_GLB_MAX_TRIS) {
      return skip(`mesh has ${sourceTriangles} triangles (limit ${FULL_GLB_MAX_TRIS})`, sourceTriangles)
    }

    const glbKey = ownerGlbKey(input.modelId, input.partId)
    // NOT immutable-cached: the key is unguessable and single-use, but the object
    // is owner-only and always streamed through the API, so a long public CDN TTL
    // buys nothing and only widens the window if a key ever does leak.
    await uploadObject(glbKey, await fsp.readFile(outPath), 'model/gltf-binary', { immutable: false })

    const durationMs = Date.now() - started
    log.info('Full GLB built', {
      jobId: input.jobId, modelId: input.modelId, partId: input.partId,
      triangles, bytes, durationMs,
    })
    return { glbKey, skippedReason: null, triangles, bytes, durationMs }
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {})
  }
}
