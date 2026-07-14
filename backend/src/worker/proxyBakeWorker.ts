// backend/src/worker/proxyBakeWorker.ts
//
// Standalone entrypoint for the proxy bake worker — a SEPARATE Railway service
// (its own Blender Docker image), pointed at the same repo + database. It does not
// import the Express app: just the DB, R2, and the bake service, so it stays light.
//
// Loop: claim the oldest open job -> bake it in Blender -> record success/failure
// -> repeat. When idle it sleeps POLL_INTERVAL_MS between claims. SIGTERM/SIGINT
// finish the in-flight job (best effort) and exit cleanly so Railway restarts are
// graceful.

import 'dotenv/config'
import os from 'os'
import logger from '../utils/logger'
import { runProxyBake } from '../services/proxyBake/bake'
import { claimNextJob, completeJob, failJob } from '../services/proxyBake/queue'
import { closeDatabase } from '../db'

const POLL_INTERVAL_MS = Number(process.env.PROXY_BAKE_POLL_MS ?? 5000)
const WORKER_ID = `${os.hostname()}:${process.pid}`

let stopping = false
let draining = false

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function processOne(): Promise<boolean> {
  const job = await claimNextJob(WORKER_ID)
  if (!job) return false

  logger.info('Worker claimed bake job', {
    jobId: job.id,
    modelId: job.model_id,
    partId: job.part_id,
    attempt: job.attempts,
  })
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

function shutdown(signal: string) {
  if (stopping) return
  logger.info(`Worker received ${signal} — draining current job then exiting`)
  stopping = true
  draining = true
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

main().catch((err) => {
  logger.error('Worker crashed', { err })
  process.exit(1)
})
