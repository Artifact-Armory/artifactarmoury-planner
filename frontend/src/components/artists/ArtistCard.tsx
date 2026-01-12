import React from 'react'
import { Link } from 'react-router-dom'
import { Users, Eye } from 'lucide-react'
import { ArtistSummary } from '../../api/types'

interface ArtistCardProps {
  artist: ArtistSummary
}

const ArtistCard: React.FC<ArtistCardProps> = ({ artist }) => {
  return (
    <Link
      to={`/artists/${artist.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
    >
      <div className="relative h-32 w-full bg-gradient-to-br from-indigo-200 via-purple-200 to-pink-200">
        {artist.bannerImageUrl ? (
          <img src={artist.bannerImageUrl} alt={artist.name} className="h-full w-full object-cover" />
        ) : null}
        <div className="absolute -bottom-10 left-6 h-20 w-20 overflow-hidden rounded-full border-4 border-white bg-gray-100">
          {artist.profileImageUrl ? (
            <img src={artist.profileImageUrl} alt={artist.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-500">
              {artist.name.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>
      </div>

      <div className="mt-12 flex flex-1 flex-col px-6 pb-6">
        <h3 className="text-lg font-semibold text-gray-900 group-hover:text-indigo-600">
          {artist.name}
        </h3>
        {artist.bio ? (
          <p className="mt-2 line-clamp-2 text-sm text-gray-600">{artist.bio}</p>
        ) : (
          <p className="mt-2 text-sm text-gray-400">No bio provided.</p>
        )}

        <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1">
            <Users size={14} />
            {artist.totalModels ?? 0} models
          </span>
          {artist.totalViews !== undefined && (
            <span className="inline-flex items-center gap-1">
              <Eye size={14} />
              {artist.totalViews}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

export default ArtistCard
