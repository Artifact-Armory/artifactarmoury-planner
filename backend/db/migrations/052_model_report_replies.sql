-- 052_model_report_replies.sql
--
-- Two-way reply thread on a model report / admin action (051 made a direct
-- admin action a model_reports row too, so this covers both). Until now an
-- artist had no way to respond to a moderation decision — resolution_summary
-- was one-shot, admin -> artist, and ArtistReports.tsx just rendered it as
-- read-only text. This lets either side keep talking on the same report.

CREATE TABLE IF NOT EXISTS model_report_replies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id UUID NOT NULL REFERENCES model_reports(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_admin BOOLEAN NOT NULL, -- snapshot at send time: true = an admin sent it, false = the artist
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_model_report_replies_report
  ON model_report_replies(report_id, created_at);

COMMENT ON TABLE model_report_replies IS
  'Reply thread on a model_reports row, either side. is_admin is snapshotted since a user''s role can change later.';
