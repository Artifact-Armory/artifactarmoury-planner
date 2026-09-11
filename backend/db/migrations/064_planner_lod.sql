-- 064_planner_lod.sql
--
-- PLANNER LOD — a third variant of the preview mesh, for the 3D planner.
--
-- THE PROBLEM. Until now the planner has drawn the same GLB the product page
-- draws: the public preview proxy. That file is sized for looking at ONE piece
-- on its own page, where several hundred thousand triangles is defensible. The
-- planner lays out a whole table. A real artist showcase measured at 28 distinct
-- models, 84.9 MB of downloads and roughly 8.5 million triangles on the table,
-- which is where its ~9-second open and its framerate went.
--
-- WHY THIS COULD NOT BE BUILT BEFORE. Not for want of trying to decimate —
-- proxyDecimationEnabled and its adaptive budget have been in the bake pipeline
-- all along. The blocker was that the proxy shipped FLAT-SHADED. An STL has no
-- vertex normals, so Blender imports it flat, and a flat-shaded mesh cannot share
-- a vertex between two triangles: each one needs its own copy carrying the face
-- normal. Measured on a live marketplace proxy: 332,191 triangles stored as
-- 957,595 vertices over only 172,652 unique positions. With every edge a seam
-- there is nothing left to collapse, and meshopt simply refuses — asked for 33%
-- of a real bake it returned 91-95% of the triangles. Crease shading
-- (proxyCreaseAngleDeg, added the same week as this migration) is what restores
-- the shared edges and makes simplification possible at all.
--
-- WHAT THESE COLUMNS HOLD. The R2 key of the LOD GLB, built by the bake worker
-- from the same Blender output as the proxy (services/proxyBake/lod.ts) and
-- served by GET /api/models/:id/preview.glb?variant=lod.
--
-- NULL is a normal, expected state, not a failure:
--   * every model baked before this migration (their proxies are flat-shaded and
--     cannot be derived from at all — backfilling them means RE-BAKING, not
--     re-processing);
--   * a model whose proxy is already at or under the LOD triangle budget;
--   * a model whose topology defeats the simplifier (many disconnected shells,
--     so the union of its UV and crease seams leaves nothing collapsible).
-- In every one of those cases the planner falls back to glb_file_path, which is
-- exactly what it loaded before this existed.
--
-- THE KEY IS A SECRET, like full_glb_path (041) and display_stl_path (053/054).
-- The R2 bucket is public through the CDN and model ids are public, so the key
-- carries 16 random bytes and must never be returned by any API — not in a model
-- payload, not in an admin payload, not even inside the preview route's ETag
-- (which hashes it). Do not "helpfully" expose this column.

ALTER TABLE models
  ADD COLUMN IF NOT EXISTS lod_glb_path VARCHAR(500);

ALTER TABLE model_parts
  ADD COLUMN IF NOT EXISTS lod_glb_path VARCHAR(500);

COMMENT ON COLUMN models.lod_glb_path IS
  'R2 key of the planner-specific LOD GLB (migration 064). NULL = planner falls back to glb_file_path. Unguessable key — never return it from an API.';
COMMENT ON COLUMN model_parts.lod_glb_path IS
  'R2 key of this part''s planner LOD GLB (migration 064). See models.lod_glb_path.';
