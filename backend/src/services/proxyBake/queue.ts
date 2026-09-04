// backend/src/services/proxyBake/queue.ts
//
// DB-backed job queue for the proxy bake worker. The web service ENQUEUEs jobs
// when a model is uploaded/updated; a separate worker CLAIMs them with
// `SELECT ... FOR UPDATE SKIP LOCKED` (so multiple worker replicas never grab the
// same row), bakes, then completes/fails them. When every bake for a model is
// done, the model flips from 'processing' to 'ready' (or 'failed').
//
// With PROXY_BAKE_ENABLED unset/false the enqueue helpers are no-ops from the
// caller's perspective (the caller keeps the existing pure-Node inline path), so
// deploying this code changes nothing until the worker is switched on.

import { db } from '../../db'
import logger from '../../utils/logger'
import { createNotification } from '../notifications'
import type { ProxyBakeConfigOverrides } from './config'
import type { BakeResult } from './bake'

/** True when uploads should hand preview generation to the bake worker. */
export function isBakeWorkerEnabled(): boolean {
  return process.env.PROXY_BAKE_ENABLED === 'true'
}

/** A running job whose lock is older than this is assumed crashed and reclaimable.
 *
 *  Short (3 min) because the worker HEARTBEATS its lock while baking (see
 *  `heartbeatJob`), so a lock only goes stale when the worker is genuinely gone.
 *  Before the heartbeat existed this had to exceed the longest legitimate bake
 *  and sat at 45 minutes — which is exactly what a crashed worker cost us in
 *  production on 2026-08-23: one part of a 4-part upload was claimed by a worker
 *  that died mid-bake without recording an error, so the row stayed 'running'
 *  and unreclaimable for 2700s while the other three parts finished in 95s
 *  total. The model can't go 'ready' until every part is done, so the whole
 *  upload took 46 minutes to do a minute and a half of work. */
const STALE_LOCK_MS = Number(process.env.PROXY_BAKE_STALE_LOCK_MS ?? 3 * 60_000)

/** How often a worker refreshes its lock while a bake runs. Must be comfortably
 *  under STALE_LOCK_MS so a live job is never reclaimed mid-bake. */
export const HEARTBEAT_INTERVAL_MS = Number(process.env.PROXY_BAKE_HEARTBEAT_MS ?? 30_000)

export interface EnqueueInput {
  modelId: string
  partId?: string | null
  sourceKey: string
  sourceFormat: string
  overrides?: ProxyBakeConfigOverrides | null
}

export interface BakeJobRow {
  id: string
  model_id: string
  part_id: string | null
  source_key: string
  source_format: string
  status: string
  attempts: number
  max_attempts: number
  config: ProxyBakeConfigOverrides | null
}

/** Insert one queued bake job. Safe to call from the web service. */
export async function enqueueBakeJob(input: EnqueueInput): Promise<string | null> {
  const { rows } = await db.query(
    `INSERT INTO proxy_bake_jobs (model_id, part_id, source_key, source_format, config, status)
     VALUES ($1, $2, $3, $4, $5, 'queued')
     RETURNING id`,
    [
      input.modelId,
      input.partId ?? null,
      input.sourceKey,
      input.sourceFormat || 'stl',
      input.overrides ? JSON.stringify(input.overrides) : null,
    ],
  )
  const id = rows[0]?.id ?? null
  logger.info('Bake job enqueued', { jobId: id, modelId: input.modelId, partId: input.partId ?? null })
  return id
}

/**
 * Atomically claim the oldest open job (queued, or a running job whose lock has
 * gone stale). Returns null when there's nothing to do. SKIP LOCKED makes this
 * safe to call concurrently from N worker replicas.
 */
