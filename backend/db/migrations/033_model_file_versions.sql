-- 033_model_file_versions.sql
-- File versioning. Artists fix/improve models after release constantly; buyers
-- own a model (not a specific version), so a new file should be a free
-- re-download plus a notification — not a new purchase.
--
--   file_version     : bumps each time the artist publishes a new file (starts 1).
--   version_notes    : changelog for the LATEST version (shown on the listing).
--   files_updated_at  : when the files were last replaced (NULL = never updated).
--
-- Full history lives in model_versions so a listing can show a changelog and a
-- buyer can see what changed since they bought.

ALTER TABLE models ADD COLUMN IF NOT EXISTS file_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE models ADD COLUMN IF NOT EXISTS version_notes TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS files_updated_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS model_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (model_id, version)
);

CREATE INDEX IF NOT EXISTS idx_model_versions_model ON model_versions(model_id, version DESC);

COMMENT ON COLUMN models.file_version IS 'Increments each time the artist replaces the model files (starts at 1).';
COMMENT ON TABLE model_versions IS 'Per-model file version history / changelog (migration 033).';
