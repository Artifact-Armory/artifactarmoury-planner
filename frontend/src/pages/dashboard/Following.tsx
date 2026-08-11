import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { artistsApi } from '../../api/endpoints/artists'
import ModelGrid from '../../components/models/ModelGrid'
import Spinner from '../../components/ui/Spinner'

const Following: React.FC = () => {
  const followingQuery = useQuery({
    queryKey: ['my-following'],
    queryFn: () => artistsApi.getFollowing(),
  })

  const feedQuery = useQuery({
    queryKey: ['my-feed'],
    queryFn: () => artistsApi.getFeed({ limit: 24 }),
  })

  const artists = followingQuery.data ?? []
  const feed = feedQuery.data ?? []

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Following</h1>
        <p className="text-sm text-gray-500">New releases from the artists you follow.</p>
      </div>

      {/* Artists you follow */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Artists ({artists.length})
        </h2>
        {followingQuery.isLoading ? (
          <Spinner size="sm" />
        ) : artists.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
            You aren't following anyone yet.{' '}
            <Link to="/artists" className="font-medium text-indigo-600">Browse artists</Link> and hit
            Follow to build your release feed.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {artists.map((a) => (
              <Link
                key={a.id}
                to={`/artists/${a.id}`}
                className="flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-1.5 pr-4 shadow-xs hover:border-indigo-300"
              >
                <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                  {a.profileImageUrl ? (
                    <img src={a.profileImageUrl} alt={a.name} className="h-full w-full object-cover" />
                  ) : (
                    a.name.slice(0, 2).toUpperCase()
                  )}
                </span>
                <span className="text-sm font-medium text-gray-800">{a.name}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Release feed */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Latest releases</h2>
        {feedQuery.isLoading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : feed.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
            Nothing new yet — releases from artists you follow will show up here.
          </p>
        ) : (
          <ModelGrid models={feed} />
        )}
      </section>
    </div>
  )
}

export default Following
