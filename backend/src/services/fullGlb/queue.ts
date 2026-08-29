// backend/src/services/fullGlb/queue.ts
//
// DB-backed queue for the owner full-fidelity GLB build (migration 041).
//
// Deliberately a SEPARATE table from proxy_bake_jobs, and deliberately toothless:
//
//   - It NEVER touches models.processing_status. A model goes 'ready' — and the
//     artist leaves the upload form — on exactly the schedule it does today. That
//     is the whole point: the owner GLB is a bonus artefact, not a gate.
//   - A permanent failure notifies nobody and marks nothing failed on the model.
//     The consequence of no owner GLB is "the buyer sees the preview proxy", which
//     is the pre-041 behaviour, so there is nothing to escalate to the artist.
//   - The bake worker drains it only when no preview bake is waiting, so a backlog
//     here can't delay anyone's preview.
//
// Claim discipline (FOR UPDATE SKIP LOCKED + heartbeat + stale-lock reclaim)
// mirrors proxyBake/queue.ts so the two behave the same under a worker restart.

import { db } from '../../db'
import logger from '../../utils/logger'
import { deleteObject } from '../r2'
import type { FullGlbBuildResult } from './build'

const log = logger.child('FULL_GLB')

/** A running job whose lock is older than this is assumed crashed and reclaimable. */
const STALE_LOCK_MS = Number(process.env.FULL_GLB_STALE_LOCK_MS ?? 5 * 60_000)

/** How often a worker refreshes its lock while a build runs. */
export const HEARTBEAT_INTERVAL_MS = Number(process.env.FULL_GLB_HEARTBEAT_MS ?? 30_000)

/** Owner GLBs can be switched off entirely (buyers then keep seeing the proxy). */
export function isFullGlbEnabled(): boolean {
  return process.env.FULL_GLB_ENABLED !== 'false'
}

export interface FullGlbJobRow {
  id: string
  model_id: string
  part_id: string | null
  source_key: string
  status: string
  attempts: number
  max_attempts: number
}

type MeshStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'skipped'

/** Write the per-mesh status column. `models` for the primary mesh, else `model_parts`. */
async function markStatus(
  modelId: string,
  partId: string | null,
  status: MeshStatus,
  error: string | null,
): Promise<void> {
  const table = partId ? 'model_parts' : 'models'
  await db.query(
    `UPDATE ${table} SET full_glb_status = $2, full_glb_error = $3 WHERE id = $1`,
    [partId ?? modelId, status, error],
  )
}

/**
 * Queue a full-GLB build for one mesh. Fire-and-forget: every caller is an upload
 * path, so this must never throw into one — a failed enqueue costs the owner GLB
 * and nothing else.
 *
 * The unique partial index on (model_id, part_id) WHERE status IN
 * ('queued','running') collapses repeat enqueues for the same mesh, so a file
 * version bumped twice in a row doesn't stack two builds.
 */
