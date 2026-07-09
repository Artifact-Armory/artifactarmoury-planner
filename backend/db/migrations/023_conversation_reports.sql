-- Migration 023: conversation reports
--
-- A participant can report a direct conversation (e.g. harassment, threats, scam).
-- Reporting CAPTURES A SNAPSHOT of the conversation at report time into `snapshot`
-- (JSONB) so admins review exactly what was reported even if messages are later
-- changed/deleted or the conversation row is removed. Admins triage in a queue and
-- can act on the reported user (warn / shadow-ban / suspend / ban).

CREATE TABLE IF NOT EXISTS conversation_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- SET NULL (not CASCADE) so a report survives the conversation being deleted —
    -- the evidence lives in `snapshot`, not the live thread.
    conversation_id  UUID REFERENCES conversations(id) ON DELETE SET NULL,
    reporter_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    reported_user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- the other participant

    reason VARCHAR(30) NOT NULL CHECK (reason IN (
        'harassment', 'threats', 'hate_speech', 'spam', 'scam', 'other'
    )),
    detail TEXT,

    -- { messages: [{ id, senderId, senderName, isSystem, body, createdAt }],
    --   reporterName, reportedUserName, capturedAt }
    snapshot JSONB NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'under_review', 'resolved_upheld', 'resolved_dismissed'
    )),

    resolution_action  VARCHAR(30),
    resolution_summary TEXT,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conv_reports_status ON conversation_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_reports_reporter ON conversation_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_conv_reports_reported ON conversation_reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_conv_reports_conversation ON conversation_reports(conversation_id);

-- One open report per (reporter, conversation): stops duplicate spam while a report is
-- live, but lets a user re-report after the previous one is resolved.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_reports_reporter_conv_open
    ON conversation_reports(reporter_id, conversation_id)
    WHERE status IN ('open', 'under_review');
