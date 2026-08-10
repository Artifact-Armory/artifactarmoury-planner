import React from 'react'
import { ChevronRight, ChevronDown, Check, Search, X } from 'lucide-react'
import {
  taxonomyApi,
  termToken,
  facetAppliesTo,
  MODEL_CLASS_SLUG,
  type TaxFacet,
  type TaxTerm,
} from '../../api/endpoints/taxonomy'

interface TermPickerProps {
  /** Selected tokens `facetSlug:termPath`. */
  value: string[]
  onChange: (tokens: string[]) => void
  disabled?: boolean
  /**
   * Facet slugs to hide from the picker (they're chosen elsewhere, e.g. as
   * required dropdowns). Their tokens already in `value` are left untouched.
   */
  excludeFacets?: string[]
  /**
   * Term subtrees to hide, as `facetSlug:path` prefixes (e.g.
   * `print-files:process`). Use this when only PART of a facet duplicates a
   * dedicated field — hiding the whole facet would take its other groups with
   * it. Tokens already in `value` are left untouched, exactly like
   * `excludeFacets`.
   */
  excludeTermPaths?: string[]
  /**
   * The model's class (terrain / vehicles / characters). When set, only facets
   * applicable to that class are shown; the model-class facet itself is always
   * hidden (it's chosen via a dedicated picker).
   */
  modelClass?: string | null
}

/** Keep only nodes that match `q` (by name) or have a matching descendant. */
function filterTerms(terms: TaxTerm[], q: string): TaxTerm[] {
  const needle = q.toLowerCase()
  const out: TaxTerm[] = []
  for (const t of terms) {
    const kids = filterTerms(t.children ?? [], q)
    const selfMatch =
      t.name.toLowerCase().includes(needle) ||
      (t.synonyms ?? []).some((s) => s.toLowerCase().includes(needle))
    if (selfMatch || kids.length) out.push({ ...t, children: kids })
  }
  return out
}

