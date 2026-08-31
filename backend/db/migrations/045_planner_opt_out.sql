-- 045_planner_opt_out.sql
--
-- Not every listing belongs on the 3D table planner — a misc item (a paint brush
-- holder, a display base, a tool) isn't terrain/vehicle/character scenery and an
-- artist may not want it offered as a placeable piece at all. Adds an artist-level
-- opt-out, independent of category/model-class.
--
-- Defaults to TRUE so every existing model keeps appearing in the planner exactly
-- as it does today — this is an opt-OUT, not an opt-in, so the rollout changes
-- nothing until an artist actually flips it off.

ALTER TABLE models
  ADD COLUMN IF NOT EXISTS show_in_planner BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN models.show_in_planner IS
  'Whether this model may be placed on the 3D table planner. Artist-controlled, independent of category/model-class — lets a misc listing (paint brush holder, display base, etc.) stay out of the planner catalogue while still selling normally on the marketplace. Default true (opt-out, not opt-in).';

CREATE INDEX IF NOT EXISTS idx_models_show_in_planner ON models(show_in_planner) WHERE show_in_planner = false;
