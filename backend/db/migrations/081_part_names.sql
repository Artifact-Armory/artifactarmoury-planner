-- 081_part_names.sql
--
-- The listing's own first file lives on the models row, not in model_parts, so
-- it had no name of its own and always showed as "Part 1". Give it one, filled
-- from the uploaded file name and renamable by the artist like every other part.
-- Existing listings stay NULL and keep showing "Part 1" until renamed.

ALTER TABLE models ADD COLUMN IF NOT EXISTS primary_part_name VARCHAR(255);
