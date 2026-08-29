// backend/src/services/fullGlb/build.ts
//
// Builds ONE owner full-fidelity GLB: pull the canonical STL from R2, convert it
// with no decimation and no watermark, and upload the result under a key only the
// database knows.
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
 * Meshes above this are not built at all (job → 'skipped', owner keeps the
 * proxy). A full-resolution GLB is uncompressed on the GPU, so a genuinely
 * enormous mesh would hurt the very people it's meant to reward — and the build
 * itself is minutes of CPU. Raise it if the planner turns out to cope.
 */
export const FULL_GLB_MAX_TRIS = Number(process.env.FULL_GLB_MAX_TRIS ?? 3_000_000)

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
    const stlPath = path.join(work, 'source.stl')
    await fsp.writeFile(stlPath, await downloadObject(input.sourceKey))

    const outPath = path.join(work, 'full.glb')
    const { triangles, bytes } = await convertSTLtoGLBFull(stlPath, outPath)

    if (triangles > FULL_GLB_MAX_TRIS) {
      // Converted before we could count triangles cheaply, but still worth not
      // shipping: throw the artefact away rather than serve something that would
      // stall the planner.
      const reason = `mesh has ${triangles} triangles (limit ${FULL_GLB_MAX_TRIS})`
      log.info('Full GLB skipped', { jobId: input.jobId, modelId: input.modelId, reason })
      return { glbKey: null, skippedReason: reason, triangles, bytes, durationMs: Date.now() - started }
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
