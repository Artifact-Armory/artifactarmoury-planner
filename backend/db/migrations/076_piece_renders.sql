-- 076_piece_renders.sql
-- A site-generated render of each placeable piece (services/pieceRender.ts), drawn
-- by the worker from the piece's preview GLB. Used in the planner palette when the
-- artist's photo is shared between several pieces (a pack of markers all showing
-- the same pack shot). An artist's own photo still wins where it is specific.
--   render_thumbnail_path  public R2 key of the WebP; NULL = not rendered yet
--   render_failed_at       set when rendering failed, so it isn't retried forever

ALTER TABLE models ADD COLUMN IF NOT EXISTS render_thumbnail_path VARCHAR(500);
ALTER TABLE models ADD COLUMN IF NOT EXISTS render_failed_at TIMESTAMPTZ;
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS render_thumbnail_path VARCHAR(500);
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS render_failed_at TIMESTAMPTZ;
