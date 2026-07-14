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
import type { ProxyBakeConfigOverrides } from './config'
import type { BakeResult } from './bake'

/** True when uploads should hand preview generation to the bake worker. */
export function isBakeWorkerEnabled(): boolean {
  return process.env.PROXY_BAKE_ENABLED === 'true'
}

/** A running job whose lock is older than this is assumed crashed and reclaimable. */
const STALE_LOCK_MS = Number(process.env.PROXY_BAKE_STALE_LOCK_MS ?? 45 * 60_000)

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
  logger.error('Bake job failed permanently', { jobId: job.id, modelId: job.model_id, error: msg })
}

/**
 * Flip the model to 'ready' when it has no open bake jobs left and none failed.
 * Called after each successful job. Leaves 'processing' while any remain.
 */
async function rollUpModelStatus(modelId: string): Promise<void> {
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

  if (failed === 0 && succeeded > 0) {
    await db.query(
      `UPDATE models SET processing_status = 'ready', processing_error = NULL, updated_at = NOW()
        WHERE id = $1 AND processing_status <> 'ready'`,
      [modelId],
    )
    logger.info('Model bakes all complete — ready', { modelId, succeeded })
  }
}
