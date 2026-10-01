-- 066_follower_emails.sql
--
-- Emails to followers when an artist they follow releases a model or starts a sale.
--
-- email_follow_updates is the consent switch. Default OFF: nobody gets these emails
-- unless they ticked the optional box at sign-up or switched it on in profile
-- settings (the Privacy Policy promises marketing email only "where you have opted
-- in"). marketing_consent_at records WHEN they last opted in, as evidence of
-- consent. Every email also carries a one-click unsubscribe.
--
-- follower_email_log throttles per (follower, artist, kind) so an artist
-- publishing ten models in one go sends each follower ONE email, not ten. It also
-- gives an audit trail of what was sent to whom.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_follow_updates BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS follower_email_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('release', 'sale')),
    sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_follower_email_log_lookup
    ON follower_email_log (follower_id, artist_id, kind, sent_at DESC);
