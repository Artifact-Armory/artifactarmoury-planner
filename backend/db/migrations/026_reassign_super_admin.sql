-- Migration 026: reassign super-admin to the owner account
--
-- Migration 025 seeded super-admin on a placeholder account. Move it to the real
-- owner. A super-admin also needs `role='admin'` to reach the admin panel at all
-- (the whole /admin router is behind requireAdmin), so we grant both here.
--
-- Idempotent and order-independent: whatever 025 did, this leaves exactly one
-- super-admin — callumjwhite95@hotmail.co.uk. Emails are stored lower-cased;
-- no-ops where an account doesn't exist.

UPDATE users SET is_super_admin = false
 WHERE lower(email) = 'firefox68@hotmail.co.uk';

UPDATE users SET role = 'admin', is_super_admin = true
 WHERE lower(email) = 'callumjwhite95@hotmail.co.uk';
