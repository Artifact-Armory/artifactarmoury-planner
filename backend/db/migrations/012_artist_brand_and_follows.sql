-- Migration 012: artist brand pages + the follow → release-feed → notification loop
--
-- Artists ARE users with role='artist' (there is no separate `artists` table — the
-- old routes/artists.ts queried one that never existed). This adds the brand-page
-- media columns to users, plus the social graph:
--
--   follows        follower (user) → artist (user), the retention engine
--   notifications  in-app notifications (a followed artist's new release, etc.)

ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_avatar_url VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_banner_url VARCHAR(500);

CREATE TABLE IF NOT EXISTS follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, artist_id),
    CHECK (follower_id <> artist_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_artist ON follows(artist_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- recipient
    type     VARCHAR(40) NOT NULL,                                    -- e.g. 'new_release'
    title    VARCHAR(200) NOT NULL,
    body     TEXT,
    link     VARCHAR(500),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,            -- who triggered it (the artist)
    model_id UUID REFERENCES models(id) ON DELETE CASCADE,
    is_read  BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
