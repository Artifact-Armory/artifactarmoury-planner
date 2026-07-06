import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PoundSterling, ShoppingBag, Users, Eye, Package, Download } from 'lucide-react'
import { artistsApi } from '../../api/endpoints/artists'
import { formatPrice } from '../../utils/format'
import Spinner from '../../components/ui/Spinner'

const StatCard: React.FC<{ label: string; value: string; icon: React.ReactNode; hint?: string }> = ({
  label,
  value,
  icon,
  hint,
}) => (
  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
    <div className="flex items-center gap-2 text-gray-400">
      {icon}
      <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
    </div>
    <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
    {hint && <p className="text-xs text-gray-400">{hint}</p>}
  </div>
)

const ArtistDashboard: React.FC = () => {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['artist-stats'],
    queryFn: () => artistsApi.getDashboardStats(),
  })

  return (
    <div className="px-4 py-10 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Artist Dashboard</h1>
          <p className="text-gray-600">Your sales, audience, and catalogue at a glance.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/artist/models" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50">My Models</Link>
          <Link to="/artist/sales" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">View sales</Link>
        </div>
      </div>

      {isLoading || !stats ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatCard label="Your earnings" value={formatPrice(stats.netEarnings)} icon={<PoundSterling size={16} />} hint="after 15% platform fee" />
          <StatCard label="Gross revenue" value={formatPrice(stats.grossRevenue)} icon={<PoundSterling size={16} />} />
          <StatCard label="Sales" value={String(stats.totalSales)} icon={<ShoppingBag size={16} />} />
          <StatCard label="Followers" value={String(stats.followers)} icon={<Users size={16} />} />
          <StatCard label="Total views" value={String(stats.totalViews)} icon={<Eye size={16} />} />
          <StatCard label="Downloads" value={String(stats.totalDownloads)} icon={<Download size={16} />} />
          <StatCard
            label="Models"
            value={String(stats.activeModels)}
            icon={<Package size={16} />}
            hint={`${stats.activeModels} published · ${stats.draftModels} draft`}
          />
        </div>
      )}
    </div>
  )
}

export default ArtistDashboard
