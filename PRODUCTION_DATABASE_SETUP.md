# Production Database Configuration - Artifact Armoury Planner

**Project**: Artifact Armoury Planner  
**Database**: PostgreSQL 14+  
**Date**: October 29, 2025  
**Status**: Configuration Guide

---

## 📋 Overview

Complete guide for configuring PostgreSQL database for production deployment on AWS RDS with proper connection pooling, backups, monitoring, and security.

---

## 🚀 Quick Start (5 Steps)

### Step 1: Create AWS RDS PostgreSQL Instance

```bash
# Using AWS CLI
aws rds create-db-instance \
  --db-instance-identifier artifact-armoury-prod \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 14.7 \
  --master-username postgres \
  --master-user-password "$(openssl rand -base64 32)" \
  --allocated-storage 100 \
  --storage-type gp3 \
  --storage-encrypted \
  --backup-retention-period 30 \
  --multi-az \
  --publicly-accessible false \
  --vpc-security-group-ids sg-xxxxxxxx \
  --db-subnet-group-name artifact-db-subnet \
  --enable-cloudwatch-logs-exports postgresql \
  --enable-iam-database-authentication
```

### Step 2: Configure Security Group

```bash
# Allow inbound traffic from application servers
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxx \
  --protocol tcp \
  --port 5432 \
  --source-security-group-id sg-app-servers
```

### Step 3: Create Production Database

```bash
# Connect to RDS instance
psql -h artifact-armoury-prod.xxxxx.us-east-1.rds.amazonaws.com \
     -U postgres \
     -d postgres

# Create database
CREATE DATABASE artifact_armoury_prod;

# Create application user
CREATE USER app_user WITH PASSWORD 'strong-password-here';

# Grant permissions
GRANT CONNECT ON DATABASE artifact_armoury_prod TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT CREATE ON SCHEMA public TO app_user;
```

### Step 4: Run Migrations

```bash
# Set environment variable
export DATABASE_URL="postgresql://app_user:password@artifact-armoury-prod.xxxxx.us-east-1.rds.amazonaws.com:5432/artifact_armoury_prod"

# Run migrations
npm run migrate
```

### Step 5: Verify Connection

```bash
# Test connection
npm run test:db

# Check schema
psql $DATABASE_URL -c "\dt"
```

---

## 🔧 Configuration Details

### Connection String Format

```
postgresql://username:password@host:port/database?sslmode=require&application_name=artifact-armoury
```

### Environment Variables

```bash
# Production .env
NODE_ENV=production
DATABASE_URL=postgresql://app_user:password@host:5432/artifact_armoury_prod

# Connection pooling
DB_POOL_MIN=5
DB_POOL_MAX=20
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=5000
DB_STATEMENT_TIMEOUT=30000

# SSL/TLS
DB_SSL_MODE=require
DB_SSL_REJECT_UNAUTHORIZED=true

# Monitoring
DB_LOG_QUERIES=true
DB_SLOW_QUERY_THRESHOLD=1000
```

---

## 🔐 Security Best Practices

### 1. SSL/TLS Encryption

```typescript
// In src/db/index.ts
const connectionConfig = {
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/path/to/rds-ca-bundle.pem'),
  },
}
```

### 2. IAM Database Authentication

```bash
# Generate auth token
TOKEN=$(aws rds generate-db-auth-token \
  --hostname artifact-armoury-prod.xxxxx.us-east-1.rds.amazonaws.com \
  --port 5432 \
  --username app_user)

# Connect using token
psql -h artifact-armoury-prod.xxxxx.us-east-1.rds.amazonaws.com \
     -U app_user \
     -d artifact_armoury_prod \
     --password="$TOKEN"
```

### 3. Principle of Least Privilege

```sql
-- Create read-only user for analytics
CREATE USER analytics_user WITH PASSWORD 'analytics-password';
GRANT CONNECT ON DATABASE artifact_armoury_prod TO analytics_user;
GRANT USAGE ON SCHEMA public TO analytics_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_user;

-- Create backup user
CREATE USER backup_user WITH PASSWORD 'backup-password';
GRANT CONNECT ON DATABASE artifact_armoury_prod TO backup_user;
```

---

## 📊 Connection Pooling

### PgBouncer Configuration

