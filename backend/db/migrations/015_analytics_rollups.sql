-- Migration 015: daily rollup tables so the artist dashboard queries aggregates,
-- not raw analytics_events rows. Recomputed idempotently by services/analyticsRollup.ts
-- (a DELETE+INSERT per day inside a txn), refreshed for the last couple of days on
-- each dashboard load and fully by a scheduled `npm run rollup:analytics`.

-- Per model, per day: the intent funnel (views/placements/wishlist) + sales.
CREATE TABLE IF NOT EXISTS daily_model_stats (
    day DATE NOT NULL,
    model_id  UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    artist_id UUID REFERENCES users(id) ON DELETE SET NULL,
    views         INTEGER NOT NULL DEFAULT 0,
    placements    INTEGER NOT NULL DEFAULT 0,
    wishlist_adds INTEGER NOT NULL DEFAULT 0,
    units_sold    INTEGER NOT NULL DEFAULT 0,
    gross NUMERIC(12,2) NOT NULL DEFAULT 0,
    net   NUMERIC(12,2) NOT NULL DEFAULT 0,
    PRIMARY KEY (day, model_id)
);

CREATE INDEX IF NOT EXISTS idx_dms_artist_day ON daily_model_stats(artist_id, day);
CREATE INDEX IF NOT EXISTS idx_dms_day ON daily_model_stats(day);

-- Per normalised search query, per day (site-wide): demand + zero-result gaps.
CREATE TABLE IF NOT EXISTS daily_search_terms (
    day DATE NOT NULL,
    query TEXT NOT NULL,
    searches INTEGER NOT NULL DEFAULT 0,
    zero_result_searches INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, query)
);

CREATE INDEX IF NOT EXISTS idx_dst_day ON daily_search_terms(day);
