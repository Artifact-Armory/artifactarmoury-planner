import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../../api/endpoints/admin'
import { formatPrice } from '../../utils/format'

const PERIODS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]

const AdminReports: React.FC = () => {
  const [period, setPeriod] = useState(30)

  const revenue = useQuery({
    queryKey: ['admin', 'analytics', 'revenue', period],
    queryFn: () => adminApi.getRevenueAnalytics(period),
  })
  const users = useQuery({
    queryKey: ['admin', 'analytics', 'users', period],
    queryFn: () => adminApi.getUserAnalytics(period),
  })

  const totalRevenue = (revenue.data?.revenueByDay ?? []).reduce(
    (sum, r) => sum + Number(r.revenue || 0),
    0,
  )
  const totalOrders = (revenue.data?.revenueByDay ?? []).reduce(
    (sum, r) => sum + Number(r.order_count || 0),
    0,
  )
  const newUsers = (users.data?.userGrowth ?? []).reduce(
    (sum, r) => sum + Number(r.new_users || 0),
    0,
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Reports & Analytics</h1>
          <p className="mt-1 text-sm text-gray-500">Revenue and growth over the selected period.</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-md p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-sm rounded ${
                period === p.value ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="text-sm text-gray-500">Revenue</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {formatPrice(totalRevenue)}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="text-sm text-gray-500">Orders</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{totalOrders}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="text-sm text-gray-500">New users</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{newUsers}</div>
          <div className="text-xs text-gray-500 mt-1">
            {users.data?.activeUsers?.active_users ?? 0} active
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by category */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Revenue by category</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {revenue.isLoading && <p className="px-5 py-6 text-sm text-gray-500">Loading…</p>}
            {revenue.data?.revenueByCategory
              ?.filter((c) => c.category)
              .map((c) => (
                <div key={c.category} className="px-5 py-2.5 flex items-center justify-between">
                  <span className="text-sm text-gray-800 capitalize">{c.category}</span>
                  <span className="text-sm font-medium text-gray-900">
                    {formatPrice(c.revenue ?? 0)}{' '}
                    <span className="text-xs text-gray-400">({c.sales_count})</span>
                  </span>
                </div>
              ))}
            {revenue.data && (revenue.data.revenueByCategory?.length ?? 0) === 0 && (
              <p className="px-5 py-6 text-sm text-gray-500">No sales in this period.</p>
            )}
          </div>
        </div>

        {/* Top artists */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Top artists</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {revenue.isLoading && <p className="px-5 py-6 text-sm text-gray-500">Loading…</p>}
            {revenue.data?.topArtists?.map((a) => (
              <div key={a.id} className="px-5 py-2.5 flex items-center justify-between">
                <span className="text-sm text-gray-800">{a.artist_name || 'Unknown'}</span>
                <span className="text-sm font-medium text-gray-900">
                  {formatPrice(a.earnings ?? 0)}{' '}
                  <span className="text-xs text-gray-400">({a.sales_count} sold)</span>
                </span>
              </div>
            ))}
            {revenue.data && (revenue.data.topArtists?.length ?? 0) === 0 && (
              <p className="px-5 py-6 text-sm text-gray-500">No sales in this period.</p>
            )}
          </div>
        </div>

        {/* Top models */}
        <div className="bg-white border border-gray-200 rounded-lg lg:col-span-2">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Top selling models</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {revenue.data?.topModels?.map((m) => (
              <div key={m.id} className="px-5 py-2.5 flex items-center justify-between">
                <div className="min-w-0">
                  <span className="text-sm text-gray-800">{m.name}</span>
                  {m.artist_name && (
                    <span className="text-xs text-gray-500"> · {m.artist_name}</span>
                  )}
                </div>
                <span className="text-sm font-medium text-gray-900 whitespace-nowrap">
                  {formatPrice(m.revenue ?? 0)}{' '}
                  <span className="text-xs text-gray-400">({m.sales_count} sold)</span>
                </span>
              </div>
            ))}
            {revenue.data && (revenue.data.topModels?.length ?? 0) === 0 && (
              <p className="px-5 py-6 text-sm text-gray-500">No sales in this period.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminReports
