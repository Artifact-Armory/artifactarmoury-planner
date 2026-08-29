-- 042_terms_acceptance.sql
--
-- Checkout used to require a checkbox waiving the buyer's 14-day cancellation
-- right (download_consent_at). That waiver was removed — buyers now keep the
-- statutory right regardless of what they tick — but checkout still needs the
-- buyer to affirmatively agree to the Terms of Service before paying, since
-- that's where the per-model licence restrictions live (e.g. "personal use"
-- models can't be printed and sold unless the listing says commercial). This
-- is evidence of a contract being formed, not a rights waiver.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP;

COMMENT ON COLUMN orders.terms_accepted_at IS
  'When the buyer ticked "I agree to the Terms of Service" at checkout. Evidence of agreement to the per-model licence terms, not a rights waiver — see download_consent_at (retired) for that history.';
