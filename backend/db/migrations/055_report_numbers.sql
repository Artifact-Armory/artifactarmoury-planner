-- 055_report_numbers.sql
--
-- Every model_reports row is UUID-only today, which is fine for the app but
-- useless as something a human types, reads over the phone, or cites in an
-- email ("re: report a1b2c3d4-..."). Admin asked for a short, sequential
-- report number so reports can be looked up and referenced like a ticket.
--
-- Backfilled in creation order (not insertion/physical order) so existing
-- reports get numbers that read sensibly against their created_at, then a
-- sequence takes over for everything filed from here on.

ALTER TABLE model_reports ADD COLUMN IF NOT EXISTS report_number INTEGER;

CREATE SEQUENCE IF NOT EXISTS model_reports_report_number_seq;

-- Backfill only rows that don't already have a number (safe to re-run).
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM model_reports
  WHERE report_number IS NULL
)
UPDATE model_reports m
SET report_number = ordered.rn + COALESCE((SELECT MAX(report_number) FROM model_reports), 0)
FROM ordered
WHERE m.id = ordered.id;

-- Point the sequence past the highest number now in use so newly-inserted
-- rows continue the same series instead of colliding with the backfill.
SELECT setval('model_reports_report_number_seq', COALESCE((SELECT MAX(report_number) FROM model_reports), 0) + 1, false);

ALTER TABLE model_reports ALTER COLUMN report_number SET DEFAULT nextval('model_reports_report_number_seq');
ALTER TABLE model_reports ALTER COLUMN report_number SET NOT NULL;
ALTER SEQUENCE model_reports_report_number_seq OWNED BY model_reports.report_number;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'model_reports_report_number_key'
  ) THEN
    ALTER TABLE model_reports ADD CONSTRAINT model_reports_report_number_key UNIQUE (report_number);
  END IF;
END $$;

COMMENT ON COLUMN model_reports.report_number IS
  'Short sequential ticket number shown to admins/artists/reporters, distinct from the UUID id. Assigned in creation order.';
