import React, { useMemo } from 'react'
import { useArtistAnalytics } from '../../hooks/useArtistAnalytics'
import { useAuthStore } from '../../store/authStore'
import { BarChart2, TrendingUp, Wallet } from 'lucide-react'

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
})

const formatCurrency = (value: number) => currencyFormatter.format(value)

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const ArtistSales: React.FC = () => {
  const { user } = useAuthStore()
  const { data, isLoading, isError, error } = useArtistAnalytics()

  const orders = data?.recentOrders ?? []
  const topModels = data?.topModels ?? []

  const paymentBreakdown = useMemo(() => {
    const completed = orders.filter((order) => order.paymentStatus === 'completed').length
    const pending = orders.filter((order) => order.paymentStatus !== 'completed').length
    return { completed, pending }
  }, [orders])

  return (
    <div className="px-4 py-10 space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900">Sales &amp; Analytics</h1>
        <p className="text-gray-600">
          Visualise revenue trends, monitor order health, and evaluate the performance of your catalogue.
        </p>
      </div>

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to load sales analytics. {error instanceof Error ? error.message : 'Please try again later.'}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Lifetime revenue</p>
            <span className="rounded-full bg-emerald-50 p-2">
              <Wallet className="text-emerald-600" size={20} />
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-gray-900">
            {isLoading ? (
              <span className="inline-flex h-6 w-20 animate-pulse rounded bg-gray-200" />
            ) : (
              formatCurrency(data?.totalRevenue ?? 0)
            )}
          </p>
          <p className="mt-1 text-xs text-gray-500">Completed payouts across all orders.</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white px-4 py-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Pending payout</p>
            <span className="rounded-full bg-amber-50 p-2">
              <BarChart2 className="text-amber-600" size={20} />
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-gray-900">
            {isLoading ? (
              <span className="inline-flex h-6 w-20 animate-pulse rounded bg-gray-200" />
            ) : (
              formatCurrency(data?.pendingPayout ?? 0)
            )}
          </p>
          <p className="mt-1 text-xs text-gray-500">Awaiting completion or transfer.</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white px-4 py-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Recent orders</p>
            <span className="rounded-full bg-indigo-50 p-2">
              <TrendingUp className="text-indigo-600" size={20} />
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-gray-900">
            {isLoading ? (
              <span className="inline-flex h-6 w-20 animate-pulse rounded bg-gray-200" />
            ) : (
              orders.length
            )}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {paymentBreakdown.completed} completed · {paymentBreakdown.pending} pending
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Orders</h2>
          <span className="text-sm text-gray-500">
            Showing latest {orders.length} orders
          </span>
        </div>
        <div className="overflow-x-auto px-5 py-4">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="flex animate-pulse justify-between rounded-md bg-gray-100 px-4 py-3" />
              ))}
            </div>
          ) : orders.length > 0 ? (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Order</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Customer</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Total</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Payment</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Fulfilment</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="px-3 py-2 font-medium text-gray-900">#{order.orderNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{order.customerEmail || '—'}</td>
                    <td className="px-3 py-2 text-gray-900">{formatCurrency(order.total)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        order.paymentStatus === 'completed'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}>
                        {order.paymentStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{order.fulfillmentStatus ?? 'n/a'}</td>
                    <td className="px-3 py-2 text-gray-600">{formatDateTime(order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-500">No orders yet. Promote your models to drive your first sale.</p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Model performance</h2>
          <span className="text-sm text-gray-500">View-to-sale ratio highlights where to improve listings.</span>
        </div>
        <div className="px-5 py-4 space-y-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex animate-pulse justify-between rounded-md bg-gray-100 px-4 py-3" />
            ))
          ) : topModels.length > 0 ? (
            topModels.map((model) => {
              const conversion = model.viewCount
                ? Math.min(100, (model.saleCount / model.viewCount) * 100)
                : 0
              return (
                <div key={model.id} className="space-y-2 rounded-lg border border-gray-100 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{model.name}</p>
                      <p className="text-xs text-gray-500">
                        {model.saleCount} sales · {model.viewCount} views · {formatCurrency(model.revenue)} revenue
                      </p>
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      Avg price {formatCurrency(model.basePrice)}
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-indigo-500"
                      style={{ width: `${Math.min(100, conversion || 0)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500">{conversion.toFixed(1)}% view-to-sale conversion</p>
                </div>
              )
            })
          ) : (
            <p className="text-sm text-gray-500">Upload and publish models to start analysing performance.</p>
          )}
        </div>
      </section>
    </div>
  )
}

export default ArtistSales