export async function enqueueFullGlbJob(input: {
  modelId: string
  partId?: string | null
  sourceKey: string | null | undefined
}): Promise<string | null> {
  if (!isFullGlbEnabled()) return null
  if (!input.sourceKey) return null
  try {
    // Mark intent immediately so the serving route can distinguish "building" from
    // "this model predates the feature" while the job waits for a worker.
    await markStatus(input.modelId, input.partId ?? null, 'queued', null)
    const { rows } = await db.query(
      `INSERT INTO full_glb_jobs (model_id, part_id, source_key, status)
       VALUES ($1, $2, $3, 'queued')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [input.modelId, input.partId ?? null, input.sourceKey],
    )
    const id = rows[0]?.id ?? null
    log.info('Full GLB job enqueued', {
      jobId: id, modelId: input.modelId, partId: input.partId ?? null,
    })
    return id
  } catch (err) {
    log.error('Full GLB enqueue failed (upload unaffected)', { error: err, modelId: input.modelId })
    return null
  }
}

/** Atomically claim the oldest open job. Returns null when there's nothing to do. */
export async function claimNextFullGlbJob(workerId: string): Promise<FullGlbJobRow | null> {
  const client = await db.connect()
  let job: FullGlbJobRow
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id, model_id, part_id, source_key, status, attempts, max_attempts
         FROM full_glb_jobs
        WHERE status = 'queued'
           OR (status = 'running' AND locked_at < NOW() - ($1::int * INTERVAL '1 millisecond'))
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [STALE_LOCK_MS],
    )
    if (rows.length === 0) {
      await client.query('COMMIT')
      return null
    }
    job = rows[0] as FullGlbJobRow
    await client.query(
      `UPDATE full_glb_jobs
          SET status = 'running', attempts = attempts + 1,
              locked_at = NOW(), locked_by = $2, updated_at = NOW()
        WHERE id = $1`,
      [job.id, workerId],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  // Outside the claim transaction: a status blip is cosmetic, a held lock is not.
  await markStatus(job.model_id, job.part_id, 'processing', null)
  return { ...job, status: 'running', attempts: job.attempts + 1 }
}

/** Refresh this worker's lock on a job it is actively building. */
export async function heartbeatFullGlbJob(jobId: string, workerId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE full_glb_jobs SET locked_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
    [jobId, workerId],
  )
  return (res.rowCount ?? 0) > 0
}

/** Hand a claimed job back on shutdown — not a failure, so don't spend the attempt. */
export async function releaseFullGlbJob(job: FullGlbJobRow, workerId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE full_glb_jobs
        SET status = 'queued', locked_at = NULL, locked_by = NULL,
            attempts = GREATEST(attempts - 1, 0), updated_at = NOW()
      WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
    [job.id, workerId],
  )
  const released = (res.rowCount ?? 0) > 0
  if (released) await markStatus(job.model_id, job.part_id, 'queued', null)
  return released
}

/** Record a finished build and point the model/part at the new object. */
export async function completeFullGlbJob(
  job: FullGlbJobRow,
  result: FullGlbBuildResult,
): Promise<void> {
  const table = job.part_id ? 'model_parts' : 'models'
  const rowId = job.part_id ?? job.model_id

  // Keep the key we're replacing so the old object can be dropped: build.ts mints
  // a fresh random key each run, so without this a re-upload would orphan the
  // previous full GLB in R2 forever.
  const prev = (await db.query(
    `SELECT full_glb_path FROM ${table} WHERE id = $1`, [rowId],
  )).rows[0]?.full_glb_path as string | null | undefined

  if (result.glbKey) {
    await db.query(
      `UPDATE ${table}
          SET full_glb_path = $2, full_glb_status = 'ready',
              full_glb_error = NULL, full_glb_tris = $3
        WHERE id = $1`,
      [rowId, result.glbKey, result.triangles],
    )
  } else {
    // Deliberately not built (too heavy). Clear the path so nothing stale is served.
    await db.query(
      `UPDATE ${table}
          SET full_glb_path = NULL, full_glb_status = 'skipped',
              full_glb_error = $2, full_glb_tris = $3
        WHERE id = $1`,
      [rowId, result.skippedReason, result.triangles],
    )
  }

  await db.query(
    `UPDATE full_glb_jobs
        SET status = $2, report = $3, error = NULL, updated_at = NOW()
      WHERE id = $1`,
    [
      job.id,
      result.glbKey ? 'succeeded' : 'skipped',
      JSON.stringify({
        triangles: result.triangles,
        bytes: result.bytes,
        durationMs: result.durationMs,
        skipped: result.skippedReason,
      }),
    ],
  )

  if (prev && prev !== result.glbKey) {
    deleteObject(prev).catch((err) =>
      log.warn('Could not delete superseded owner GLB', { error: err, key: prev }))
  }
}

/**
 * Handle a failed build: requeue while attempts remain, otherwise give up quietly.
 *
 * "Quietly" is intentional. Unlike a failed preview bake — which leaves a listing
 * with no picture and so has to reach the artist — a failed owner GLB is invisible
 * to everyone: buyers keep the proxy they would have had anyway. Notifying the
 * artist would be noise about something they cannot act on.
 */
export async function failFullGlbJob(job: FullGlbJobRow, error: string): Promise<void> {
  const msg = (error || 'full GLB build failed').slice(0, 500)
  if (job.attempts < job.max_attempts) {
    await db.query(
      `UPDATE full_glb_jobs
          SET status = 'queued', error = $2, locked_at = NULL, locked_by = NULL, updated_at = NOW()
        WHERE id = $1`,
      [job.id, msg],
    )
    await markStatus(job.model_id, job.part_id, 'queued', msg)
    log.warn('Full GLB job requeued after failure', {
      jobId: job.id, attempts: job.attempts, error: msg,
    })
    return
  }
  await db.query(
    `UPDATE full_glb_jobs SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`,
    [job.id, msg],
  )
  await markStatus(job.model_id, job.part_id, 'failed', msg)
  log.error('Full GLB job failed permanently (owner falls back to preview)', {
    jobId: job.id, modelId: job.model_id, partId: job.part_id, error: msg,
  })
}
