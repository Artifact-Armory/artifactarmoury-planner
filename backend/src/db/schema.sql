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
    commission_rate DECIMAL(5,2) DEFAULT 85.00, -- Artist's SHARE percent of each sale (platform keeps the remainder; 85 = 15% platform fee)
    stripe_account_id VARCHAR(255), -- Stripe Connect account
    stripe_onboarding_complete BOOLEAN DEFAULT false,

    -- Account status
    email_verified BOOLEAN DEFAULT false,
    -- Email verification + password reset: only the SHA-256 HASH of the token is
    -- stored, never the raw token. See migration 024.
    email_verification_token VARCHAR(64),
    email_verification_expires TIMESTAMP,
    password_reset_token VARCHAR(64),
    password_reset_expires TIMESTAMP,
    account_status VARCHAR(20) DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'banned')),
    -- Super-admin (owner) sees platform financials/analytics; regular admins don't. See migration 025.
    is_super_admin BOOLEAN NOT NULL DEFAULT false,
    -- Shadow-ban: still 'active' for buying (and reporting a model they own), but blocked
    -- from filing other reports, posting reviews, and messaging. Orthogonal to account_status.
    shadow_banned BOOLEAN NOT NULL DEFAULT false,
    
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
-- MODELS (3D Terrain Assets)
-- ============================================================================

CREATE TABLE models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Basic info
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL CHECK (category IN (
        'buildings', 'nature', 'scatter', 'props', 'complete_sets', 'other',
        'vehicles', 'characters'
    )),
    tags TEXT[], -- Array of searchable tags
    
    -- Files
    stl_file_path VARCHAR(500) NOT NULL,
    glb_file_path VARCHAR(500), -- For 3D preview
    thumbnail_path VARCHAR(500),
    
    -- Dimensions (in mm)
    width DECIMAL(10,2),
    depth DECIMAL(10,2),
    height DECIMAL(10,2),
    
    -- Fulfillment (digital STL only for now; print-and-ship comes later)
    fulfillment_type VARCHAR(10) NOT NULL DEFAULT 'stl' CHECK (fulfillment_type IN ('stl', 'print')),

    -- Pricing
    base_price DECIMAL(10,2) NOT NULL, -- Base price in USD

    -- Print-on-demand quote (see migration 027): the outsourced print provider's
    -- cost + the computed customer-facing print price. Set by the artist Print
    -- button; print_price = print_provider_cost + base_price + £1 site fee.
    print_provider_cost DECIMAL(10,2),
    print_price DECIMAL(10,2),
    print_provider VARCHAR(50),
    print_quoted_at TIMESTAMP,
    -- Artist agreement that this model may be manufactured by a third-party
    -- print service (see migration 028). Required before a print can be quoted.
    print_consent BOOLEAN NOT NULL DEFAULT false,
    print_consent_at TIMESTAMP,

    -- Print specifications
    estimated_print_time INTEGER, -- Minutes
    estimated_material_cost DECIMAL(10,2), -- USD
    supports_required BOOLEAN DEFAULT false,
    recommended_layer_height DECIMAL(5,3), -- mm (e.g., 0.2)
    recommended_infill INTEGER, -- Percentage
    
    -- Status & visibility
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'flagged')),
    visibility VARCHAR(20) DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'unlisted')),
    in_library BOOLEAN DEFAULT false,
    
    -- Stats
    view_count INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,
    sale_count INTEGER DEFAULT 0,
    
    -- Multi-part ("set") models: number of STL files in the product (1 = ordinary
    -- single-STL model; extra parts live in model_parts, this row is part 1).
    part_count INTEGER NOT NULL DEFAULT 1,

    -- Duplicate prevention
    file_hash VARCHAR(64) UNIQUE, -- SHA-256 of original STL bytes

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
CREATE INDEX idx_models_file_hash ON models(file_hash);

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
-- MODEL PARTS (Multi-part "set" models — one product, several STL files)
-- ============================================================================

