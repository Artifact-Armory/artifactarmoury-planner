import React from 'react'
import { ChevronDown, Check, Search, X } from 'lucide-react'
import { taxonomyApi, termToken, type TaxFacet, type TaxTerm } from '../../api/endpoints/taxonomy'

interface FacetSelectsProps {
  /** Facet slugs to render as dropdowns, in order. */
  facetSlugs: string[]
  /** Optional display-label override per facet slug (e.g. terrain-type → "Model type"). */
  labels?: Record<string, string>
  /** Shared selection tokens `facetSlug:termPath` — the same array TermPicker uses. */
  value: string[]
  onChange: (tokens: string[]) => void
  disabled?: boolean
}

interface FlatOption {
  token: string
  name: string
  depth: number
  /** Lower-cased haystack (name + synonyms) for the in-dropdown filter. */
  search: string
}

/** Depth-first flatten a facet's term tree into indented options. */
function flatten(terms: TaxTerm[], facetSlug: string, out: FlatOption[] = []): FlatOption[] {
  for (const t of terms) {
    out.push({
      token: termToken(facetSlug, t.path),
      name: `${t.name}${t.ratio ? ` · ${t.ratio}` : ''}`,
      depth: t.depth,
      search: [t.name, ...(t.synonyms ?? [])].join(' ').toLowerCase(),
    })
    if (t.children?.length) flatten(t.children, facetSlug, out)
  }
  return out
}

/**
 * One facet as a dropdown whose rows are tick boxes — buyers can pick several
 * terms per facet (up to the facet's `maxTerms` cap). Selections are stored as
 * `facetSlug:termPath` tokens in the shared `value` array; toggling one only
 * touches this facet's tokens, leaving others (managed by TermPicker) untouched.
 */
const FacetMultiSelect: React.FC<{
  slug: string
  facet: TaxFacet
  label: string
  value: string[]
  onChange: (tokens: string[]) => void
  disabled?: boolean
}> = ({ slug, facet, label, value, onChange, disabled }) => {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)

  const options = React.useMemo(() => flatten(facet.terms, slug), [facet, slug])
  const nameByToken = React.useMemo(() => new Map(options.map((o) => [o.token, o.name])), [options])
  const selectedTokens = React.useMemo(() => value.filter((t) => t.startsWith(`${slug}:`)), [value, slug])
  const selectedSet = React.useMemo(() => new Set(selectedTokens), [selectedTokens])
  const max = facet.maxTerms ?? null
  const atCap = max != null && selectedTokens.length >= max

  // Only show a search box for facets with enough options to warrant one.
  const searchable = options.length > 8
  const needle = query.trim().toLowerCase()
  const visibleOptions = React.useMemo(
    () => (needle ? options.filter((o) => o.search.includes(needle)) : options),
    [options, needle],
  )

  // Close when clicking away.
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Reset the filter whenever the dropdown closes.
  React.useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const toggle = (token: string) => {
    if (disabled) return
    if (selectedSet.has(token)) {
      onChange(value.filter((t) => t !== token))
    } else {
      if (atCap) return // respect the per-facet cap
      onChange([...value, token])
    }
  }

  const summary =
    selectedTokens.length === 0
      ? `Select ${label}…`
      : selectedTokens.map((t) => nameByToken.get(t) ?? t.split(':').pop()).join(', ')

  return (
    <div>
      <label className="block text-sm font-medium mb-1">
        {label} <span className="text-red-500">*</span>
      </label>
      <div ref={ref} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className={`w-full flex items-center justify-between gap-2 border rounded px-3 py-2 bg-white text-left disabled:opacity-60 ${
            selectedTokens.length ? 'text-gray-900' : 'text-gray-400'
          }`}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown
            size={16}
            className={`flex-none text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 text-xs text-gray-500">
              <span>Tick one or more</span>
              <span>
                {selectedTokens.length}
                {max != null ? `/${max}` : ''}
              </span>
            </div>
            {searchable && (
              <div className="border-b border-gray-100 p-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${label.toLowerCase()}…`}
                    className="w-full rounded-sm border border-gray-300 py-1.5 pl-8 pr-8 text-sm focus:border-indigo-500 focus:outline-hidden"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            )}
            <ul className="max-h-64 overflow-auto py-1">
              {visibleOptions.length === 0 && (
                <li className="px-3 py-2 text-sm text-gray-400">No matches</li>
              )}
              {visibleOptions.map((o) => {
                const checked = selectedSet.has(o.token)
                const blocked = !checked && atCap
                return (
                  <li key={o.token}>
                    <button
                      type="button"
                      disabled={disabled || blocked}
                      onClick={() => toggle(o.token)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-indigo-50 disabled:opacity-40 disabled:hover:bg-transparent"
                      style={{ paddingLeft: 12 + o.depth * 14 }}
                    >
                      <span
                        className={`flex h-4 w-4 flex-none items-center justify-center rounded border ${
                          checked ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300'
                        }`}
                      >
                        {checked && <Check size={12} />}
                      </span>
                      <span className="truncate">{o.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {atCap && (
              <div className="border-t border-gray-100 px-3 py-1.5 text-xs text-amber-600">
                Up to {max} — untick one to swap.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A row of required, multi-select dropdowns for the headline browse facets
 * (Model type / Theme & Era / Scale / Condition), populated from the taxonomy tree.
 */
const FacetSelects: React.FC<FacetSelectsProps> = ({ facetSlugs, labels, value, onChange, disabled }) => {
  const [facets, setFacets] = React.useState<TaxFacet[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    taxonomyApi
      .getTree()
      .then((f) => alive && setFacets(f))
      .catch(() => alive && setError('Could not load the tag options.'))
    return () => {
      alive = false
    }
  }, [])

  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!facets) return <p className="text-sm text-gray-500">Loading options…</p>

  const bySlug = new Map(facets.map((f) => [f.slug, f]))

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {facetSlugs.map((slug) => {
        const facet = bySlug.get(slug)
        if (!facet) return null
        return (
          <FacetMultiSelect
            key={slug}
            slug={slug}
            facet={facet}
            label={labels?.[slug] ?? facet.name}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        )
      })}
    </div>
  )
}

export default FacetSelects
