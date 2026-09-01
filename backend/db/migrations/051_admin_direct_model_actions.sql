-- 051_admin_direct_model_actions.sql
--
-- Lets an admin act on a model directly from the Models admin page (unpublish,
-- flag, remove, refund buyers, warn, reinstate) without a user having filed a
-- report first. Rather than build a second notification/audit path, a direct
-- action is recorded as an ordinary model_reports row with reporter_id NULL and
-- this new reason, then resolved through the exact same action logic the
-- report-moderation queue already uses (routes/admin.ts's resolveReport()) — so
-- it shows up in the moderation history, and the artist sees the admin's
-- required message on their existing /artist/reports page, with no new
-- artist-facing UI needed.

ALTER TABLE model_reports DROP CONSTRAINT IF EXISTS model_reports_reason_check;
ALTER TABLE model_reports ADD CONSTRAINT model_reports_reason_check CHECK (reason IN (
    'copyright', 'offensive', 'not_as_advertised', 'no_printed_photo', 'broken_file', 'other',
    'admin_action'
));

COMMENT ON COLUMN model_reports.reason IS
  'admin_action = created by an admin acting directly on a model (Models admin page fast actions), not filed by a user. reporter_id is NULL for these.';
