-- Migration: geometry fingerprint for re-upload / theft detection.
--
-- A rotation/scale/tessellation-invariant shape descriptor (see
-- services/fingerprint.ts) stored per model. On upload we compare a new model's
-- fingerprint against existing ones to catch re-uploads even when the file was
-- re-exported to dodge the exact-hash check. Never modifies the model file.

ALTER TABLE models ADD COLUMN IF NOT EXISTS geometry_fingerprint JSONB;
