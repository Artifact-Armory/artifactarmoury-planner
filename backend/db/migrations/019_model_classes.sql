-- Migration 019: top-level MODEL CLASSES (Terrain / Vehicles / Characters & Units)
--
-- The marketplace used to sell terrain only, so the faceted taxonomy (migration 011)
-- treated `terrain-type` as the required primary axis and every browse/upload/planner
-- surface showed all facets to every model. We now sell three top-level classes, each
-- with its own detailed type tree and correctly-scoped facets.
--
-- This migration is SCHEMA ONLY. The actual vocabulary (the `model-class` facet plus
-- the `vehicle-type` / `character-type` trees) and the backfill of existing models to
-- `model-class:terrain` live in the idempotent taxonomy seed (scripts/seed-taxonomy.ts),
-- which runs in the postmigrate hook AFTER this migration — so the terms it backfills
-- against don't exist yet at migration time.
--
-- Two schema changes:
--   1. facets.applies_to — the class slugs a facet is relevant to (NULL = universal).
--      Drives which facets the upload form / browse rail / planner show per class, and
--      class-conditional required-ness (a vehicle must tag vehicle-type, not terrain-type).
--   2. models.category CHECK — allow the two new legacy categories, since from-upload
--      maps the chosen model-class onto the legacy `category` column so the existing
--      category-based code paths (browse related / categories / stats) keep working.

ALTER TABLE facets ADD COLUMN IF NOT EXISTS applies_to TEXT[];

ALTER TABLE models DROP CONSTRAINT IF EXISTS models_category_check;
ALTER TABLE models ADD CONSTRAINT models_category_check CHECK (category IN (
    'buildings', 'nature', 'scatter', 'props', 'complete_sets', 'other',
    'vehicles', 'characters'
));
