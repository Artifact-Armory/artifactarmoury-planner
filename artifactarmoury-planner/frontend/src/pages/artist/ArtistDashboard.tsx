import React from 'react'
import { Layout, Eye, ShoppingBag, Wallet, Clock, Trophy } from 'lucide-react'
import { useArtistAnalytics } from '../../hooks/useArtistAnalytics'
import { useAuthStore } from '../../store/authStore'

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
})

const formatCurrency = (value: number) => currencyFormatter.format(value)

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

const ArtistDashboard: React.FC = () => {
  const { user } = useAuthStore()
  const { data, isLoading, isError, error } = useArtistAnalytics()

  const statCards = [
    {
      title: 'Total Models',
      value: data?.totalModels ?? 0,
      icon: <Layout className="text-indigo-600" size={20} />,
    },
    {
      title: 'Published Models',
      value: data?.publishedModels ?? 0,
      icon: <Trophy className="text-indigo-600" size={20} />,
    },
    {
      title: 'Total Views',
      value: data?.totalViews ?? 0,
      icon: <Eye className="text-indigo-600" size={20} />,
    },
    {
      title: 'Total Purchases',
      value: data?.totalPurchases ?? 0,
      icon: <ShoppingBag className="text-indigo-600" size={20} />,
    },
    {
      title: 'Total Revenue',
      value: typeof data?.totalRevenue === 'number' ? formatCurrency(data.totalRevenue) : '—',
      icon: <Wallet className="text-indigo-600" size={20} />,
    },
    {
      title: 'Pending Payout',
      value: typeof data?.pendingPayout === 'number' ? formatCurrency(data.pendingPayout) : '—',
      icon: <Clock className="text-indigo-600" size={20} />,
    },
  ]

  return (
    <div className="px-4 py-10 space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900">Welcome back, {user?.name ?? 'Artist'}</h1>
        <p className="text-gray-600">
          Track performance across your catalogue, recent orders, and top-selling models.
        </p>
      </div>

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to load analytics. {error instanceof Error ? error.message : 'Please try again later.'}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {statCards.map((card) => (
          <div
            key={card.title}
            className="rounded-xl border border-gray-200 bg-white px-4 py-5 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-500">{card.title}</p>
              <span className="rounded-full bg-indigo-50 p-2">{card.icon}</span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-gray-900">
              {isLoading ? (
                <span className="inline-flex h-6 w-16 animate-pulse rounded bg-gray-200" />
              ) : (
                card.value
              )}
            </p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Orders</h2>
            <span className="text-sm text-gray-500">
              {data?.recentOrders.length ?? 0} in the last {data?.recentOrders.length === 1 ? 'order' : 'orders'}
            </span>
          </div>
          <div className="px-5 py-4">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex animate-pulse justify-between rounded-md bg-gray-100 px-4 py-3" />
                ))}
              </div>
            ) : data && data.recentOrders.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Order</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Customer</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Total</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.recentOrders.map((order) => (
                      <tr key={order.id}>
                        <td className="px-3 py-2 font-medium text-gray-900">#{order.orderNumber}</td>
                        <td className="px-3 py-2 text-gray-600">{order.customerEmail || '—'}</td>
                        <td className="px-3 py-2 text-gray-900">{formatCurrency(order.total)}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                            {order.paymentStatus}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{formatDate(order.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-500">You don&apos;t have any orders yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Top Models</h2>
            <span className="text-sm text-gray-500">
              Based on revenue earned
            </span>
          </div>
          <div className="px-5 py-4 space-y-3">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="flex animate-pulse justify-between rounded-md bg-gray-100 px-4 py-3" />
              ))
            ) : data && data.topModels.length > 0 ? (
              data.topModels.map((model) => (
                <div key={model.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3">
                  <div>
                    <p className="font-medium text-gray-900">{model.name}</p>
                    <p className="text-sm text-gray-500">
                      {model.saleCount} sales · {formatCurrency(model.revenue)} revenue
                    </p>
                  </div>
                  <div className="text-right text-sm text-gray-500">
                    <p>{formatCurrency(model.basePrice)}</p>
                    <p>{model.viewCount} views</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">Add models to see performance insights here.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export default ArtistDashboard
