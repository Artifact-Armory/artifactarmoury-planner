import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import ModelGrid from '../components/models/ModelGrid'
import FacetRail from '../components/taxonomy/FacetRail'
import { browseApi } from '../api/endpoints/browse'
import { taxonomyApi } from '../api/endpoints/taxonomy'
import { SearchFilters } from '../api/types'

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
  const pageParam = Number(searchParams.get('page') ?? 1)

  const [searchTerm, setSearchTerm] = useState(searchTermParam)
  const [minPrice, setMinPrice] = useState(minPriceParam)
  const [maxPrice, setMaxPrice] = useState(maxPriceParam)

  const selectedTokens = useMemo(
    () => new Set(termsParam ? termsParam.split(',').filter(Boolean) : []),
    [termsParam],
  )

  const filters = useMemo<SearchFilters>(
    () => ({
      search: searchTermParam || undefined,
      terms: termsParam || undefined,
      minPrice: minPriceParam ? Number(minPriceParam) : undefined,
      maxPrice: maxPriceParam ? Number(maxPriceParam) : undefined,
      sortBy: sortByParam,
      page: pageParam,
      limit: DEFAULT_LIMIT,
    }),
    [searchTermParam, termsParam, minPriceParam, maxPriceParam, sortByParam, pageParam],
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

  const updateParams = (updates: Record<string, string | number | undefined | null>) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') next.delete(key)
      else next.set(key, String(value))
    })
    next.delete('page')
    setSearchParams(next)
  }

  const handleApplyFilters = (event: React.FormEvent) => {
    event.preventDefault()
    updateParams({ search: searchTerm || undefined, minPrice: minPrice || undefined, maxPrice: maxPrice || undefined })
  }

  const handleResetFilters = () => {
    setSearchTerm('')
    setMinPrice('')
    setMaxPrice('')
    const next = new URLSearchParams()
    if (sortByParam) next.set('sortBy', sortByParam)
    setSearchParams(next)
  }

  const handlePageChange = (nextPage: number) => {
    const bounded = Math.max(1, Math.min(totalPages, nextPage))
    const next = new URLSearchParams(searchParams)
    next.set('page', String(bounded))
    setSearchParams(next)
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[300px_1fr]">
        <aside className="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Search</h2>
            <form onSubmit={handleApplyFilters} className="mt-4 space-y-4">
              <Input
                label="Keyword"
                placeholder="Search terrain"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
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
              <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
              {facetsFetching && <Spinner size="sm" className="text-indigo-500" />}
            </div>
            <div className="mt-3">
              {facets?.length ? (
                <FacetRail
                  facets={facets}
                  selected={selectedTokens}
                  onToggle={toggleTerm}
                  loading={facetsFetching}
                />
              ) : (
                <p className="text-sm text-gray-400">No filters available yet.</p>
              )}
            </div>
          </div>
        </aside>

        <section>
          <header className="flex flex-col gap-4 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Browse models</h1>
              <p className="text-sm text-gray-500">
                {pagination?.totalItems ?? models.length} results · Page {pagination?.page ?? 1} of {totalPages}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isFetching && <Spinner size="sm" className="text-indigo-500" />}
              <label className="flex items-center gap-2 text-sm text-gray-600">
                Sort by
                <select
                  value={sortByParam}
                  onChange={(event) => updateParams({ sortBy: event.target.value })}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value ?? 'recent'}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </header>

          {/* Selected filter chips (work even when a term is pruned from the rail). */}
          {selectedTokens.size > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {[...selectedTokens].map((token) => (
                <button
                  key={token}
                  onClick={() => toggleTerm(token)}
                  className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  {labelByToken.get(token) ?? token.split(':').pop()}
                  <X size={13} />
                </button>
              ))}
              <button onClick={() => setTerms(new Set())} className="text-sm text-gray-500 hover:text-gray-800">
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
              <span className="text-sm text-gray-600">Page {pagination?.page ?? 1} of {totalPages}</span>
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
