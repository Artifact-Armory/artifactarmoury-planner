// backend/src/services/notificationCleanup.ts
// Deletes notifications once they have been read for NOTIFICATION_READ_TTL_HOURS
// (default 12). Unread notifications are never deleted. Migration 074.

import { db } from '../db'
import logger from '../utils/logger'

const log = logger.child('NOTIFICATION_CLEANUP')

const READ_TTL_HOURS = Math.max(1, Math.round(Number(process.env.NOTIFICATION_READ_TTL_HOURS) || 12))
const CHECK_INTERVAL_MS = Number(process.env.NOTIFICATION_CLEANUP_INTERVAL_MS || 60 * 60 * 1000) // hourly

export async function deleteExpiredReadNotifications(): Promise<number> {
  const result = await db.query(
    `DELETE FROM notifications
      WHERE read_at IS NOT NULL
        AND read_at < NOW() - make_interval(hours => $1::int)`,
    [READ_TTL_HOURS],
  )
  const n = result.rowCount ?? 0
  if (n > 0) log.info('Deleted read notifications', { rows: n, ttlHours: READ_TTL_HOURS })
  return n
}

/** Catch-up pass shortly after boot, then on a timer. */
export function startNotificationCleanupScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  const tick = () => {
    deleteExpiredReadNotifications().catch(err => log.error('Notification cleanup failed', { error: err }))
  }
  setTimeout(tick, 30_000)
  setInterval(tick, CHECK_INTERVAL_MS)
  log.info('Notification cleanup scheduler started', { intervalMs: CHECK_INTERVAL_MS, ttlHours: READ_TTL_HOURS })
}
