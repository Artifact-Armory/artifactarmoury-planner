// backend/src/services/queueAlarm.ts
//
// The thing that tells you the worker stopped.
//
// getQueueHealth() only reports; nothing looks at it unless someone opens the
// admin page. This polls it and pushes a notification out when something is
// wrong, because the failure mode being defended against is precisely the one
// nobody is watching for: the worker dies, the site stays up, and uploads
// silently pile up at "processing" until an artist complains.
//
// Latching. An open incident emails ONCE, then at most once per
// QUEUE_ALARM_REPEAT_MS while it persists, and sends a single recovery notice
// when it clears (queue_alert_state, migration 062). An alarm that fires every
// five minutes gets muted by its reader within the hour, which is the same as
// having no alarm at all.
//
// Runs on the API server rather than the worker, deliberately: an alarm hosted
// inside the process it is meant to be watching cannot report that process
// being dead. Multiple API replicas are serialised with a Postgres advisory
// lock so one incident does not produce N emails.

import { db } from '../db'
import logger from '../utils/logger'
import { sendEmail } from './email'
import { notifyAdminsOfQueueAlarm } from './notifications'
import { getQueueHealth, pruneStaleHeartbeats, type QueueHealth } from './queueHealth'

const log = logger.child('QUEUE_ALARM')

const CHECK_INTERVAL_MS = Number(process.env.QUEUE_ALARM_INTERVAL_MS ?? 5 * 60_000)
const REPEAT_MS = Number(process.env.QUEUE_ALARM_REPEAT_MS ?? 6 * 3600_000)
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@artifactarmoury.com'
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://artifactarmoury.com'

// Distinct from the analytics rollup's key so the two schedulers never block
// each other.
const ALARM_LOCK_KEY = 848_213_907

let started = false

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

/** Serialise across API replicas so one incident sends one email. */
async function withAlarmLock(fn: () => Promise<void>): Promise<boolean> {
  const client = await db.getClient()
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [ALARM_LOCK_KEY])
    if (!rows[0]?.ok) return false
    try {
      await fn()
      return true
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ALARM_LOCK_KEY])
    }
  } finally {
    client.release()
  }
}

function alarmEmailHtml(health: QueueHealth): string {
  const rows = health.problems
    .map(
      (p) =>
        `<li><strong>${p.severity === 'critical' ? 'CRITICAL' : 'Warning'}:</strong> ${escapeHtml(p.message)}</li>`,
    )
    .join('')
  const queueRows = health.queues
    .map(
      (q) =>
        `<tr><td>${q.queue}</td><td>${q.enabled ? 'on' : 'off'}</td><td>${q.queued}</td>` +
        `<td>${q.running}</td><td>${q.failed}</td></tr>`,
    )
    .join('')
  return `
    <h2>Artifact Armoury — processing queue alarm</h2>
    <p>Detected at ${escapeHtml(health.checkedAt)}.</p>
    <ul>${rows}</ul>
    <h3>Queues</h3>
    <table cellpadding="6" border="1" style="border-collapse:collapse">
      <tr><th>Queue</th><th>Enabled</th><th>Queued</th><th>Running</th><th>Failed</th></tr>
      ${queueRows}
    </table>
    <p>Live workers: <strong>${health.liveWorkers}</strong> of ${health.workers.length} known.</p>
    <h3>What to check first</h3>
    <ol>
      <li>Is the <code>worker</code> Railway service running? <code>railway logs</code> on it.</li>
      <li>If it is down, restart it — queued jobs resume on their own, nothing is lost.</li>
      <li>Full runbook: "Uploads are stuck at processing" in CLAUDE.md.</li>
    </ol>
    <p><a href="${FRONTEND_URL}/admin/queues">Open the queue dashboard</a></p>
  `
}

/**
 * Compare the live snapshot against the latched state and notify on changes.
 * Only transitions produce noise: newly-opened incidents, incidents old enough
 * to repeat, and recoveries.
 */
