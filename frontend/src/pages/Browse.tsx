import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { X, Search } from 'lucide-react'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import ModelGrid from '../components/models/ModelGrid'
import FacetRail from '../components/taxonomy/FacetRail'
import Seo from '../components/common/Seo'
import { browseApi } from '../api/endpoints/browse'
import {
  taxonomyApi,
  facetAppliesTo,
  MODEL_CLASSES,
  MODEL_CLASS_SLUG,
  type TaxFacet,
} from '../api/endpoints/taxonomy'
import { SearchFilters } from '../api/types'
import TrademarkDisclaimer, { mentionsTrademark } from '../components/legal/TrademarkDisclaimer'
import { FEATURES } from '../config/features'

const sortOptions: { value: SearchFilters['sortBy']; label: string }[] = [
  { value: 'recent', label: 'Newest' },
  { value: 'popular', label: 'Most popular' },
  { value: 'sales', label: 'Best sellers' },
  { value: 'rating', label: 'Top rated' },
  { value: 'price_low', label: 'Price: Low to high' },
  { value: 'price_high', label: 'Price: High to low' },
  { value: 'name', label: 'Alphabetical' },
]

const DEFAULT_LIMIT = 24

const Browse: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()

  const searchTermParam = searchParams.get('search') ?? searchParams.get('query') ?? ''
  const termsParam = searchParams.get('terms') ?? ''
  const minPriceParam = searchParams.get('minPrice') ?? ''
  const maxPriceParam = searchParams.get('maxPrice') ?? ''
  const sortByParam = (searchParams.get('sortBy') as SearchFilters['sortBy']) ?? 'recent'
  // With Print & Ship parked, everything is a digital download — force 'stl' so
  // an old ?fulfillment=print bookmark can't strand a buyer in an empty filter
  // with no visible tab to escape it.
  const fulfillmentParam = (
    FEATURES.printAndShip && searchParams.get('fulfillment') === 'print' ? 'print' : 'stl'
  ) as 'stl' | 'print'
  const pageParam = Number(searchParams.get('page') ?? 1)

  const [searchTerm, setSearchTerm] = useState(searchTermParam)
  const [minPrice, setMinPrice] = useState(minPriceParam)
  const [maxPrice, setMaxPrice] = useState(maxPriceParam)

  // Live search: debounce the keyword box into the URL so results filter as you
  // type (no need to hit "Apply" to find a specific model).
  React.useEffect(() => {
    if (searchTerm === searchTermParam) return
    const id = setTimeout(() => {
      const next = new URLSearchParams(searchParams)
      if (searchTerm) next.set('search', searchTerm)
      else next.delete('search')
      next.delete('query')
      next.delete('page')
      setSearchParams(next)
    }, 300)
    return () => clearTimeout(id)
  }, [searchTerm, searchTermParam, searchParams, setSearchParams])

  const selectedTokens = useMemo(
    () => new Set(termsParam ? termsParam.split(',').filter(Boolean) : []),
    [termsParam],
  )

  // The currently-selected model class (Terrain / Vehicles / Characters), if any.
  const selectedClass = useMemo(() => {
    const tok = [...selectedTokens].find((t) => t.startsWith(`${MODEL_CLASS_SLUG}:`))
    return tok ? tok.slice(MODEL_CLASS_SLUG.length + 1) : null
  }, [selectedTokens])

  // Surface the non-affiliation notice when someone searches a trademarked game
  // name or filters by a "Can be used with" (designed-for) compatibility term.
  const showTrademarkNotice = useMemo(
    () =>
      mentionsTrademark(searchTermParam) ||
      [...selectedTokens].some((t) => t.startsWith('designed-for:')),
    [searchTermParam, selectedTokens],
  )

  const filters = useMemo<SearchFilters>(
    () => ({
      search: searchTermParam || undefined,
      terms: termsParam || undefined,
      minPrice: minPriceParam ? Number(minPriceParam) : undefined,
      maxPrice: maxPriceParam ? Number(maxPriceParam) : undefined,
      sortBy: sortByParam,
      fulfillment: fulfillmentParam,
      page: pageParam,
      limit: DEFAULT_LIMIT,
    }),
    [searchTermParam, termsParam, minPriceParam, maxPriceParam, sortByParam, fulfillmentParam, pageParam],
  )

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['browse-models', filters],
    queryFn: () => browseApi.searchModels(filters),
    placeholderData: (prev: any) => prev,
  })

  // The facet rail with live, context-aware counts (zero-count terms pruned).
  const { data: facets, isFetching: facetsFetching } = useQuery({
    queryKey: ['browse-facets', termsParam, searchTermParam, minPriceParam, maxPriceParam],
    queryFn: () =>
      taxonomyApi.getFacetsWithCounts({
        terms: termsParam || undefined,
        search: searchTermParam || undefined,
        minPrice: minPriceParam ? Number(minPriceParam) : undefined,
        maxPrice: maxPriceParam ? Number(maxPriceParam) : undefined,
        hideZero: true,
      }),
    placeholderData: (prev: any) => prev,
  })

  // Full tree once, purely for labelling selected chips (a selected term can be
  // pruned from the counted rail, so we need a stable name lookup).
  const { data: tree } = useQuery({
    queryKey: ['taxonomy-tree'],
    queryFn: () => taxonomyApi.getTree(),
    staleTime: Infinity,
  })

  const labelByToken = useMemo(() => {
    const map = new Map<string, string>()
    const walk = (facetSlug: string, terms: any[]) => {
      for (const t of terms) {
        map.set(`${facetSlug}:${t.path}`, t.name)
        if (t.children?.length) walk(facetSlug, t.children)
      }
    }
    for (const f of tree ?? []) walk(f.slug, f.terms)
    return map
  }, [tree])

  // Prefer the counted rail (zero-count terms pruned) once models are tagged;
  // otherwise fall back to the full taxonomy tree so the filters are still usable
  // on a young catalogue where nothing carries counts yet. Note the counted
  // endpoint returns every facet object with its `terms` emptied when all are
  // pruned, so we must check for actual terms, not just facet count.
  // appliesTo per facet slug (from the full tree) — used to prune stale filters
  // when the class changes.
  const appliesToBySlug = useMemo(() => {
    const m = new Map<string, string[] | null>()
    for (const f of tree ?? []) m.set(f.slug, f.appliesTo)
    return m
  }, [tree])

  // Show the model-class facet as the segmented chips above (not in the rail), and
  // hide facets that don't apply to the chosen class.
  const scopeFacets = (list: TaxFacet[]): TaxFacet[] =>
    list.filter((f) => f.slug !== MODEL_CLASS_SLUG && facetAppliesTo(f, selectedClass))
  const scopedCounted = scopeFacets(facets?.filter((f) => f.terms.length) ?? [])
  // Prefer the counted rail (zero-count terms pruned) once real facets carry counts;
  // otherwise fall back to the full tree so filters are usable on an untagged
  // catalogue (where only the backfilled model-class facet has any counts). Apply
  // the class scoping BEFORE this fallback check, or a lone model-class count would
  // wrongly suppress the tree fallback and leave the rail empty.
  const railFacets = scopedCounted.length ? scopedCounted : scopeFacets(tree ?? [])

  const models = data?.models ?? []
  const pagination = data?.pagination
  const totalPages = Math.max(1, Number(pagination?.totalPages || pagination?.pages || 1))

  const setTerms = (tokens: Set<string>) => {
    const next = new URLSearchParams(searchParams)
    if (tokens.size) next.set('terms', [...tokens].join(','))
    else next.delete('terms')
    next.delete('page')
    setSearchParams(next)
  }

  const toggleTerm = (token: string) => {
    const next = new Set(selectedTokens)
    next.has(token) ? next.delete(token) : next.add(token)
    setTerms(next)
  }

  // Switch model class: replace the model-class token and drop any selected terms
  // for class-specific facets that no longer apply (universal filters are kept).
  const setClass = (slug: string | null) => {
    const next = new Set<string>()
    for (const tok of selectedTokens) {
      const facetSlug = tok.slice(0, tok.indexOf(':'))
      if (facetSlug === MODEL_CLASS_SLUG) continue
      const appliesTo = appliesToBySlug.get(facetSlug)
      const scoped = appliesTo && appliesTo.length > 0
      if (!scoped) next.add(tok) // universal — keep
      else if (slug && appliesTo!.includes(slug)) next.add(tok) // still applies
    }
    if (slug) next.add(`${MODEL_CLASS_SLUG}:${slug}`)
    setTerms(next)
  }

  const updateParams = (updates: Record<string, string | number | undefined | null>) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') next.delete(key)
      else next.set(key, String(value))
    })
    next.delete('page')
    setSearchParams(next)
  }

  const setFulfillment = (mode: 'stl' | 'print') => {
    const next = new URLSearchParams(searchParams)
    if (mode === 'print') next.set('fulfillment', 'print')
    else next.delete('fulfillment')
    next.delete('page')
    setSearchParams(next)
  }

  const handleApplyFilters = (event: React.FormEvent) => {
    event.preventDefault()
    updateParams({ minPrice: minPrice || undefined, maxPrice: maxPrice || undefined })
  }

  const handleResetFilters = () => {
    setSearchTerm('')
    setMinPrice('')
    setMaxPrice('')
    const next = new URLSearchParams()
    if (sortByParam) next.set('sortBy', sortByParam)
    if (fulfillmentParam === 'print') next.set('fulfillment', 'print')
    setSearchParams(next)
  }

  const handlePageChange = (nextPage: number) => {
    const bounded = Math.max(1, Math.min(totalPages, nextPage))
    const next = new URLSearchParams(searchParams)
    next.set('page', String(bounded))
    setSearchParams(next)
  }

  const selectedClassLabel = MODEL_CLASSES.find((c) => c.slug === selectedClass)?.label

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <Seo
        title={selectedClassLabel ? `${selectedClassLabel} STLs` : 'Browse Tabletop Terrain STLs'}
        description={
          selectedClassLabel
            ? `Browse print-ready ${selectedClassLabel.toLowerCase()} STLs from independent artists. Filter by scale, era and print process, then plan them on the free 3D table planner.`
            : 'Browse print-ready tabletop terrain, vehicles and character STLs from independent artists. Filter by scale, era and print process, then plan your table in 3D before you buy.'
        }
        path="/browse"
      />
      {/* Fulfillment tabs: digital STL download vs third-party print-and-ship.
          Hidden while Print & Ship is parked — with one option the strip is noise. */}
      {FEATURES.printAndShip && (
      <div className="mb-8 inline-flex rounded-xl border border-border bg-accent p-1">
        {([
          { mode: 'stl' as const, label: 'Digital downloads only' },
          { mode: 'print' as const, label: 'Print & Ship' },
        ]).map((t) => {
          const active = fulfillmentParam === t.mode
          return (
            <button
              key={t.mode}
              type="button"
              onClick={() => setFulfillment(t.mode)}
              aria-pressed={active}
              className={`rounded-lg px-5 py-2 text-sm font-medium transition ${
                active ? 'bg-background text-primary shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      )}

      {fulfillmentParam === 'print' && (
        <p className="mb-6 -mt-4 text-sm text-muted-foreground">
          Models available to order printed and shipped — no 3D printer needed. Price includes the print and delivery.
        </p>
      )}

      {/* Prominent, live keyword search — the quickest way to find a specific model. */}
      <div className="relative mb-8">
        <Search size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search models by name, tag or keyword…"
          aria-label="Search models"
          className="w-full rounded-xl border border-border bg-background py-3.5 pl-12 pr-11 text-base shadow-xs focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-ring"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Model class — the primary axis. Switching it re-scopes the filter rail. */}
      <div className="mb-8 flex flex-wrap gap-2">
        {[{ slug: null as string | null, label: 'All models' }, ...MODEL_CLASSES].map((c) => {
          const active = selectedClass === c.slug || (c.slug === null && !selectedClass)
          return (
            <button
              key={c.slug ?? 'all'}
              type="button"
              onClick={() => setClass(c.slug)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                active
                  ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                  : 'border-border bg-background text-foreground hover:border-primary/50 hover:text-primary'
              }`}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[300px_1fr]">
        <aside className="space-y-6 rounded-2xl border border-border bg-card p-6 shadow-xs lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Price</h2>
            <form onSubmit={handleApplyFilters} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Min £" type="number" min={0} value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
                <Input label="Max £" type="number" min={0} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">Apply</Button>
                <Button type="button" variant="outline" onClick={handleResetFilters}>Reset</Button>
              </div>
            </form>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Filters</h2>
              {facetsFetching && <Spinner size="sm" className="text-primary" />}
            </div>
            <div className="mt-3">
              {railFacets.length ? (
                <FacetRail
                  facets={railFacets}
                  selected={selectedTokens}
                  onToggle={toggleTerm}
                  loading={facetsFetching}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Loading filters…</p>
              )}
            </div>
          </div>
        </aside>

        <section>
          <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Browse models</h1>
              <p className="text-sm text-muted-foreground">
                {pagination?.totalItems ?? models.length} results · Page {pagination?.page ?? 1} of {totalPages}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isFetching && <Spinner size="sm" className="text-primary" />}
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Sort by
                <select
                  value={sortByParam}
                  onChange={(event) => updateParams({ sortBy: event.target.value })}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-xs focus:border-primary focus:outline-hidden"
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value ?? 'recent'}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </header>

          {showTrademarkNotice && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
              <TrademarkDisclaimer className="text-xs leading-relaxed text-amber-800" />
            </div>
          )}

          {/* Selected filter chips (work even when a term is pruned from the rail). */}
          {[...selectedTokens].some((t) => !t.startsWith(`${MODEL_CLASS_SLUG}:`)) && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {[...selectedTokens].filter((t) => !t.startsWith(`${MODEL_CLASS_SLUG}:`)).map((token) => (
                <button
                  key={token}
                  onClick={() => toggleTerm(token)}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary hover:bg-primary/20"
                >
                  {labelByToken.get(token) ?? token.split(':').pop()}
                  <X size={13} />
                </button>
              ))}
              <button
                onClick={() => setTerms(new Set(selectedClass ? [`${MODEL_CLASS_SLUG}:${selectedClass}`] : []))}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            </div>
          )}

          <div className="mt-6">
            {isLoading ? (
              <div className="flex justify-center py-20"><Spinner size="lg" /></div>
            ) : (
              <ModelGrid models={models} />
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-4">
              <Button variant="outline" onClick={() => handlePageChange((pagination?.page ?? 1) - 1)} disabled={(pagination?.page ?? 1) <= 1}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {pagination?.page ?? 1} of {totalPages}</span>
              <Button variant="outline" onClick={() => handlePageChange((pagination?.page ?? 1) + 1)} disabled={(pagination?.page ?? 1) >= totalPages}>
                Next
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default Browse
