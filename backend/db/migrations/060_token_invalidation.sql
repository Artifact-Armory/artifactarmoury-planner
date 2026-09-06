-- 060_token_invalidation.sql
-- Security fix (2026-09-05 audit): JWTs are stateless with no revocation list, so
-- changing a password, resetting a password, or disabling 2FA didn't actually kick
-- out any session issued before the change — a token captured before the user
-- noticed a compromise stayed valid for its full 7-day (access) / 30-day (refresh)
-- lifetime regardless. `tokens_valid_from` is a per-user "nothing issued before this
-- moment is trusted" watermark: NULL means no invalidation has ever happened (every
-- token is trusted, same as before this migration); set to NOW() by password
-- change/reset and 2FA disable, and checked in middleware/auth.ts against the
-- token's own `iat` claim.

ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_valid_from TIMESTAMP;
