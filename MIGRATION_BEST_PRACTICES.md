# Database Migration Best Practices

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025

---

## ✅ DO's

### 1. Use IF NOT EXISTS / IF EXISTS

```sql
-- ✅ Good
CREATE TABLE IF NOT EXISTS users (...)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)
DROP TABLE IF EXISTS old_table

-- ❌ Bad
CREATE TABLE users (...)  -- Fails if table exists
ALTER TABLE users ADD COLUMN email VARCHAR(255)  -- Fails if column exists
```

### 2. Use Transactions

```sql
-- ✅ Good - Automatic in migration system
BEGIN;
  CREATE TABLE users (...)
  CREATE INDEX idx_users_email ON users(email)
COMMIT;

-- ❌ Bad - No rollback on error
CREATE TABLE users (...)
CREATE INDEX idx_users_email ON users(email)
```

### 3. Add Indexes for Foreign Keys

```sql
-- ✅ Good
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_orders_user_id ON orders(user_id);

-- ❌ Bad - No index on foreign key
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id)
);
```

### 4. Use Meaningful Names

```sql
-- ✅ Good
CREATE INDEX idx_users_email_active ON users(email) WHERE status = 'active'
CREATE TABLE user_preferences (...)
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP

-- ❌ Bad
CREATE INDEX idx1 ON users(email)
CREATE TABLE up (...)
ALTER TABLE users ADD COLUMN last_login TIMESTAMP
```

### 5. Document Your Migrations

```sql
-- ✅ Good
-- Migration: Add user preferences table
-- Purpose: Store user-specific settings
-- Author: Your Name
-- Date: 2025-10-29

CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme VARCHAR(50) DEFAULT 'light',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ❌ Bad
CREATE TABLE user_preferences (...)
```

### 6. Test Migrations Locally First

```bash
# ✅ Good workflow
1. Create migration file
2. Test locally: npm run migrate
3. Test rollback: npm run migrate:rollback
4. Commit to git
5. Deploy to staging
6. Deploy to production

# ❌ Bad
1. Create migration
2. Deploy directly to production
```

### 7. Use Proper Data Types

```sql
-- ✅ Good
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  age INTEGER,
  balance DECIMAL(10,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

-- ❌ Bad
CREATE TABLE users (
  id TEXT,
  email TEXT,
  age TEXT,
  balance TEXT,
  is_active TEXT,
  created_at TEXT,
  metadata TEXT
);
```

### 8. Add Constraints

```sql
-- ✅ Good
CREATE TABLE products (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10,2) NOT NULL CHECK (price > 0),
  category VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ❌ Bad
CREATE TABLE products (
  id UUID,
  name VARCHAR(255),
  price DECIMAL(10,2),
  category VARCHAR(50),
  created_at TIMESTAMP
);
```

---

## ❌ DON'Ts

### 1. Don't Make Breaking Changes Without Planning

```sql
-- ❌ Bad - Breaks existing code
ALTER TABLE users DROP COLUMN email

-- ✅ Better - Deprecate first
-- Step 1: Add new column
ALTER TABLE users ADD COLUMN email_new VARCHAR(255)
-- Step 2: Migrate data
UPDATE users SET email_new = email
-- Step 3: Drop old column (in separate migration)
ALTER TABLE users DROP COLUMN email
```

### 2. Don't Use Non-Deterministic Operations

```sql
-- ❌ Bad - Different results each time
UPDATE users SET updated_at = NOW()

-- ✅ Good - Deterministic
UPDATE users SET updated_at = CURRENT_TIMESTAMP
```

### 3. Don't Skip Version Numbers

```
-- ❌ Bad
001_initial.sql
002_add_users.sql
004_add_products.sql  -- Missing 003!

-- ✅ Good
001_initial.sql
002_add_users.sql
003_add_products.sql
004_add_orders.sql
```

### 4. Don't Mix Schema and Data Changes

