-- Terrain Builder Database Schema
-- PostgreSQL 14+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- USERS & AUTHENTICATION
-- ============================================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'artist', 'admin')),
    
    -- Artist-specific fields
    artist_name VARCHAR(100),
    artist_bio TEXT,
    artist_url VARCHAR(255),
    commission_rate DECIMAL(5,2) DEFAULT 15.00, -- Artist's commission percentage
    stripe_account_id VARCHAR(255), -- Stripe Connect account
    stripe_onboarding_complete BOOLEAN DEFAULT false,
    creator_verified BOOLEAN DEFAULT false,
    verification_badge VARCHAR(50),
    
    -- Account status
    email_verified BOOLEAN DEFAULT false,
    account_status VARCHAR(20) DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'banned')),
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_stripe_account ON users(stripe_account_id);

-- ============================================================================
-- INVITE CODES (Artist Registration)
-- ============================================================================

CREATE TABLE invite_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    created_by UUID REFERENCES users(id),
    used_by UUID REFERENCES users(id),
    max_uses INTEGER DEFAULT 1,
    current_uses INTEGER DEFAULT 0,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP
);

CREATE INDEX idx_invite_codes_code ON invite_codes(code);
CREATE INDEX idx_invite_codes_created_by ON invite_codes(created_by);

-- ============================================================================
-- ANONYMOUS SESSIONS (Guest Table Builders)
-- ============================================================================

CREATE TABLE anonymous_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_token UUID NOT NULL UNIQUE,
    table_limit INTEGER DEFAULT 3 CHECK (table_limit >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_anonymous_sessions_token ON anonymous_sessions(session_token);

-- ============================================================================
-- MODELS (3D Terrain Assets)
-- ============================================================================

CREATE TABLE models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Basic info
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL CHECK (category IN (
        'buildings', 'nature', 'scatter', 'props', 'complete_sets', 'other'
    )),
    tags TEXT[], -- Array of searchable tags
    
    -- Files
    stl_file_path VARCHAR(500) NOT NULL,
    glb_file_path VARCHAR(500), -- For 3D preview
    thumbnail_path VARCHAR(500),
    license VARCHAR(50) NOT NULL DEFAULT 'standard-commercial' CHECK (license IN (
        'cc0',
        'cc-by',
        'cc-by-sa',
        'cc-by-nd',
        'cc-by-nc',
        'standard-commercial',
        'personal-use'
    )),
    
    -- Dimensions (in mm)
    width DECIMAL(10,2),
    depth DECIMAL(10,2),
    height DECIMAL(10,2),
    
    -- Pricing
    base_price DECIMAL(10,2) NOT NULL, -- Base price in USD
    
    -- Print specifications
    estimated_print_time INTEGER, -- Minutes
    estimated_material_cost DECIMAL(10,2), -- USD
    supports_required BOOLEAN DEFAULT false,
    recommended_layer_height DECIMAL(5,3), -- mm (e.g., 0.2)
    recommended_infill INTEGER, -- Percentage
    
    -- Status & visibility
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'flagged')),
    visibility VARCHAR(20) DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'unlisted')),
    
    -- Stats
    view_count INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,
    sale_count INTEGER DEFAULT 0,
    
    -- Moderation
    flagged_reason TEXT,
    moderated_by UUID REFERENCES users(id),
    moderated_at TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP
);

CREATE INDEX idx_models_artist ON models(artist_id);
CREATE INDEX idx_models_category ON models(category);
CREATE INDEX idx_models_status ON models(status);
CREATE INDEX idx_models_visibility ON models(visibility);
CREATE INDEX idx_models_tags ON models USING GIN(tags);
CREATE INDEX idx_models_created ON models(created_at DESC);
CREATE INDEX idx_models_license ON models(license);

-- ============================================================================
-- MODEL IMAGES (Additional photos)
-- ============================================================================

CREATE TABLE model_watermarks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    watermark_token UUID NOT NULL,
    metadata JSONB NOT NULL,
    hash_signature TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (model_id),
    UNIQUE (hash_signature)
);

