import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Eye, Heart, LayoutGrid, ShoppingBag } from 'lucide-react'
import { artistAnalyticsApi } from '../../../api/endpoints/artistAnalytics'
import { useAnalyticsRange, DateRangePicker } from '../../../components/analytics/dateRange'
import { ColumnChart } from '../../../components/analytics/charts'
import { formatPrice } from '../../../utils/format'
import Spinner from '../../../components/ui/Spinner'

const FunnelStep: React.FC<{ icon: React.ReactNode; label: string; value: number; rate?: string }> = ({ icon, label, value, rate }) => (
  <div className="flex-1 rounded-xl border border-border bg-card p-4 text-center">
    <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</div>
    <p className="mt-2 text-xl font-semibold text-foreground">{value}</p>
    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
    {rate && <p className="text-xs text-muted-foreground">{rate}</p>}
  </div>
)

const ModelFunnel: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const { range, setRange, setPreset } = useAnalyticsRange()
  const [metric, setMetric] = React.useState<'views' | 'placements' | 'units'>('views')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['aa-funnel', id, range.from, range.to],
    queryFn: () => artistAnalyticsApi.modelFunnel(id as string, range),
    enabled: Boolean(id),
  })

  if (isLoading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  if (isError || !data) return <div className="px-4 py-16 text-center text-muted-foreground">Model not found or not yours. <Link to="/artist" className="text-primary">← Analytics</Link></div>

  const f = data.funnel
  const rate = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—')

  return (
    <div className="px-4 py-8 max-w-4xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/artist" className="text-sm text-primary">← Analytics</Link>
          <h1 className="text-2xl font-semibold text-foreground">{data.name}</h1>
          <Link to={`/models/${data.modelId}`} className="text-sm text-muted-foreground hover:text-primary">View product page →</Link>
        </div>
        <DateRangePicker range={range} setRange={setRange} setPreset={setPreset} />
      </div>

      <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <FunnelStep icon={<Eye size={16} />} label="Views" value={f.views} />
        <span className="hidden text-muted-foreground sm:block">→</span>
        <FunnelStep icon={<Heart size={16} />} label="Wishlist" value={f.wishlist} rate={rate(f.wishlist, f.views)} />
        <span className="hidden text-muted-foreground sm:block">→</span>
        <FunnelStep icon={<LayoutGrid size={16} />} label="Placed" value={f.placements} rate={rate(f.placements, f.views)} />
        <span className="hidden text-muted-foreground sm:block">→</span>
        <FunnelStep icon={<ShoppingBag size={16} />} label="Sales" value={f.sales} rate={rate(f.sales, f.views)} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Conversion</p><p className="text-xl font-semibold">{(f.conversion * 100).toFixed(1)}%</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Gross</p><p className="text-xl font-semibold">{formatPrice(data.gross)}</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Net</p><p className="text-xl font-semibold text-green-700">{formatPrice(data.net)}</p></div>
      </div>

      {f.views >= 20 && f.conversion < 0.01 && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          High views, low conversion — likely a presentation or price issue (renders, scale clarity, price). Different fix from low-view (discoverability) products.
        </p>
      )}

      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Over time</h2>
          <div className="inline-flex overflow-hidden rounded-lg border border-border text-sm">
            {(['views', 'placements', 'units'] as const).map((m) => (
              <button key={m} onClick={() => setMetric(m)} className={`px-3 py-1 capitalize ${metric === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>{m}</button>
            ))}
          </div>
        </div>
        <ColumnChart data={data.series.map((d) => ({ label: d.day, value: d[metric] }))} />
      </div>
    </div>
  )
}

export default ModelFunnel
