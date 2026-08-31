import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Package } from 'lucide-react'
import { bundlesApi } from '../api/endpoints/bundles'
import Spinner from '../components/ui/Spinner'
import Seo from '../components/common/Seo'
import { formatPrice } from '../utils/format'

const Bundles: React.FC = () => {
  const { data: bundles, isLoading } = useQuery({
    queryKey: ['bundles-list'],
    queryFn: () => bundlesApi.list(),
  })

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <Seo
        title="Terrain Bundles"
        description="Multi-model terrain bundles from independent artists: several STLs grouped at one price. Buy once and download every file in the set."
        path="/bundles"
      />
      <header className="border-b border-border pb-4">
        <h1 className="text-2xl font-semibold text-foreground">Bundles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Several models grouped at one price — buy once and download every STL in the set.
        </p>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : !bundles || bundles.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Package className="mx-auto text-muted-foreground" size={40} />
          <p className="mt-3 font-medium text-foreground">No bundles yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Check back soon — artists are putting sets together.</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {bundles.map((b) => (
            <Link
              key={b.id}
              to={`/bundles/${b.id}`}
              className="group overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition hover:shadow-md"
            >
              <div className="relative h-44 w-full bg-muted">
                {b.thumbnailUrl ? (
                  <img src={b.thumbnailUrl} alt={b.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <Package size={32} />
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-sm bg-primary/90 px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  BUNDLE · {b.modelCount}
                </span>
              </div>
              <div className="p-4">
                <h3 className="truncate font-semibold text-foreground group-hover:text-primary">{b.name}</h3>
                {b.artistName && <p className="text-xs text-muted-foreground">by {b.artistName}</p>}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-lg font-bold text-foreground">{formatPrice(b.price)}</span>
                  <span className="text-xs text-muted-foreground">{b.modelCount} models</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default Bundles
