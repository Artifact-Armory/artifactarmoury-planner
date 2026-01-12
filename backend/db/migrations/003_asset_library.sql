-- Asset Library schema extensions

-- Anonymous sessions for unauthenticated builders
CREATE TABLE IF NOT EXISTS anonymous_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_token UUID NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    table_limit INTEGER DEFAULT 3 CHECK (table_limit >= 0)
);

CREATE INDEX IF NOT EXISTS idx_anonymous_sessions_token
    ON anonymous_sessions(session_token);

-- Core asset catalogue (selective)
CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    tags TEXT[],
    file_ref VARCHAR(500) NOT NULL,
    glb_file_path VARCHAR(500),
    preview_url VARCHAR(500),
    thumbnail_path VARCHAR(500),
    base_price DECIMAL(10,2) DEFAULT 0,
    width DECIMAL(10,2),
    depth DECIMAL(10,2),
    height DECIMAL(10,2),
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    visibility VARCHAR(20) DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
    view_count INTEGER DEFAULT 0,
    add_count INTEGER DEFAULT 0,
    use_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_visibility ON assets(visibility);
CREATE INDEX IF NOT EXISTS idx_assets_tags ON assets USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_assets_artist ON assets(artist_id);

-- Asset sets (curated collections)
CREATE TABLE IF NOT EXISTS asset_sets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_asset_sets_owner ON asset_sets(owner_id);

CREATE TABLE IF NOT EXISTS asset_set_items (
    set_id UUID REFERENCES asset_sets(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (set_id, asset_id)
);

-- Assets attached to a specific table layout
CREATE TABLE IF NOT EXISTS table_assets (
    table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB,
    PRIMARY KEY (table_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_table_assets_table ON table_assets(table_id);
CREATE INDEX IF NOT EXISTS idx_table_assets_asset ON table_assets(asset_id);

-- Sets linked to tables
CREATE TABLE IF NOT EXISTS table_sets (
    table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
    set_id UUID REFERENCES asset_sets(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (table_id, set_id)
);

CREATE INDEX IF NOT EXISTS idx_table_sets_table ON table_sets(table_id);

-- Track recent asset usage to power recommendations
CREATE TABLE IF NOT EXISTS recent_asset_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    used_by UUID REFERENCES users(id) ON DELETE SET NULL,
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recent_asset_usage_table
    ON recent_asset_usage(table_id);
CREATE INDEX IF NOT EXISTS idx_recent_asset_usage_asset
    ON recent_asset_usage(asset_id);
