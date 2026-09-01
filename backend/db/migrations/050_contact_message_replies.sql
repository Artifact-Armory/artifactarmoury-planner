-- 050_contact_message_replies.sql
--
-- In-app reply for the admin Contact inbox (047_contact_message_status.sql).
-- Until now the only "reply" action was a mailto: link, which opens the admin's
-- own desktop email client under their personal address instead of support@.
-- This adds a real reply path: the admin types into the inbox, the backend sends
-- it via Resend as support@artifactarmoury.com (services/email.ts's
-- sendContactReply), and the sent text is kept here so the thread is visible to
-- any admin who opens the message later.

CREATE TABLE IF NOT EXISTS contact_message_replies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_message_id UUID NOT NULL REFERENCES contact_messages(id) ON DELETE CASCADE,
    admin_id UUID REFERENCES users(id) ON DELETE SET NULL, -- who sent it; kept even if their account is later deleted
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contact_message_replies_message
  ON contact_message_replies(contact_message_id, created_at);

COMMENT ON TABLE contact_message_replies IS
  'Replies sent from the admin Contact inbox, one row per send. The email itself always goes out from SUPPORT_EMAIL, never the admin''s own address.';
