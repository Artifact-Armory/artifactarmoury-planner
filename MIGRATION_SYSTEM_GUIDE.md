# Database Migration System Guide

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025  
**Status**: ✅ Fully Implemented

---

## 📋 Overview

Your project has a **production-ready database migration system** built on PostgreSQL. It provides:

- ✅ Version-controlled schema changes
- ✅ Automatic migration tracking
- ✅ Rollback capability
- ✅ Transaction safety (ACID compliance)
- ✅ Migration status reporting

---

## 🏗️ Architecture

### Migration Flow

```
┌─────────────────────────────────────────────────┐
│  npm run migrate                                │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│  scripts/migrate.ts                             │
│  ├─ Load all .sql files from db/migrations/     │
│  ├─ Check schema_migrations table               │
│  ├─ Find pending migrations                     │
│  └─ Execute each in transaction                 │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│  For each pending migration:                    │
│  ├─ BEGIN transaction                           │
│  ├─ Execute SQL                                 │
│  ├─ Record in schema_migrations                 │
│  ├─ COMMIT or ROLLBACK                          │
│  └─ Log result                                  │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│  Database Updated ✅                            │
└─────────────────────────────────────────────────┘
```

### Database Schema

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

---

## 📁 File Structure

```
backend/
├── db/
│   └── migrations/
│       ├── 001_initial_schema.sql
│       ├── 002_add_tables_columns.sql
│       ├── 003_asset_library.sql
│       ├── 004_cleanup_legacy.sql
│       ├── 005_model_watermarks.sql
│       ├── 006_model_license_creator_verification.sql
│       ├── 007_add_dimensions_to_assets.sql
│       └── 008_populate_asset_dimensions.sql
├── scripts/
│   ├── migrate.ts          # Run pending migrations
│   ├── rollback.ts         # Rollback migrations
│   ├── migrate-status.ts   # Show migration status
│   └── ...
└── package.json            # npm scripts
```

---

## 🚀 Quick Start

### Run All Pending Migrations

```bash
npm run migrate
```

Output:
```
🚀 Starting database migrations...

📊 Current schema version: 7
📦 Found 1 pending migration(s)

⏳ Running migration 8: populate_asset_dimensions
✅ Migration 8 completed

🎉 All migrations completed successfully!
```

### Check Migration Status

```bash
npm run migrate:status
```

Output:
```
📊 Migration Status
==================

Current version: 8
Latest version: 8

Applied migrations:
  ✅ 001 - initial_schema
  ✅ 002 - add_tables_columns
  ✅ 003 - asset_library
  ✅ 004 - cleanup_legacy
  ✅ 005 - model_watermarks
  ✅ 006 - model_license_creator_verification
  ✅ 007 - add_dimensions_to_assets
  ✅ 008 - populate_asset_dimensions
```

### Rollback Last Migration

```bash
npm run migrate:rollback
```

### Rollback Multiple Migrations

```bash
npm run migrate:rollback 3
```

---

## ✍️ Creating a New Migration

### Step 1: Create Migration File

Create a new SQL file in `db/migrations/` with the naming convention:

```
{VERSION}_{description}.sql
```

**Example**: `009_add_user_preferences.sql`

### Step 2: Write SQL

```sql
-- Migration: Add user preferences table
-- Version: 009

CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme VARCHAR(50) DEFAULT 'light',
  notifications_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id);
```

### Step 3: Run Migration

```bash
npm run migrate
```

### Best Practices

✅ **Do**:
- Use transactions (automatic)
- Add indexes for foreign keys
- Include comments
- Test locally first
- Keep migrations small and focused
- Use IF NOT EXISTS for safety

❌ **Don't**:
- Use multiple statements without transactions
- Drop tables without backup
- Make breaking changes without planning
- Skip version numbers
- Use non-deterministic operations

---

## 🔄 Migration Lifecycle

### Development

```bash
# Create migration
echo "CREATE TABLE test (id SERIAL);" > db/migrations/009_test.sql

# Run migration
npm run migrate

# Test changes
npm run dev

# If needed, rollback
npm run migrate:rollback
```

### Staging

```bash
# Pull latest code
git pull

# Run migrations
npm run migrate

# Verify
npm run migrate:status
```

### Production

```bash
# Backup database first!
pg_dump $DATABASE_URL > backup.sql

# Run migrations
npm run migrate

# Verify
npm run migrate:status

# Monitor logs
tail -f logs/app.log
```

---

## 📊 Current Migrations

| Version | Name | Purpose |
|---------|------|---------|
| 001 | initial_schema | Create core tables |
| 002 | add_tables_columns | Add additional columns |
| 003 | asset_library | Create asset library |
| 004 | cleanup_legacy | Remove old tables |
| 005 | model_watermarks | Add watermark support |
| 006 | model_license_creator_verification | Add license fields |
| 007 | add_dimensions_to_assets | Add dimension columns |
| 008 | populate_asset_dimensions | Populate dimension data |

---

## 🔐 Safety Features

### Transaction Safety
- Each migration runs in a transaction
- Automatic rollback on error
- No partial updates

### Idempotency
- Migrations only run once
- Version tracking prevents duplicates
- Safe to re-run migrate command

### Error Handling
- Clear error messages
- Automatic rollback on failure
- Process exit code indicates status

---

## 🐛 Troubleshooting

### Migration Fails

**Error**: `relation "table_name" already exists`

**Solution**:
```sql
-- Use IF NOT EXISTS
CREATE TABLE IF NOT EXISTS table_name (...)
```

### Connection Error

**Error**: `ECONNREFUSED`

**Solution**:
```bash
# Check DATABASE_URL
echo $DATABASE_URL

# Verify PostgreSQL is running
psql $DATABASE_URL -c "SELECT 1"
```

### Migration Stuck

**Solution**:
```bash
# Check active connections
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity"

# Kill blocking connection
psql $DATABASE_URL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid()"
```

---

## 📈 Advanced Usage

### View Migration History

```bash
psql $DATABASE_URL -c "SELECT * FROM schema_migrations ORDER BY version"
```

### Manual Migration

```bash
# If needed, run SQL directly
psql $DATABASE_URL < db/migrations/009_custom.sql
```

### Create Backup Before Migration

```bash
# Backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# Migrate
npm run migrate

# Restore if needed
psql $DATABASE_URL < backup_20251029_120000.sql
```

---

## 🎯 Next Steps

1. **Create new migrations** as needed using the naming convention
2. **Test locally** before deploying
3. **Backup production** before running migrations
4. **Monitor logs** after deployment
5. **Document schema changes** in migration files

---

## 📞 Support

### Commands Reference

```bash
npm run migrate              # Run pending migrations
npm run migrate:rollback     # Rollback last migration
npm run migrate:rollback 3   # Rollback 3 migrations
npm run migrate:status       # Show migration status
npm run db:seed              # Seed development data
```

### Files

- `scripts/migrate.ts` - Migration runner
- `scripts/rollback.ts` - Rollback handler
- `scripts/migrate-status.ts` - Status checker
- `db/migrations/` - Migration files

---

**Status**: ✅ PRODUCTION READY  
**Last Updated**: October 29, 2025

