-- 080_community_tables.sql
--
-- The Tables page splits into "Artist created tables" and "Community tables".
-- Being public (is_public) only means the share link works; being listed on the
-- Tables page is now a separate choice (is_listed), so a customer who copies a
-- share link for a friend is no longer put on the page without asking.
--
-- Artists' public tables (their showcases) were already on the page on purpose,
-- so they stay listed. Customers' public tables start unlisted; they publish to
-- Community tables from My Tables. Admins can unlist any table.

ALTER TABLE user_tables ADD COLUMN IF NOT EXISTS is_listed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_tables ADD COLUMN IF NOT EXISTS listed_at TIMESTAMP;

UPDATE user_tables ut
SET is_listed = true, listed_at = COALESCE(ut.updated_at, NOW())
FROM users u
WHERE u.email = ut.user_email AND u.role = 'artist' AND ut.is_public = true AND ut.is_listed = false;

CREATE INDEX IF NOT EXISTS idx_user_tables_listed ON user_tables(listed_at DESC) WHERE is_listed = true;