CREATE TABLE model_parts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    name VARCHAR(255),
    stl_file_path VARCHAR(500) NOT NULL,
    glb_file_path VARCHAR(500),
    width DECIMAL(10,2), depth DECIMAL(10,2), height DECIMAL(10,2), -- mm
    file_hash VARCHAR(64),
    geometry_fingerprint JSONB,
    processing_status VARCHAR(20) DEFAULT 'processing',
    processing_error TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_model_parts_model ON model_parts(model_id);

-- ============================================================================
-- BUNDLES (Several models grouped under one name + one price)
-- ============================================================================

CREATE TABLE bundles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    thumbnail_path VARCHAR(500),
    price DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    visibility VARCHAR(20) DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'unlisted')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP
);

CREATE INDEX idx_bundles_artist ON bundles(artist_id);
CREATE INDEX idx_bundles_status ON bundles(status);

CREATE TABLE bundle_items (
    bundle_id UUID NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
    model_id  UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 0,
    PRIMARY KEY (bundle_id, model_id)
);

CREATE INDEX idx_bundle_items_model ON bundle_items(model_id);

-- ============================================================================
-- TABLES (Saved Layouts)
-- ============================================================================

CREATE TABLE tables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL for anonymous
    
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

-- ============================================================================
-- USER TABLES (planner saves — used by routes/tables.ts at /api/tables)
-- Email-based ownership; separate from the legacy `tables` table above.
-- ============================================================================

CREATE TABLE user_tables (
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

CREATE INDEX idx_user_tables_email ON user_tables(user_email);
CREATE INDEX idx_user_tables_share ON user_tables(share_token);
CREATE INDEX idx_user_tables_public ON user_tables(is_public) WHERE is_public = true;
CREATE INDEX idx_user_tables_artist_display ON user_tables(is_artist_display) WHERE is_artist_display = true;

-- ============================================================================
-- ORDERS
-- ============================================================================

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number VARCHAR(50) UNIQUE NOT NULL, -- Human-readable (e.g., ORD-2024-001234)
    
    -- Customer
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    customer_email VARCHAR(255) NOT NULL,
    
    -- Shipping (nullable — digital STL orders have no shipping address)
    shipping_name VARCHAR(255),
    shipping_address_line1 VARCHAR(255),
    shipping_address_line2 VARCHAR(255),
    shipping_city VARCHAR(100),
    shipping_state VARCHAR(100),
    shipping_postal_code VARCHAR(20),
    shipping_country VARCHAR(2), -- ISO country code
    
    -- Pricing
    subtotal DECIMAL(10,2) NOT NULL,
    shipping_cost DECIMAL(10,2) NOT NULL,
    tax DECIMAL(10,2) DEFAULT 0.00,
    total DECIMAL(10,2) NOT NULL,
    
    -- Immediate-download consent: when the buyer agreed the download starts now and
    -- thereby waived the 14-day cancellation right (UK Consumer Contracts Regs 2013).
    download_consent_at TIMESTAMP,

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

    -- Bundle linkage: a bundle purchase creates one row per constituent model,
    -- all tagged with the same bundle_id + a bundle_name snapshot.
    bundle_id UUID REFERENCES bundles(id) ON DELETE SET NULL,
    bundle_name VARCHAR(255),

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
-- ARTIST EARNINGS LEDGER + PAYOUTS  (migration 021; supersedes the payments table)
-- ============================================================================
-- Separate charges & transfers: buyer pays the platform, we accrue one earning row
-- per order_item at the artist's share, hold it 21 days, then pay out in batches.

CREATE TABLE artist_earnings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    model_id      UUID REFERENCES models(id) ON DELETE SET NULL,

    gross_amount    DECIMAL(10,2) NOT NULL,
    artist_amount   DECIMAL(10,2) NOT NULL,
    platform_amount DECIMAL(10,2) NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'GBP',

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'cleared', 'paid', 'reversed')),
    available_at TIMESTAMP NOT NULL,   -- paid_at + 21 days
    payout_id    UUID,                  -- FK to payouts(id) added after that table (see below / migration 021)
    reversed_reason TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT artist_earnings_order_item_unique UNIQUE (order_item_id)
);
CREATE INDEX idx_earnings_artist ON artist_earnings(artist_id, status);
CREATE INDEX idx_earnings_status_available ON artist_earnings(status, available_at);
CREATE INDEX idx_earnings_payout ON artist_earnings(payout_id);
CREATE INDEX idx_earnings_order ON artist_earnings(order_id);

