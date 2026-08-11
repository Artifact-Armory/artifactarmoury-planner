import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, Link } from 'react-router-dom'
import { Download, Star } from 'lucide-react'
import { ordersApi } from '../../api/endpoints/orders'
import { browseApi } from '../../api/endpoints/browse'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import ModelGrid from '../../components/models/ModelGrid'
import { formatPrice } from '../../utils/format'
import { Card, CardContent } from '../../components/shadcn/card'

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const ordersQuery = useQuery({ queryKey: ['my-orders', { page: 1, limit: 5 }], queryFn: () => ordersApi.getMyOrders(1, 5) })
  const libraryQuery = useQuery({ queryKey: ['my-library'], queryFn: () => ordersApi.getLibrary() })
  const featuredQuery = useQuery({ queryKey: ['recommended-models'], queryFn: () => browseApi.getTrendingModels(4) })

  const orders = ordersQuery.data?.orders ?? []
  const library = libraryQuery.data ?? []

  return (
    <div className="space-y-10">
      <section className="rounded-3xl bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">Welcome back</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Track your recent orders, manage saved tables, and discover new terrain to add to your collection.
        </p>
      </section>

      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">My models</h2>
            <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/models')}>
              View all
            </Button>
          </div>

          {libraryQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : library.length ? (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {library.slice(0, 4).map(({ model, myReview }) => (
                <Link
                  key={model.id}
                  to="/dashboard/models"
                  className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs transition hover:shadow-md"
                >
                  <div className="relative h-28 w-full overflow-hidden bg-muted">
                    {model.thumbnailUrl ? (
                      <img src={model.thumbnailUrl} alt={model.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                        No preview
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col px-3 py-2">
                    <p className="line-clamp-1 text-sm font-medium text-foreground">{model.name}</p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 text-primary">
                        <Download size={13} /> STL
                      </span>
                      {myReview ? (
                        <span className="inline-flex items-center gap-0.5 text-amber-500">
                          <Star size={13} className="fill-amber-400" /> {myReview.rating}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Review</span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/50 py-10 text-center text-sm text-muted-foreground">
              No models yet. Purchased models appear here to download and review.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Recent orders</h2>
            <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/purchases')}>
              View all orders
            </Button>
          </div>

          {ordersQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : orders.length ? (
            <div className="mt-4 divide-y divide-border">
              {orders.map((order) => (
                <div key={order.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Order #{order.orderNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      Placed {new Date(order.createdAt).toLocaleDateString()} • {order.itemCount} item{order.itemCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <span className="font-semibold text-foreground">{formatPrice(order.total)}</span>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      {order.fulfillmentStatus ?? 'processing'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/50 py-10 text-center text-sm text-muted-foreground">
              No orders yet. Browse the marketplace to place your first order.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Recommended for you</h2>
            <Button variant="outline" size="sm" onClick={() => navigate('/browse?sortBy=popular')}>
              Explore marketplace
            </Button>
          </div>
          <div className="mt-6">
            {featuredQuery.isLoading ? (
              <div className="flex justify-center py-12">
                <Spinner size="lg" />
              </div>
            ) : featuredQuery.data && featuredQuery.data.length ? (
              <ModelGrid models={featuredQuery.data} />
            ) : (
              <p className="text-sm text-muted-foreground">No recommendations yet. Keep browsing to personalize suggestions.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Dashboard
