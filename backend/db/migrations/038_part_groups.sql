-- Migration 038: component groups inside a multi-part model
--
-- 009 gave a listing a flat list of STL parts ("Gothic Ruin" = 4 files). That
-- isn't enough for artists selling a *collection* as one product — e.g. a
-- "Small Village" made of a Village Tower (3 parts), a Tavern (2 parts) and a
-- Well (1 part). The listing is still ONE product / price / purchase, but its
-- files now belong to named COMPONENTS ("included models").
--
--   group_index : which component a part belongs to. 0 = the component that
--                 owns the model's own primary STL; 1..N = later components.
--   group_name  : that component's display name ("Village Tower"). Repeated on
--                 every part of the group so a part row is self-describing.
--   models.primary_group_name : the name of component 0 (the primary file's
--                 component). NULL = the listing isn't grouped (plain set), in
--                 which case the model name is used as the component label.
--
-- Grouping by explicit index (not by name) means two components may legitimately
-- share a name without merging.

ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS group_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS group_name VARCHAR(255);

ALTER TABLE models ADD COLUMN IF NOT EXISTS primary_group_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_model_parts_group ON model_parts(model_id, group_index, display_order);
