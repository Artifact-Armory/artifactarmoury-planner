-- 079_application_terms.sql
--
-- Approving an artist application now upgrades the account straight away
-- instead of emailing an invite code. The upgrade records the applicant's
-- acceptance of the seller terms, so that acceptance has to be captured on
-- the application itself (by the applicant, never by the approving admin).
-- Applications submitted before this have NULLs and still get an invite code.

ALTER TABLE artist_applications ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP;
ALTER TABLE artist_applications ADD COLUMN IF NOT EXISTS terms_version VARCHAR(40);
