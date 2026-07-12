-- 031_two_factor_auth.sql
-- Optional TOTP two-factor authentication. Aimed at sellers, whose accounts hold
-- earnings and are prime phishing targets, but available to any account.
--
--   totp_secret        : the shared secret, ENCRYPTED at rest (AES-256-GCM via
--                        services/totp.ts). NULL until the user starts enrolment.
--                        A non-null secret with totp_enabled=false is a pending
--                        (not-yet-confirmed) enrolment.
--   totp_enabled       : true once the user has confirmed a code, so login demands 2FA.
--   totp_backup_codes  : JSON array of *hashed* single-use recovery codes.
--   totp_enrolled_at   : when 2FA was last turned on (for the security page).

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMP;

COMMENT ON COLUMN users.totp_secret IS 'Encrypted TOTP shared secret (services/totp.ts). NULL = no 2FA; set but totp_enabled=false = pending enrolment.';
COMMENT ON COLUMN users.totp_backup_codes IS 'JSON array of hashed single-use 2FA recovery codes.';
