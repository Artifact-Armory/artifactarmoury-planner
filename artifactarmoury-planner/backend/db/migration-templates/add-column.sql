-- Migration Template: Add Column to Existing Table
-- Description: Template for adding a new column to an existing table
-- Usage: Copy this template and customize for your needs

-- Add a single column
ALTER TABLE table_name
ADD COLUMN IF NOT EXISTS column_name data_type DEFAULT default_value;

-- Examples of common data types:
-- VARCHAR(255) - Text with max length
-- TEXT - Unlimited text
-- INTEGER - Whole numbers
-- DECIMAL(10,2) - Decimal numbers
-- BOOLEAN - True/false
-- TIMESTAMP - Date and time
-- UUID - Unique identifier
-- JSONB - JSON data
-- ARRAY - Array of values

-- Add multiple columns at once
-- ALTER TABLE table_name
-- ADD COLUMN IF NOT EXISTS column1 VARCHAR(255),
-- ADD COLUMN IF NOT EXISTS column2 INTEGER DEFAULT 0,
-- ADD COLUMN IF NOT EXISTS column3 BOOLEAN DEFAULT false;

-- Add column with constraint
-- ALTER TABLE table_name
-- ADD COLUMN IF NOT EXISTS email VARCHAR(255) NOT NULL UNIQUE;

-- Add column with foreign key
-- ALTER TABLE table_name
-- ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Create index for the new column (improves query performance)
-- CREATE INDEX IF NOT EXISTS idx_table_name_column_name ON table_name(column_name);

-- Add comment for documentation
-- COMMENT ON COLUMN table_name.column_name IS 'Description of what this column stores';

-- If you need to populate the column with data:
-- UPDATE table_name SET column_name = value WHERE condition;

