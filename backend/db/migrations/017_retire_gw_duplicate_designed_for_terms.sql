-- Migration 017: retire duplicate Games Workshop entries in the "Can be used with"
-- (designed-for) facet.
--
-- All of GW's 40k-family games (Kill Team, Necromunda, Horus Heresy) share the same
-- 28mm-heroic scale as core Warhammer 40,000, and the AoS-family (Warcry, Mordheim)
-- match Age of Sigmar. Since terrain compatibility is a matter of scale, the
-- marketplace now lists a single scale-labelled entry per family (with the other
-- game names kept as search synonyms on that entry, per the taxonomy seed).
--
-- The seed is upsert-only and never deactivates, so we retire the now-consolidated
-- individual terms here. is_active = false hides them from every taxonomy query
-- (pickers, browse rail, product pages) while preserving any existing model_terms
-- links. Idempotent; a no-op on a fresh DB where the facet/terms don't exist yet.

UPDATE terms SET is_active = false, updated_at = NOW()
WHERE facet_id = (SELECT id FROM facets WHERE slug = 'designed-for')
  AND path IN (
    'sci-fi-skirmish-battle/kill-team',
    'sci-fi-skirmish-battle/necromunda-style-underhive',
    'sci-fi-skirmish-battle/horus-heresy',
    'fantasy/warcry',
    'fantasy/mordheim-style'
  );
