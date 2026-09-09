-- 061_model_soft_delete.sql
--
-- Deleting a model was a hard DELETE: the row went, the R2 objects were unlinked,
-- and `order_items.model_id ON DELETE SET NULL` silently stripped download access
-- from everyone who had paid for it. Fine while the only artist was the owner of
-- the site; with outside sellers that is a refund and a consumer-law problem.
--
-- Delete is now a soft delete: the row and its files stay, so
--   * buyers keep downloading what they paid for, and
--   * the geometry fingerprint / file hash stay in the dedup corpus, so nobody
--     else can upload the same file as their own.
--
-- WHY A NEW STATUS RATHER THAN A BARE `deleted_at` FLAG:
-- every public listing query already filters `status = 'published'` (browse,
-- search, planner catalogue, artist portfolios — 33 call sites), so a deleted
-- model drops out of all of them with no query changes and no risk of missing
-- one. The flag alone would have needed `deleted_at IS NULL` threaded through
-- ~75 `FROM models` sites, where a single miss leaks a deleted listing.
--
-- WHY NOT REUSE 'archived': that is the MODERATION TAKEDOWN state, and
-- routes/models.ts's download route deliberately blocks archived/flagged models
-- for everyone but admins (copyright removals depend on that). Reusing it would
-- cut off exactly the buyers this migration exists to protect. 'deleted' is a
-- separate state that is hidden from the storefront but still downloadable.
--
-- The artist can re-upload the same file afterwards: migration 039 already made
-- the uploader exempt from dedup (only a match against ANOTHER artist rejects),
-- so a soft-deleted model is a self-match, which is allowed and merely rolls
-- into the existing informational `model.duplicate_allowed` notification.

-- Drop by convention name (019/051 set this precedent on this same table), but
-- verify afterwards: if the live constraint were named anything else, the DROP
-- would silently no-op, the old CHECK would survive alongside the new one, and
-- EVERY delete would 500 on a constraint violation. Fail the migration loudly
-- here instead of discovering that in production.
ALTER TABLE models DROP CONSTRAINT IF EXISTS models_status_check;

DO $$
DECLARE
  leftover TEXT;
BEGIN
  SELECT conname INTO leftover
    FROM pg_constraint
   WHERE conrelid = 'models'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%'
     AND pg_get_constraintdef(oid) ILIKE '%draft%'
   LIMIT 1;

  IF leftover IS NOT NULL THEN
    EXECUTE format('ALTER TABLE models DROP CONSTRAINT %I', leftover);
    RAISE NOTICE 'Dropped non-conventionally-named status check constraint: %', leftover;
  END IF;
END $$;

ALTER TABLE models ADD CONSTRAINT models_status_check
  CHECK (status IN ('draft', 'published', 'archived', 'flagged', 'deleted'));

ALTER TABLE models
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN models.deleted_at IS
  'When the artist soft-deleted this listing. Non-NULL implies status = ''deleted''. The row, its R2 files and its dedup fingerprint are all retained deliberately — buyers keep their downloads and the file stays blocked for other artists.';
COMMENT ON COLUMN models.deleted_by IS
  'Who performed the soft delete (the artist, or an admin acting on their behalf).';

-- Partial index: the artist-facing lists filter these out on every page load.
CREATE INDEX IF NOT EXISTS idx_models_not_deleted ON models(artist_id) WHERE deleted_at IS NULL;
