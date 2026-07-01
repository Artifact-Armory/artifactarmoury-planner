-- Populate asset dimensions from models table
UPDATE assets a
SET 
  width = m.width,
  depth = m.depth,
  height = m.height
FROM models m
WHERE a.file_ref = m.stl_file_path
  AND (a.width IS NULL OR a.depth IS NULL OR a.height IS NULL);

