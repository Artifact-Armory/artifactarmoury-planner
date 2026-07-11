-- 029_source_files.sql
-- Multi-format uploads (STL / OBJ / 3MF). We convert every upload to a canonical
-- STL (used for the fingerprint, preview GLB and per-buyer watermark), but keep
-- the artist's ORIGINAL file and deliver it to the buyer alongside the STL.
--
--   source_format    : 'stl' | 'obj' | '3mf' — the format the artist uploaded.
--   source_file_path : R2 key of the original upload when it isn't STL
--                      (NULL for STL, where stl_file_path already IS the original).

ALTER TABLE models ADD COLUMN IF NOT EXISTS source_format TEXT NOT NULL DEFAULT 'stl';
ALTER TABLE models ADD COLUMN IF NOT EXISTS source_file_path TEXT;

ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS source_format TEXT NOT NULL DEFAULT 'stl';
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS source_file_path TEXT;