export async function claimNextJob(workerId: string): Promise<BakeJobRow | null> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id, model_id, part_id, source_key, source_format, status, attempts, max_attempts, config
         FROM proxy_bake_jobs
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
    const job = rows[0] as BakeJobRow
    await client.query(
      `UPDATE proxy_bake_jobs
          SET status = 'running', attempts = attempts + 1,
              locked_at = NOW(), locked_by = $2, updated_at = NOW()
        WHERE id = $1`,
      [job.id, workerId],
    )
    await client.query('COMMIT')
    return { ...job, status: 'running', attempts: job.attempts + 1 }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Refresh this worker's lock on a job it is actively baking, so the row is not
 * mistaken for a crashed worker's. Scoped to `locked_by` and `status='running'`
 * so a job that has already been reclaimed (or finished) is never re-locked.
 *
 * Returns false when the update matched nothing, which means this worker no
 * longer owns the job — worth logging, since it means two workers briefly
 * duplicated a bake.
 */
export async function heartbeatJob(jobId: string, workerId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE proxy_bake_jobs SET locked_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
    [jobId, workerId],
  )
  return (res.rowCount ?? 0) > 0
}

/**
 * Hand a claimed job straight back to the queue because THIS worker is shutting
 * down, not because the bake failed. Used on SIGTERM so a deploy/restart never
 * orphans an in-flight bake: without it the row sits 'running' until the stale
 * window expires, which is how a 4-part upload once took 46 minutes to do 95
 * seconds of work.
 *
 * `attempts` is decremented because the attempt was abandoned by us, not spent
 * on a real failure — otherwise a few unlucky redeploys could burn through
 * max_attempts and fail the model for no reason.
 */
export async function releaseJob(job: BakeJobRow, workerId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE proxy_bake_jobs
        SET status = 'queued', locked_at = NULL, locked_by = NULL,
            attempts = GREATEST(attempts - 1, 0), updated_at = NOW()
      WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
    [job.id, workerId],
  )
  return (res.rowCount ?? 0) > 0
}

/**
 * Mark a job succeeded, store its result on the model/part, and roll the parent
 * model up to 'ready' once every bake for it is done.
 */
export async function completeJob(job: BakeJobRow, result: BakeResult): Promise<void> {
  await db.query(
    `UPDATE proxy_bake_jobs SET status = 'succeeded', report = $2, error = NULL, updated_at = NOW()
      WHERE id = $1`,
    [job.id, JSON.stringify(result.report)],
  )

  if (job.part_id) {
    await db.query(
      `UPDATE model_parts
          SET glb_file_path = $2, proxy_report = $3, processing_status = 'ready',
              processing_error = NULL
        WHERE id = $1`,
      [job.part_id, result.glbKey, JSON.stringify(result.report)],
    )
  } else {
    await db.query(
      `UPDATE models
          SET glb_file_path = $2, proxy_report = $3, updated_at = NOW()
        WHERE id = $1`,
      [job.model_id, result.glbKey, JSON.stringify(result.report)],
    )
  }

  await rollUpModelStatus(job.model_id)
}

/**
 * Handle a failed bake: requeue if attempts remain, otherwise fail the job and
 * the parent model (one un-bakeable mesh fails the model, mirroring the existing
 * multi-part behaviour). The buyer file is never touched by any of this.
 */
export async function failJob(job: BakeJobRow, error: string): Promise<void> {
  const msg = (error || 'bake failed').slice(0, 500)
  if (job.attempts < job.max_attempts) {
    // Transient failure — requeue for another worker/attempt.
    await db.query(
      `UPDATE proxy_bake_jobs
          SET status = 'queued', error = $2, locked_at = NULL, locked_by = NULL, updated_at = NOW()
        WHERE id = $1`,
      [job.id, msg],
    )
    logger.warn('Bake job requeued after failure', { jobId: job.id, attempts: job.attempts, error: msg })
    return
  }

  await db.query(
    `UPDATE proxy_bake_jobs SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`,
    [job.id, msg],
  )
  if (job.part_id) {
    await db.query(
      `UPDATE model_parts SET processing_status = 'failed', processing_error = $2 WHERE id = $1`,
      [job.part_id, msg],
    )
  }
  await db.query(
    `UPDATE models SET processing_status = 'failed', processing_error = $2, updated_at = NOW()
      WHERE id = $1`,
    [job.model_id, msg],
  )
  // Tell the artist. They left the upload form long before the bake ran, so a
  // failure recorded only in processing_error is invisible to them — the model
  // just never gets a preview. (The upload-time rejections do the same, from
  // markModelFailed in routes/models.ts.)
  try {
    const row = (await db.query(
      'SELECT artist_id, name FROM models WHERE id = $1', [job.model_id],
    )).rows[0]
    if (row?.artist_id) {
      await createNotification({
        userId: row.artist_id,
        type: 'model.upload_failed',
        title: `Preview failed: ${row.name || 'your model'}`,
        body: `We couldn't generate the 3D preview for this model. ${msg}`,
        link: '/artist/models',
        modelId: job.model_id,
      })
    }
  } catch (err) {
    logger.error('Bake-failure notification failed', { error: err, modelId: job.model_id })
  }
  logger.error('Bake job failed permanently', { jobId: job.id, modelId: job.model_id, error: msg })
}

