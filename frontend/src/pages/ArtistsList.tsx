import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import ArtistCard from '../components/artists/ArtistCard'
import { artistsApi } from '../api/endpoints/artists'

const sortOptions = [
  { value: 'popular', label: 'Most popular' },
  { value: 'recent', label: 'Newest' },
  { value: 'name', label: 'Name (A-Z)' },
]

const DEFAULT_LIMIT = 12

const ArtistsList: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const searchParam = searchParams.get('query') ?? ''
  const sortParam = (searchParams.get('sort') as 'popular' | 'recent' | 'name') ?? 'popular'
  const pageParam = Number(searchParams.get('page') ?? 1)

  const [searchTerm, setSearchTerm] = useState(searchParam)

  const listKey = useMemo(
    () => ({ page: pageParam, sort: sortParam, search: searchParam }),
    [pageParam, sortParam, searchParam],
  )

  const listQuery = useQuery(['artists', listKey], async () => {
    if (searchParam.trim()) {
      const results = await artistsApi.searchArtists(searchParam.trim())
      return {
        artists: results,
        total: results.length,
        page: 1,
        limit: results.length,
        totalPages: 1,
        isSearch: true,
      }
    }

    const response = await artistsApi.listArtists({
      page: pageParam,
      limit: DEFAULT_LIMIT,
      sort: sortParam,
    })
    return { ...response, isSearch: false }
  })

  const featuredQuery = useQuery(['featured-artists'], () => artistsApi.getFeaturedArtists(4))

  const data = listQuery.data
  const artists = data?.artists ?? []
  const totalPages = data?.totalPages ?? 1

  const updateParams = (updates: Record<string, string | number | undefined | null>) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        next.delete(key)
      } else {
        next.set(key, String(value))
      }
    })

    if (!updates.page) {
      next.delete('page')
    }
    setSearchParams(next)
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    updateParams({ query: searchTerm || undefined })
  }

  const handleClearSearch = () => {
    setSearchTerm('')
    updateParams({ query: undefined })
  }

  const handlePageChange = (direction: 'prev' | 'next') => {
    if (data?.isSearch) return
    const current = data?.page ?? 1
    const nextPage = direction === 'prev' ? Math.max(1, current - 1) : Math.min(totalPages, current + 1)
    updateParams({ page: nextPage })
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <section className="rounded-3xl bg-indigo-600 px-6 py-12 text-white shadow-lg sm:px-12">
        <h1 className="text-3xl font-semibold">Artists</h1>
        <p className="mt-2 max-w-2xl text-indigo-100">
          Discover creators crafting terrain for tabletop adventures. Follow artists to stay up to date with their latest
          releases.
        </p>
        {featuredQuery.data && featuredQuery.data.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-3">
            {featuredQuery.data.map((artist) => (
              <span key={artist.id} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white">
                {artist.name}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10 flex flex-col gap-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <form onSubmit={handleSubmit} className="flex-1 space-y-3">
          <Input
            label="Search artists"
            placeholder="Search by name or bio"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" className="flex-1">
              Search
            </Button>
            <Button type="button" variant="outline" onClick={handleClearSearch}>
              Clear
            </Button>
          </div>
        </form>

        <div className="w-full lg:w-64">
          <label className="block text-sm font-medium text-gray-700">Sort by</label>
          <select
            value={sortParam}
            onChange={(event) => updateParams({ sort: event.target.value, page: 1 })}
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
            disabled={Boolean(data?.isSearch)}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="mt-10">
        {listQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : artists.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {artists.map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center">
            <p className="text-sm font-medium text-gray-700">No artists matched your criteria.</p>
            <p className="mt-2 text-xs text-gray-500">Try adjusting your filters or clearing the search.</p>
          </div>
        )}
      </section>

      {!data?.isSearch && totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          <Button variant="outline" onClick={() => handlePageChange('prev')} disabled={pageParam <= 1}>
            Previous
          </Button>
          <span className="text-sm text-gray-600">
            Page {data?.page ?? 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            onClick={() => handlePageChange('next')}
            disabled={(data?.page ?? 1) >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

export default ArtistsList
