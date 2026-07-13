import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PoundSterling, ShoppingBag, Eye, Heart, Target, LayoutGrid, Star, Search, TrendingUp, TrendingDown, ArrowRight, Layers, Wallet } from 'lucide-react'
import { artistAnalyticsApi, type PeriodTotals } from '../../api/endpoints/artistAnalytics'
import { artistsApi } from '../../api/endpoints/artists'
import { payoutsApi } from '../../api/endpoints/payouts'
import { useAnalyticsRange, DateRangePicker } from '../../components/analytics/dateRange'
import { formatPrice } from '../../utils/format'
import Spinner from '../../components/ui/Spinner'

const pct = (cur: number, prev: number): number | null => {
  if (prev === 0) return cur > 0 ? 100 : null
  return ((cur - prev) / prev) * 100
}

const Delta: React.FC<{ cur: number; prev: number; goodUp?: boolean }> = ({ cur, prev, goodUp = true }) => {
  const p = pct(cur, prev)
  if (p === null) return <span className="text-xs text-gray-400">— vs prev</span>
  const up = p >= 0
  const good = up === goodUp
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${good ? 'text-green-600' : 'text-red-500'}`}>
      <Icon size={12} /> {Math.abs(p).toFixed(0)}% vs prev
    </span>
  )
}

const Tile: React.FC<{
  label: string; icon: React.ReactNode; to?: string; children: React.ReactNode; hint?: string
}> = ({ label, icon, to, children, hint }) => {
  const body = (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow">
      <div className="flex items-center gap-2 text-gray-400">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {to && <ArrowRight size={13} className="ml-auto text-gray-300" />}
      </div>
      <div className="mt-2 flex-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
  return to ? <Link to={to} className="block h-full">{body}</Link> : body
}

const Big: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-2xl font-semibold text-gray-900">{children}</p>
)

const ArtistDashboard: React.FC = () => {
  const { range, setRange, setPreset } = useAnalyticsRange()
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['artist-analytics-summary', range.from, range.to],
    queryFn: () => artistAnalyticsApi.summary(range),
    placeholderData: (p) => p,
  })

  const { data: payouts } = useQuery({
    queryKey: ['artist-payouts-summary'],
    queryFn: () => payoutsApi.getMine(),
  })

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['artist-sales'],
    queryFn: () => artistsApi.getSales({ limit: 100 }),
  })
  const sales = salesData?.sales ?? []

  const t: PeriodTotals | undefined = data?.totals
  const prev = data?.prev
  const conv = (v: PeriodTotals) => (v.conversion * 100)

  return (
    <div className="px-4 py-8 max-w-6xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Sales Overview</h1>
          <p className="text-sm text-gray-500">Your earnings and completed sales, with the data behind what to make next.</p>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && <Spinner size="sm" className="text-indigo-500" />}
          <DateRangePicker range={range} setRange={setRange} setPreset={setPreset} />
        </div>
      </div>

      {isLoading || !data || !t || !prev ? (
        <div className="flex justify-center py-24"><Spinner size="lg" /></div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <Tile label="Your earnings" icon={<PoundSterling size={16} />} to="/artist/analytics/sales" hint="after 15% fee">
            <Big>{formatPrice(t.net)}</Big>
            <Delta cur={t.net} prev={prev.net} />
          </Tile>

          <Tile label="Pending payouts" icon={<Wallet size={16} />} to="/artist/payouts" hint={payouts?.connect.onboardingComplete ? 'in 21-day hold' : 'set up payouts to get paid'}>
            <Big>{formatPrice(payouts?.summary.pending ?? 0)}</Big>
            {payouts && (payouts.summary.cleared > 0) && (
              <p className="text-xs text-green-600">{formatPrice(payouts.summary.cleared)} ready</p>
            )}
          </Tile>

          <Tile label="Total sales" icon={<ShoppingBag size={16} />} to="/artist/analytics/sales">
            <Big>{t.sales}</Big>
            <Delta cur={t.sales} prev={prev.sales} />
          </Tile>

          <Tile label="Conversion" icon={<Target size={16} />} to="/artist/analytics/products" hint="views → sales">
            <Big>{conv(t).toFixed(1)}%</Big>
            <Delta cur={t.conversion} prev={prev.conversion} />
          </Tile>

          <Tile label="Planner placements" icon={<LayoutGrid size={16} />} to="/artist/analytics/products" hint="purchase intent">
            <Big>{t.placements}</Big>
            <Delta cur={t.placements} prev={prev.placements} />
          </Tile>

          <Tile label="Views" icon={<Eye size={16} />} to="/artist/analytics/products">
            <Big>{t.views}</Big>
            <Delta cur={t.views} prev={prev.views} />
          </Tile>

          <Tile label="Wishlists" icon={<Heart size={16} />} to="/artist/analytics/products">
            <Big>{t.wishlist}</Big>
            <Delta cur={t.wishlist} prev={prev.wishlist} />
          </Tile>

          <Tile label="Avg rating" icon={<Star size={16} />} to="/artist/analytics/rating" hint={`${data.rating.count} reviews`}>
            <Big>{data.rating.count ? data.rating.avg.toFixed(2) : '—'}</Big>
            {data.rating.count > 0 && (
              <div className="mt-1 flex items-end gap-0.5" title="rating distribution">
                {([5, 4, 3, 2, 1] as const).map((s) => {
                  const max = Math.max(1, ...Object.values(data.rating.distribution))
                  const h = 6 + (data.rating.distribution[String(s) as '5'] / max) * 22
                  return <span key={s} className="w-2 rounded-t bg-amber-400" style={{ height: h }} />
                })}
              </div>
            )}
          </Tile>

          <Tile label="Most popular" icon={<TrendingUp size={16} />} to={data.topModels[0] ? `/artist/analytics/model/${data.topModels[0].modelId}` : undefined}>
            {data.topModels[0] ? (
              <>
                <p className="line-clamp-2 text-sm font-semibold text-gray-900">
                  {data.topModels[0].isSet && <Layers size={12} className="mr-1 inline text-gray-400" />}
                  {data.topModels[0].name}
                </p>
                <p className="text-xs text-gray-400">{data.topModels[0].units} sold · {data.topModels[0].views} views</p>
              </>
            ) : (
              <p className="text-sm text-gray-400">No sales yet</p>
            )}
          </Tile>

          <Tile label="Most viewed table" icon={<LayoutGrid size={16} />} to={data.mostViewedTable ? `/planner/view/${data.mostViewedTable.id}` : undefined}>
            {data.mostViewedTable ? (
              <>
                <p className="line-clamp-2 text-sm font-semibold text-gray-900">{data.mostViewedTable.name}</p>
                <p className="text-xs text-gray-400">{data.mostViewedTable.viewCount} views</p>
              </>
            ) : (
              <p className="text-sm text-gray-400">Not in any public table yet</p>
            )}
          </Tile>

          <Tile label="Featured in tables" icon={<Layers size={16} />} hint="your pieces in community builds">
            <Big>{data.featuredInTables}</Big>
          </Tile>

          <Tile label="Top searches (site)" icon={<Search size={16} />} to="/artist/analytics/searches">
            {data.topSearches.length ? (
              <ul className="space-y-0.5 text-xs text-gray-600">
                {data.topSearches.slice(0, 4).map((s) => (
                  <li key={s.query} className="flex justify-between gap-2">
                    <span className="truncate">{s.query}</span>
                    <span className="text-gray-400">{s.searches}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400">No search data yet</p>
            )}
          </Tile>
        </div>
      )}

      {/* SALES — the full ledger of completed sales, merged in from the old
          "Sales & Analytics" page so this is the single sales hub. */}
      <section className="mt-12">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Sales</h2>
            <p className="text-sm text-gray-500">
              {salesData?.total ?? 0} completed sale{(salesData?.total ?? 0) === 1 ? '' : 's'}
              {sales.length < (salesData?.total ?? 0) ? ` · showing latest ${sales.length}` : ''}.
            </p>
          </div>
          <Link to="/artist/analytics/sales" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700">
            Sales analytics <ArrowRight size={14} />
          </Link>
        </div>

        {salesLoading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : sales.length === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
            No sales yet. When someone buys one of your models, it'll appear here.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Buyer</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">You earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sales.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {s.model_id ? (
                        <Link to={`/models/${s.model_id}`} className="hover:text-indigo-600">{s.model_name}</Link>
                      ) : (
                        s.model_name
                      )}
                      {s.bundle_name && <span className="ml-1 text-xs text-gray-400">({s.bundle_name})</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{s.order_number}</td>
                    <td className="px-4 py-3 text-gray-500">{s.customer_email}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{formatPrice(s.total_price)}</td>
                    <td className="px-4 py-3 text-right font-medium text-green-700">{formatPrice(s.earnings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export default ArtistDashboard
