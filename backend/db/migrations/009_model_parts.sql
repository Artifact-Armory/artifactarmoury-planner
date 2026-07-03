-- Migration 009: multi-part models ("sets")
--
-- A single piece of terrain is often authored as several STL files (e.g. a
-- Gothic Ruin = 4 parts, or one STL per floor). A multi-part model is ONE
-- product / listing / price whose download is a ZIP of all its parts, and whose
-- parts are individually placeable in the planner.
--
-- The model's own stl_file_path/glb_file_path/dims remain "part 1" (primary);
-- additional parts live in model_parts. A model is multi-part when part_count > 1.

CREATE TABLE IF NOT EXISTS model_parts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    name VARCHAR(255),                              -- e.g. "Ground floor"
    stl_file_path VARCHAR(500) NOT NULL,
    glb_file_path VARCHAR(500),
    width DECIMAL(10,2), depth DECIMAL(10,2), height DECIMAL(10,2),  -- mm
    file_hash VARCHAR(64),
    geometry_fingerprint JSONB,
    processing_status VARCHAR(20) DEFAULT 'processing',
    processing_error TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_model_parts_model ON model_parts(model_id);

-- Number of STL files in the product (1 = ordinary single-STL model).
ALTER TABLE models ADD COLUMN IF NOT EXISTS part_count INTEGER NOT NULL DEFAULT 1;
