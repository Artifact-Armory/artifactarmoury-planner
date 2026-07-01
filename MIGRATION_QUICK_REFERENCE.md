# Database Migration - Quick Reference

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025

---

## 🚀 Quick Commands

```bash
# Create a new migration
npm run migrate:create "migration_name"

# Create with template
npm run migrate:create "migration_name" --template=table
npm run migrate:create "migration_name" --template=column
npm run migrate:create "migration_name" --template=index

# Run pending migrations
npm run migrate

# Check migration status
npm run migrate:status

# Rollback last migration
npm run migrate:rollback

# Rollback multiple migrations
npm run migrate:rollback 3

# Seed development data
npm run db:seed
```

---

## 📁 File Structure

```
backend/
├── db/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_add_tables_columns.sql
│   │   └── ...
│   └── migration-templates/
│       ├── table.sql
│       ├── add-column.sql
│       └── index.sql
└── scripts/
    ├── migrate.ts
    ├── create-migration.ts
    ├── rollback.ts
    └── migrate-status.ts
```

---

## 📝 Creating a Migration

### Step 1: Generate File

```bash
npm run migrate:create "add_user_preferences"
```

Output:
```
✅ Migration created: 009_add_user_preferences.sql
📁 Location: db/migrations/009_add_user_preferences.sql
📝 Template: blank
```

### Step 2: Edit File

```sql
-- db/migrations/009_add_user_preferences.sql

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme VARCHAR(50) DEFAULT 'light',
  notifications_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id);
```

### Step 3: Test

```bash
npm run migrate
npm run migrate:status
npm run migrate:rollback
```

### Step 4: Commit

```bash
git add db/migrations/009_add_user_preferences.sql
git commit -m "feat: add user preferences table"
```

---

## 🎯 Common Tasks

### Add a Table

```bash
npm run migrate:create "create_users_table" --template=table
```

### Add a Column

```bash
npm run migrate:create "add_email_to_users" --template=column
```

### Create an Index

```bash
npm run migrate:create "add_index_users_email" --template=index
```

### Rename a Column

```bash
npm run migrate:create "rename_user_column"
```

Then edit:
```sql
ALTER TABLE users RENAME COLUMN old_name TO new_name;
```

### Add a Constraint

```bash
npm run migrate:create "add_unique_email"
```

Then edit:
```sql
ALTER TABLE users ADD CONSTRAINT unique_email UNIQUE (email);
```

### Drop a Column

```bash
npm run migrate:create "remove_deprecated_column"
```

Then edit:
```sql
ALTER TABLE users DROP COLUMN deprecated_field;
```

---

## 🔍 Checking Status

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

---

## 🔄 Rollback

### Rollback Last Migration

```bash
npm run migrate:rollback
```

### Rollback Multiple

```bash
npm run migrate:rollback 3
```

### Check What Will Rollback

```bash
npm run migrate:status
```

---

## 📊 SQL Templates

### Create Table

```sql
CREATE TABLE IF NOT EXISTS table_name (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Add Column

```sql
ALTER TABLE table_name
ADD COLUMN IF NOT EXISTS column_name data_type DEFAULT value;
```

### Create Index

```sql
CREATE INDEX IF NOT EXISTS idx_table_column ON table_name(column_name);
```

### Add Foreign Key

```sql
ALTER TABLE table_name
ADD CONSTRAINT fk_name FOREIGN KEY (column_id) REFERENCES other_table(id);
```

### Add Unique Constraint

```sql
ALTER TABLE table_name
ADD CONSTRAINT unique_name UNIQUE (column_name);
```

### Drop Column

```sql
ALTER TABLE table_name DROP COLUMN IF EXISTS column_name;
```

### Rename Column

```sql
ALTER TABLE table_name RENAME COLUMN old_name TO new_name;
```

### Update Data

```sql
UPDATE table_name SET column = value WHERE condition;
```

---

## 🐛 Troubleshooting

### Migration Fails

**Check logs**:
```bash
npm run migrate 2>&1 | tail -20
```

**Rollback**:
```bash
npm run migrate:rollback
```

### Connection Error

**Verify DATABASE_URL**:
```bash
echo $DATABASE_URL
```

**Test connection**:
```bash
psql $DATABASE_URL -c "SELECT 1"
```

### Table Already Exists

**Use IF NOT EXISTS**:
```sql
CREATE TABLE IF NOT EXISTS table_name (...)
```

### Column Already Exists

**Use IF NOT EXISTS**:
```sql
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS column_name type
```

---

## 📚 Data Types Reference

| Type | Example | Use Case |
|------|---------|----------|
| UUID | `gen_random_uuid()` | Primary keys |
| VARCHAR(n) | `VARCHAR(255)` | Text with limit |
| TEXT | `TEXT` | Unlimited text |
| INTEGER | `INTEGER` | Whole numbers |
| DECIMAL(p,s) | `DECIMAL(10,2)` | Money, precise decimals |
| BOOLEAN | `BOOLEAN` | True/false |
| TIMESTAMP | `CURRENT_TIMESTAMP` | Date and time |
| DATE | `CURRENT_DATE` | Date only |
| JSONB | `'{}'::jsonb` | JSON data |
| ARRAY | `INTEGER[]` | Array of values |

---

## 🔐 Safety Tips

✅ **Always**:
- Test locally first
- Backup before production
- Use IF NOT EXISTS
- Add indexes for foreign keys
- Document your migrations

❌ **Never**:
- Skip version numbers
- Drop tables without backup
- Make breaking changes without planning
- Use hardcoded values
- Ignore performance

---

## 📞 Help

**View all migrations**:
```bash
ls -la db/migrations/
```

**View migration templates**:
```bash
ls -la db/migration-templates/
```

**View migration scripts**:
```bash
ls -la scripts/migrate*.ts
```

**Read full guide**:
```bash
cat MIGRATION_SYSTEM_GUIDE.md
cat MIGRATION_BEST_PRACTICES.md
```

---

**Status**: ✅ READY TO USE  
**Last Updated**: October 29, 2025

