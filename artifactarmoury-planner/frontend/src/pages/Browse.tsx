import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import ModelGrid from '../components/models/ModelGrid'
import { browseApi } from '../api/endpoints/browse'
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

const DEFAULT_LIMIT = 12

const Browse: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()

  const searchTermParam = searchParams.get('search') ?? searchParams.get('query') ?? ''
  const categoryParam = searchParams.get('category') ?? ''
  const minPriceParam = searchParams.get('minPrice') ?? ''
  const maxPriceParam = searchParams.get('maxPrice') ?? ''
  const sortByParam = (searchParams.get('sortBy') as SearchFilters['sortBy']) ?? 'recent'
  const pageParam = Number(searchParams.get('page') ?? 1)

  const [searchTerm, setSearchTerm] = useState(searchTermParam)
  const [minPrice, setMinPrice] = useState(minPriceParam)
  const [maxPrice, setMaxPrice] = useState(maxPriceParam)

  const filters = useMemo<SearchFilters>(() => ({
    search: searchTermParam || undefined,
    category: categoryParam || undefined,
    minPrice: minPriceParam ? Number(minPriceParam) : undefined,
    maxPrice: maxPriceParam ? Number(maxPriceParam) : undefined,
    sortBy: sortByParam,
    page: pageParam,
    limit: DEFAULT_LIMIT,
  }), [searchTermParam, categoryParam, minPriceParam, maxPriceParam, sortByParam, pageParam])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['browse-models', filters],
    queryFn: () => browseApi.searchModels(filters),
    placeholderData: (previousData) => previousData,
  })

  const { data: categories } = useQuery({
    queryKey: ['browse-categories'],
    queryFn: () => browseApi.getCategories(),
  })

  const models = data?.models ?? []
  const pagination = data?.pagination
  const totalPages = Math.max(1, Number(pagination?.totalPages || pagination?.pages || 1))

  const updateParams = (updates: Record<string, string | number | undefined | null>) => {
    const next = new URLSearchParams(searchParams)

    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        next.delete(key)
      } else {
        next.set(key, String(value))
      }
    })

    next.delete('page')
    setSearchParams(next)
  }

  const handleApplyFilters = (event: React.FormEvent) => {
    event.preventDefault()
    updateParams({
      search: searchTerm || undefined,
      minPrice: minPrice || undefined,
      maxPrice: maxPrice || undefined,
    })
  }

  const handleResetFilters = () => {
    setSearchTerm('')
    setMinPrice('')
    setMaxPrice('')
    const next = new URLSearchParams()
    if (sortByParam) {
      next.set('sortBy', sortByParam)
    }
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
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[280px_1fr]">
        <aside className="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
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
                <Input
                  label="Min price"
                  type="number"
                  min={0}
                  value={minPrice}
                  onChange={(event) => setMinPrice(event.target.value)}
                />
                <Input
                  label="Max price"
                  type="number"
                  min={0}
                  value={maxPrice}
                  onChange={(event) => setMaxPrice(event.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">
                  Apply
                </Button>
                <Button type="button" variant="outline" onClick={handleResetFilters}>
                  Reset
                </Button>
              </div>
            </form>
          </div>

          {categories?.length ? (
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Categories</h2>
              <div className="mt-4 space-y-2">
                <button
                  onClick={() => updateParams({ category: undefined })}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                    categoryParam ? 'text-gray-600 hover:bg-gray-50' : 'bg-indigo-50 font-medium text-indigo-600'
                  }`}
                >
                  All categories
                </button>
                {categories.map((category) => {
                  const isActive = category.category === categoryParam
                  return (
                    <button
                      key={category.category}
                      onClick={() => updateParams({ category: category.category })}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                        isActive
                          ? 'bg-indigo-600 font-medium text-white'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {category.category}
                      <span className="ml-2 text-xs text-gray-400">{category.modelCount}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
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
                    <option key={option.value} value={option.value ?? 'recent'}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </header>

          <div className="mt-6">
            {isLoading ? (
              <div className="flex justify-center py-20">
                <Spinner size="lg" />
              </div>
            ) : (
              <ModelGrid models={models} />
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-4">
              <Button
                variant="outline"
                onClick={() => handlePageChange((pagination?.page ?? 1) - 1)}
                disabled={(pagination?.page ?? 1) <= 1}
              >
                Previous
              </Button>
              <span className="text-sm text-gray-600">
                Page {pagination?.page ?? 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                onClick={() => handlePageChange((pagination?.page ?? 1) + 1)}
                disabled={(pagination?.page ?? 1) >= totalPages}
              >
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
