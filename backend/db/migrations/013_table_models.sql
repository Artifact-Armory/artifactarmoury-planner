-- Migration 013: table_models — denormalised link between a saved table and the
-- models it places, powering the cross-linking web:
--   • "Featured in N tables" on a model
--   • table → pieces → artists, with multi-artist BOM credit
--
-- Tables store their layout as a JSON blob (user_tables.layout_data.models), which
-- can't be indexed or reverse-queried. This join table is kept in sync on every
-- table save (services/tableModels.ts) and backfilled once from existing layouts.

CREATE TABLE IF NOT EXISTS table_models (
    table_id  UUID NOT NULL REFERENCES user_tables(id) ON DELETE CASCADE,
    model_id  UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    artist_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (table_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_table_models_model ON table_models(model_id);
CREATE INDEX IF NOT EXISTS idx_table_models_artist ON table_models(artist_id);

-- One-off backfill from existing layouts. Each layout element carries a modelId or
-- assetId; part refs like 'part:<uuid>' never match a models.id::text, so they're
-- skipped naturally by the join.
INSERT INTO table_models (table_id, model_id, artist_id)
SELECT DISTINCT ut.id, m.id, m.artist_id
FROM user_tables ut
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ut.layout_data->'models', '[]'::jsonb)) AS elem
JOIN models m
  ON m.id::text = COALESCE(NULLIF(elem->>'modelId', ''), elem->>'assetId')
ON CONFLICT DO NOTHING;
