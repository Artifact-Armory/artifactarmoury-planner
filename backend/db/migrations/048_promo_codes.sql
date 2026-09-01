-- 048_promo_codes.sql
--
-- Artist-run promo codes. Distinct from the existing `sales` table (034):
-- a Sale is automatic and public (everyone sees the discounted price, it can
-- surface on the front-page carousel) and its cost is split proportionally
-- with the platform (commission is a percentage of the already-discounted
-- price). A promo code is private (a buyer must be given the code) and its
-- cost comes ENTIRELY out of the artist's own cut — the platform's commission
-- is calculated as if the code had never been entered, so running a promo
-- never reduces platform revenue. See services/promoCodes.ts.
--
-- v1 scope: model or portfolio-wide only (no bundle scope — see routes/orders.ts).

CREATE TABLE IF NOT EXISTS promo_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(40) NOT NULL,
    discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
    discount_value NUMERIC(10, 2) NOT NULL CHECK (discount_value > 0),
    -- What the code discounts. target_id is a model id; NULL for portfolio-wide.
    scope VARCHAR(20) NOT NULL CHECK (scope IN ('model', 'portfolio')),
    target_id UUID,
    active BOOLEAN NOT NULL DEFAULT true,
    starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at TIMESTAMP, -- NULL = no expiry (unlike `sales`, promo codes aren't publicly
                        -- surfaced, so the 14-day fairness cap on `sales` doesn't apply here)
    max_redemptions INTEGER,              -- NULL = unlimited total uses
    redemption_count INTEGER NOT NULL DEFAULT 0,
    max_redemptions_per_customer INTEGER, -- NULL = unlimited per buyer
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK ((scope = 'portfolio' AND target_id IS NULL) OR (scope = 'model' AND target_id IS NOT NULL)),
    CHECK (max_redemptions IS NULL OR max_redemptions >= 1),
    CHECK (max_redemptions_per_customer IS NULL OR max_redemptions_per_customer >= 1)
);

-- Codes are entered at checkout with no artist context, so they must be
-- globally unique (case-insensitive) to unambiguously resolve to one artist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes (UPPER(code));
CREATE INDEX IF NOT EXISTS idx_promo_codes_artist ON promo_codes(artist_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_target ON promo_codes(target_id) WHERE target_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS promo_code_redemptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    promo_code_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    model_id UUID REFERENCES models(id) ON DELETE SET NULL,
    discount_amount NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code ON promo_code_redemptions(promo_code_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user ON promo_code_redemptions(promo_code_id, user_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_order ON promo_code_redemptions(order_id);

-- order_items gains the fields needed to record what a promo code actually did
-- to that line: original_price is the pre-code price (what commission is
-- calculated from — see routes/orders.ts pushModelRow), unit_price/total_price
-- (existing columns) become the discounted price the buyer actually paid.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS original_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promo_code_id UUID REFERENCES promo_codes(id) ON DELETE SET NULL;

COMMENT ON TABLE promo_codes IS 'Artist-run promo codes (migration 048). Discount comes entirely from the artist''s own commission share — see services/promoCodes.ts.';
COMMENT ON TABLE promo_code_redemptions IS 'One row per order line a promo code discounted — backs redemption-limit enforcement and artist-facing stats.';
COMMENT ON COLUMN order_items.original_price IS 'Pre-promo-code price (post-Sale if one was active). Commission is calculated from this, not unit_price, so a promo code never reduces platform revenue.';
COMMENT ON COLUMN order_items.discount_amount IS 'original_price - unit_price. Zero unless a promo code was applied to this line.';
