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
    bundle!.models.length > 0 &&
    bundle!.models.every((m) => entitlementsQuery.data?.has(m.id))

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
        <h1 className="text-2xl font-semibold text-gray-900">Bundle not found</h1>
        <p className="mt-2 text-sm text-gray-500">It may be unpublished or removed.</p>
      </div>
    )
  }

  const handleAddToCart = () => {
    addItem({
      kind: 'bundle',
      id: bundle.id,
      name: bundle.name,
      artistName: bundle.artistName ?? '',
      price: bundle.price,
      imageUrl: bundle.thumbnailUrl,
    })
    openCart()
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl bg-white shadow">
            <div className="relative h-80 w-full bg-gray-100">
              {bundle.thumbnailUrl ? (
                <img src={bundle.thumbnailUrl} alt={bundle.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-gray-400">No thumbnail</div>
              )}
            </div>
          </div>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">About this bundle</h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">{bundle.description ?? 'No description provided.'}</p>
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Includes {bundle.models.length} models</h2>
            <ul className="mt-4 divide-y">
              {bundle.models.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                    {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <Link to={`/models/${m.id}`} className="flex-1 truncate text-sm font-medium text-gray-900 hover:text-indigo-600">
                    {m.name}
                  </Link>
                  <span className="text-xs text-gray-400 line-through">{formatPrice(m.basePrice)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside>
          <section className="rounded-2xl bg-white p-6 shadow-md">
            <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">BUNDLE</span>
            <h1 className="mt-2 text-2xl font-semibold text-gray-900">{bundle.name}</h1>
            {bundle.artistName && <p className="mt-1 text-sm text-gray-500">by {bundle.artistName}</p>}

            <div className="mt-4">
              <span className="text-3xl font-bold text-gray-900">{formatPrice(bundle.price)}</span>
              <span className="ml-2 text-sm text-gray-500">for {bundle.models.length} models</span>
            </div>

            {owned ? (
              <p className="mt-6 flex items-center justify-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-800">
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
            <p className="mt-3 text-center text-xs text-gray-400">
              You already own some of these? You still get the whole bundle at this price.
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}

export default BundleDetails
