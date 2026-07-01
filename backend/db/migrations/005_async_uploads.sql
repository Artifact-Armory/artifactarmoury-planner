-- Migration: async seller upload pipeline
--
-- Sellers now upload the raw STL directly to R2 (presigned PUT), then a
-- background job downloads it, runs STL->GLB + geometry analysis, and writes
-- the derived assets back. `processing_status` tracks that pipeline separately
-- from `status` (which stays the moderation/visibility state: draft/published/…).

ALTER TABLE models ADD COLUMN IF NOT EXISTS processing_status VARCHAR(20) DEFAULT 'ready'
  CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed'));
ALTER TABLE models ADD COLUMN IF NOT EXISTS processing_error TEXT;

-- Existing rows are already fully processed.
UPDATE models SET processing_status = 'ready' WHERE processing_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_models_processing_status ON models(processing_status);
