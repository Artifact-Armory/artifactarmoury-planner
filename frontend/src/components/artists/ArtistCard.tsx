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
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition hover:-translate-y-1 hover:shadow-lg"
    >
      <div className="relative h-32 w-full bg-linear-to-br from-primary/30 via-purple-200 to-pink-200">
        {artist.bannerImageUrl ? (
          <img src={artist.bannerImageUrl} alt={artist.name} className="h-full w-full object-cover" />
        ) : null}
        <div className="absolute -bottom-10 left-6 h-20 w-20 overflow-hidden rounded-full border-4 border-card bg-muted">
          {artist.profileImageUrl ? (
            <img src={artist.profileImageUrl} alt={artist.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-muted-foreground">
              {artist.name.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>
      </div>

      <div className="mt-12 flex flex-1 flex-col px-6 pb-6">
        <h3 className="text-lg font-semibold text-foreground group-hover:text-primary">
          {artist.name}
        </h3>
        {artist.bio ? (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{artist.bio}</p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No bio provided.</p>
        )}

        <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
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