CREATE INDEX idx_model_watermarks_artist ON model_watermarks(artist_id);

-- ============================================================================
-- MODEL IMAGES (Additional photos)
-- ============================================================================

CREATE TABLE model_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    image_path VARCHAR(500) NOT NULL,
    display_order INTEGER DEFAULT 0,
    caption TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_model_images_model ON model_images(model_id);

-- ============================================================================
-- TABLES (Saved Layouts)
-- ============================================================================

CREATE TABLE tables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL for anonymous
    session_id UUID,
    
    -- Table info
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Table dimensions (in mm)
    width INTEGER NOT NULL DEFAULT 1200, -- 4ft standard
    depth INTEGER NOT NULL DEFAULT 900,  -- 3ft standard
    
    -- Layout data (JSON)
    layout JSONB NOT NULL, -- Array of {modelId, x, y, rotation, scale}
    
    -- Sharing
    is_public BOOLEAN DEFAULT false,
    share_code VARCHAR(50) UNIQUE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    plan VARCHAR(20) DEFAULT 'user_free' CHECK (plan IN ('anon_free', 'user_free', 'pro')),
    max_assets INTEGER DEFAULT 1000,
    
    -- Stats
    view_count INTEGER DEFAULT 0,
    clone_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tables_user ON tables(user_id);
CREATE INDEX idx_tables_share_code ON tables(share_code);
CREATE INDEX idx_tables_public ON tables(is_public) WHERE is_public = true;
CREATE INDEX idx_tables_session ON tables(session_id);
CREATE INDEX idx_tables_status ON tables(status);

-- ============================================================================
-- ASSET LIBRARY (Selective Uploads)
-- ============================================================================

CREATE TABLE assets (
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
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    visibility VARCHAR(20) DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
    width DECIMAL(10,2),
    depth DECIMAL(10,2),
    height DECIMAL(10,2),
    view_count INTEGER DEFAULT 0,
    add_count INTEGER DEFAULT 0,
    use_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP
);

CREATE INDEX idx_assets_category ON assets(category);
CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_visibility ON assets(visibility);
CREATE INDEX idx_assets_tags ON assets USING GIN(tags);
CREATE INDEX idx_assets_artist ON assets(artist_id);

CREATE TABLE asset_sets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_asset_sets_owner ON asset_sets(owner_id);

CREATE TABLE asset_set_items (
    set_id UUID REFERENCES asset_sets(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (set_id, asset_id)
);

CREATE TABLE table_assets (
    table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB,
    PRIMARY KEY (table_id, asset_id)
);

CREATE INDEX idx_table_assets_table ON table_assets(table_id);
CREATE INDEX idx_table_assets_asset ON table_assets(asset_id);

CREATE TABLE table_sets (
    table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
    set_id UUID REFERENCES asset_sets(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (table_id, set_id)
);

CREATE INDEX idx_table_sets_table ON table_sets(table_id);

CREATE TABLE recent_asset_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    used_by UUID REFERENCES users(id) ON DELETE SET NULL,
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_recent_asset_usage_table ON recent_asset_usage(table_id);
CREATE INDEX idx_recent_asset_usage_asset ON recent_asset_usage(asset_id);

-- ============================================================================
-- ORDERS
-- ============================================================================

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number VARCHAR(50) UNIQUE NOT NULL, -- Human-readable (e.g., ORD-2024-001234)
    
    -- Customer
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    customer_email VARCHAR(255) NOT NULL,
    
    -- Shipping
    shipping_name VARCHAR(255) NOT NULL,
    shipping_address_line1 VARCHAR(255) NOT NULL,
    shipping_address_line2 VARCHAR(255),
    shipping_city VARCHAR(100) NOT NULL,
    shipping_state VARCHAR(100),
    shipping_postal_code VARCHAR(20) NOT NULL,
    shipping_country VARCHAR(2) NOT NULL, -- ISO country code
    
    -- Pricing
    subtotal DECIMAL(10,2) NOT NULL,
    shipping_cost DECIMAL(10,2) NOT NULL,
    tax DECIMAL(10,2) DEFAULT 0.00,
    total DECIMAL(10,2) NOT NULL,
    
    -- Payment
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('stripe', 'paypal')),
    payment_intent_id VARCHAR(255), -- Stripe PaymentIntent ID
    payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN (
        'pending', 'processing', 'succeeded', 'failed', 'refunded'
    )),
    
    -- Fulfillment
    fulfillment_status VARCHAR(20) DEFAULT 'pending' CHECK (fulfillment_status IN (
        'pending', 'processing', 'printing', 'shipped', 'delivered', 'cancelled'
    )),
    tracking_number VARCHAR(100),
    tracking_url VARCHAR(500),
    estimated_delivery DATE,
    
    -- Print farm integration
    print_farm_job_id VARCHAR(255), -- External print service job ID
    print_farm_status VARCHAR(50),
    
    -- Order notes
    customer_notes TEXT,
    internal_notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP,
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_number ON orders(order_number);
CREATE INDEX idx_orders_email ON orders(customer_email);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_fulfillment_status ON orders(fulfillment_status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);

