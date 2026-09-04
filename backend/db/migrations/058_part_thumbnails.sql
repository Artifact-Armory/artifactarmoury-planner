-- Migration 058: per-component thumbnail for a grouped/multi-part listing.
--
-- models.thumbnail_path is the ONE image shown on the store/browse page for
-- the whole listing. A grouped listing ("Small Village" — several named
-- models under one product) had no way to show a buyer which visual goes
-- with which named component once they're all placeable individually in the
-- planner — every part rendered with the same generic icon. This adds one
-- optional thumbnail per COMPONENT (group_index), not per file: only
-- meaningful on a component's first/primary part (same "first file
-- represents the component" convention 054's is_presupported/display_stl_path
-- already uses). The listing's own primary component (group_index 0) has no
-- model_parts row for its own file, so it keeps using models.thumbnail_path
-- as its planner thumbnail too — no separate column needed there.

ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR(500);

COMMENT ON COLUMN model_parts.thumbnail_path IS
  'Optional per-component thumbnail, shown in the planner palette so a buyer can tell this named component apart from the others in the set. Only meaningful on a component''s first/primary part (lowest display_order within its group_index) — every other part in that component has no thumbnail of its own.';
