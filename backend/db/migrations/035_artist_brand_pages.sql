-- Migration 035: richer artist brand pages
--
-- Lets an artist really sell their brand on their public profile:
--   * a custom full-page background image + an accent colour, on top of the
--     existing banner/avatar (migration 012)
--   * a hand-picked, ordered set of "featured" models that render in a carousel
--     above the rest of their catalogue
--
-- Their published showcase tables are surfaced by a new query in routes/artists.ts
-- (joining user_tables on email) — no schema change needed for that.

ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_background_url VARCHAR(500);
-- Hex accent colour like '#4f46e5' (theme for buttons/headings on the brand page).
ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_accent_color VARCHAR(9);

-- The featured-models carousel: an ordered subset of the artist's own models.
CREATE TABLE IF NOT EXISTS artist_featured_models (
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_id  UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (artist_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_artist_featured_models
    ON artist_featured_models(artist_id, position);