-- ============================================================================
-- ORDER ITEMS
-- ============================================================================

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    model_id UUID REFERENCES models(id) ON DELETE SET NULL, -- NULL if model deleted
    artist_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Item details (snapshot at time of purchase)
    model_name VARCHAR(255) NOT NULL,
    model_snapshot JSONB, -- Full model data at purchase time
    
    -- Quantity & pricing
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    
    -- Artist commission
    artist_commission_rate DECIMAL(5,2) NOT NULL,
    artist_commission_amount DECIMAL(10,2) NOT NULL,
    commission_paid BOOLEAN DEFAULT false,
    commission_paid_at TIMESTAMP,
    
    -- Print specifications (customer selections)
    print_color VARCHAR(50),
    print_material VARCHAR(50),
    print_quality VARCHAR(20), -- 'draft', 'standard', 'fine'
    special_instructions TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_model ON order_items(model_id);
CREATE INDEX idx_order_items_artist ON order_items(artist_id);

-- ============================================================================
-- PAYMENTS (Commission Tracking)
-- ============================================================================

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id),
    
    -- Payment details
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Stripe Connect
    stripe_transfer_id VARCHAR(255),
    stripe_payout_id VARCHAR(255),
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
        'pending', 'processing', 'completed', 'failed', 'refunded'
    )),
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP,
    
    CONSTRAINT payments_amount_positive CHECK (amount > 0)
);

CREATE INDEX idx_payments_artist ON payments(artist_id);
CREATE INDEX idx_payments_order_item ON payments(order_item_id);
CREATE INDEX idx_payments_status ON payments(status);

-- ============================================================================
-- REVIEWS
-- ============================================================================

CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id), -- Verified purchase
    
    -- Review content
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title VARCHAR(255),
    comment TEXT,
    
    -- Print quality feedback
    print_quality_rating INTEGER CHECK (print_quality_rating >= 1 AND print_quality_rating <= 5),
    would_recommend BOOLEAN,
    
    -- Moderation
    is_visible BOOLEAN DEFAULT true,
    flagged BOOLEAN DEFAULT false,
    flagged_reason TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(model_id, user_id) -- One review per model per user
);

CREATE INDEX idx_reviews_model ON reviews(model_id);
CREATE INDEX idx_reviews_user ON reviews(user_id);
CREATE INDEX idx_reviews_visible ON reviews(is_visible) WHERE is_visible = true;

-- ============================================================================
-- FAVORITES (Wishlist)
-- ============================================================================

CREATE TABLE favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, model_id)
);

CREATE INDEX idx_favorites_user ON favorites(user_id);
CREATE INDEX idx_favorites_model ON favorites(model_id);

