-- 078_piece_renders_redo.sql
-- 077 cleared the watermarked renders, but it ran (API pre-deploy) while the
-- worker was still on 076's code, which redrew them from the watermarked proxy
-- within minutes. The worker now renders from the owner GLB, so clear once more.

UPDATE models SET render_thumbnail_path = NULL, render_failed_at = NULL
 WHERE render_thumbnail_path IS NOT NULL OR render_failed_at IS NOT NULL;
UPDATE model_parts SET render_thumbnail_path = NULL, render_failed_at = NULL
 WHERE render_thumbnail_path IS NOT NULL OR render_failed_at IS NOT NULL;
