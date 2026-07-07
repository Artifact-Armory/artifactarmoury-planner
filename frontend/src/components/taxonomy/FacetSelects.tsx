import React from 'react'
import { taxonomyApi, termToken, type TaxFacet, type TaxTerm } from '../../api/endpoints/taxonomy'

interface FacetSelectsProps {
  /** Facet slugs to render as dropdowns, in order. */
  facetSlugs: string[]
  /** Optional display-label override per facet slug (e.g. terrain-type → "Type"). */
  labels?: Record<string, string>
  /** Shared selection tokens `facetSlug:termPath` — the same array TermPicker uses. */
  value: string[]
  onChange: (tokens: string[]) => void
  disabled?: boolean
}

interface FlatOption {
  token: string
  label: string
}

/** Depth-first flatten a facet's term tree into indented <option> rows. */
function flatten(terms: TaxTerm[], facetSlug: string, out: FlatOption[] = []): FlatOption[] {
  for (const t of terms) {
    out.push({
      token: termToken(facetSlug, t.path),
      label: `${'  '.repeat(t.depth)}${t.name}${t.ratio ? ` · ${t.ratio}` : ''}`,
    })
    if (t.children?.length) flatten(t.children, facetSlug, out)
  }
  return out
}

/**
 * A row of required, single-select dropdowns for the headline browse facets
 * (Type / Theme & Era / Scale / Condition). Each dropdown owns exactly one term
 * for its facet; selecting replaces that facet's token in the shared `value`
 * array, leaving other facets' tokens (managed by TermPicker) untouched.
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

  // Set the single selection for one facet: drop its existing tokens, add the new one.
  const select = (slug: string, token: string) => {
    const kept = value.filter((t) => !t.startsWith(`${slug}:`))
    onChange(token ? [...kept, token] : kept)
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {facetSlugs.map((slug) => {
        const facet = bySlug.get(slug)
        if (!facet) return null
        const label = labels?.[slug] ?? facet.name
        const options = flatten(facet.terms, slug)
        const current = value.find((t) => t.startsWith(`${slug}:`)) ?? ''
        return (
          <div key={slug}>
            <label className="block text-sm font-medium mb-1">
              {label} <span className="text-red-500">*</span>
            </label>
            <select
              className="w-full border rounded px-3 py-2 bg-white"
              value={current}
              onChange={(e) => select(slug, e.target.value)}
              disabled={disabled}
            >
              <option value="">— Select {label} —</option>
              {options.map((o) => (
                <option key={o.token} value={o.token}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
  )
}

export default FacetSelects