const TermPicker: React.FC<TermPickerProps> = ({
  value, onChange, disabled, excludeFacets, excludeTermPaths, modelClass,
}) => {
  const [facets, setFacets] = React.useState<TaxFacet[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    let alive = true
    taxonomyApi
      .getTree()
      .then((f) => alive && setFacets(f))
      .catch(() => alive && setError('Could not load the tag catalogue.'))
    return () => {
      alive = false
    }
  }, [])

  const selected = React.useMemo(() => new Set(value), [value])
  const countInFacet = (facetSlug: string) =>
    value.filter((t) => t.startsWith(`${facetSlug}:`)).length

  const toggle = (facet: TaxFacet, path: string) => {
    if (disabled) return
    const token = termToken(facet.slug, path)
    if (selected.has(token)) {
      onChange(value.filter((t) => t !== token))
    } else {
      if (facet.maxTerms != null && countInFacet(facet.slug) >= facet.maxTerms) return
      onChange([...value, token])
    }
  }

  const toggleExpand = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!facets) return <p className="text-sm text-gray-500">Loading tags…</p>

  const searching = query.trim().length > 0

  const Chip: React.FC<{ facet: TaxFacet; term: TaxTerm }> = ({ facet, term }) => {
    const token = termToken(facet.slug, term.path)
    const isSel = selected.has(token)
    const atCap =
      !isSel && facet.maxTerms != null && countInFacet(facet.slug) >= facet.maxTerms
    return (
      <button
        type="button"
        disabled={disabled || atCap}
        onClick={() => toggle(facet, term.path)}
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition ${
          isSel
            ? 'border-indigo-600 bg-indigo-600 text-white'
            : atCap
            ? 'cursor-not-allowed border-gray-200 text-gray-300'
            : 'border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-600'
        }`}
        title={term.synonyms?.length ? `Also: ${term.synonyms.join(', ')}` : undefined}
      >
        {isSel && <Check size={13} />}
        {term.name}
        {term.ratio && <span className="opacity-60">· {term.ratio}</span>}
      </button>
    )
  }

  // Recursive tree row (for selection_ui === 'tree').
  const TreeNode: React.FC<{ facet: TaxFacet; term: TaxTerm }> = ({ facet, term }) => {
    const key = `${facet.slug}::${term.path}`
    const hasKids = (term.children?.length ?? 0) > 0
    const isOpen = searching || expanded.has(key)
    const token = termToken(facet.slug, term.path)
    const isSel = selected.has(token)
    const atCap = !isSel && facet.maxTerms != null && countInFacet(facet.slug) >= facet.maxTerms
    return (
      <li>
        <div className="flex items-center gap-1" style={{ paddingLeft: term.depth * 14 }}>
          {hasKids ? (
            <button
              type="button"
              onClick={() => toggleExpand(key)}
              className="p-0.5 text-gray-400 hover:text-gray-700"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
            >
              {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
          ) : (
            <span className="w-[19px]" />
          )}
          <button
            type="button"
            disabled={disabled || atCap}
            onClick={() => toggle(facet, term.path)}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-sm transition ${
              isSel
                ? 'bg-indigo-600 text-white'
                : atCap
                ? 'cursor-not-allowed text-gray-300'
                : 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-700'
            }`}
          >
            {isSel && <Check size={13} />}
            {term.name}
          </button>
        </div>
        {hasKids && isOpen && (
          <ul>
            {term.children.map((c) => (
              <TreeNode key={c.id} facet={facet} term={c} />
            ))}
          </ul>
        )}
      </li>
    )
  }

  /** Drop any subtree named in `excludeTermPaths` for this facet. */
  const prunedTerms = (facet: TaxFacet): TaxTerm[] => {
    const prefixes = (excludeTermPaths ?? [])
      .filter((e) => e.startsWith(`${facet.slug}:`))
      .map((e) => e.slice(facet.slug.length + 1))
    if (!prefixes.length) return facet.terms
    const keep = (list: TaxTerm[]): TaxTerm[] =>
      list
        .filter((t) => !prefixes.some((p) => t.path === p || t.path.startsWith(`${p}/`)))
        .map((t) => ({ ...t, children: keep(t.children ?? []) }))
    return keep(facet.terms)
  }

  const renderFacetBody = (facet: TaxFacet) => {
    const base = prunedTerms(facet)
    const terms = searching ? filterTerms(base, query.trim()) : base
    // Nothing left to show — either the search matched nothing, or every term in
    // this facet was excluded. Either way the outer map hides the whole card.
    if (terms.length === 0) return null

    if (facet.selectionUi === 'tree') {
      return (
        <ul className="space-y-0.5">
          {terms.map((t) => (
            <TreeNode key={t.id} facet={facet} term={t} />
          ))}
        </ul>
      )
    }
    if (facet.selectionUi === 'grouped') {
      return (
        <div className="space-y-3">
          {terms.map((group) => (
            <div key={group.id}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {group.name}
              </p>
              <div className="flex flex-wrap gap-2">
                {(group.children?.length ? group.children : [group]).map((t) => (
                  <Chip key={t.id} facet={facet} term={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )
    }
    // chips / flat
    return (
      <div className="flex flex-wrap gap-2">
        {terms.map((t) => (
          <Chip key={t.id} facet={facet} term={t} />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tags (e.g. hedgerow, bunker, 28mm)…"
          className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-9 text-sm focus:border-indigo-500 focus:outline-none"
          disabled={disabled}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {facets
        .filter(
          (facet) =>
            !(excludeFacets ?? []).includes(facet.slug) &&
            facet.slug !== MODEL_CLASS_SLUG &&
            (modelClass === undefined || facetAppliesTo(facet, modelClass)),
        )
        .map((facet) => {
        const body = renderFacetBody(facet)
        if (body === null) return null // hidden while searching with no matches
        const count = countInFacet(facet.slug)
        const needsMore = facet.required && count === 0
        return (
          <div key={facet.id} className="rounded-lg border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">{facet.name}</h3>
                {facet.required && <span className="text-red-500" title="Required">*</span>}
                {facet.maxTerms != null && (
                  <span className="text-xs text-gray-400">
                    {count}/{facet.maxTerms}
                  </span>
                )}
              </div>
              {count > 0 && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((t) => !t.startsWith(`${facet.slug}:`)))}
                  className="text-xs text-gray-400 hover:text-gray-700"
                >
                  Clear
                </button>
              )}
            </div>
            {needsMore && (
              <p className="mb-2 text-xs text-amber-600">Pick at least one to publish.</p>
            )}
            {body}
          </div>
        )
      })}
    </div>
  )
}

export default TermPicker
