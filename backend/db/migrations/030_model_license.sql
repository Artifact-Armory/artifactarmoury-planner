-- 030_model_license.sql
-- Per-model usage licence. The marketplace sells DIGITAL STL downloads, and the
-- watermark only makes leaks *traceable* — it is legally toothless without an
-- explicit licence saying what a buyer may do with the file. Standard split in
-- this space:
--
--   personal   : print for your own personal use; may NOT sell printed copies.
--   commercial : print AND sell the physical prints you make (merchant licence).
--
-- Both licences forbid redistributing/reselling the digital file itself — that is
-- the platform-wide rule the per-buyer watermark enforces.
--
-- Default 'personal' (the conservative choice) so existing rows get the tighter
-- licence rather than accidentally granting commercial rights.

ALTER TABLE models ADD COLUMN IF NOT EXISTS license TEXT NOT NULL DEFAULT 'personal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'models_license_check'
  ) THEN
    ALTER TABLE models
      ADD CONSTRAINT models_license_check CHECK (license IN ('personal', 'commercial'));
  END IF;
END $$;

COMMENT ON COLUMN models.license IS 'Buyer usage licence: personal (own use only) | commercial (may sell physical prints). Neither permits redistributing the digital file.';
