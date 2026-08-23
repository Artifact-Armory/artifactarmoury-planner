// backend/src/worker/proxyBakeWorker.ts
//
// Standalone entrypoint for the proxy bake worker — a SEPARATE Railway service
// (its own Blender Docker image), pointed at the same repo + database. It does not
// import the Express app: just the DB, R2, and the bake service, so it stays light.
//
// Loop: claim the oldest open job -> bake it in Blender -> record success/failure
// -> repeat. When idle it sleeps POLL_INTERVAL_MS between claims. While a bake
// runs the worker heartbeats its lock, so a short stale-lock window still can't
// steal a live job. SIGTERM/SIGINT RELEASE the in-flight job back to the queue
// and exit immediately, so a Railway redeploy hands the bake to another worker
// in seconds instead of orphaning it.

import 'dotenv/config'
import os from 'os'
import logger from '../utils/logger'
import { runProxyBake } from '../services/proxyBake/bake'
import {
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
  releaseJob,
  HEARTBEAT_INTERVAL_MS,
  type BakeJobRow,
} from '../services/proxyBake/queue'
import { closeDatabase } from '../db'

const POLL_INTERVAL_MS = Number(process.env.PROXY_BAKE_POLL_MS ?? 5000)
const WORKER_ID = `${os.hostname()}:${process.pid}`

let stopping = false
let draining = false
/** The job this worker is baking right now, so shutdown can hand it back. */
let currentJob: BakeJobRow | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function processOne(): Promise<boolean> {
  const job = await claimNextJob(WORKER_ID)
  if (!job) return false
  currentJob = job

  logger.info('Worker claimed bake job', {
    jobId: job.id,
    modelId: job.model_id,
    partId: job.part_id,
    attempt: job.attempts,
  })
  // Keep the lock fresh for as long as this bake is actually running, so the
  // reclaim window can stay short. Blender runs as a child process, so this
  // timer keeps firing during a bake — but if the worker itself wedges or is
  // killed, the beats stop and another worker takes the job over in minutes
  // instead of waiting out a lock window sized for the slowest possible bake.
  const heartbeat = setInterval(() => {
    heartbeatJob(job.id, WORKER_ID)
      .then((held) => {
        if (!held) {
          logger.warn('Bake job lock lost while still baking (reclaimed elsewhere?)', {
            jobId: job.id,
            workerId: WORKER_ID,
          })
        }
      })
      .catch((e) => logger.warn('Bake job heartbeat failed', { jobId: job.id, e }))
  }, HEARTBEAT_INTERVAL_MS)
  // Never let the timer alone hold the process open at shutdown.
  if (typeof heartbeat.unref === 'function') heartbeat.unref()

  try {
    const result = await runProxyBake({
      jobId: job.id,
      modelId: job.model_id,
      partId: job.part_id,
      sourceKey: job.source_key,
      sourceFormat: job.source_format,
      overrides: job.config,
    })
    await completeJob(job, result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await failJob(job, msg).catch((e) => logger.error('failJob errored', { jobId: job.id, e }))
  } finally {
    clearInterval(heartbeat)
    currentJob = null
  }
  return true
}

async function main(): Promise<void> {
  logger.info('Proxy bake worker started', {
    workerId: WORKER_ID,
    blender: process.env.BLENDER_PATH || 'blender',
    pollMs: POLL_INTERVAL_MS,
  })

  while (!stopping) {
    let didWork = false
    try {
      didWork = await processOne()
    } catch (err) {
      logger.error('Worker loop error (continuing)', { err })
    }
    if (draining) break // finished the in-flight job during shutdown
    if (!didWork) await sleep(POLL_INTERVAL_MS)
  }

  await closeDatabase().catch(() => {})
  logger.info('Proxy bake worker stopped')
  process.exit(0)
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  draining = true

  // Hand any in-flight bake straight back to the queue rather than trying to
  // finish it. A bake runs 20-90s and the platform's drain window is shorter,
  // so "drain then exit" mostly meant the container was killed mid-bake — no
  // exception, so failJob never ran, and the row stayed 'running' until the
  // stale-lock window expired. Releasing takes milliseconds and lets another
  // worker restart it immediately.
  const job = currentJob
  if (!job) {
    logger.info(`Worker received ${signal} — idle, exiting`)
    return
  }
  logger.warn(`Worker received ${signal} mid-bake — releasing job for another worker`, {
    jobId: job.id,
    modelId: job.model_id,
    partId: job.part_id,
  })
  const released = await releaseJob(job, WORKER_ID).catch((e) => {
    logger.error('releaseJob errored during shutdown', { jobId: job.id, e })
    return false
  })
  if (!released) {
    logger.warn('Job was no longer ours to release at shutdown', { jobId: job.id })
  }
  // The bake is abandoned deliberately; exit rather than let the loop write a
  // result for a job that now belongs to whoever claims it next.
  await closeDatabase().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

main().catch((err) => {
  logger.error('Worker crashed', { err })
  process.exit(1)
})
