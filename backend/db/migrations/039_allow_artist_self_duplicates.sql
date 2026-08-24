-- Migration 039: an artist may upload the same model more than once
--
-- Dedup exists to stop THEFT — someone re-uploading another artist's file. It was
-- also blocking the original artist from listing their own piece twice, which is a
-- legitimate thing to want: sell a watchtower on its own AND as part of a "Small
-- Village" set. The application-level checks now exempt the uploader's own models
-- (a match against ANOTHER artist is still rejected), so the hard UNIQUE constraint
-- on file_hash has to go with them — otherwise the second upload dies on a
-- constraint violation with an unreadable Postgres error instead of being allowed.
--
-- The column keeps a plain (non-unique) index: dedup still looks up by hash on
-- every upload, it just no longer demands global uniqueness.
--
-- Both spellings are dropped because the constraint's origin differs by how the DB
-- was created: schema.sql declares `file_hash VARCHAR(64) UNIQUE` (constraint
-- models_file_hash_key), while migration 006 created a unique INDEX of its own.

ALTER TABLE models DROP CONSTRAINT IF EXISTS models_file_hash_key;
DROP INDEX IF EXISTS idx_models_file_hash;
CREATE INDEX IF NOT EXISTS idx_models_file_hash ON models(file_hash);
