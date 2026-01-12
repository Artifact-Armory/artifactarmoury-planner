-- Legacy schema cleanup placeholder
-- Drop legacy tables only after verifying migrations and data integrity.

-- DROP TABLE IF EXISTS artists CASCADE;
-- DROP TABLE IF EXISTS assets CASCADE;
-- DROP TABLE IF EXISTS example_tables CASCADE;
-- DROP TABLE IF EXISTS user_tables CASCADE;
-- DROP TABLE IF EXISTS stripe_transfers CASCADE;

COMMENT ON TABLE models IS 'Legacy models table - data migrated to assets.';
