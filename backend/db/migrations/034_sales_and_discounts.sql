-- 034_sales_and_discounts.sql
-- Temporary sales/discounts an artist runs on a single model, a single bundle, or
-- their whole portfolio. Capped at 14 days each and rate-limited by a cooldown so
-- nobody can sit on the front-page "On sale" carousel permanently.
--
-- Guard rails (enforced in routes/sales.ts + here):
--   * duration <= 14 days                          (CHECK below)
--   * discount 5–90%                               (CHECK below)
--   * one active/upcoming sale per target          (partial unique index)
--   * cooldown after a sale ends                   (app logic)
--   * no discounting a just-inflated price         (app logic, uses price_history)

CREATE TABLE IF NOT EXISTS sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- What the sale covers. target_id is a model or bundle id; NULL for a
    -- portfolio-wide sale (covers all the artist's published models + bundles).
    scope TEXT NOT NULL CHECK (scope IN ('model', 'bundle', 'portfolio')),
    target_id UUID,
    discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 5 AND 90),
    starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at TIMESTAMP NOT NULL,
    canceled_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK (ends_at > starts_at),
    CHECK (ends_at <= starts_at + INTERVAL '14 days'),
    -- portfolio sales have no target; model/bundle sales require one
    CHECK ((scope = 'portfolio' AND target_id IS NULL) OR (scope <> 'portfolio' AND target_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_sales_artist ON sales(artist_id);
CREATE INDEX IF NOT EXISTS idx_sales_active ON sales(starts_at, ends_at) WHERE canceled_at IS NULL;

-- At most one live (not-canceled, not-ended) sale per exact scope+target. Uses a
-- COALESCE so portfolio sales (target NULL) are also de-duplicated per artist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_one_live_per_target
    ON sales (artist_id, scope, COALESCE(target_id, artist_id))
    WHERE canceled_at IS NULL;

-- Price history for models AND bundles, so a sale's "was" price can't be gamed by
-- inflating the list price right before discounting it. A row is written whenever
-- a price is set or changed.
CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('model', 'bundle')),
    entity_id UUID NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_price_history_entity
    ON price_history(entity_type, entity_id, recorded_at DESC);

COMMENT ON TABLE sales IS 'Temporary artist discounts (model/bundle/portfolio), max 14 days, cooldown-limited (migration 034).';
COMMENT ON TABLE price_history IS 'Model/bundle list-price history — backs the anti-inflation guard on sales.';
