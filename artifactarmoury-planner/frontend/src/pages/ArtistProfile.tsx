import React, { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import ModelGrid from '../components/models/ModelGrid'
import { artistsApi } from '../api/endpoints/artists'
import { ShieldCheck } from 'lucide-react'

const sortOptions = [
  { value: 'recent', label: 'Newest' },
  { value: 'popular', label: 'Most popular' },
  { value: 'price_asc', label: 'Price: Low to high' },
  { value: 'price_desc', label: 'Price: High to low' },
]

const ArtistProfile: React.FC = () => {
  const { id } = useParams()
  const [sortBy, setSortBy] = useState('recent')
  const [page, setPage] = useState(1)

  const artistQuery = useQuery({
    queryKey: ['artist-profile', id],
    queryFn: () => artistsApi.getArtistProfile(id as string),
    enabled: Boolean(id),
  })

  const modelsQuery = useQuery({
    queryKey: ['artist-models', id, sortBy, page],
    queryFn: () => artistsApi.getArtistModels(id as string, { sort: sortBy, page, limit: 12 }),
    enabled: Boolean(id),
    placeholderData: (previousData) => previousData,
  })

  const artist = artistQuery.data
  const models = modelsQuery.data?.models ?? []
  const totalPages = modelsQuery.data?.totalPages ?? 1

  const handlePageChange = (direction: 'prev' | 'next') => {
    setPage((current) => {
      if (direction === 'prev') return Math.max(1, current - 1)
      return Math.min(totalPages, current + 1)
    })
  }

  if (artistQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!artist || artistQuery.isError) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Artist not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          The artist you are looking for may have removed their profile or is no longer active.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <section className="overflow-hidden rounded-3xl bg-white shadow">
        <div className="h-48 w-full bg-gradient-to-r from-indigo-500 to-purple-500">
          {artist.bannerImageUrl ? (
            <img src={artist.bannerImageUrl} alt={`${artist.name} banner`} className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="flex flex-col gap-6 px-6 pb-8 sm:flex-row sm:items-end">
          <div className="-mt-16 h-32 w-32 overflow-hidden rounded-full border-4 border-white bg-gray-100">
            {artist.profileImageUrl ? (
              <img src={artist.profileImageUrl} alt={artist.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-gray-500">
                {artist.name.slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-gray-900">{artist.name}</h1>
              {artist.creatorVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-sm font-medium text-emerald-700">
                  <ShieldCheck size={16} />
                  {artist.verificationBadge ?? 'Verified Creator'}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-gray-500">Joined {artist.createdAt ? new Date(artist.createdAt).toLocaleDateString() : 'recently'}</p>
            {artist.bio ? <p className="mt-4 text-sm text-gray-700">{artist.bio}</p> : null}
          </div>
          <div className="flex gap-8 text-sm text-gray-600">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Models</p>
              <p className="text-xl font-semibold text-gray-900">{artist.totalModels ?? 0}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Purchases</p>
              <p className="text-xl font-semibold text-gray-900">{artist.totalPurchases ?? 0}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Views</p>
              <p className="text-xl font-semibold text-gray-900">{artist.totalViews ?? 0}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-12 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Published models</h2>
          <p className="text-sm text-gray-500">{modelsQuery.data?.total ?? 0} items</p>
        </div>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Sort by
            <select
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value)
                setPage(1)
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline">Follow</Button>
        </div>
      </section>

      <section className="mt-6">
        {modelsQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : models.length ? (
          <ModelGrid models={models} />
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center">
            <p className="text-sm font-medium text-gray-700">No models published yet.</p>
            <p className="mt-2 text-xs text-gray-500">Check back soon for new releases.</p>
          </div>
        )}
      </section>

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          <Button variant="outline" onClick={() => handlePageChange('prev')} disabled={page <= 1}>
            Previous
          </Button>
          <span className="text-sm text-gray-600">
            Page {modelsQuery.data?.page ?? page} of {totalPages}
          </span>
          <Button variant="outline" onClick={() => handlePageChange('next')} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      )}

      {models.length > 0 && (
        <section className="mt-12 rounded-3xl bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-10 text-white shadow-lg">
          <h3 className="text-xl font-semibold">Want this artist to build your next table?</h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">
            Reach out to request commissions or custom terrain packs. Premium members get priority responses and
            discounted rates.
          </p>
          <Button className="mt-4 bg-white text-slate-900 hover:bg-slate-100" variant="primary">
            Request commission
          </Button>
        </section>
      )}
    </div>
  )
}

export default ArtistProfile