```ini
# /etc/pgbouncer/pgbouncer.ini
[databases]
artifact_armoury_prod = host=artifact-armoury-prod.xxxxx.us-east-1.rds.amazonaws.com port=5432 user=app_user password=password

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
min_pool_size = 5
reserve_pool_size = 5
reserve_pool_timeout = 3
max_db_connections = 100
max_user_connections = 50
```

### Application Connection Pool

```typescript
// Configured in src/db/index.ts
const connectionConfig = {
  max: 20,                    // Max connections
  idleTimeoutMillis: 30000,   // 30 seconds
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
}
```

---

## 💾 Backup Strategy

### Automated Backups

```bash
# AWS RDS automatic backups (configured in RDS)
- Retention period: 30 days
- Backup window: 03:00-04:00 UTC
- Multi-AZ enabled for high availability
```

### Manual Backups

```bash
# Create snapshot
aws rds create-db-snapshot \
  --db-instance-identifier artifact-armoury-prod \
  --db-snapshot-identifier artifact-armoury-prod-$(date +%Y%m%d)

# Export to S3
aws rds start-export-task \
  --export-task-identifier artifact-armoury-prod-export-$(date +%Y%m%d) \
  --source-arn arn:aws:rds:region:account:db:artifact-armoury-prod \
  --s3-bucket-name artifact-armoury-backups \
  --s3-prefix backups/ \
  --iam-role-arn arn:aws:iam::account:role/rds-export-role
```

---

## 📈 Monitoring & Alerts

### CloudWatch Metrics

```bash
# Key metrics to monitor
- DatabaseConnections
- CPUUtilization
- DatabaseConnections
- ReadLatency
- WriteLatency
- DiskQueueDepth
- FreeableMemory
```

### Slow Query Logging

```sql
-- Enable slow query log
ALTER SYSTEM SET log_min_duration_statement = 1000;
SELECT pg_reload_conf();

-- View slow queries
SELECT query, calls, mean_time, max_time 
FROM pg_stat_statements 
WHERE mean_time > 1000 
ORDER BY mean_time DESC;
```

---

## 🔄 Disaster Recovery

### Point-in-Time Recovery

```bash
# Restore to specific time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier artifact-armoury-prod \
  --target-db-instance-identifier artifact-armoury-prod-restore \
  --restore-time 2025-10-29T12:00:00Z
```

### Cross-Region Replication

```bash
# Create read replica in different region
aws rds create-db-instance-read-replica \
  --db-instance-identifier artifact-armoury-prod-replica \
  --source-db-instance-identifier artifact-armoury-prod \
  --availability-zone us-west-2a
```

---

## 🧪 Testing Connection

```bash
# Test connection script
npm run test:db

# Expected output:
# ✓ Database connection successful
# ✓ Schema initialized
# ✓ Admin user verified
```

---

## 📋 Pre-Production Checklist

- [ ] RDS instance created and configured
- [ ] Security groups configured
- [ ] Database and users created
- [ ] SSL/TLS certificates installed
- [ ] Migrations run successfully
- [ ] Connection pooling configured
- [ ] Backups enabled and tested
- [ ] Monitoring and alerts configured
- [ ] Slow query logging enabled
- [ ] Read replicas configured (optional)
- [ ] IAM authentication enabled
- [ ] Secrets stored in AWS Secrets Manager

---

## 🚨 Troubleshooting

### Connection Refused

```bash
# Check security group
aws ec2 describe-security-groups --group-ids sg-xxxxxxxx

# Check RDS status
aws rds describe-db-instances --db-instance-identifier artifact-armoury-prod
```

### Slow Queries

```sql
-- Find slow queries
SELECT query, calls, mean_time 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;

-- Analyze query plan
EXPLAIN ANALYZE SELECT * FROM models WHERE category = 'buildings';
```

### Connection Pool Exhaustion

```bash
# Check active connections
SELECT count(*) FROM pg_stat_activity;

# Kill idle connections
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'idle' AND query_start < now() - interval '30 minutes';
```

---

## 📚 Related Documentation

- [PRODUCTION_ENV_TEMPLATE.md](PRODUCTION_ENV_TEMPLATE.md) - Environment variables
- [DATABASE_BACKUP_STRATEGY.md](DATABASE_BACKUP_STRATEGY.md) - Backup procedures
- [DATABASE_MONITORING.md](DATABASE_MONITORING.md) - Monitoring setup
- [DATABASE_SECURITY.md](DATABASE_SECURITY.md) - Security hardening

---

**Last Updated**: October 29, 2025  
**Version**: 1.0.0  
**Status**: Production Ready

