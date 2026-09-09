// backend/src/services/queueHealth.ts
//
// Answers one question: "is upload/bake processing actually working right now?"
//
// Background. Model ingest runs on a separate worker service with deliberately
// no in-process fallback (migration 057 / MODEL_INGEST_WORKER_ENABLED), so if
// that worker is not running, uploads sit at processing_status='processing'
// forever and every other health signal stays green — the API server is fine,
// the database is fine, /health passes. This module is the thing that notices.
//
// Two independent signals, because neither alone is sufficient:
//   1. WORKER LIVENESS (worker_heartbeats, migration 062). Catches a dead worker
//      even with an empty queue — i.e. before any artist has hit the problem.
//   2. QUEUE AGE / DEPTH. Catches a worker that is alive but wedged, stuck in a
//      crash-retry loop, or simply too far behind.
// A dead worker with no queued jobs is not yet hurting anyone but IS the thing
// you want told about; a growing queue with a live worker is a different fault.

import { db } from '../db'
import logger from '../utils/logger'
// Reuse the REAL enablement predicates rather than re-reading the env vars here.
// A local copy would drift: these use a strict === 'true' compare, so a value
// like "TRUE" disables the queue while a lenient copy would report it enabled —
// and the health check would then alarm about a backlog on a queue that is off
// on purpose (or, worse, stay quiet about one that is on).
import { isIngestWorkerEnabled } from './modelIngest/queue'
import { isBakeWorkerEnabled } from './proxyBake/queue'
import { isFullGlbEnabled } from './fullGlb/queue'

const log = logger.child('QUEUE_HEALTH')

/** A worker unseen for longer than this is presumed down. */
export const WORKER_STALE_MS = Number(process.env.QUEUE_WORKER_STALE_MS ?? 5 * 60_000)
/** A job still waiting after this long means nothing is draining the queue. */
export const QUEUE_STUCK_MS = Number(process.env.QUEUE_STUCK_MS ?? 20 * 60_000)
/** A 'running' job whose lock has not moved in this long has lost its worker. */
export const RUNNING_STALE_MS = Number(process.env.QUEUE_RUNNING_STALE_MS ?? 30 * 60_000)
/** Backlog size that is worth mentioning even when everything is moving. */
export const QUEUE_DEPTH_WARN = Number(process.env.QUEUE_DEPTH_WARN ?? 25)

export type QueueName = 'ingest' | 'bake' | 'full_glb'

export interface QueueStats {
  queue: QueueName
  table: string
  /** Whether this queue is actually being drained by anything right now. */
  enabled: boolean
  queued: number
  running: number
  failed: number
  /** Age of the oldest still-queued job, seconds. null when nothing is queued. */
  oldestQueuedAgeSec: number | null
  /** 'running' rows whose lock has gone stale — a worker died mid-job. */
  stalledRunning: number
}

export interface WorkerInfo {
  workerId: string
  kind: string
  startedAt: string
  lastSeenAt: string
  ageSec: number
  jobsCompleted: number
  alive: boolean
}

export interface QueueProblem {
  key: string
  severity: 'critical' | 'warning'
  message: string
}

export interface StuckModel {
  id: string
  name: string
  artistName: string | null
  waitingSec: number
}

export interface QueueHealth {
  healthy: boolean
  checkedAt: string
  ingestWorkerRequired: boolean
  queues: QueueStats[]
  workers: WorkerInfo[]
  liveWorkers: number
  problems: QueueProblem[]
  /** Models left mid-flight — what an artist actually experiences as "stuck". */
  stuckModels: StuckModel[]
}

/**
 * True when ingest work has nowhere to run except the worker service. This is
 * what turns "no worker" from a slowdown into a hard outage of uploads, so it
 * decides whether a missing worker is critical or merely a warning.
 */
export function isIngestWorkerRequired(): boolean {
  return isIngestWorkerEnabled()
}

/**
 * Per-queue counts. The three job tables share the same column shape (status /
 * locked_at / created_at), so one query serves all of them — `table` is from a
 * fixed internal allowlist below, never user input.
 */
async function statsFor(queue: QueueName, table: string, enabled: boolean): Promise<QueueStats> {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'queued')  AS queued,
       COUNT(*) FILTER (WHERE status = 'running') AS running,
       COUNT(*) FILTER (WHERE status = 'failed')  AS failed,
       COUNT(*) FILTER (WHERE status = 'running'
                          AND (locked_at IS NULL
                               OR locked_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')))
                                                  AS stalled_running,
       EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'queued')))
                                                  AS oldest_queued_age
     FROM ${table}`,
    [RUNNING_STALE_MS],
  )
  const r = rows[0] ?? {}
  return {
    queue,
    table,
    enabled,
    queued: Number(r.queued ?? 0),
    running: Number(r.running ?? 0),
    failed: Number(r.failed ?? 0),
    stalledRunning: Number(r.stalled_running ?? 0),
    oldestQueuedAgeSec: r.oldest_queued_age == null ? null : Math.round(Number(r.oldest_queued_age)),
  }
}

/** Upsert this worker's liveness beacon. Best-effort — never fail a poll over it. */
export async function recordWorkerHeartbeat(
  workerId: string,
  opts: { kind?: string; jobsCompleted?: number } = {},
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO worker_heartbeats (worker_id, kind, last_seen_at, jobs_completed)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (worker_id) DO UPDATE
         SET last_seen_at = NOW(),
             kind = EXCLUDED.kind,
             jobs_completed = EXCLUDED.jobs_completed`,
      [workerId, opts.kind ?? 'bake', opts.jobsCompleted ?? 0],
    )
  } catch (err) {
    log.warn('Worker heartbeat write failed', { workerId, error: err })
  }
}

