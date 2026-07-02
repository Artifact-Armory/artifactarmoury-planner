-- Migration: add model columns present in the code/schema but never migrated.
--
-- `fulfillment_type` and `file_hash` exist in src/db/schema.sql and are used by
-- the browse query and the model-upload flow, but the original 001 migration
-- omitted them — so a migrated (production) database lacked them and /api/browse
-- 500'd with "column m.fulfillment_type does not exist". IF NOT EXISTS keeps this
-- safe to re-run and a no-op on databases that already have them.

ALTER TABLE models ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(10) NOT NULL DEFAULT 'print';
ALTER TABLE models ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_models_file_hash ON models(file_hash);
