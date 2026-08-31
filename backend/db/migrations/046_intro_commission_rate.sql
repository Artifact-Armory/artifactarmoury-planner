-- 046_intro_commission_rate.sql
--
-- Introductory commission rates: an admin can offer an artist a lower platform
-- cut (a higher commission_rate = artist share) for their first N months of
-- selling, then have it automatically revert to their standard rate.
--
-- The clock is NOT set when the admin creates the offer — an artist might sit
-- on drafts for weeks before their first sale-ready listing goes live, and the
-- whole point of "introductory" is to reward the first months of ACTUALLY
-- selling. So the offer sits pending (intro_commission_starts_at IS NULL)
-- until the artist's first-ever model is published, at which point the
-- app layer stamps starts_at/ends_at and flips users.commission_rate to the
-- intro rate. A scheduler then reverts commission_rate back to
-- standard_commission_rate once ends_at has passed.
--
-- users.commission_rate remains the single value every existing code path
-- (earnings.ts, payouts.ts, orders.ts) reads to snapshot an artist's share at
-- purchase time — nothing about that contract changes. These columns just
-- describe *how* commission_rate got its current value and what it should
-- become next.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS intro_commission_rate DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS intro_commission_months INTEGER,
  ADD COLUMN IF NOT EXISTS standard_commission_rate DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS intro_commission_starts_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS intro_commission_ends_at TIMESTAMP;

COMMENT ON COLUMN users.intro_commission_rate IS
  'Artist''s SHARE percent (like commission_rate) while an introductory offer is running. NULL = no offer on this account.';
COMMENT ON COLUMN users.intro_commission_months IS
  'Length of the introductory period in months, counted from intro_commission_starts_at.';
COMMENT ON COLUMN users.standard_commission_rate IS
  'The commission_rate to revert to once the introductory period ends.';
COMMENT ON COLUMN users.intro_commission_starts_at IS
  'Set once, automatically, when this artist''s first-ever model is published. NULL = offer is still pending (artist has no published model yet).';
COMMENT ON COLUMN users.intro_commission_ends_at IS
  'intro_commission_starts_at + intro_commission_months, stamped at the same time as starts_at so the revert sweep is a plain timestamp comparison.';

-- Sweep query: find artists whose intro has lapsed but who are still sitting
-- on the intro rate (commission_rate = intro_commission_rate is what makes the
-- revert self-terminating — once reverted it no longer matches, no extra
-- "already reverted" flag needed).
CREATE INDEX IF NOT EXISTS idx_users_intro_commission_ends_at
  ON users(intro_commission_ends_at)
  WHERE intro_commission_ends_at IS NOT NULL;