/** Drop beacons from long-gone replicas so the admin view is not a graveyard. */
export async function pruneStaleHeartbeats(olderThanMs = 7 * 24 * 3600_000): Promise<void> {
  try {
    await db.query(
      `DELETE FROM worker_heartbeats
        WHERE last_seen_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
      [olderThanMs],
    )
  } catch (err) {
    log.warn('Heartbeat prune failed', { error: err })
  }
}

/**
 * Full snapshot plus the list of things currently wrong. Pure read, so it is
 * safe to call from the admin page, the monitor endpoint and the alarm alike.
 */
export async function getQueueHealth(): Promise<QueueHealth> {
  const ingestRequired = isIngestWorkerRequired()

  const [ingest, bake, fullGlb] = await Promise.all([
    statsFor('ingest', 'model_ingest_jobs', ingestRequired),
    statsFor('bake', 'proxy_bake_jobs', isBakeWorkerEnabled()),
    statsFor('full_glb', 'full_glb_jobs', isFullGlbEnabled()),
  ])
  const queues = [ingest, bake, fullGlb]

  const { rows: workerRows } = await db.query(
    `SELECT worker_id, kind, started_at, last_seen_at, jobs_completed,
            EXTRACT(EPOCH FROM (NOW() - last_seen_at)) AS age_sec
       FROM worker_heartbeats
      ORDER BY last_seen_at DESC`,
  )
  const workers: WorkerInfo[] = workerRows.map((w: any) => {
    const ageSec = Math.round(Number(w.age_sec ?? 0))
    return {
      workerId: w.worker_id,
      kind: w.kind,
      startedAt: new Date(w.started_at).toISOString(),
      lastSeenAt: new Date(w.last_seen_at).toISOString(),
      ageSec,
      jobsCompleted: Number(w.jobs_completed ?? 0),
      alive: ageSec * 1000 < WORKER_STALE_MS,
    }
  })
  const liveWorkers = workers.filter((w) => w.alive).length

  // What the artist actually sees. Deliberately driven off `models`, not the job
  // table: a model can be stuck 'processing' because its job row was never
  // created at all, which no queue count would ever reveal.
  const { rows: stuckRows } = await db.query(
    `SELECT m.id, m.name, u.artist_name,
            EXTRACT(EPOCH FROM (NOW() - m.updated_at)) AS waiting_sec
       FROM models m
       LEFT JOIN users u ON u.id = m.artist_id
      WHERE m.processing_status = 'processing'
        AND m.updated_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
      ORDER BY m.updated_at ASC
      LIMIT 50`,
    [QUEUE_STUCK_MS],
  )
  const stuckModels: StuckModel[] = stuckRows.map((r: any) => ({
    id: r.id,
    name: r.name,
    artistName: r.artist_name ?? null,
    waitingSec: Math.round(Number(r.waiting_sec ?? 0)),
  }))

  const problems: QueueProblem[] = []
  const mins = (ms: number) => Math.round(ms / 60_000)

  // 1. No worker at all. Critical only when something actually depends on it —
  //    with ingest still running in-process this is a degradation, not an outage.
  if (liveWorkers === 0) {
    const everSeen = workers.length > 0
    problems.push({
      key: 'worker_down',
      severity: ingestRequired ? 'critical' : 'warning',
      message: ingestRequired
        ? `No worker has checked in for over ${mins(WORKER_STALE_MS)} minutes. ` +
          'MODEL_INGEST_WORKER_ENABLED=true, so nothing is processing uploads — every new ' +
          'upload will sit at "processing" until a worker is running again.' +
          (everSeen ? ` Last seen: ${workers[0].lastSeenAt}.` : ' No worker has ever checked in.')
        : 'No worker has checked in recently. Preview bakes and owner GLBs are not being built.',
    })
  }

  // 2. Queue not draining. Independent of (1): covers a worker that is alive but
  //    wedged, or crash-looping on one poisonous job.
  for (const q of queues) {
    if (!q.enabled) continue
    if (q.oldestQueuedAgeSec != null && q.oldestQueuedAgeSec * 1000 > QUEUE_STUCK_MS) {
      problems.push({
        key: `queue_stalled_${q.queue}`,
        severity: q.queue === 'ingest' ? 'critical' : 'warning',
        message:
          `The ${q.queue} queue is not draining — its oldest job has been waiting ` +
          `${Math.round(q.oldestQueuedAgeSec / 60)} minutes (${q.queued} queued).`,
      })
    }
    if (q.stalledRunning > 0) {
      problems.push({
        key: `queue_stalled_running_${q.queue}`,
        severity: 'warning',
        message:
          `${q.stalledRunning} ${q.queue} job(s) are marked running but their worker has ` +
          'stopped heartbeating — they will be reclaimed, but a worker died mid-job.',
      })
    }
    if (q.queued >= QUEUE_DEPTH_WARN) {
      problems.push({
        key: `queue_depth_${q.queue}`,
        severity: 'warning',
        message: `The ${q.queue} queue has ${q.queued} jobs waiting.`,
      })
    }
  }

  // 3. Models stuck regardless of what the queues say — the artist-visible symptom.
  if (stuckModels.length > 0) {
    problems.push({
      key: 'models_stuck_processing',
      severity: 'critical',
      message:
        `${stuckModels.length} model(s) have been stuck at "processing" for over ` +
        `${mins(QUEUE_STUCK_MS)} minutes. Oldest: "${stuckModels[0].name}" ` +
        `(${Math.round(stuckModels[0].waitingSec / 60)} min).`,
    })
  }

  return {
    healthy: problems.length === 0,
    checkedAt: new Date().toISOString(),
    ingestWorkerRequired: ingestRequired,
    queues,
    workers,
    liveWorkers,
    problems,
    stuckModels,
  }
}
