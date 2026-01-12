import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { ordersApi } from '../../api/endpoints/orders'
import { browseApi } from '../../api/endpoints/browse'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import ModelGrid from '../../components/models/ModelGrid'
import { formatPrice } from '../../utils/format'
import { MODEL_SHOWCASE_ENABLED } from '../../config/features'

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const ordersQuery = useQuery(['my-orders', { page: 1, limit: 5 }], () => ordersApi.getMyOrders(1, 5))
  const featuredQuery = useQuery(
    ['recommended-models'],
    () => browseApi.getTrendingModels(4),
    { enabled: MODEL_SHOWCASE_ENABLED },
  )

  const orders = ordersQuery.data?.orders ?? []
  const hasRecommendations = MODEL_SHOWCASE_ENABLED && (featuredQuery.data?.length ?? 0) > 0

  return (
    <div className="space-y-10">
      <section className="rounded-3xl bg-white p-8 shadow">
        <h1 className="text-2xl font-semibold text-gray-900">Welcome back</h1>
        <p className="mt-2 text-sm text-gray-600">
          Track your recent orders, manage saved tables, and discover new terrain to add to your collection.
        </p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent orders</h2>
          <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/purchases')}>
            View all orders
          </Button>
        </div>

        {ordersQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : orders.length ? (
          <div className="mt-4 divide-y divide-gray-100">
            {orders.map((order) => (
              <div key={order.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">Order #{order.orderNumber}</p>
                  <p className="text-xs text-gray-500">
                    Placed {new Date(order.createdAt).toLocaleDateString()} • {order.itemCount} item
                    {order.itemCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <span className="font-semibold text-gray-900">{formatPrice(order.total)}</span>
                  <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                    {order.fulfillmentStatus ?? 'processing'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-gray-600">
            No orders yet. Browse the marketplace to place your first order.
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recommended for you</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/browse?sortBy=popular')}
            disabled={!MODEL_SHOWCASE_ENABLED}
          >
            Explore marketplace
          </Button>
        </div>
        <div className="mt-6">
          {!MODEL_SHOWCASE_ENABLED ? (
            <p className="text-sm text-gray-600">
              Marketplace recommendations will appear here once uploads are enabled.
            </p>
          ) : featuredQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : hasRecommendations ? (
            <ModelGrid models={featuredQuery.data ?? []} />
          ) : (
            <p className="text-sm text-gray-600">
              No recommendations yet. Keep browsing to personalize suggestions.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

export default Dashboard
