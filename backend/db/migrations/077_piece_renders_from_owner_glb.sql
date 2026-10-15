-- 077_piece_renders_from_owner_glb.sql
-- 076's renders were drawn from the public preview proxy, which carries the
-- embossed watermark. Renders now come from the owner GLB; clear the old ones
-- (and any failures) so the worker draws them again.

UPDATE models SET render_thumbnail_path = NULL, render_failed_at = NULL
 WHERE render_thumbnail_path IS NOT NULL OR render_failed_at IS NOT NULL;
UPDATE model_parts SET render_thumbnail_path = NULL, render_failed_at = NULL
 WHERE render_thumbnail_path IS NOT NULL OR render_failed_at IS NOT NULL;
