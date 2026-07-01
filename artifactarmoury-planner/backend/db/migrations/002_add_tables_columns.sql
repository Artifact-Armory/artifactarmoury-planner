ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS session_id UUID,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'user_free'
    CHECK (plan IN ('anon_free', 'user_free', 'pro')),
  ADD COLUMN IF NOT EXISTS max_assets INTEGER DEFAULT 1000;

CREATE INDEX IF NOT EXISTS idx_tables_session ON tables(session_id);
CREATE INDEX IF NOT EXISTS idx_tables_status ON tables(status);