```sql
-- ❌ Bad - Too much in one migration
CREATE TABLE users (...)
INSERT INTO users VALUES (...)
CREATE TABLE orders (...)
INSERT INTO orders VALUES (...)

-- ✅ Good - Separate concerns
-- Migration 1: Create tables
CREATE TABLE users (...)
CREATE TABLE orders (...)

-- Migration 2: Populate data
INSERT INTO users VALUES (...)
INSERT INTO orders VALUES (...)
```

### 5. Don't Forget Rollback Considerations

```sql
-- ❌ Bad - Can't rollback
ALTER TABLE users DROP COLUMN email

-- ✅ Good - Can rollback
-- Forward: Add new column
ALTER TABLE users ADD COLUMN email_new VARCHAR(255)
-- Backward: Remove new column
-- ALTER TABLE users DROP COLUMN email_new
```

### 6. Don't Use Hardcoded Values

```sql
-- ❌ Bad - Hardcoded
UPDATE users SET role = 'admin' WHERE id = '123e4567-e89b-12d3-a456-426614174000'

-- ✅ Good - Use conditions
UPDATE users SET role = 'admin' WHERE email = 'admin@example.com'
```

### 7. Don't Ignore Performance

```sql
-- ❌ Bad - Slow on large tables
ALTER TABLE users ADD COLUMN full_name VARCHAR(255)

-- ✅ Good - Add index if needed
ALTER TABLE users ADD COLUMN full_name VARCHAR(255)
CREATE INDEX idx_users_full_name ON users(full_name)
```

### 8. Don't Forget Constraints

```sql
-- ❌ Bad - No constraints
CREATE TABLE users (
  id UUID,
  email VARCHAR(255),
  age INTEGER
)

-- ✅ Good - Proper constraints
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  age INTEGER CHECK (age >= 0)
)
```

---

## 🎯 Migration Checklist

Before running a migration:

- [ ] Migration file follows naming convention (NNN_description.sql)
- [ ] SQL uses IF NOT EXISTS / IF EXISTS
- [ ] All changes are in a transaction
- [ ] Indexes created for foreign keys
- [ ] Constraints added where appropriate
- [ ] Comments included
- [ ] Tested locally
- [ ] Rollback tested
- [ ] No breaking changes without planning
- [ ] Performance considered
- [ ] Data types are appropriate
- [ ] Naming is clear and consistent

---

## 🚀 Migration Workflow

### Creating a Migration

```bash
# 1. Create migration file
npm run migrate:create "add_user_preferences"

# 2. Edit the file
vim db/migrations/009_add_user_preferences.sql

# 3. Test locally
npm run migrate

# 4. Test rollback
npm run migrate:rollback

# 5. Commit to git
git add db/migrations/009_add_user_preferences.sql
git commit -m "feat: add user preferences table"

# 6. Deploy to staging
git push origin feature-branch

# 7. Deploy to production
git push origin main
```

### Deploying a Migration

```bash
# 1. Backup database
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Run migrations
npm run migrate

# 3. Verify
npm run migrate:status

# 4. Monitor logs
tail -f logs/app.log
```

---

## 📊 Common Patterns

### Add New Feature

```sql
-- 1. Create table
CREATE TABLE feature_name (...)

-- 2. Add indexes
CREATE INDEX idx_feature_name_user_id ON feature_name(user_id)

-- 3. Add foreign keys
ALTER TABLE feature_name ADD CONSTRAINT fk_feature_user FOREIGN KEY (user_id) REFERENCES users(id)
```

### Rename Column

```sql
-- 1. Add new column
ALTER TABLE table_name ADD COLUMN new_name data_type

-- 2. Copy data
UPDATE table_name SET new_name = old_name

-- 3. Drop old column
ALTER TABLE table_name DROP COLUMN old_name
```

### Change Data Type

```sql
-- 1. Add new column with new type
ALTER TABLE table_name ADD COLUMN new_column new_type

-- 2. Convert data
UPDATE table_name SET new_column = CAST(old_column AS new_type)

-- 3. Drop old column
ALTER TABLE table_name DROP COLUMN old_column
```

---

**Status**: ✅ COMPLETE  
**Last Updated**: October 29, 2025

