# Schema Migration Guide

## Overview

This document describes the transition from the legacy schema to the DEV_GUIDE-aligned implementation with the asset library system.

## What Changed

### Tables Renamed or Removed

- `artists` → `users` (artists are users with `role = 'artist'`)
- `assets` (legacy) → `models` (existing catalogue prior to the library)
- `example_tables` → `tables`
- `user_tables` → `tables`
- `stripe_transfers` → `payments`

### New / Updated Structures

- `order_items` replaces the JSON blob on `orders`
- `assets` becomes the global asset catalogue
- `asset_sets`, `asset_set_items`, `table_assets`, `table_sets` manage curated collections
- `anonymous_sessions` tracks session-scoped table limits
- `tables` now includes `session_id`, `status`, `plan`, `max_assets`

## Migration Steps

1. **Backup the database**
   ```bash
   pg_dump -U postgres -d terrain_builder > backup_$(date +%Y%m%d).sql
   ```

2. **Apply schema migrations**
   ```bash
   npm run migrate
   ```

3. **Copy existing models to the new assets catalogue**
   ```bash
   npm run migrate:models-to-assets
   ```

4. **Verify integrity**
   ```bash
   npm run test
   npm run migrate:status
   ```

5. **Redeploy application code**
   ```bash
   npm install
   npm run build
   npm run dev   # or your PM2/hosting equivalent
   ```

## Rollback Plan

If issues occur:

```bash
# Restore from backup
psql -U postgres -d terrain_builder < backup_YYYYMMDD.sql

# Or roll back migrations
npm run migrate:rollback
```

## Verification Queries

```sql
-- Confirm artist data resides in users
SELECT COUNT(*) FROM users WHERE role = 'artist';

-- Inspect new table columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'tables';

-- Ensure legacy tables are absent
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('artists', 'user_tables', 'stripe_transfers');

-- Confirm order_items populated
SELECT * FROM order_items LIMIT 5;
```

## Post-Migration Cleanup

- Drop legacy tables once data is verified (`backend/db/migrations/004_cleanup_legacy.sql`).
- Update monitoring dashboards and alerts to cover new asset usage metrics.
