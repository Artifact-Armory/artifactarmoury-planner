import React, { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import ModelGrid from '../components/models/ModelGrid'
import { collectionsApi } from '../api/endpoints/collections'
import Seo from '../components/common/Seo'

// One of an artist's collections (e.g. "WW2 buildings"): just that range of their
// catalogue, in the order the artist chose.
const ArtistCollection: React.FC = () => {
  const { id, slug } = useParams()
  const [page, setPage] = useState(1)

  const query = useQuery({
    queryKey: ['artist-collection', id, slug, page],
    queryFn: () => collectionsApi.getCollection(id as string, slug as string, { page, limit: 24 }),
    enabled: Boolean(id && slug),
    placeholderData: (prev: any) => prev,
  })

  if (query.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!query.data || query.isError) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Collection not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">It may have been renamed or removed.</p>
        {id && (
          <Link to={`/artists/${id}`} className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            Back to the artist&apos;s page
          </Link>
        )}
      </div>
    )
  }

  const { collection, models, total, totalPages } = query.data

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Seo
        title={`${collection.name} by ${collection.artistName}`}
        description={
          collection.description
            ? collection.description.slice(0, 160)
            : `${collection.name}: a collection of 3D-printable terrain STLs by ${collection.artistName} on Artifact Armoury.`
        }
        path={`/artists/${collection.artistPath}/collections/${collection.slug}`}
        image={models[0]?.thumbnailUrl}
      />

      <Link
        to={`/artists/${collection.artistPath}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={16} />
        {collection.artistName}
      </Link>

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Collection</p>
        <h1 className="mt-1 text-3xl font-semibold text-foreground">{collection.name}</h1>
        {collection.description ? (
          <p className="mt-3 max-w-3xl whitespace-pre-line text-sm text-foreground">{collection.description}</p>
        ) : null}
        <p className="mt-2 text-sm text-muted-foreground">
          {total} {total === 1 ? 'item' : 'items'}
        </p>
      </div>

      <section className="mt-8">
        <ModelGrid models={models} emptyMessage="Nothing in this collection yet." />
      </section>

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

export default ArtistCollection