-- ============================================================================
-- ACTIVITY LOG (Audit Trail)
-- ============================================================================

CREATE TABLE activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Activity details
    action VARCHAR(100) NOT NULL, -- 'model.created', 'order.placed', etc.
    resource_type VARCHAR(50), -- 'model', 'order', 'user'
    resource_id UUID,
    
    -- Additional context
    metadata JSONB,
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_log_user ON activity_log(user_id);
CREATE INDEX idx_activity_log_action ON activity_log(action);
CREATE INDEX idx_activity_log_resource ON activity_log(resource_type, resource_id);
CREATE INDEX idx_activity_log_created ON activity_log(created_at DESC);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_models_updated_at BEFORE UPDATE ON models
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tables_updated_at BEFORE UPDATE ON tables
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Generate order number
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.order_number = 'ORD-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || 
                       LPAD(NEXTVAL('order_number_seq')::TEXT, 6, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE order_number_seq START 1;

CREATE TRIGGER set_order_number BEFORE INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION generate_order_number();

-- ============================================================================
-- VIEWS (Convenient Queries)
-- ============================================================================

-- Active models with artist info
CREATE VIEW active_models AS
SELECT 
    m.*,
    u.artist_name,
    u.artist_url,
    COUNT(DISTINCT r.id) as review_count,
    COALESCE(AVG(r.rating), 0) as average_rating
FROM models m
JOIN users u ON m.artist_id = u.id
LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
WHERE m.status = 'published' AND m.visibility = 'public'
GROUP BY m.id, u.artist_name, u.artist_url;

-- Artist earnings summary
CREATE VIEW artist_earnings AS
SELECT 
    u.id as artist_id,
    u.artist_name,
    COUNT(DISTINCT oi.id) as total_sales,
    SUM(oi.artist_commission_amount) as total_earnings,
    SUM(CASE WHEN p.status = 'completed' THEN p.amount ELSE 0 END) as paid_earnings,
    SUM(CASE WHEN p.status = 'pending' THEN p.amount ELSE 0 END) as pending_earnings
FROM users u
LEFT JOIN order_items oi ON u.id = oi.artist_id
LEFT JOIN payments p ON oi.id = p.order_item_id
WHERE u.role = 'artist'
GROUP BY u.id, u.artist_name;

-- ============================================================================
-- SEED DATA (Initial Admin)
-- ============================================================================

-- Default admin user (password: 'admin123' - CHANGE IN PRODUCTION!)
-- Password hash generated with bcrypt, rounds=10
INSERT INTO users (email, password_hash, display_name, role, email_verified)
VALUES (
    'admin@terrainbuilder.com',
    '$2b$10$rZ3qPx7F8YvKxJ9mH5nE5eZQYYxJ9mH5nE5eZQYYxJ9mH5nE5eZQYY', -- Change this!
    'Admin',
    'admin',
    true
) ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- PERMISSIONS (Row Level Security - Optional)
-- ============================================================================

-- Enable RLS on sensitive tables
-- ALTER TABLE models ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY models_select ON models FOR SELECT USING (status = 'published' OR artist_id = current_user_id());
-- (Add more policies as needed)

-- ============================================================================
-- COMMENTS (Documentation)
-- ============================================================================

COMMENT ON TABLE users IS 'User accounts: customers, artists, and admins';
COMMENT ON TABLE models IS '3D terrain models uploaded by artists';
COMMENT ON TABLE orders IS 'Customer orders for printed models';
COMMENT ON TABLE order_items IS 'Individual items within an order';
COMMENT ON TABLE payments IS 'Artist commission payments via Stripe Connect';
COMMENT ON TABLE tables IS 'Saved table layouts created in the builder';
COMMENT ON TABLE invite_codes IS 'Invitation codes for artist registration';
COMMENT ON TABLE reviews IS 'Customer reviews and ratings for models';
COMMENT ON TABLE favorites IS 'User wishlists/favorites';
COMMENT ON TABLE activity_log IS 'Audit trail of all system actions';