/**
 * Flip the model to 'ready' when it has no open bake jobs left and none failed.
 * Called after each successful job. Leaves 'processing' while any remain.
 *
 * Two guards added 2026-09-03 after a real incident (a 10-model grouped
 * upload where only 5 models ever got processed — see modelIngest/process.ts
 * / isolatedRunner.ts for the root cause):
 *
 *   1. A multi-part listing's bake jobs are enqueued INCREMENTALLY as the
 *      ingest job (modelIngest/process.ts) works through each part in turn —
 *      it can take minutes for a large listing. "No open jobs in
 *      proxy_bake_jobs right now" can therefore just mean the ingest job
 *      hasn't reached the rest of the parts yet, not that the listing is
 *      actually finished. This cross-checks against `model_parts`, the
 *      authoritative list of what the listing needs, before declaring it
 *      done — every known part must be 'ready' or 'failed', not merely
 *      "no bake job currently outstanding for it".
 *   2. Never resurrect a model the ingest side has already given up on. If
 *      ingest hit an unprocessable part and called markModelFailed (leaving
 *      processing_status='failed'), a late-arriving completion for an
 *      EARLIER part's bake job must not flip that back to 'ready' — the
 *      listing is genuinely incomplete.
 */
async function rollUpModelStatus(modelId: string): Promise<void> {
  const modelRow = (
    await db.query(`SELECT processing_status FROM models WHERE id = $1`, [modelId])
  ).rows[0]
  if (!modelRow || modelRow.processing_status === 'failed') return

  const { rows } = await db.query(
    `SELECT
        COUNT(*) FILTER (WHERE status IN ('queued','running')) AS open,
        COUNT(*) FILTER (WHERE status = 'failed')             AS failed,
        COUNT(*) FILTER (WHERE status = 'succeeded')          AS succeeded
       FROM proxy_bake_jobs WHERE model_id = $1`,
    [modelId],
  )
  const open = Number(rows[0]?.open ?? 0)
  const failed = Number(rows[0]?.failed ?? 0)
  const succeeded = Number(rows[0]?.succeeded ?? 0)
  if (open > 0) return // still baking

  // 'no_preview' (2026-09-04) is a SETTLED state, same as 'ready'/'failed' —
  // a part that's too heavy to preview never gets a bake job enqueued for it
  // at all, so treating it as "pending" here would block this model from
  // ever reaching 'ready'.
  const { rows: partRows } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE processing_status NOT IN ('ready', 'failed', 'no_preview')) AS pending
       FROM model_parts WHERE model_id = $1`,
    [modelId],
  )
  const pendingParts = Number(partRows[0]?.pending ?? 0)
  if (pendingParts > 0) return // ingest still has parts of this listing left to reach

  if (failed === 0 && succeeded > 0) {
    await db.query(
      `UPDATE models SET processing_status = 'ready', processing_error = NULL, updated_at = NOW()
        WHERE id = $1 AND processing_status <> 'ready'`,
      [modelId],
    )
    logger.info('Model bakes all complete — ready', { modelId, succeeded })
  }
}
