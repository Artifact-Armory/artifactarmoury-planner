import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import { artistAnalyticsApi } from '../../../api/endpoints/artistAnalytics'
import { useAnalyticsRange, DateRangePicker } from '../../../components/analytics/dateRange'
import { formatPrice } from '../../../utils/format'
import Spinner from '../../../components/ui/Spinner'

type SortKey = 'units' | 'gross' | 'views' | 'conversion'

const ProductsDetail: React.FC = () => {
  const { range, setRange, setPreset } = useAnalyticsRange()
  const [sort, setSort] = React.useState<SortKey>('units')

  const { data, isLoading } = useQuery({
    queryKey: ['aa-products', range.from, range.to, sort],
    queryFn: () => artistAnalyticsApi.products(range, sort),
    placeholderData: (p) => p,
  })

  const cols: { key: SortKey; label: string }[] = [
    { key: 'units', label: 'Units' },
    { key: 'gross', label: 'Gross' },
    { key: 'views', label: 'Views' },
    { key: 'conversion', label: 'Conv.' },
  ]

  return (
    <div className="px-4 py-8 max-w-5xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/artist" className="text-sm text-primary">← Analytics</Link>
          <h1 className="text-2xl font-semibold text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground">"Popular" differs by metric — sort to see which. High views + low conversion = presentation/price; low views = discoverability.</p>
        </div>
        <DateRangePicker range={range} setRange={setRange} setPreset={setPreset} />
      </div>

      {isLoading && !data ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Model</th>
                {cols.map((c) => (
                  <th key={c.key} className="px-4 py-3 text-right">
                    <button onClick={() => setSort(c.key)} className={`hover:text-foreground ${sort === c.key ? 'font-semibold text-primary' : ''}`}>
                      {c.label}{sort === c.key ? ' ↓' : ''}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-3 text-right">Placed</th>
                <th className="px-4 py-3 text-right">Wishlist</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(data ?? []).map((p) => (
                <tr key={p.modelId} className="hover:bg-accent">
                  <td className="px-4 py-3">
                    <Link to={`/artist/analytics/model/${p.modelId}`} className="font-medium text-foreground hover:text-primary">
                      {p.isSet && <Layers size={12} className="mr-1 inline text-muted-foreground" />}
                      {p.name}
                    </Link>
                    {p.status !== 'published' && <span className="ml-2 rounded-sm bg-muted px-1.5 text-xs text-muted-foreground">{p.status}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">{p.units}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{formatPrice(p.gross)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{p.views}</td>
                  <td className={`px-4 py-3 text-right ${p.views >= 20 && p.conversion < 0.01 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                    {(p.conversion * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{p.placements}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{p.wishlist}</td>
                </tr>
              ))}
              {(data ?? []).length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No activity in this range yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ProductsDetail
