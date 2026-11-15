-- 088_turntables.sql
-- Spin-around view on the product page (services/pieceRender.ts renderTurntable,
-- services/turntableBackfill.ts). The worker draws each model's OWNER GLB (no
-- logo, not decimated like the public preview) from 36 angles into one WebP
-- sheet; the product page swaps pictures as the buyer drags. Only pictures are
-- published, never 3D data.
--   turntable_path       public R2 key of the sheet; NULL = none (yet)
--   turntable_key        what the sheet was drawn from (hash of the owner GLB key
--                        + default tilt). The worker redraws when it no longer
--                        matches, e.g. after a new file version or a tilt change.
--   turntable_failed_at  set when drawing failed for the current turntable_key

ALTER TABLE models ADD COLUMN IF NOT EXISTS turntable_path VARCHAR(500);
ALTER TABLE models ADD COLUMN IF NOT EXISTS turntable_key VARCHAR(64);
ALTER TABLE models ADD COLUMN IF NOT EXISTS turntable_failed_at TIMESTAMPTZ;
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS turntable_path VARCHAR(500);
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS turntable_key VARCHAR(64);
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS turntable_failed_at TIMESTAMPTZ;
