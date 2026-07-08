-- Migration 021: artist payouts (earnings ledger) + model moderation (reports)
--
-- Two features settled in the payments/moderation design session:
--
--  1. PAYOUTS — separate charges & transfers. The buyer pays the full cart to the
--     platform; on a succeeded order we accrue ONE earning row per order_item at the
--     artist's share (default 85% — platform keeps 15%, and absorbs Stripe fees).
--     Earnings sit `pending` through a 21-day hold (UK consumer cancellation-rights
--     window; the buyer waives the 14-day right at download, recorded on the order),
--     then clear and are paid out on a schedule via Stripe Connect transfers.
--
--  2. MODERATION — any signed-in user can report a model. Copyright / Not-as-advertised
--     / Broken-unprintable reports must carry proof uploads. Admins triage in a
--     moderation queue, publish findings (notifying reporter + artist), and take
--     actions (unpublish / remove / warn / suspend / ban / shadow-ban / refund).

-- ============================================================================
-- USERS: commission semantics + shadow-ban
-- ============================================================================

-- `commission_rate` now unambiguously means the ARTIST'S SHARE percent (what the
-- artist keeps). Default was 15.00 with a contradictory "artist's commission"
-- comment while code split it two different ways. Standardise on artist-share and
-- backfill: anyone still on the old 15.00 default becomes 85.00 (15% platform fee).
ALTER TABLE users ALTER COLUMN commission_rate SET DEFAULT 85.00;
UPDATE users SET commission_rate = 85.00 WHERE commission_rate = 15.00;
COMMENT ON COLUMN users.commission_rate IS 'Artist share percent of each sale (platform keeps the remainder). Default 85 = 15% platform fee.';

-- Shadow-ban: orthogonal to account_status. A shadow-banned user is still `active`
-- for buying (and can still report a model they OWN — they keep consumer rights),
-- but is blocked from filing other reports, posting reviews, and (once it exists)
-- messaging other users/artists.
ALTER TABLE users ADD COLUMN IF NOT EXISTS shadow_banned BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- ORDERS: immediate-download consent (waiver of the 14-day cancellation right)
-- ============================================================================

-- Set when the buyer ticks "I want my download now and understand I lose my 14-day
-- right to cancel once it begins". Required to lawfully rely on the lost-cancellation
-- basis (UK Consumer Contracts Regs 2013) that underpins the 21-day payout hold.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS download_consent_at TIMESTAMP;

-- ============================================================================
-- ARTIST EARNINGS LEDGER
-- ============================================================================

-- One row per order_item that belongs to an artist. Accrued on payment success,
-- held (pending) until `available_at`, then cleared and eventually paid.
--   pending  — inside the 21-day hold, not yet payable
--   cleared  — past the hold, awaiting the next payout run
--   paid     — included in a Stripe transfer (payout_id set)
--   reversed — voided by a refund/takedown before it was paid (never leaves platform)
CREATE TABLE IF NOT EXISTS artist_earnings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    model_id      UUID REFERENCES models(id) ON DELETE SET NULL,

    -- Money (GBP). gross_amount = sale price of the line; artist_amount = their share;
    -- platform_amount = the cut we keep (gross - artist).
    gross_amount    DECIMAL(10,2) NOT NULL,
    artist_amount   DECIMAL(10,2) NOT NULL,
    platform_amount DECIMAL(10,2) NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'GBP',

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'cleared', 'paid', 'reversed')),

    available_at TIMESTAMP NOT NULL,      -- when it clears (paid_at + 21 days)
    payout_id    UUID,                     -- FK set once included in a payout batch
    reversed_reason TEXT,                  -- why it was voided (refund/takedown)

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT artist_earnings_order_item_unique UNIQUE (order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_earnings_artist ON artist_earnings(artist_id, status);
CREATE INDEX IF NOT EXISTS idx_earnings_status_available ON artist_earnings(status, available_at);
CREATE INDEX IF NOT EXISTS idx_earnings_payout ON artist_earnings(payout_id);
CREATE INDEX IF NOT EXISTS idx_earnings_order ON artist_earnings(order_id);

-- ============================================================================
-- PAYOUTS (a batched Stripe Connect transfer to one artist)
-- ============================================================================

CREATE TABLE IF NOT EXISTS payouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    amount   DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'GBP',

    stripe_transfer_id VARCHAR(255),
    stripe_account_id  VARCHAR(255),

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'failed')),
    failure_reason TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    paid_at    TIMESTAMP,

    CONSTRAINT payouts_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_payouts_artist ON payouts(artist_id, status);

-- artist_earnings.payout_id references payouts (added after payouts exists)
ALTER TABLE artist_earnings
    DROP CONSTRAINT IF EXISTS artist_earnings_payout_fk;
ALTER TABLE artist_earnings
    ADD CONSTRAINT artist_earnings_payout_fk
    FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE SET NULL;

-- ============================================================================
-- MODEL REPORTS
-- ============================================================================

--   open           — awaiting admin triage
--   under_review   — an admin has picked it up
--   awaiting_info  — admin asked reporter/artist for more information
--   resolved_upheld    — report was valid, action taken
--   resolved_dismissed — no violation found
CREATE TABLE IF NOT EXISTS model_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id    UUID REFERENCES models(id) ON DELETE SET NULL,
    artist_id   UUID REFERENCES users(id) ON DELETE SET NULL,   -- model owner at report time
    reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,

    reason VARCHAR(30) NOT NULL CHECK (reason IN (
        'copyright', 'offensive', 'not_as_advertised', 'no_printed_photo',
        'broken_file', 'other'
    )),
    detail TEXT,

    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'under_review', 'awaiting_info',
        'resolved_upheld', 'resolved_dismissed'
    )),

    -- Admin outcome
    resolution_action  VARCHAR(30),   -- e.g. 'remove_model', 'ban_artist', 'dismiss'
    resolution_summary TEXT,          -- findings published to reporter + artist
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON model_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_model ON model_reports(model_id);
CREATE INDEX IF NOT EXISTS idx_reports_artist ON model_reports(artist_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON model_reports(reporter_id);

-- One open report per (reporter, model): stops duplicate spam while a report is live,
-- but lets a user re-report after a previous one is resolved.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_reporter_model_open
    ON model_reports(reporter_id, model_id)
    WHERE status IN ('open', 'under_review', 'awaiting_info');

-- Proof attachments (photos/PDFs on R2). Required for copyright / not_as_advertised /
-- broken_file reasons; optional otherwise.
CREATE TABLE IF NOT EXISTS model_report_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id  UUID NOT NULL REFERENCES model_reports(id) ON DELETE CASCADE,
    file_path  VARCHAR(500) NOT NULL,     -- R2 key
    file_name  VARCHAR(255),
    content_type VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_report_attachments_report ON model_report_attachments(report_id);
