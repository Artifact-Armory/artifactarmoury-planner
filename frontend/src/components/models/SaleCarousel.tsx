import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Tag } from 'lucide-react'
import { salesApi } from '../../api/endpoints/sales'
import PriceDisplay from './PriceDisplay'

/**
 * Front-page strip of items currently on sale. Renders nothing when there are no
 * active sales, so it's safe to always mount. The backend caps items per artist,
 * so one seller can't dominate the strip.
 */
const SaleCarousel: React.FC = () => {
  const { data: items } = useQuery({
    queryKey: ['featured-sales'],
    queryFn: () => salesApi.featured(),
    staleTime: 60_000,
  })

  if (!items || items.length === 0) return null

  return (
    <section className="mt-12">
      <div className="flex items-center gap-2">
        <Tag size={20} className="text-rose-500" />
        <h2 className="text-2xl font-semibold text-foreground">On sale now</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Limited-time discounts from our artists.</p>

      <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
        {items.map((item) => (
          <Link
            key={item.id}
            to={`/models/${item.id}`}
            className="group w-52 shrink-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg"
          >
            <div className="relative h-40 w-full bg-muted">
              {item.thumbnailUrl ? (
                <img
                  src={item.thumbnailUrl}
                  alt={item.name}
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">No preview</div>
              )}
              <span className="absolute left-2 top-2 rounded-full bg-rose-600/95 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
                -{item.salePercent}%
              </span>
            </div>
            <div className="p-3">
              <h3 className="line-clamp-1 text-sm font-semibold text-foreground">{item.name}</h3>
              <p className="line-clamp-1 text-xs text-muted-foreground">by {item.artistName}</p>
              {/* No percent badge here — the image corner badge above already shows it. */}
              <div className="mt-2">
                <PriceDisplay price={item.salePrice} originalPrice={item.originalPrice} />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default SaleCarousel
