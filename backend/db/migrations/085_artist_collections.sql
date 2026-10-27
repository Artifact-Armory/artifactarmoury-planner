-- 085_artist_collections.sql
--
-- Collections: named groups inside an artist's store ("WW2 buildings") so buyers
-- can browse one range instead of the whole catalogue. Browsing only: nothing is
-- sold as a collection (that's what bundles are for). A listing can sit in any
-- number of the artist's collections. The slug is unique per artist and gives
-- each collection its own URL: /artists/:artistId/collections/:slug.

CREATE TABLE IF NOT EXISTS artist_collections (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(80) NOT NULL,
    slug        VARCHAR(100) NOT NULL,
    description TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (artist_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_artist_collections_artist
    ON artist_collections (artist_id, position);

CREATE TABLE IF NOT EXISTS artist_collection_models (
    collection_id UUID NOT NULL REFERENCES artist_collections(id) ON DELETE CASCADE,
    model_id      UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_artist_collection_models_model
    ON artist_collection_models (model_id);
