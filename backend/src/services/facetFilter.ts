// backend/src/services/facetFilter.ts
//
// Shared helpers for filtering models by taxonomy terms (see migration 011).
//
// Filter semantics: OR within a facet, AND across facets. Selecting a parent term
// matches the parent AND every descendant, via the materialised `terms.path`
// (a slug path like 'buildings/residential/cottages-and-farmhouses'): a model
// matches a selected path P if it carries a term whose path = P or LIKE 'P/%'.
//
// The wire format for the `terms` query param is a comma-separated list of
// `facetSlug:termPath` tokens, e.g.
//   ?terms=terrain-type:buildings/residential,scale:28mm,condition:ruined
// (term paths contain '/', facet/path split on the FIRST ':').

/** facetSlug -> selected term paths (deduped, non-empty). */
export type TermGroups = Map<string, string[]>

export function parseTermsParam(raw: unknown): TermGroups {
  const groups: TermGroups = new Map()
  if (!raw) return groups
  const str = Array.isArray(raw) ? raw.join(',') : String(raw)
  for (const token of str.split(',')) {
    const trimmed = token.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0) continue
    const facet = trimmed.slice(0, idx).trim()
    const path = trimmed.slice(idx + 1).trim().replace(/^\/+|\/+$/g, '')
    if (!facet || !path) continue
    const list = groups.get(facet) ?? []
    if (!list.includes(path)) list.push(path)
    groups.set(facet, list)
  }
  return groups
}

/** Escape LIKE metacharacters so a path can't act as a wildcard in the prefix match. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&')
}

/**
 * SQL fragment (referencing model alias `m`) that is true when a model carries at
 * least one term in `facetSlug` matching any selected path or its descendants.
 * `push(value)` appends a bound parameter and returns its `$n` placeholder, so the
 * caller controls parameter numbering.
 */
export function facetExistsSql(
  facetSlug: string,
  paths: string[],
  push: (value: unknown) => string,
): string {
  const slugP = push(facetSlug)
  const exactP = push(paths)
  const prefixP = push(paths.map((p) => `${escapeLike(p)}/%`))
  return `EXISTS (
    SELECT 1 FROM model_terms mt
    JOIN terms tt ON tt.id = mt.term_id
    JOIN facets ff ON ff.id = tt.facet_id
    WHERE mt.model_id = m.id
      AND ff.slug = ${slugP}
      AND (tt.path = ANY(${exactP}::text[]) OR tt.path LIKE ANY(${prefixP}::text[]))
  )`
}

/** Build one AND-ed EXISTS clause per facet group. */
export function facetConditions(
  groups: TermGroups,
  push: (value: unknown) => string,
  opts: { exclude?: string } = {},
): string[] {
  const out: string[] = []
  for (const [facet, paths] of groups) {
    if (opts.exclude && facet === opts.exclude) continue
    if (!paths.length) continue
    out.push(facetExistsSql(facet, paths, push))
  }
  return out
}

/**
 * SQL fragment that is true when a model carries a term whose display name OR a
 * synonym matches the search term — lets a search for "hedgerow" surface pieces
 * tagged Bocage Banks. `like` is the `%term%` placeholder already bound.
 */
export function termSearchSql(likePlaceholder: string): string {
  return `EXISTS (
    SELECT 1 FROM model_terms mt
    JOIN terms tt ON tt.id = mt.term_id
    WHERE mt.model_id = m.id
      AND (tt.name ILIKE ${likePlaceholder}
        OR EXISTS (SELECT 1 FROM unnest(COALESCE(tt.synonyms, '{}')) syn WHERE syn ILIKE ${likePlaceholder}))
  )`
}
