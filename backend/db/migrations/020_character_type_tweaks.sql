-- Migration 020: retire the character-type terms consolidated into "Specialists".
--
-- The character-type tree (added in migration 019 + the taxonomy seed) originally
-- listed separate "Snipers" and "Engineers & Sappers" infantry terms. These are now
-- folded into a single "Specialists" term. The seed is upsert-only and never
-- deactivates, so we retire the superseded terms here (is_active = false hides them
-- from every taxonomy query while preserving any existing model_terms links).
--
-- Idempotent; a no-op on a DB where the facet/terms don't exist yet.

UPDATE terms SET is_active = false, updated_at = NOW()
WHERE facet_id = (SELECT id FROM facets WHERE slug = 'character-type')
  AND path IN (
    'infantry/snipers',
    'infantry/engineers-and-sappers'
  );
