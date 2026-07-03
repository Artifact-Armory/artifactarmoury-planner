-- Migration 008: STL-only marketplace + model bundles
--
-- The product is moving to digital STL sales only (print-and-ship comes later).
--   1. Models default to 'stl' fulfilment and every existing model becomes 'stl'.
--   2. Orders are digital: shipping is no longer required, so the shipping_*
--      columns become nullable (an STL order has no address).
--   3. Bundles: an artist groups several of their own models under one name +
--      one price. Buying a bundle grants download access to each model, so a
--      bundle purchase expands into one order_items row per constituent model
--      (linked back via order_items.bundle_id / bundle_name).

-- --- 1. STL-only models ------------------------------------------------------
ALTER TABLE models ALTER COLUMN fulfillment_type SET DEFAULT 'stl';
UPDATE models SET fulfillment_type = 'stl' WHERE fulfillment_type IS DISTINCT FROM 'stl';

-- --- 2. Digital orders: shipping optional ------------------------------------
ALTER TABLE orders ALTER COLUMN shipping_name DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN shipping_address_line1 DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN shipping_city DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN shipping_postal_code DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN shipping_country DROP NOT NULL;

-- --- 3. Bundles --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bundles (
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

CREATE INDEX IF NOT EXISTS idx_bundles_artist ON bundles(artist_id);
CREATE INDEX IF NOT EXISTS idx_bundles_status ON bundles(status);

CREATE TABLE IF NOT EXISTS bundle_items (
    bundle_id UUID NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
    model_id  UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 0,
    PRIMARY KEY (bundle_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_bundle_items_model ON bundle_items(model_id);

-- Keep bundles.updated_at fresh (reuse the shared trigger fn from schema.sql).
DROP TRIGGER IF EXISTS update_bundles_updated_at ON bundles;
CREATE TRIGGER update_bundles_updated_at BEFORE UPDATE ON bundles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Link a bundle purchase's per-model order rows back to the bundle.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS bundle_id UUID REFERENCES bundles(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS bundle_name VARCHAR(255);
