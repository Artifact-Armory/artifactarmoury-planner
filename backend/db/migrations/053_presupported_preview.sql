-- Migration 053: optional "clean preview" file for pre-supported models.
--
-- An artist whose print STL already has supports built in (a "pre-supported"
-- file, common for resin printers) can tick a box at upload and separately
-- attach a support-free STL. That file — NOT the print STL — becomes the
-- source for BOTH the public preview GLB and the buyer's owner-tier full GLB
-- (migration 041), so nobody sees a forest of support struts in the
-- marketplace card or the 3D planner. The print STL itself is completely
-- untouched and is still exactly what buyers download.

ALTER TABLE models ADD COLUMN IF NOT EXISTS is_presupported BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE models ADD COLUMN IF NOT EXISTS display_stl_path VARCHAR(500);

COMMENT ON COLUMN models.is_presupported IS
  'Artist has flagged the print STL as already including supports. When true, display_stl_path (if set) drives the preview/owner GLBs instead of stl_file_path.';
COMMENT ON COLUMN models.display_stl_path IS
  'Canonical STL of an optional support-free preview file (set only when is_presupported). Source for glb_file_path/full_glb_path in that case. Never served for download — the print file (stl_file_path) is what buyers get.';
