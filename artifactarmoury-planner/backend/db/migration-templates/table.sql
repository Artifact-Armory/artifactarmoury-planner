-- Migration Template: Create New Table
-- Description: Template for creating a new table with common fields
-- Usage: Copy this template and customize for your table

CREATE TABLE IF NOT EXISTS table_name (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign keys (if needed)
  -- user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- parent_id UUID REFERENCES table_name(id) ON DELETE SET NULL,
  
  -- Data fields
  -- name VARCHAR(255) NOT NULL,
  -- description TEXT,
  -- status VARCHAR(50) DEFAULT 'active',
  -- metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
-- CREATE INDEX idx_table_name_user_id ON table_name(user_id);
-- CREATE INDEX idx_table_name_status ON table_name(status);
-- CREATE INDEX idx_table_name_created_at ON table_name(created_at);

-- Create unique constraints if needed
-- ALTER TABLE table_name ADD CONSTRAINT unique_table_name_slug UNIQUE (slug);

-- Add comments for documentation
-- COMMENT ON TABLE table_name IS 'Description of what this table stores';
-- COMMENT ON COLUMN table_name.id IS 'Unique identifier';
-- COMMENT ON COLUMN table_name.created_at IS 'Timestamp when record was created';

