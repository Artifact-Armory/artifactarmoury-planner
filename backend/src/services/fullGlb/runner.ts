// backend/src/services/fullGlb/runner.ts
//
// "Claim one job, build it, record the result" — shared by the two things that
// can drain the owner-GLB queue:
//
//   1. the proxy bake worker (the normal path in production: a separate service,
//      so the build's CPU never lands on the web dyno), and
//   2. an in-process drainer in the API server, used when no worker is deployed
//      (see inline.ts). Without it, switching the bake worker off would silently
//      turn this feature off too.
//
// Neither caller needs Blender: this build is pure Node, unlike the preview bake.

import os from 'os'
import logger from '../../utils/logger'
import { runFullGlbBuild } from './build'
import {
  claimNextFullGlbJob,
  completeFullGlbJob,
  failFullGlbJob,
  heartbeatFullGlbJob,
  releaseFullGlbJob,
  HEARTBEAT_INTERVAL_MS,
  type FullGlbJobRow,
} from './queue'

const log = logger.child('FULL_GLB')

export const FULL_GLB_WORKER_ID = `${os.hostname()}:${process.pid}`

/** The job this process is building right now, so shutdown can hand it back. */
let inFlight: FullGlbJobRow | null = null

/**
 * Claim and run at most one job.
 * @returns true if a job was claimed (so the caller should loop again immediately).
 */
export async function runOneFullGlbJob(workerId = FULL_GLB_WORKER_ID): Promise<boolean> {
  const job = await claimNextFullGlbJob(workerId)
  if (!job) return false
  inFlight = job

  log.info('Claimed full GLB job', {
    jobId: job.id, modelId: job.model_id, partId: job.part_id, attempt: job.attempts,
  })

  // Keep the lock fresh for as long as the build actually runs, so the reclaim
  // window can stay short. Unlike the Blender bake this is in-process CPU work,
  // and Draco encoding a multi-million-triangle mesh blocks the event loop in
  // bursts — the interval fires late but still well inside the stale window.
  const heartbeat = setInterval(() => {
    heartbeatFullGlbJob(job.id, workerId)
      .then((held) => {
        if (!held) log.warn('Full GLB lock lost mid-build (reclaimed elsewhere?)', { jobId: job.id })
      })
      .catch((e) => log.warn('Full GLB heartbeat failed', { jobId: job.id, e }))
  }, HEARTBEAT_INTERVAL_MS)
  if (typeof heartbeat.unref === 'function') heartbeat.unref()

  try {
    const result = await runFullGlbBuild({
      jobId: job.id,
      modelId: job.model_id,
      partId: job.part_id,
      sourceKey: job.source_key,
    })
    await completeFullGlbJob(job, result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await failFullGlbJob(job, msg).catch((e) =>
      log.error('failFullGlbJob errored', { jobId: job.id, e }))
  } finally {
    clearInterval(heartbeat)
    inFlight = null
  }
  return true
}

/**
 * Hand any in-flight build back to the queue (call on SIGTERM).
 *
 * Returns true when something WAS released — in which case the caller must exit
 * rather than let the build finish: the job now belongs to whoever claims it
 * next, and completeFullGlbJob would otherwise write a result over theirs.
 */
export async function releaseInFlightFullGlbJob(workerId = FULL_GLB_WORKER_ID): Promise<boolean> {
  const job = inFlight
  if (!job) return false
  log.warn('Shutting down mid-build — releasing full GLB job', {
    jobId: job.id, modelId: job.model_id, partId: job.part_id,
  })
  return releaseFullGlbJob(job, workerId).catch(() => false)
}
