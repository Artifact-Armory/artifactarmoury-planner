// backend/src/services/modelIngest/runner.ts
//
// "Claim one ingest job, run it, record the result" — used by the proxy bake
// worker process (worker/proxyBakeWorker.ts), which drains this queue at
// higher priority than preview bakes / owner GLBs: a bake or full-GLB job for a
// model can't even exist until that model's ingest job has run and enqueued it,
// so ingest naturally has to go first.

import os from 'os';
import logger from '../../utils/logger';
import { processUploadedModel, processModelVersionUpdate } from './process';
import {
  claimNextIngestJob,
  completeIngestJob,
  failIngestJob,
  heartbeatIngestJob,
  releaseIngestJob,
  isLargeIngestJob,
  tryAcquireLargeJobLock,
  releaseLargeJobLock,
  HEARTBEAT_INTERVAL_MS,
  type IngestJobRow,
  type UploadPayload,
  type VersionPayload,
} from './queue';

const log = logger.child('MODEL_INGEST');

export const MODEL_INGEST_WORKER_ID = `${os.hostname()}:${process.pid}`;

/** The job this process is running right now, so shutdown can hand it back. */
let inFlight: IngestJobRow | null = null;
/** The client holding the large-job lock, if this process's in-flight job needs one. */
let inFlightLargeLock: any | null = null;

/**
 * Claim and run at most one job.
 * @returns true if a job was claimed and run (so the caller should loop again
 * immediately). Also false when a large job was claimed but had to be handed
 * straight back because another replica already holds the large-job lock —
 * the caller should move on to other work and let a later poll retry it.
 */
export async function runOneIngestJob(workerId = MODEL_INGEST_WORKER_ID): Promise<boolean> {
  const job = await claimNextIngestJob(workerId);
  if (!job) return false;
  inFlight = job;

  // Large jobs (see queue.ts's LARGE_JOB_BYTES) may only run one-at-a-time,
  // cluster-wide — the exact "several heavy uploads at once" scenario this
  // queue exists to defuse, which could otherwise still happen across worker
  // replicas even with per-replica processing already serialized. A normal/
  // small job never needs this and always proceeds immediately.
  let largeLock: any | null = null;
  if (isLargeIngestJob(job)) {
    largeLock = await tryAcquireLargeJobLock();
    if (!largeLock) {
      // Another replica already has a large job running. Hand this one straight
      // back to the queue (not a failure — same "we're not doing this right
      // now" release used on shutdown) and let a later poll retry it.
      log.info('Large ingest job deferred — another large job is already running elsewhere', {
        jobId: job.id, modelId: job.model_id,
      });
      await releaseIngestJob(job, workerId);
      inFlight = null;
      return false;
    }
    inFlightLargeLock = largeLock;
  }

  log.info('Claimed ingest job', {
    jobId: job.id, modelId: job.model_id, jobType: job.job_type, attempt: job.attempts,
    large: !!largeLock,
  });

  // Keep the lock fresh for as long as this job actually runs — a dense mesh's
  // STL parse can take a while, and the reclaim window should only trip when the
  // worker itself is genuinely gone, not mid-parse.
  const heartbeat = setInterval(() => {
    heartbeatIngestJob(job.id, workerId)
      .then((held) => {
        if (!held) log.warn('Ingest job lock lost mid-run (reclaimed elsewhere?)', { jobId: job.id, workerId });
      })
      .catch((e) => log.warn('Ingest job heartbeat failed', { jobId: job.id, e }));
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  try {
    // processUploadedModel/processModelVersionUpdate never throw — every normal
    // rejection is handled internally (markModelFailed/failVersionUpdate + an
    // artist notification). A throw escaping here means something genuinely
    // unexpected happened before that internal handling could run.
    if (job.job_type === 'upload') {
      const p = job.payload as UploadPayload;
      await processUploadedModel(job.model_id, p.rawKey, p.filename ?? undefined, p.displayRawKey ?? undefined, p.displayFilename ?? undefined);
    } else {
      const p = job.payload as VersionPayload;
      await processModelVersionUpdate(job.model_id, p.rawKey, p.filename ?? undefined, p.notes ?? null);
    }
    await completeIngestJob(job);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failIngestJob(job, msg).catch((e) => log.error('failIngestJob errored', { jobId: job.id, e }));
  } finally {
    clearInterval(heartbeat);
    inFlight = null;
    if (largeLock) {
      inFlightLargeLock = null;
      await releaseLargeJobLock(largeLock).catch((e) => log.warn('releaseLargeJobLock errored', { jobId: job.id, e }));
    }
  }
  return true;
}

/**
 * Hand any in-flight job back to the queue (call on SIGTERM). Returns true when
 * something WAS released — the caller must exit immediately rather than let the
 * run finish, since the job now belongs to whoever claims it next.
 */
export async function releaseInFlightIngestJob(workerId = MODEL_INGEST_WORKER_ID): Promise<boolean> {
  const job = inFlight;
  if (!job) return false;
  log.warn('Shutting down mid-run — releasing ingest job', { jobId: job.id, modelId: job.model_id, jobType: job.job_type });
  const released = await releaseIngestJob(job, workerId).catch(() => false);
  // The advisory lock is session-scoped, so closing the pool at shutdown would
  // eventually clear it too — but release explicitly so a large job's slot
  // frees up the instant this job is handed back, not whenever the pool
  // finishes tearing down.
  if (inFlightLargeLock) {
    const lock = inFlightLargeLock;
    inFlightLargeLock = null;
    await releaseLargeJobLock(lock).catch(() => {});
  }
  return released;
}
