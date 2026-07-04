-- Migration 010: user_tables (per-account + shareable planner saves)
--
-- The planner persists layouts via routes/tables.ts (mounted at /api/tables),
-- which reads/writes a `user_tables` table — but that table was never added to
-- schema.sql or any migration, so every save/load 500'd in production. This adds
-- it (the pre-existing `tables` table from 001 is a different, legacy shape and
-- is not what routes/tables.ts uses).
--
-- Ownership is email-based (the route trusts user_email); a JWT-auth hardening is
-- a separate follow-up. `is_artist_display` flags an artist's showcase planner —
-- a read-only-to-others table used to display several of their models together.

CREATE TABLE IF NOT EXISTS user_tables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    table_config JSONB NOT NULL,
    layout_data JSONB NOT NULL,
    share_token VARCHAR(64) UNIQUE,
    is_public BOOLEAN DEFAULT false,
    is_artist_display BOOLEAN DEFAULT false,
    view_count INTEGER DEFAULT 0,
    clone_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_tables_email ON user_tables(user_email);
CREATE INDEX IF NOT EXISTS idx_user_tables_share ON user_tables(share_token);
CREATE INDEX IF NOT EXISTS idx_user_tables_public ON user_tables(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_user_tables_artist_display ON user_tables(is_artist_display) WHERE is_artist_display = true;
