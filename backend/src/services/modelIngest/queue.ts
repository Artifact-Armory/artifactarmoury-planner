// backend/src/services/modelIngest/queue.ts
//
// DB-backed job queue for moving upload processing off the API server (migration
// 057). Mirrors proxyBake/queue.ts's claim discipline (SELECT ... FOR UPDATE SKIP
// LOCKED + heartbeat + stale-lock reclaim) so it behaves the same way under a
// worker restart.
//
// Unlike proxyBake/queue.ts, this queue does NOT own the model's success/failure
// state — processUploadedModel/processModelVersionUpdate (services/modelIngest/
// process.ts) already do that internally and never throw, so completeIngestJob
// below is just "mark the job row done". failIngestJob only fires on the truly
// unexpected case of the call itself throwing (a bug, not a normal rejection).
//
// With MODEL_INGEST_WORKER_ENABLED unset/false, dispatchIngestUpload/
// dispatchIngestVersionUpdate call the processing functions directly in-process,
// exactly as before this migration — deploying this code changes nothing until
// the flag is set. Deliberately NO in-process inline fallback when the flag is
// on (unlike full_glb_jobs): the whole point of turning it on is "this heavy
// work must never run in the API server again", so a silent fallback there would
// defeat it. Turning the flag on without the worker actually deployed leaves
// uploads stuck 'processing' forever — see this migration's SQL comment and the
// CLAUDE.md entry for this change before flipping it in production.

import { db } from '../../db';
import logger from '../../utils/logger';
import { processUploadedModel, processModelVersionUpdate } from './process';

const log = logger.child('MODEL_INGEST');

/** A running job whose lock is older than this is assumed crashed and reclaimable. */
const STALE_LOCK_MS = Number(process.env.MODEL_INGEST_STALE_LOCK_MS ?? 10 * 60_000);

/** How often a worker refreshes its lock while a job runs. */
export const HEARTBEAT_INTERVAL_MS = Number(process.env.MODEL_INGEST_HEARTBEAT_MS ?? 30_000);

/** Should uploads be handed to the worker queue instead of processed in-process? */
export function isIngestWorkerEnabled(): boolean {
  return process.env.MODEL_INGEST_WORKER_ENABLED === 'true';
}

export type IngestJobType = 'upload' | 'version';

export interface UploadPayload {
  rawKey: string;
  filename?: string | null;
  displayRawKey?: string | null;
  displayFilename?: string | null;
}

export interface VersionPayload {
  rawKey: string;
  filename?: string | null;
  notes?: string | null;
}

export interface IngestJobRow {
  id: string;
  model_id: string;
  job_type: IngestJobType;
  payload: UploadPayload | VersionPayload;
  status: string;
  attempts: number;
  max_attempts: number;
}

/** Insert one queued ingest job. */
async function enqueueIngestJob(input: {
  modelId: string;
  jobType: IngestJobType;
  payload: UploadPayload | VersionPayload;
}): Promise<string | null> {
  const { rows } = await db.query(
    `INSERT INTO model_ingest_jobs (model_id, job_type, payload, status)
     VALUES ($1, $2, $3, 'queued')
     RETURNING id`,
    [input.modelId, input.jobType, JSON.stringify(input.payload)],
  );
  const id = rows[0]?.id ?? null;
  log.info('Ingest job enqueued', { jobId: id, modelId: input.modelId, jobType: input.jobType });
  return id;
}

/**
 * Called from the upload route. Enqueues to the worker when
 * MODEL_INGEST_WORKER_ENABLED is on, otherwise runs processUploadedModel
 * in-process, fire-and-forget — the exact pre-057 behaviour.
 */
export async function dispatchIngestUpload(input: {
  modelId: string;
  rawKey: string;
  filename?: string;
  displayRawKey?: string;
  displayFilename?: string;
}): Promise<void> {
  if (isIngestWorkerEnabled()) {
    await enqueueIngestJob({
      modelId: input.modelId,
      jobType: 'upload',
      payload: {
        rawKey: input.rawKey,
        filename: input.filename ?? null,
        displayRawKey: input.displayRawKey ?? null,
        displayFilename: input.displayFilename ?? null,
      },
    });
    return;
  }
  processUploadedModel(input.modelId, input.rawKey, input.filename, input.displayRawKey, input.displayFilename).catch(
    (err) => logger.error('Async model processing crashed', { error: err, modelId: input.modelId }),
  );
}