CREATE TABLE payouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount   DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
    stripe_transfer_id VARCHAR(255),
    stripe_account_id  VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
    failure_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    paid_at    TIMESTAMP
);
CREATE INDEX idx_payouts_artist ON payouts(artist_id, status);
-- Now that payouts exists, wire the earnings→payout FK.
ALTER TABLE artist_earnings
    ADD CONSTRAINT artist_earnings_payout_fk
    FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE SET NULL;

-- ============================================================================
-- MODEL REPORTS (moderation queue)
-- ============================================================================

CREATE TABLE model_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id    UUID REFERENCES models(id) ON DELETE SET NULL,
    artist_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason VARCHAR(30) NOT NULL CHECK (reason IN (
        'copyright', 'offensive', 'not_as_advertised', 'no_printed_photo', 'broken_file', 'other'
    )),
    detail TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'under_review', 'awaiting_info', 'resolved_upheld', 'resolved_dismissed'
    )),
    resolution_action  VARCHAR(30),
    resolution_summary TEXT,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_reports_status ON model_reports(status, created_at DESC);
CREATE INDEX idx_reports_model ON model_reports(model_id);
CREATE INDEX idx_reports_artist ON model_reports(artist_id);
CREATE INDEX idx_reports_reporter ON model_reports(reporter_id);
CREATE UNIQUE INDEX idx_reports_reporter_model_open ON model_reports(reporter_id, model_id)
    WHERE status IN ('open', 'under_review', 'awaiting_info');

CREATE TABLE model_report_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id  UUID NOT NULL REFERENCES model_reports(id) ON DELETE CASCADE,
    file_path  VARCHAR(500) NOT NULL,
    file_name  VARCHAR(255),
    content_type VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_report_attachments_report ON model_report_attachments(report_id);

-- ============================================================================
-- MESSAGING (migration 022): direct buyer<->artist threads + site/system messages
-- ============================================================================

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kind VARCHAR(20) NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'system')),
    subject VARCHAR(255),
    pair_key VARCHAR(80),               -- canonical "minId:maxId" for direct threads; NULL for system
    allow_replies BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    last_message_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_message_preview TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_conversations_pair ON conversations(pair_key) WHERE pair_key IS NOT NULL;
CREATE INDEX idx_conversations_last_message ON conversations(last_message_at DESC);

CREATE TABLE conversation_participants (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMP NOT NULL DEFAULT to_timestamp(0),
    archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_participants_user ON conversation_participants(user_id);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,   -- NULL = site/system
    is_system BOOLEAN NOT NULL DEFAULT false,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- Conversation reports (migration 023): a participant reports a thread; a JSONB
-- snapshot captures the messages at report time for admin review.
CREATE TABLE conversation_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id  UUID REFERENCES conversations(id) ON DELETE SET NULL,
    reporter_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    reported_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason VARCHAR(30) NOT NULL CHECK (reason IN (
        'harassment', 'threats', 'hate_speech', 'spam', 'scam', 'other'
    )),
    detail TEXT,
    snapshot JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'under_review', 'resolved_upheld', 'resolved_dismissed'
    )),
    resolution_action  VARCHAR(30),
    resolution_summary TEXT,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_conv_reports_status ON conversation_reports(status, created_at DESC);
CREATE INDEX idx_conv_reports_reporter ON conversation_reports(reporter_id);
CREATE INDEX idx_conv_reports_reported ON conversation_reports(reported_user_id);
CREATE INDEX idx_conv_reports_conversation ON conversation_reports(conversation_id);
CREATE UNIQUE INDEX idx_conv_reports_reporter_conv_open
    ON conversation_reports(reporter_id, conversation_id)
    WHERE status IN ('open', 'under_review');

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

CREATE TRIGGER update_bundles_updated_at BEFORE UPDATE ON bundles
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

-- (Removed the legacy `artist_earnings` summary VIEW — it was built on the dead
--  `payments` table and is superseded by the artist_earnings ledger TABLE above,
--  which migration 021 drops the view to make room for.)

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
