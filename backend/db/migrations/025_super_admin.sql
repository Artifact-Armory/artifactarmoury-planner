-- Migration 025: super-admin tier
--
-- Regular admins moderate the marketplace (users, orders, models, moderation),
-- but must NOT see platform financials. A super-admin (the owner) additionally
-- sees Reports & Analytics — total/site revenue, growth, view/visitor analytics.
--
-- Orthogonal boolean rather than a new role, so existing `role='admin'` checks
-- (JWT + requireAdmin) keep working unchanged; super-admin is an added grant.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- Promote the owner account. Emails are stored lower-cased; this is a no-op on
-- any environment where the account doesn't exist. Change/rerun the UPDATE (or
-- use the db:query script) to promote a different account.
UPDATE users SET is_super_admin = true
 WHERE lower(email) = 'firefox68@hotmail.co.uk';
