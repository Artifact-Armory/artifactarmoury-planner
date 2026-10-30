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

/**
 * Split a search box entry into keywords for `keywordSearchSql`. Lower-cased,
 * deduped, capped at 8 words. Simple plural stemming so "houses" finds "House"
 * and "batteries" finds "Battery" (the stem is matched as a substring).
 */
export function searchKeywords(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  const words = raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^["'(,.]+|["'),.!?]+$/g, ''))
    .filter(Boolean)
    .map((w) => {
      if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3)
      if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
      return w
    })
  return [...new Set(words)].slice(0, 8)
}

/**
 * Keyword search across a model's name, description, legacy tags, taxonomy term
 * names/synonyms and artist name. Every keyword must match somewhere (in any
 * order), so "german tank" finds a Panzer whose name says Panzer but whose era
 * term says German. Returns null when there are no keywords.
 *
 * `rank` is an ORDER BY expression: the number of keywords found in the model's
 * name, so name matches come first. It only reuses the WHERE placeholders.
 */
export function keywordSearchSql(
  keywords: string[],
  push: (value: unknown) => string,
): { where: string; rank: string } | null {
  if (!keywords.length) return null
  const likes = keywords.map((w) => push(`%${escapeLike(w)}%`))
  const where = likes
    .map(
      (like) => `(
      m.name ILIKE ${like} OR
      m.description ILIKE ${like} OR
      EXISTS (SELECT 1 FROM unnest(m.tags) tag WHERE tag ILIKE ${like}) OR
      ${termSearchSql(like)} OR
      EXISTS (SELECT 1 FROM users su WHERE su.id = m.artist_id AND su.artist_name ILIKE ${like})
    )`,
    )
    .join(' AND ')
  const rank = likes.map((like) => `(CASE WHEN m.name ILIKE ${like} THEN 1 ELSE 0 END)`).join(' + ')
  return { where: `(${where})`, rank: `(${rank})` }
}
