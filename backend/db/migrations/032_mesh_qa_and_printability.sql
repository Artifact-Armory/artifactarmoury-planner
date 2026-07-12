-- 032_mesh_qa_and_printability.sql
-- Two related additions that attack the "unprintable file" complaint class:
--
--  1. PRINTABILITY METADATA (artist-declared). `supports_required`,
--     `recommended_layer_height` and `recommended_infill` already exist (001).
--     Add `printer_type` so a listing states whether it's authored for FDM, resin
--     or both — matters most for resin-oriented character sculpts.
--
--  2. MESH QA (automatic). At upload we already parse the STL for the fingerprint
--     and preview; the same triangles let us check the mesh is watertight/manifold
--     cheaply. Results are advisory (they never block an upload) but warn the
--     artist and let buyers see a "clean mesh" signal.

-- Printer authoring target.
ALTER TABLE models ADD COLUMN IF NOT EXISTS printer_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'models_printer_type_check') THEN
    ALTER TABLE models
      ADD CONSTRAINT models_printer_type_check
      CHECK (printer_type IS NULL OR printer_type IN ('fdm', 'resin', 'both'));
  END IF;
END $$;

-- Automated mesh-quality results (advisory).
ALTER TABLE models ADD COLUMN IF NOT EXISTS mesh_analyzed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE models ADD COLUMN IF NOT EXISTS mesh_is_watertight BOOLEAN;
ALTER TABLE models ADD COLUMN IF NOT EXISTS mesh_is_manifold BOOLEAN;
ALTER TABLE models ADD COLUMN IF NOT EXISTS mesh_triangle_count INTEGER;
ALTER TABLE models ADD COLUMN IF NOT EXISTS mesh_open_edges INTEGER;
ALTER TABLE models ADD COLUMN IF NOT EXISTS mesh_report JSONB;

COMMENT ON COLUMN models.printer_type IS 'Artist-declared authoring target: fdm | resin | both. NULL = unspecified.';
COMMENT ON COLUMN models.mesh_report IS 'Full mesh-QA result (services/meshQA.ts): counts, open/non-manifold edges, status.';
