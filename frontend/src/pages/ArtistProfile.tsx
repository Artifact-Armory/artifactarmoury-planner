import React, { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { UserPlus, UserCheck, MessageSquare, ExternalLink, LayoutGrid } from 'lucide-react'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import ModelGrid from '../components/models/ModelGrid'
import ModelCard from '../components/models/ModelCard'
import { artistsApi } from '../api/endpoints/artists'
import { messagesApi } from '../api/endpoints/messages'
import { ArtistShowcase } from '../api/types'
import { useAuthStore } from '../store/authStore'

const sortOptions = [
  { value: 'recent', label: 'Newest' },
  { value: 'popular', label: 'Most popular' },
  { value: 'price_asc', label: 'Price: Low to high' },
  { value: 'price_desc', label: 'Price: High to low' },
]

const ArtistProfile: React.FC = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isAuthenticated, user } = useAuthStore()
  const [sortBy, setSortBy] = useState('recent')
  const [page, setPage] = useState(1)

  const [following, setFollowing] = useState(false)
  const [followerCount, setFollowerCount] = useState(0)
  const [followBusy, setFollowBusy] = useState(false)
  const [messageBusy, setMessageBusy] = useState(false)

  const artistQuery = useQuery({
    queryKey: ['artist-profile', id],
    queryFn: () => artistsApi.getArtistProfile(id as string),
    enabled: Boolean(id),
  })

  const modelsQuery = useQuery({
    queryKey: ['artist-models', id, sortBy, page],
    queryFn: () => artistsApi.getArtistModels(id as string, { sort: sortBy, page, limit: 12 }),
    enabled: Boolean(id),
    placeholderData: (prev: any) => prev,
  })

  const featuredQuery = useQuery({
    queryKey: ['artist-featured', id],
    queryFn: () => artistsApi.getFeatured(id as string),
    enabled: Boolean(id),
  })

  const showcasesQuery = useQuery({
    queryKey: ['artist-showcases', id],
    queryFn: () => artistsApi.getShowcases(id as string),
    enabled: Boolean(id),
  })

  const artist = artistQuery.data
  const models = modelsQuery.data?.models ?? []
  const featured = featuredQuery.data ?? []
  const showcases = showcasesQuery.data ?? []
  const totalPages = modelsQuery.data?.totalPages ?? 1
  const isOwnProfile = Boolean(user?.id && user.id === id)

  const accent = artist?.accentColor
  const background = artist?.backgroundImageUrl

  useEffect(() => {
    if (artist) {
      setFollowing(Boolean(artist.isFollowing))
      setFollowerCount(artist.followerCount ?? 0)
    }
  }, [artist])

  const toggleFollow = async () => {
    if (!id) return
    if (!isAuthenticated) {
      navigate('/login')
      return
    }
    setFollowBusy(true)
    // optimistic
    const prev = { following, followerCount }
    setFollowing(!following)
    setFollowerCount((c) => c + (following ? -1 : 1))
    try {
      const res = following ? await artistsApi.unfollow(id) : await artistsApi.follow(id)
      setFollowing(res.following)
      setFollowerCount(res.followerCount)
    } catch {
      setFollowing(prev.following)
      setFollowerCount(prev.followerCount)
      toast.error('Could not update follow')
    } finally {
      setFollowBusy(false)
    }
  }

  const startConversation = async () => {
    if (!id) return
    if (!isAuthenticated) {
      navigate('/login')
      return
    }
    setMessageBusy(true)
    try {
      const conversationId = await messagesApi.start({ recipientId: id })
      navigate(`/dashboard/messages?c=${conversationId}`)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not start a conversation')
    } finally {
      setMessageBusy(false)
    }
  }

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
    <div className="relative min-h-screen" style={accent ? ({ ['--accent' as any]: accent }) : undefined}>
      {/* Artist-chosen page background: a fixed image behind a translucent scrim so
          the white content cards stay readable. Falls back to the default page bg. */}
      {background && (
        <div className="pointer-events-none fixed inset-0 -z-10">
          <img src={background} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-white/75 backdrop-blur-sm" />
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 py-10">
        <section className="overflow-hidden rounded-3xl bg-white/95 shadow">
          <div
            className="h-48 w-full bg-gradient-to-r from-indigo-500 to-purple-500"
            style={accent ? { backgroundImage: `linear-gradient(to right, ${accent}, ${accent}cc)` } : undefined}
          >
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
              <h1 className="text-3xl font-semibold text-gray-900">{artist.name}</h1>
              <p className="mt-2 text-sm text-gray-500">Joined {artist.createdAt ? new Date(artist.createdAt).toLocaleDateString() : 'recently'}</p>
              {artist.bio ? <p className="mt-4 whitespace-pre-line text-sm text-gray-700">{artist.bio}</p> : null}
              {artist.artistUrl ? (
                <a
                  href={artist.artistUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
                  style={{ color: accent ?? '#4f46e5' }}
                >
                  <ExternalLink size={14} />
                  {artist.artistUrl.replace(/^https?:\/\//, '')}
                </a>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {isOwnProfile ? (
                  <Link
                    to="/artist/settings"
                    className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    Edit brand page
                  </Link>
                ) : (
                  <>
                    <button
                      onClick={toggleFollow}
                      disabled={followBusy}
                      className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition disabled:opacity-60 ${
                        following
                          ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                          : 'text-white hover:opacity-90'
                      }`}
                      style={!following ? { backgroundColor: accent ?? '#4f46e5' } : undefined}
                    >
                      {following ? <UserCheck size={16} /> : <UserPlus size={16} />}
                      {following ? 'Following' : 'Follow'}
                    </button>
                    <button
                      onClick={startConversation}
                      disabled={messageBusy}
                      className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                    >
                      <MessageSquare size={16} />
                      Message
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-8 text-sm text-gray-600">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Followers</p>
                <p className="text-xl font-semibold text-gray-900">{followerCount}</p>
              </div>
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

        {/* FEATURED CAROUSEL — the artist's hand-picked highlights, above the shop. */}
        {featured.length > 0 && (
          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-gray-900">Featured</h2>
            <p className="text-sm text-gray-500">Hand-picked by {artist.name}</p>
            <div className="mt-4 flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4 [scrollbar-width:thin]">
              {featured.map((model) => (
                <div key={model.id} className="w-72 flex-none snap-start">
                  <ModelCard model={model} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* PUBLISHED SHOWCASE TABLES — links to the artist's public planner displays. */}
        {showcases.length > 0 && (
          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-gray-900">Display tables</h2>
            <p className="text-sm text-gray-500">See {artist.name}&apos;s models laid out together — open one to shop the whole build.</p>
            <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {showcases.map((table) => (
                <ShowcaseCard key={table.id} table={table} accent={accent} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-12 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">All models</h2>
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
    </div>
  )
}

// A card linking to one of the artist's public showcase planner tables, with a
// mosaic of the pieces it contains.
const ShowcaseCard: React.FC<{ table: ArtistShowcase; accent?: string }> = ({ table, accent }) => (
  <Link
    to={`/planner/view/${table.id}`}
    className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md"
  >
    <div className="relative aspect-[16/9] w-full bg-gray-100">
      {table.thumbnails.length > 0 ? (
        <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px">
          {table.thumbnails.slice(0, 4).map((src, i) => (
            <img key={i} src={src} alt="" className="h-full w-full object-cover" />
          ))}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-gray-400">
          <LayoutGrid size={32} />
        </div>
      )}
      <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
        {table.modelCount} {table.modelCount === 1 ? 'piece' : 'pieces'}
      </span>
    </div>
    <div className="flex items-center justify-between gap-2 p-4">
      <div className="min-w-0">
        <p className="truncate font-medium text-gray-900">{table.name}</p>
        {table.description ? (
          <p className="mt-0.5 truncate text-xs text-gray-500">{table.description}</p>
        ) : null}
      </div>
      <span
        className="inline-flex flex-none items-center gap-1 text-sm font-medium group-hover:underline"
        style={{ color: accent ?? '#4f46e5' }}
      >
        Open
      </span>
    </div>
  </Link>
)

export default ArtistProfile
