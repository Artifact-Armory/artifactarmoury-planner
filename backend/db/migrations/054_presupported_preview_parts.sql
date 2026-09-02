-- Migration 054: extend the "clean preview" upload (053) to per-component parts.
--
-- 053 only let an artist attach one support-free preview file for the WHOLE
-- listing (the model's own primary file). A grouped listing ("Small Village" —
-- several independently-named models under one product, migration 038) needs
-- one PER NAMED MODEL: each component's own primary file (its first uploaded
-- part) can independently be flagged pre-supported with its own preview file,
-- so a village of five buildings doesn't collapse into "one preview for the
-- whole heap with no names attached".
--
-- Mirrors 053's models.is_presupported/display_stl_path exactly, but on
-- model_parts. display_stl_path starts out holding the RAW uploaded key (same
-- "starts raw, finalized in place" convention stl_file_path already uses) and
-- is only ever meaningful on a component's first part (group_index's lowest
-- display_order) — every other part in that component keeps rendering from
-- its own print file, same "known v1 limit" as 053.

ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS is_presupported BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS display_stl_path VARCHAR(500);

COMMENT ON COLUMN model_parts.is_presupported IS
  'This part''s print STL already includes supports (only meaningful on a component''s first/primary part). When true, display_stl_path (once processed) drives that part''s preview/owner GLBs instead of stl_file_path.';
COMMENT ON COLUMN model_parts.display_stl_path IS
  'Support-free preview file for this part. Starts as the raw uploaded key, finalized to a canonical STL path during processing (see models.display_stl_path). Never served for download.';