async function evaluateAndNotify(): Promise<void> {
  const health = await getQueueHealth()

  const { rows: openRows } = await db.query(
    'SELECT alert_key, last_notified_at FROM queue_alert_state WHERE resolved_at IS NULL',
  )
  const open = new Map<string, Date | null>(
    openRows.map((r: any) => [r.alert_key, r.last_notified_at ? new Date(r.last_notified_at) : null]),
  )
  const current = new Set(health.problems.map((p) => p.key))

  const toNotify = health.problems.filter((p) => {
    if (!open.has(p.key)) return true // brand new incident
    const last = open.get(p.key)
    return !last || Date.now() - last.getTime() > REPEAT_MS // still open, due a reminder
  })

  // Open/refresh rows for everything currently wrong.
  for (const p of health.problems) {
    const notifying = toNotify.some((t) => t.key === p.key)
    await db.query(
      `INSERT INTO queue_alert_state (alert_key, opened_at, last_notified_at, resolved_at, detail)
       VALUES ($1, NOW(), CASE WHEN $2::boolean THEN NOW() ELSE NULL END, NULL, $3)
       ON CONFLICT (alert_key) DO UPDATE
         SET detail = EXCLUDED.detail,
             resolved_at = NULL,
             opened_at = CASE WHEN queue_alert_state.resolved_at IS NOT NULL
                              THEN NOW() ELSE queue_alert_state.opened_at END,
             last_notified_at = CASE WHEN $2::boolean THEN NOW()
                                     ELSE queue_alert_state.last_notified_at END`,
      [p.key, notifying, p.message],
    )
  }

  // Anything previously open and no longer present has recovered.
  const recovered = [...open.keys()].filter((k) => !current.has(k))
  if (recovered.length > 0) {
    await db.query(
      'UPDATE queue_alert_state SET resolved_at = NOW() WHERE alert_key = ANY($1::varchar[])',
      [recovered],
    )
  }

  if (toNotify.length > 0) {
    const critical = toNotify.some((p) => p.severity === 'critical')
    const subject = critical
      ? 'CRITICAL: Artifact Armoury upload processing is down'
      : 'Warning: Artifact Armoury processing queues need attention'

    log.error('Queue alarm firing', {
      problems: toNotify.map((p) => p.key),
      liveWorkers: health.liveWorkers,
    })

    // Email is best-effort by design (services/email.ts swallows failures), so
    // an in-app admin notification goes out too — two channels, since the whole
    // point is not to miss this.
    await sendEmail({ to: SUPPORT_EMAIL, subject, html: alarmEmailHtml(health) })
    await notifyAdminsOfQueueAlarm(
      subject,
      toNotify.map((p) => p.message).join(' — '),
    )
  }

  if (recovered.length > 0) {
    log.info('Queue alarm recovered', { recovered })
    await sendEmail({
      to: SUPPORT_EMAIL,
      subject: 'Resolved: Artifact Armoury processing queues are healthy again',
      html:
        '<h2>Queues recovered</h2><p>These conditions have cleared:</p><ul>' +
        recovered.map((k) => `<li>${escapeHtml(k)}</li>`).join('') +
        `</ul><p><a href="${FRONTEND_URL}/admin/queues">Queue dashboard</a></p>`,
    })
  }
}

export function startQueueAlarmScheduler(): void {
  if (started) return
  if (process.env.DB_MOCK === 'true') return // no DB in mock/dev
  if (String(process.env.QUEUE_ALARM_ENABLED ?? '').toLowerCase() === 'false') {
    log.info('Queue alarm disabled by QUEUE_ALARM_ENABLED=false')
    return
  }
  started = true

  const tick = async () => {
    try {
      const ran = await withAlarmLock(async () => {
        await evaluateAndNotify()
        await pruneStaleHeartbeats()
      })
      if (!ran) log.debug?.('Queue alarm tick skipped — another replica holds the lock')
    } catch (err) {
      log.error('Queue alarm tick failed', { error: err })
    }
  }

  // Delay the first run so a rolling deploy does not alarm on its own restart:
  // the worker needs a moment to come back up and heartbeat before we judge it.
  setTimeout(tick, 90_000).unref?.()
  setInterval(tick, CHECK_INTERVAL_MS).unref?.()
  log.info('Queue alarm scheduler started', { intervalMs: CHECK_INTERVAL_MS, repeatMs: REPEAT_MS })
}
