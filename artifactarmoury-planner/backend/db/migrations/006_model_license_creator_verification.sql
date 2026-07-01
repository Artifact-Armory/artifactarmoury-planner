ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creator_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_badge VARCHAR(50);

ALTER TABLE models
  ADD COLUMN IF NOT EXISTS license VARCHAR(50) NOT NULL DEFAULT 'standard-commercial';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'models_license_check'
      AND conrelid = 'models'::regclass
  ) THEN
    ALTER TABLE models
      ADD CONSTRAINT models_license_check
      CHECK (license IN (
        'cc0',
        'cc-by',
        'cc-by-sa',
        'cc-by-nd',
        'cc-by-nc',
        'standard-commercial',
        'personal-use'
      ));
  END IF;
END $$;

UPDATE models
SET license = 'standard-commercial'
WHERE license IS NULL OR license = '';

CREATE INDEX IF NOT EXISTS idx_models_license ON models(license);
