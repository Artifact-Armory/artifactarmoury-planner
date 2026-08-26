import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ShoppingCart, CheckCircle } from 'lucide-react'
import { bundlesApi } from '../api/endpoints/bundles'
import { ordersApi } from '../api/endpoints/orders'
import { useCartStore } from '../store/cartStore'
import { useAuthStore } from '../store/authStore'
import { formatPrice } from '../utils/format'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import PriceDisplay from '../components/models/PriceDisplay'
import { Badge } from '../components/shadcn/badge'

const BundleDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const addItem = useCartStore((s) => s.addItem)
  const openCart = useCartStore((s) => s.openCart)
  const inCart = useCartStore((s) => s.hasItem('bundle', id ?? ''))
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const bundleQuery = useQuery({
    queryKey: ['bundle', id],
    queryFn: () => bundlesApi.getById(id as string),
    enabled: Boolean(id),
  })

  const entitlementsQuery = useQuery({
    queryKey: ['entitlements'],
    queryFn: () => ordersApi.getEntitlements(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  })

  const bundle = bundleQuery.data
  const owned =
    Boolean(bundle) &&
    (entitlementsQuery.data?.bundles.has(bundle!.id) ||
      (bundle!.models.length > 0 && bundle!.models.every((m) => entitlementsQuery.data?.models.has(m.id))))

  if (bundleQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (bundleQuery.isError || !bundle) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Bundle not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">It may be unpublished or removed.</p>
      </div>
    )
  }

  const handleAddToCart = () => {
    addItem({
      kind: 'bundle',
      id: bundle.id,
      name: bundle.name,
      artistName: bundle.artistName ?? '',
      price: bundle.onSale && bundle.salePrice != null ? bundle.salePrice : bundle.price,
      originalPrice: bundle.onSale && bundle.salePrice != null ? bundle.price : undefined,
      imageUrl: bundle.thumbnailUrl,
    })
    openCart()
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
            <div className="relative h-80 w-full bg-muted">
              {bundle.thumbnailUrl ? (
                <img src={bundle.thumbnailUrl} alt={bundle.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">No thumbnail</div>
              )}
            </div>
          </div>

          <section className="rounded-2xl bg-card p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-foreground">About this bundle</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{bundle.description ?? 'No description provided.'}</p>
          </section>

          <section className="rounded-2xl bg-card p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-foreground">Includes {bundle.models.length} models</h2>
            <ul className="mt-4 divide-y divide-border">
              {bundle.models.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-sm bg-muted">
                    {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <Link to={`/models/${m.id}`} className="flex-1 truncate text-sm font-medium text-foreground hover:text-primary">
                    {m.name}
                  </Link>
                  <span className="text-xs text-muted-foreground line-through">{formatPrice(m.basePrice)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside>
          <section className="rounded-2xl bg-card p-6 shadow-md">
            <Badge>BUNDLE</Badge>
            <h1 className="mt-2 text-2xl font-semibold text-foreground">{bundle.name}</h1>
            {bundle.artistName && <p className="mt-1 text-sm text-muted-foreground">by {bundle.artistName}</p>}

            <div className="mt-4 flex flex-wrap items-baseline gap-2">
              <PriceDisplay
                price={bundle.onSale && bundle.salePrice != null ? bundle.salePrice : bundle.price}
                originalPrice={
                  bundle.onSale && bundle.salePrice != null ? bundle.originalPrice ?? bundle.price : undefined
                }
                salePercent={bundle.salePercent}
                size="lg"
                showTaxNote
              />
              <span className="text-sm text-muted-foreground">for {bundle.models.length} models</span>
            </div>
            {bundle.onSale && bundle.saleEndsAt && (
              <p className="mt-1 text-xs font-medium text-rose-600">
                Sale ends {new Date(bundle.saleEndsAt).toLocaleDateString()}
              </p>
            )}

            {owned ? (
              <p className="mt-6 flex items-center justify-center gap-2 rounded-md bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle size={16} /> You own every model in this bundle
              </p>
            ) : inCart ? (
              <Button className="mt-6 w-full" variant="outline" onClick={() => openCart()} leftIcon={<ShoppingCart size={16} />}>
                In cart — view
              </Button>
            ) : (
              <Button className="mt-6 w-full" onClick={handleAddToCart} leftIcon={<ShoppingCart size={16} />}>
                Add bundle to cart
              </Button>
            )}
            <p className="mt-3 text-center text-xs text-muted-foreground">
              You already own some of these? You still get the whole bundle at this price.
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}

export default BundleDetails
