-- 074_notification_read_at.sql
-- Read notifications are deleted 12 hours after they were read
-- (services/notificationCleanup.ts). That needs the time of reading, which
-- is_read alone doesn't record.

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;

-- Already-read rows have no read time; start their 12 hours now rather than
-- deleting them all on the first sweep after deploy.
UPDATE notifications SET read_at = NOW() WHERE is_read = true AND read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_read_at
  ON notifications(read_at) WHERE read_at IS NOT NULL;
