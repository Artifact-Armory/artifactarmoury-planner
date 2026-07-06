import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { artistAnalyticsApi } from '../../../api/endpoints/artistAnalytics'
import { useAnalyticsRange, DateRangePicker } from '../../../components/analytics/dateRange'
import { BarList } from '../../../components/analytics/charts'
import Spinner from '../../../components/ui/Spinner'

const RatingDetail: React.FC = () => {
  const { range, setRange, setPreset } = useAnalyticsRange()
  const { data, isLoading } = useQuery({
    queryKey: ['aa-summary-rating', range.from, range.to],
    queryFn: () => artistAnalyticsApi.summary(range),
  })

  const r = data?.rating
  const dist = r ? ([5, 4, 3, 2, 1] as const).map((s) => ({ label: `${s} ★`, value: r.distribution[String(s) as '5'] })) : []

  return (
    <div className="px-4 py-8 max-w-3xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/artist" className="text-sm text-indigo-600">← Analytics</Link>
          <h1 className="text-2xl font-semibold text-gray-900">Ratings</h1>
          <p className="text-sm text-gray-500">A 4.2 of solid 4s and a 4.2 of 5s-and-1s are different problems — read the shape.</p>
        </div>
        <DateRangePicker range={range} setRange={setRange} setPreset={setPreset} />
      </div>

      {isLoading || !r ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : r.count === 0 ? (
        <p className="mt-10 rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">No reviews yet.</p>
      ) : (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-5 flex items-end gap-3">
            <span className="text-4xl font-bold text-gray-900">{r.avg.toFixed(2)}</span>
            <span className="flex items-center gap-1 pb-1 text-amber-500"><Star size={18} fill="currentColor" /></span>
            <span className="pb-1 text-sm text-gray-500">{r.count} review{r.count === 1 ? '' : 's'} (all-time)</span>
          </div>
          <BarList data={dist} />
        </div>
      )}
    </div>
  )
}

export default RatingDetail
