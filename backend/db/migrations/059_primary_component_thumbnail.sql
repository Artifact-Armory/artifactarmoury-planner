-- Migration 059: a separate planner thumbnail for the listing's own primary
-- model (component/group_index 0), distinct from the listing's main STORE
-- thumbnail (models.thumbnail_path).
--
-- 058 gave every OTHER named component its own planner thumbnail, but group 0
-- has no model_parts row to hang one off, so it fell back to reusing
-- models.thumbnail_path for both jobs. That's wrong in practice: the store
-- thumbnail is often a hero shot of the WHOLE set together (all N models in
-- one photo), not a picture of model 1 specifically — placing model 1 alone
-- in the planner then showed the group photo, not model 1. This gives group 0
-- its own field, same "optional, falls back to the listing thumbnail if unset"
-- treatment every other component already gets.

ALTER TABLE models ADD COLUMN IF NOT EXISTS primary_thumbnail_path VARCHAR(500);

COMMENT ON COLUMN models.primary_thumbnail_path IS
  'Optional planner thumbnail for the listing''s own primary model (group_index 0), separate from thumbnail_path (the store page''s main image, which is often a group shot of every model together). Falls back to thumbnail_path when unset.';
