-- 075_table_thumbnails.sql
-- A rendered image of the table itself, captured by the planner on save
-- (frontend ui/tableSnapshot.ts) and uploaded through POST /api/tables/:id/thumbnail.
-- NULL = never captured; cards fall back to the placed models' thumbnails.

ALTER TABLE user_tables ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR(500);
