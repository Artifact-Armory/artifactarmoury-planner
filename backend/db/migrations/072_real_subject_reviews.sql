-- 072_real_subject_reviews.sql
-- Scale models of real-world subjects (a Tiger I, a Spitfire, HMS Hood, a real
-- building) can legitimately look alike when two artists model the same thing
-- independently. An artist now ticks "scale model of a real-world subject" at
-- upload; when such an upload matches ANOTHER artist's model on geometry, it is
-- allowed through instead of rejected, and a row lands here for an admin to
-- compare the two and clear or take down the upload. A byte-identical file
-- (SHA-256) is still rejected outright — independent work is never that.

ALTER TABLE models ADD COLUMN IF NOT EXISTS is_real_subject BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS geometry_match_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- The upload that was let through.
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    -- The other artist's model it matched.
    matched_model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    -- Score on the fingerprint's scale (<= 1 = match) + per-component distances.
    score NUMERIC(8, 4) NOT NULL,
    distances JSONB,
    -- Which file matched, when it was not the listing's own primary file.
    file_label VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cleared', 'taken_down')),
    resolution_note TEXT,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- One open review per pair: a multi-part upload whose files all match the same
-- model produces one row, not one per file.
CREATE UNIQUE INDEX IF NOT EXISTS idx_geometry_match_reviews_open_pair
    ON geometry_match_reviews(model_id, matched_model_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_geometry_match_reviews_status ON geometry_match_reviews(status, created_at DESC);
