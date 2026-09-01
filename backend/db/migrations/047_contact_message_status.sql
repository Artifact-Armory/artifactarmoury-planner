-- 047_contact_message_status.sql
--
-- Admin inbox for the Contact page (043_contact_messages.sql). Until now,
-- contact_messages was a write-only log — the only way to read one was
-- `npm run db:query`. Adds the minimum an inbox needs: an unread flag (for
-- the "N new" nav badge) and an open/resolved status an admin can toggle.

ALTER TABLE contact_messages
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved')),
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status);
CREATE INDEX IF NOT EXISTS idx_contact_messages_unread ON contact_messages(is_read) WHERE is_read = false;

COMMENT ON COLUMN contact_messages.is_read IS 'Set true the first time an admin opens the message in the admin inbox.';
COMMENT ON COLUMN contact_messages.status IS 'open = needs attention (default), resolved = an admin marked it handled.';
