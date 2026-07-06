-- Migration 016: scheduled releases ("drops")
--
-- An artist groups their models (incl. multi-part sets), bundles, and tables
-- under a named Release with one go-live time. When that time arrives an
-- in-process scheduler publishes every item together (models/bundles → public,
-- tables → is_public). Until then the items stay draft/private as normal, so an
-- artist can load up a big batch and release it all at once.

CREATE TABLE IF NOT EXISTS releases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    scheduled_at TIMESTAMPTZ,                        -- when to publish; NULL while drafting
    status VARCHAR(20) NOT NULL DEFAULT 'draft',     -- draft | scheduled | published | cancelled
    published_at TIMESTAMPTZ,
    publish_error TEXT,                              -- last failure (if any) at fire time
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_releases_artist ON releases(artist_id);
-- The scheduler polls for due releases: WHERE status='scheduled' AND scheduled_at <= now().
CREATE INDEX IF NOT EXISTS idx_releases_due ON releases(status, scheduled_at);

-- A release's members. Polymorphic (model | bundle | table) so there's no single
-- FK target; the API validates ownership on add and the scheduler skips any item
-- that has since been deleted. `published` records per-item success at fire time.
CREATE TABLE IF NOT EXISTS release_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    release_id UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    item_type VARCHAR(16) NOT NULL,                 -- model | bundle | table
    item_id UUID NOT NULL,
    published BOOLEAN NOT NULL DEFAULT false,
    publish_error TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (release_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_release_items_release ON release_items(release_id);
