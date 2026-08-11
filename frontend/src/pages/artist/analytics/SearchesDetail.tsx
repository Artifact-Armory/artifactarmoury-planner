import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { artistAnalyticsApi } from '../../../api/endpoints/artistAnalytics'
import { useAnalyticsRange, DateRangePicker } from '../../../components/analytics/dateRange'
import { BarList } from '../../../components/analytics/charts'
import Spinner from '../../../components/ui/Spinner'

const SearchesDetail: React.FC = () => {
  const { range, setRange, setPreset } = useAnalyticsRange()
  const { data, isLoading } = useQuery({
    queryKey: ['aa-searches', range.from, range.to],
    queryFn: () => artistAnalyticsApi.searches(range),
  })

  return (
    <div className="px-4 py-8 max-w-4xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/artist" className="text-sm text-primary">← Analytics</Link>
          <h1 className="text-2xl font-semibold text-foreground">What buyers search for</h1>
          <p className="text-sm text-muted-foreground">Tag against demand. Zero-result queries are commission-yourself signals.</p>
        </div>
        <DateRangePicker range={range} setRange={setRange} setPreset={setPreset} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Top searches (site-wide)</h2>
            <BarList data={(data?.top ?? []).map((s) => ({ label: s.query, value: s.searches }))} />
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-1 text-sm font-semibold text-foreground">Zero-result gaps</h2>
            <p className="mb-3 text-xs text-muted-foreground">People searched these and found nothing — an opening for your next release.</p>
            <BarList data={(data?.zero ?? []).map((s) => ({ label: s.query, value: s.zeroResults, danger: true }))} />
          </div>
        </div>
      )}
    </div>
  )
}

export default SearchesDetail
