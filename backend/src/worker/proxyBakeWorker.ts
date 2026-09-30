// backend/src/worker/proxyBakeWorker.ts
//
// Worker SUPERVISOR - the process Railway runs (`node dist/worker/proxyBakeWorker.js`).
//
// It holds almost nothing: a DB pool and a poll loop. The real work (ingest, Blender
// bakes, owner GLB builds) runs in a CHILD process (proxyBakeWorkerLoop.ts) that
// is started only when a queue has something claimable and exits after
// WORKER_IDLE_EXIT_MS with nothing to do.
//
// Why: the memory-heavy steps leave memory behind that a Node process never gives
// back - WASM linear memory (meshopt, Draco) cannot shrink, and glibc keeps freed
// arenas. Measured on a 307k-triangle mesh: an owner GLB build took a fresh process
// from ~100 MB to ~475 MB and it stayed there after a forced GC. Worker replicas sat
// at 600-850 MB while idle. A child that exits hands all of it back to the OS.

import 'dotenv/config'
import os from 'os'
import fs from 'fs'
import { spawn, type ChildProcess } from 'child_process'
import logger from '../utils/logger'
import { db, closeDatabase } from '../db'

// Deliberately NOT importing queueHealth / the queue modules: they drag in the whole
// processing stack (sharp, gltf-transform, the mesh converters) and the point of this
// process is to stay small. The two things it needs from them are inlined below.
const isFullGlbEnabled = () => process.env.FULL_GLB_ENABLED !== 'false'

/** Same upsert as queueHealth.recordWorkerHeartbeat (which the child uses). */
async function beat(): Promise<void> {
  await db
    .query(
      `INSERT INTO worker_heartbeats (worker_id, kind, last_seen_at, jobs_completed)
       VALUES ($1, 'bake', NOW(), 0)
       ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = NOW(), kind = EXCLUDED.kind`,
      [WORKER_ID],
    )
    .catch((err) => logger.warn('Worker heartbeat write failed', { workerId: WORKER_ID, error: err }))
}

const POLL_INTERVAL_MS = Number(process.env.PROXY_BAKE_POLL_MS ?? 5000)
const WORKER_ID = `${os.hostname()}:${process.pid}`
// Shortest of the queues' stale-lock windows (bake: 3 min). Erring short only means
// the child starts and finds nothing, then idles out.
const STALE_LOCK_MS = Number(process.env.PROXY_BAKE_STALE_LOCK_MS ?? 3 * 60_000)

/**
 * What the container is holding, split the way the cgroup counts it. Railway's memory
 * graph is the cgroup total, which includes page cache (files read/written by Blender,
 * the R2 downloads, /tmp) - NOT just process memory. If `anonMB` is small and `fileMB`
 * is big, the graph is showing reclaimable cache, not a leak.
 */
function memoryReport(): Record<string, number | string> {
  const mb = (n: number) => Math.round(n / 1048576)
  const out: Record<string, number | string> = { supervisorRssMB: mb(process.memoryUsage().rss) }
  try {
    const stat = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8')
    const get = (k: string) => Number(new RegExp(`^${k} ([0-9]+)`, 'm').exec(stat)?.[1] ?? 0)
    out.anonMB = mb(get('anon'))
    out.fileMB = mb(get('file'))
    out.shmemMB = mb(get('shmem'))
    out.kernelMB = mb(get('kernel'))
    out.cgroupMB = mb(Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8')))
  } catch {
    out.cgroup = 'unavailable'
  }
  try {
    out.tmpEntries = fs.readdirSync(os.tmpdir()).length
  } catch {
    /* ignore */
  }
  return out
}

let child: ChildProcess | null = null
let stopping = false

/** True if any queue has a job a worker could claim right now. Deliberately a
 *  little eager - a false positive costs one child start, a false negative
 *  strands a job. */
async function hasClaimableWork(): Promise<boolean> {
  const stale = `status = 'running' AND locked_at < NOW() - ($1::int * INTERVAL '1 millisecond')`
  const tables = ['proxy_bake_jobs', 'model_ingest_jobs']
  if (isFullGlbEnabled()) tables.push('full_glb_jobs')
  const sql = tables
    .map((t) => `SELECT 1 FROM ${t} WHERE status = 'queued' OR (${stale})`)
    .join(' UNION ALL ')
  const { rows } = await db.query(`SELECT EXISTS (${sql}) AS work`, [STALE_LOCK_MS])
  return !!rows[0]?.work
}

function startChild(): void {
  logger.info('Worker supervisor: starting job process', { workerId: WORKER_ID })
  const c = spawn(process.execPath, [...process.execArgv, require.resolve('./proxyBakeWorkerLoop')], {
    stdio: 'inherit',
    env: { ...process.env, WORKER_PARENT_ID: WORKER_ID },
  })
  child = c
  c.on('exit', (code, signal) => {
    if (child === c) child = null
    logger.info('Worker memory after job process exit', memoryReport())
    if (code !== 0 && !stopping) {
      logger.error('Worker job process exited abnormally', { code, signal })
    } else {
      logger.info('Worker job process exited', { code, signal })
    }
  })
  c.on('error', (err) => {
    if (child === c) child = null
    logger.error('Worker job process failed to start', { err })
  })
}

async function main(): Promise<void> {
  logger.info('Proxy bake worker supervisor started', { workerId: WORKER_ID, pollMs: POLL_INTERVAL_MS })
  logger.info('Worker memory at start', memoryReport())
  while (!stopping) {
    try {
      // The child heartbeats too while it runs; this keeps the beacon alive while
      // it is not, which is the "healthy and idle" case /admin/queues must show.
      if (!child) {
        await beat()
        if (await hasClaimableWork()) startChild()
      }
    } catch (err) {
      logger.error('Worker supervisor loop error (continuing)', { err })
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

function shutdown(signal: string): void {
  if (stopping) return
  stopping = true
  logger.info(`Worker supervisor received ${signal}`)
  const done = async () => {
    await closeDatabase().catch(() => {})
    process.exit(0)
  }
  if (!child) return void done()
  // The child owns any in-flight job and hands it back to the queue itself.
  child.once('exit', () => void done())
  child.kill('SIGTERM')
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

main().catch((err) => {
  logger.error('Worker supervisor crashed', { err })
  process.exit(1)
})
