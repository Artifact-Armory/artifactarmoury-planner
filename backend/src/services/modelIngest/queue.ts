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
//
// LARGE-JOB SINGLE-FLIGHT (built 2026-09-03, no migration needed): the worker
// loop already runs one job at a time within a single process, but with more
// than one worker replica, two genuinely heavy jobs could still land on two
// different replicas at once — the exact "10 uploads at once" scenario this
// whole queue exists to defuse, just moved from "in the API server" to "across
// worker replicas". So a job over MODEL_INGEST_LARGE_BYTES needs a cluster-wide
// Postgres advisory lock (tryAcquireLargeJobLock) before it's allowed to run;
// only one large job runs anywhere in the cluster at a time, while any number
// of small/normal jobs keep running freely in parallel across replicas. The
// lock is session-scoped (pg_advisory_lock, not the _xact_ variant) because it
// must stay held for the whole job — which can run minutes — not just the
// instant of claiming, so it's taken on a dedicated client held open for the
// job's duration rather than the shared query pool. Size is measured from the
// RAW FILE BYTES (known cheaply in the route handler before any processing,
// via the same objectSize() call that already enforces MAX_MODEL_FILE_BYTES),
// not triangle count (only knowable after the file's already been downloaded
// and partially parsed) — a conservative proxy assuming worst-case 50
// bytes/triangle binary-STL density, so it only ever over-flags a file as
// "large", never under-flags one.

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

/**
 * Raw-byte threshold above which a job must win the cluster-wide large-job lock
 * before it's allowed to run. Default 150MB ≈ 3.1M triangles at binary STL's 50
 * bytes/triangle (~63% of fileProcessor.ts's MAX_INGEST_TRIANGLES, currently
 * 5M). Raised from an initial 75MB on 2026-09-03 — real uploads on this
 * marketplace routinely run well above 75MB, which made the lock trigger on
 * ordinary-sized files instead of just the genuinely heavy ones it exists for.
 */
const LARGE_JOB_BYTES = Number(process.env.MODEL_INGEST_LARGE_BYTES ?? 150 * 1024 * 1024);

/** Fixed arbitrary key for the cluster-wide "one large ingest job at a time" lock. */
const LARGE_JOB_LOCK_KEY = 834127001;

export type IngestJobType = 'upload' | 'version';

export interface UploadPayload {
  rawKey: string;
  filename?: string | null;
  displayRawKey?: string | null;
  displayFilename?: string | null;
  /** Raw file byte size, known up-front by the route handler — see LARGE_JOB_BYTES above. */
  rawBytes?: number | null;
}

export interface VersionPayload {
  rawKey: string;
  filename?: string | null;
  notes?: string | null;
  rawBytes?: number | null;
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

/** Is this job's raw file over the large-job threshold? See LARGE_JOB_BYTES above. */
export function isLargeIngestJob(job: IngestJobRow): boolean {
  return (job.payload?.rawBytes ?? 0) >= LARGE_JOB_BYTES;
}

/**
 * Try to take the cluster-wide "one large ingest job at a time" lock. Returns
 * the client holding it (keep it checked out and pass it to
 * releaseLargeJobLock when the job finishes) or null if another replica
 * already holds it right now — that's the normal, expected case under a burst
 * of large uploads, not an error.
 */
export async function tryAcquireLargeJobLock(): Promise<any | null> {
  const client = await db.connect();
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LARGE_JOB_LOCK_KEY]);
  if (!rows[0]?.locked) {
    client.release();
    return null;
  }
  return client;
}

/** Release a lock taken by tryAcquireLargeJobLock and hand the client back to the pool. */
export async function releaseLargeJobLock(client: any): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [LARGE_JOB_LOCK_KEY]);
  } catch (err) {
    log.warn('Failed to release large-job advisory lock (will clear when the connection closes)', { error: err });
  } finally {
    client.release();
  }
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
  rawBytes?: number | null;
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
        rawBytes: input.rawBytes ?? null,
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
  rawBytes?: number | null;
}): Promise<void> {
  if (isIngestWorkerEnabled()) {
    await enqueueIngestJob({
      modelId: input.modelId,
      jobType: 'version',
      payload: { rawKey: input.rawKey, filename: input.filename ?? null, notes: input.notes, rawBytes: input.rawBytes ?? null },
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
