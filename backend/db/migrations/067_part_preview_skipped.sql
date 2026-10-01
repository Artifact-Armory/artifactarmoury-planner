-- 067_part_preview_skipped.sql
--
-- A named model whose artist uploaded a PREVIEW file (the pre-assembled, one-piece
-- version of its print files) is placed in the planner as that single asset. Its
-- other part files are download-only: they stay in the buyer's ZIP, but baking
-- them, building owner/LOD GLBs for them and offering them as placeable pieces
-- would be wasted work for meshes that can never appear on the table.
--
-- preview_skipped = true marks such a part. It is still deduped (anti-theft is
-- unaffected), hashed, fingerprinted and downloadable; it just never gets a
-- preview GLB, a bake job or a full-GLB job, and /api/models/sets leaves it (and
-- its siblings' completeness check) out.
--
-- An artist who WANTS the parts placeable separately as well opts out at upload
-- time, in which case nothing is marked and the old behaviour applies.

ALTER TABLE model_parts
  ADD COLUMN IF NOT EXISTS preview_skipped BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN model_parts.preview_skipped IS
  'Download-only part: a sibling preview file stands in for its whole named model on the planner (migration 067). No GLB/bake/full-GLB is built for it.';
