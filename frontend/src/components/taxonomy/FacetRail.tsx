import React from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { termToken, type TaxFacet, type TaxTerm } from '../../api/endpoints/taxonomy'

interface FacetRailProps {
  facets: TaxFacet[]
  /** Selected tokens `facetSlug:termPath`. */
  selected: Set<string>
  onToggle: (token: string) => void
  loading?: boolean
}

/**
 * The browse filter rail. Renders each facet per its selection_ui (tree / grouped
 * / chips) with live result counts. Server prunes zero-count terms (hideZero), so
 * whatever arrives here is worth showing.
 */
const FacetRail: React.FC<FacetRailProps> = ({ facets, selected, onToggle, loading }) => {
  // Facets collapse/expand at the section level; tree branches expand individually.
  const [openFacets, setOpenFacets] = React.useState<Set<string>>(
    () => new Set(facets.map((f) => f.slug)),
  )
  const [openNodes, setOpenNodes] = React.useState<Set<string>>(new Set())

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) =>
    setter((s) => {
      const next = new Set(s)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const Row: React.FC<{ facet: TaxFacet; term: TaxTerm; indent: number }> = ({
    facet,
    term,
    indent,
  }) => {
    const token = termToken(facet.slug, term.path)
    const isSel = selected.has(token)
    const nodeKey = `${facet.slug}::${term.path}`
    const hasKids = (term.children?.length ?? 0) > 0
    const open = openNodes.has(nodeKey)
    return (
      <div>
        <div
          className="flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-accent"
          style={{ paddingLeft: indent * 12 }}
        >
          {hasKids ? (
            <button
              type="button"
              onClick={() => toggleSet(setOpenNodes, nodeKey)}
              className="p-0.5 text-muted-foreground hover:text-foreground"
              aria-label={open ? 'Collapse' : 'Expand'}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="w-[18px]" />
          )}
          <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isSel}
              onChange={() => onToggle(token)}
              className="h-3.5 w-3.5 rounded-sm border-border text-primary focus:ring-primary"
            />
            <span className={isSel ? 'font-medium text-primary' : 'text-foreground'}>
              {term.name}
            </span>
            {term.ratio && <span className="text-xs text-muted-foreground">{term.ratio}</span>}
            {typeof term.count === 'number' && (
              <span className="ml-auto text-xs text-muted-foreground">{term.count}</span>
            )}
          </label>
        </div>
        {hasKids && open && (
          <div>
            {term.children.map((c) => (
              <Row key={c.id} facet={facet} term={c} indent={indent + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  const facetBody = (facet: TaxFacet) => {
    if (facet.selectionUi === 'grouped') {
      return (
        <div className="space-y-2">
          {facet.terms.map((group) => (
            <div key={group.id}>
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.name}
              </p>
              {(group.children?.length ? group.children : [group]).map((t) => (
                <Row key={t.id} facet={facet} term={t} indent={0} />
              ))}
            </div>
          ))}
        </div>
      )
    }
    // tree + chips + flat all render as an indented checkbox list; tree adds
    // expandable branches (handled per-Row).
    return (
      <div>
        {facet.terms.map((t) => (
          <Row key={t.id} facet={facet} term={t} indent={0} />
        ))}
      </div>
    )
  }

  return (
    <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
      {facets.map((facet) => {
        if (!facet.terms.length) return null
        const open = openFacets.has(facet.slug)
        const selectedInFacet = facet.terms.length
          ? [...selected].filter((t) => t.startsWith(`${facet.slug}:`)).length
          : 0
        return (
          <div key={facet.id} className="border-b border-border pb-3">
            <button
              type="button"
              onClick={() => toggleSet(setOpenFacets, facet.slug)}
              className="flex w-full items-center justify-between py-1 text-left"
            >
              <span className="text-sm font-semibold text-foreground">
                {facet.name}
                {selectedInFacet > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 text-xs font-medium text-primary">
                    {selectedInFacet}
                  </span>
                )}
              </span>
              {open ? (
                <ChevronDown size={16} className="text-muted-foreground" />
              ) : (
                <ChevronRight size={16} className="text-muted-foreground" />
              )}
            </button>
            {open && <div className="mt-1">{facetBody(facet)}</div>}
          </div>
        )
      })}
    </div>
  )
}

export default FacetRail
