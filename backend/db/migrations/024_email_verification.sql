-- Migration 024: email verification (+ backfill latent password-reset columns)
--
-- New users and artists are emailed a verification link at signup. Clicking it
-- flips `email_verified` to true. We store only the SHA-256 HASH of the token
-- (never the raw token) plus a 24h expiry — same pattern as password reset.
--
-- We also add `password_reset_token`/`password_reset_expires` here: routes/auth.ts
-- has always referenced them, but they were never in schema.sql or any migration,
-- so the password-reset flow silently no-op'd in production. IF NOT EXISTS makes
-- this safe on any environment that somehow already has them.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verification_token   VARCHAR(64),
    ADD COLUMN IF NOT EXISTS email_verification_expires  TIMESTAMP,
    ADD COLUMN IF NOT EXISTS password_reset_token        VARCHAR(64),
    ADD COLUMN IF NOT EXISTS password_reset_expires      TIMESTAMP;

-- Token lookups hit these directly; partial indexes stay tiny (only rows with a
-- pending token are indexed).
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token
    ON users(email_verification_token)
    WHERE email_verification_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_password_reset_token
    ON users(password_reset_token)
    WHERE password_reset_token IS NOT NULL;