/** Called from the new-version route. Same worker/in-process split as above. */
export async function dispatchIngestVersionUpdate(input: {
  modelId: string;
  rawKey: string;
  filename?: string;
  notes: string | null;
}): Promise<void> {
  if (isIngestWorkerEnabled()) {
    await enqueueIngestJob({
      modelId: input.modelId,
      jobType: 'version',
      payload: { rawKey: input.rawKey, filename: input.filename ?? null, notes: input.notes },
    });
    return;
  }
  processModelVersionUpdate(input.modelId, input.rawKey, input.filename, input.notes).catch((err) =>
    logger.error('processModelVersionUpdate crashed', { error: err, modelId: input.modelId }),
  );
}

/**
 * Atomically claim the oldest open job (queued, or a running job whose lock has
 * gone stale). Returns null when there's nothing to do. SKIP LOCKED makes this
 * safe to call concurrently from N worker replicas.
 */
export async function claimNextIngestJob(workerId: string): Promise<IngestJobRow | null> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, model_id, job_type, payload, status, attempts, max_attempts
         FROM model_ingest_jobs
        WHERE status = 'queued'
           OR (status = 'running' AND locked_at < NOW() - ($1::int * INTERVAL '1 millisecond'))
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [STALE_LOCK_MS],
    );
    if (rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }
    const job = rows[0] as IngestJobRow;
    await client.query(
      `UPDATE model_ingest_jobs
          SET status = 'running', attempts = attempts + 1,
              locked_at = NOW(), locked_by = $2, updated_at = NOW()
        WHERE id = $1`,
      [job.id, workerId],
    );
    await client.query('COMMIT');
    return { ...job, status: 'running', attempts: job.attempts + 1 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Refresh this worker's lock on a job it is actively running. */
export async function heartbeatIngestJob(jobId: string, workerId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE model_ingest_jobs SET locked_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
    [jobId, workerId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Hand a claimed job straight back to the queue because THIS worker is shutting
 * down, not because the job failed. `attempts` is decremented so a redeploy never
 * burns through max_attempts by itself.
 */
export async function releaseIngestJob(job: IngestJobRow, workerId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE model_ingest_jobs
        SET status = 'queued', locked_at = NULL, locked_by = NULL,
            attempts = GREATEST(attempts - 1, 0), updated_at = NOW()
      WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
    [job.id, workerId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Mark a job succeeded. The model's own status/notifications were already
 * written by processUploadedModel/processModelVersionUpdate itself — this is
 * only queue bookkeeping.
 */
export async function completeIngestJob(job: IngestJobRow): Promise<void> {
  await db.query(
    `UPDATE model_ingest_jobs SET status = 'succeeded', error = NULL, updated_at = NOW() WHERE id = $1`,
    [job.id],
  );
}

/**
 * Handle the (unexpected) case where the processing call itself threw — every
 * normal rejection (duplicate, bad mesh, etc.) is already handled inside
 * process.ts and never reaches here. Requeues while attempts remain; otherwise
 * gives up and leaves the model in whatever state process.ts last wrote (usually
 * still 'processing', since a genuine throw here means something crashed before
 * process.ts's own catch block could run — a stuck model in that state needs a
 * human to look at the job's `error` column).
 */
export async function failIngestJob(job: IngestJobRow, error: string): Promise<void> {
  const msg = (error || 'ingest job failed').slice(0, 500);
  if (job.attempts < job.max_attempts) {
    await db.query(
      `UPDATE model_ingest_jobs
          SET status = 'queued', error = $2, locked_at = NULL, locked_by = NULL, updated_at = NOW()
        WHERE id = $1`,
      [job.id, msg],
    );
    log.warn('Ingest job requeued after failure', { jobId: job.id, attempts: job.attempts, error: msg });
    return;
  }
  await db.query(
    `UPDATE model_ingest_jobs SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`,
    [job.id, msg],
  );
  log.error('Ingest job failed permanently — model likely stuck, needs manual review', {
    jobId: job.id, modelId: job.model_id, error: msg,
  });
}
