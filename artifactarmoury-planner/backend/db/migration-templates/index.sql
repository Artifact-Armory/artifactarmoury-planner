-- Migration Template: Create Indexes
-- Description: Template for creating indexes to improve query performance
-- Usage: Copy this template and customize for your needs

-- Single column index
CREATE INDEX IF NOT EXISTS idx_table_name_column_name ON table_name(column_name);

-- Composite index (multiple columns)
-- CREATE INDEX IF NOT EXISTS idx_table_name_col1_col2 ON table_name(column1, column2);

-- Unique index (ensures uniqueness)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_table_name_email ON table_name(email);

-- Partial index (only indexes rows matching condition)
-- CREATE INDEX IF NOT EXISTS idx_table_name_active ON table_name(id) WHERE status = 'active';

-- Index on expression
-- CREATE INDEX IF NOT EXISTS idx_table_name_lower_email ON table_name(LOWER(email));

-- BRIN index (for large tables with sequential data)
-- CREATE INDEX IF NOT EXISTS idx_table_name_created_at ON table_name USING BRIN (created_at);

-- GiST index (for geometric data or full-text search)
-- CREATE INDEX IF NOT EXISTS idx_table_name_search ON table_name USING GiST (search_column);

-- GIN index (for array or JSONB columns)
-- CREATE INDEX IF NOT EXISTS idx_table_name_metadata ON table_name USING GIN (metadata);

-- Drop index if needed
-- DROP INDEX IF EXISTS idx_table_name_old_column;

-- Analyze table to update statistics
-- ANALYZE table_name;

-- Check index usage
-- SELECT schemaname, tablename, indexname, idx_scan
-- FROM pg_stat_user_indexes
-- WHERE tablename = 'table_name'
-- ORDER BY idx_scan DESC;

