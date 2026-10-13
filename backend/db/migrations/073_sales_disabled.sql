-- 073_sales_disabled.sql
-- Display-only artist accounts. A catalogue uploaded on someone else's behalf (the
-- Wargames3D import) and the "Tester Artist" demo account must be visible on the
-- marketplace and placeable in the planner, but nobody may buy from them: we don't
-- own those files. POST /api/orders refuses any model or bundle from an account
-- with this flag; the storefront hides its buy buttons. Clear it to start selling.

ALTER TABLE users ADD COLUMN IF NOT EXISTS sales_disabled BOOLEAN NOT NULL DEFAULT false;

UPDATE users SET sales_disabled = true
 WHERE role = 'artist'
   AND (artist_name ILIKE 'tester artist'
        OR artist_name ILIKE 'wargame%3d%'
        OR display_name ILIKE 'tester artist'
        OR display_name ILIKE 'wargame%3d%');
