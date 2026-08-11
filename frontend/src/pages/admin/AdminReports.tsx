import React, { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  DollarSign,
  PiggyBank,
  ShoppingCart,
  Users,
  Palette,
  Package,
  Eye,
  Activity,
} from 'lucide-react'
import { adminApi } from '../../api/endpoints/admin'
import { formatPrice } from '../../utils/format'
import { useAuthStore } from '../../store/authStore'

const PERIODS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]

const Tile: React.FC<{
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  accent?: string
}> = ({ icon, label, value, sub, accent = 'text-gray-400' }) => (
  <div className="bg-white rounded-lg border border-gray-200 p-5">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <span className={accent}>{icon}</span>
    </div>
    <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
    {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
  </div>
)

/** Hour-of-day (UTC) views histogram — shows when traffic peaks. */
const PeakHoursChart: React.FC<{ data: Array<{ hour: number; views: number }> }> = ({ data }) => {
  const max = Math.max(1, ...data.map((d) => d.views))
  const peak = data.reduce((a, b) => (b.views > a.views ? b : a), data[0])
  const fmtHour = (h: number) => `${String(h).padStart(2, '0')}:00`

  return (
    <div>
      <div className="flex items-end gap-1 h-40">
        {data.map((d) => {
          const isPeak = d.views === peak.views && d.views > 0
          return (
            <div key={d.hour} className="flex-1 flex flex-col items-center justify-end group relative">
              <div
                className={`w-full rounded-t ${isPeak ? 'bg-indigo-600' : 'bg-indigo-300'} transition-colors`}
                style={{ height: `${(d.views / max) * 100}%`, minHeight: d.views > 0 ? 2 : 0 }}
              />
              {/* tooltip */}
              <div className="pointer-events-none absolute bottom-full mb-1 hidden group-hover:block whitespace-nowrap rounded-sm bg-gray-900 px-2 py-1 text-[11px] text-white">
                {fmtHour(d.hour)} · {d.views} views
              </div>
            </div>
          )
        })}
      </div>
      {/* axis: every 3rd hour label */}
      <div className="flex gap-1 mt-1">
        {data.map((d) => (
          <div key={d.hour} className="flex-1 text-center text-[10px] text-gray-400">
            {d.hour % 3 === 0 ? d.hour : ''}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Views by hour of day (UK time). Peak:{' '}
        <span className="font-medium text-gray-700">
          {fmtHour(peak.hour)} ({peak.views} views)
        </span>
      </p>
    </div>
  )
}

const AdminReports: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const [period, setPeriod] = useState(30)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'analytics', 'overview', period],
    queryFn: () => adminApi.getAnalyticsOverview(period),
    enabled: !!user?.isSuperAdmin,
  })

  // Owner-only. Defence in depth — the backend also 403s this data.
  if (user && !user.isSuperAdmin) return <Navigate to="/admin" replace />

  if (isLoading) return <div className="text-gray-500">Loading analytics…</div>
  if (isError)
    return (
      <div className="text-red-600">
        Failed to load analytics: {(error as any)?.response?.data?.message || 'Unknown error'}
      </div>
    )

  const t = data!.totals
  const maxDayViews = Math.max(1, ...data!.viewsByDay.map((d) => d.views))

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Reports & Analytics</h1>
          <p className="mt-1 text-sm text-gray-500">
            Owner-only. Platform financials, catalogue growth and visitor analytics.
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-md p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-sm rounded ${
                period === p.value ? 'bg-white shadow-xs font-medium text-gray-900' : 'text-gray-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Money */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Revenue</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Tile
            icon={<DollarSign size={18} />}
            label="Total revenue"
            value={formatPrice(t.totalRevenue)}
            sub="Gross, succeeded payments"
            accent="text-green-500"
          />
          <Tile
            icon={<PiggyBank size={18} />}
            label="Site revenue (your cut)"
            value={formatPrice(t.siteRevenue)}
            sub="Platform fee after artist share"
            accent="text-indigo-500"
          />
          <Tile
            icon={<ShoppingCart size={18} />}
            label="Orders"
            value={t.totalOrders.toLocaleString()}
            sub={`${t.paidOrders.toLocaleString()} paid`}
          />
        </div>
      </section>

      {/* Community */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Community & catalogue
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <Tile
            icon={<Activity size={18} />}
            label="Active users (24h)"
            value={t.activeUsers24h.toLocaleString()}
            sub={`${t.activeUsers30d.toLocaleString()} in 30d`}
            accent="text-emerald-500"
          />
          <Tile icon={<Users size={18} />} label="Total users" value={t.totalUsers.toLocaleString()} />
          <Tile
            icon={<Palette size={18} />}
            label="Artists"
            value={t.totalArtists.toLocaleString()}
          />
          <Tile
            icon={<Package size={18} />}
            label="Models"
            value={t.totalModels.toLocaleString()}
            sub={`${t.publishedModels.toLocaleString()} published`}
          />
          <Tile
            icon={<Users size={18} />}
            label="Customers"
            value={t.totalCustomers.toLocaleString()}
          />
        </div>
      </section>

      {/* Traffic */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Traffic</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Tile
            icon={<Eye size={18} />}
            label="Total views"
            value={t.totalViews.toLocaleString()}
            sub="All time"
          />
          <Tile
            icon={<Eye size={18} />}
            label="Views (24h)"
            value={t.views24h.toLocaleString()}
            sub={`${t.views7d.toLocaleString()} in 7d`}
            accent="text-indigo-500"
          />
          <Tile
            icon={<Users size={18} />}
            label="Unique visitors (24h)"
            value={t.visitors24h.toLocaleString()}
            sub={`${t.visitors7d.toLocaleString()} in 7d`}
          />
          <Tile
            icon={<Activity size={18} />}
            label="Views / visitor (24h)"
            value={t.visitors24h > 0 ? (t.views24h / t.visitors24h).toFixed(1) : '—'}
          />
        </div>
      </section>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Peak view times</h3>
          <PeakHoursChart data={data!.viewsByHourOfDay} />
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Daily views ({period}d)</h3>
          {data!.viewsByDay.length === 0 ? (
            <p className="text-sm text-gray-500">No views recorded in this period yet.</p>
          ) : (
            <div className="flex items-end gap-0.5 h-40">
              {data!.viewsByDay.map((d) => (
                <div
                  key={d.date}
                  className="flex-1 flex flex-col items-center justify-end group relative"
                >
                  <div
                    className="w-full rounded-t bg-indigo-400 hover:bg-indigo-600"
                    style={{ height: `${(d.views / maxDayViews) * 100}%`, minHeight: d.views > 0 ? 2 : 0 }}
                  />
                  <div className="pointer-events-none absolute bottom-full mb-1 hidden group-hover:block whitespace-nowrap rounded-sm bg-gray-900 px-2 py-1 text-[11px] text-white">
                    {new Date(d.date).toLocaleDateString('en-GB')} · {d.views}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AdminReports
