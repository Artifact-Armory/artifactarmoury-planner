-- Migration 014: analytics_events — the event spine for artist analytics.
--
-- "You can't backfill events you never logged." This captures the intent signals
-- the dashboard is built on, with timestamps, so history accrues from day one:
--   product_view      a model detail page was viewed
--   search_query      a site search ran (with result_count → zero-result gaps)
--   planner_placement a model/part was dropped onto a planner table (purchase intent)
--   wishlist_add      a model was favourited/wishlisted
--
-- Denormalised artist_id so an artist's dashboard queries stay single-table.
-- Aggregate-only on the customer side — user_id/session are for funnels/dedup, never
-- exposed to artists. Rollup tables (migration TBD) will summarise this daily.

CREATE TABLE IF NOT EXISTS analytics_events (
    id BIGSERIAL PRIMARY KEY,
    type VARCHAR(40) NOT NULL,
    model_id  UUID REFERENCES models(id) ON DELETE SET NULL,
    artist_id UUID REFERENCES users(id) ON DELETE SET NULL,   -- denormalised owner
    user_id   UUID REFERENCES users(id) ON DELETE SET NULL,   -- actor (null for guests)
    session_id VARCHAR(64),                                    -- anonymous session (funnel/dedup)
    query TEXT,                                                 -- search_query text
    result_count INTEGER,                                      -- search_query result count
    source VARCHAR(30),                                        -- 'search' | 'category' | 'planner' | 'external' | 'direct'
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Artist dashboard: "my events of type X over a date range".
CREATE INDEX IF NOT EXISTS idx_ae_artist_type_time ON analytics_events(artist_id, type, created_at DESC);
-- Per-model funnels.
CREATE INDEX IF NOT EXISTS idx_ae_model_type_time ON analytics_events(model_id, type, created_at DESC);
-- Site-wide search analytics (top/zero-result queries).
CREATE INDEX IF NOT EXISTS idx_ae_type_time ON analytics_events(type, created_at DESC);
