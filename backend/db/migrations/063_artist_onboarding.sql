-- 063_artist_onboarding.sql
--
-- Two gaps in artist onboarding, both only visible once someone other than us
-- tries to become a seller.
--
-- 1. INVITE CODES COULD NOT BE REDEEMED. The backend has had a working
--    POST /auth/register/artist (invite code -> artist account) and the admin UI
--    can mint codes, but NO frontend anywhere collected an invite code: the
--    public Register page has no invite/artist fields and nothing called that
--    route. So the documented onboarding path — "we email you a code" — was a
--    dead end; every artist still had to be created by hand-run SQL. There is
--    also no way for an EXISTING customer to become an artist at all, since
--    email is unique, so a buyer who wants to sell would have needed a second
--    account under a different address.
--
-- 2. NOBODY EVER RECORDED ACCEPTING SELLER TERMS. Buyers have had
--    orders.terms_accepted_at since migration 042, but the artist side — the
--    party we take commission from, hold files for, and pay out to — had no
--    equivalent. That is the agreement that actually needs evidence.
--
-- The version string is stored alongside the timestamp deliberately: "they
-- accepted the terms" is worthless as evidence if the terms have since been
-- edited and nothing records WHICH text they agreed to.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS artist_terms_accepted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS artist_terms_version VARCHAR(20),
  ADD COLUMN IF NOT EXISTS became_artist_at TIMESTAMP;

COMMENT ON COLUMN users.artist_terms_accepted_at IS
  'When this user agreed to the seller terms (artist registration or customer upgrade). Evidence of the selling agreement — the artist-side counterpart of orders.terms_accepted_at.';
COMMENT ON COLUMN users.artist_terms_version IS
  'Which version of the seller terms was agreed to. Stored because a bare timestamp is not evidence once the terms text changes.';
COMMENT ON COLUMN users.became_artist_at IS
  'When the account became an artist — at artist registration, on upgrade from a customer account, or when an admin promoted them.';

-- Backfill: existing artists became artists at some point, and the best evidence
-- available is when the account was created. Left NULL for terms acceptance on
-- purpose — we must not manufacture a record of an agreement nobody made.
UPDATE users
   SET became_artist_at = created_at
 WHERE role = 'artist' AND became_artist_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_became_artist ON users (became_artist_at DESC)
  WHERE role = 'artist';
