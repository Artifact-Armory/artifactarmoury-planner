import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Users, Package, ShoppingCart, DollarSign, Flag } from 'lucide-react'
import { adminApi } from '../../api/endpoints/admin'
import { formatPrice } from '../../utils/format'

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string; sub?: string }> = ({
  icon,
  label,
  value,
  sub,
}) => (
  <div className="bg-white rounded-lg border border-gray-200 p-5">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <span className="text-gray-400">{icon}</span>
    </div>
    <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
    {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
  </div>
)

const AdminDashboard: React.FC = () => {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: adminApi.getDashboard,
  })

  if (isLoading) return <div className="text-gray-500">Loading dashboard…</div>
  if (isError)
    return (
      <div className="text-red-600">
        Failed to load dashboard: {(error as any)?.response?.data?.message || 'Unknown error'}
      </div>
    )

  const s = data!.stats

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">System overview and recent activity.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Users size={18} />}
          label="Customers"
          value={Number(s.customer_count).toLocaleString()}
        />
        <StatCard
          icon={<Users size={18} />}
          label="Artists"
          value={Number(s.artist_count).toLocaleString()}
        />
        <StatCard
          icon={<Package size={18} />}
          label="Published models"
          value={Number(s.published_models).toLocaleString()}
          sub={`+${Number(s.models_last_7_days)} in last 7 days`}
        />
        <StatCard
          icon={<ShoppingCart size={18} />}
          label="Orders"
          value={Number(s.total_orders).toLocaleString()}
          sub={`+${Number(s.orders_last_7_days)} in last 7 days`}
        />
        <StatCard
          icon={<DollarSign size={18} />}
          label="Total revenue"
          value={formatPrice(s.total_revenue ?? 0)}
          sub="Succeeded payments"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Flagged models */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Flag size={16} className="text-amber-500" /> Flagged models
            </h2>
            <Link to="/admin/moderation" className="text-sm text-indigo-600 hover:underline">
              Moderation queue
            </Link>
          </div>
          <div className="divide-y divide-gray-100">
            {data!.flaggedModels.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-500">Nothing flagged. 🎉</p>
            ) : (
              data!.flaggedModels.map((m) => (
                <div key={m.id} className="px-5 py-3">
                  <div className="text-sm font-medium text-gray-900">{m.name}</div>
                  <div className="text-xs text-gray-500">
                    {m.artist_name || 'Unknown artist'} · {m.flagged_reason || 'No reason given'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent activity</h2>
          </div>
          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {data!.recentActivity.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-500">No recent activity.</p>
            ) : (
              data!.recentActivity.map((a, i) => (
                <div key={i} className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm text-gray-800">{a.action}</span>
                    {a.display_name && (
                      <span className="text-xs text-gray-500"> · {a.display_name}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {new Date(a.created_at).toLocaleDateString('en-GB')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminDashboard
