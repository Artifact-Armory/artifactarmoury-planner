import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { artistAnalyticsApi } from '../../../api/endpoints/artistAnalytics'
import { useAnalyticsRange, DateRangePicker } from '../../../components/analytics/dateRange'
import { ColumnChart } from '../../../components/analytics/charts'
import { formatPrice } from '../../../utils/format'
import Spinner from '../../../components/ui/Spinner'

const SalesDetail: React.FC = () => {
  const { range, setRange, setPreset } = useAnalyticsRange()
  const [metric, setMetric] = React.useState<'gross' | 'net' | 'units'>('gross')

  const summaryQ = useQuery({ queryKey: ['aa-summary', range.from, range.to], queryFn: () => artistAnalyticsApi.summary(range) })
  const seriesQ = useQuery({ queryKey: ['aa-series', range.from, range.to], queryFn: () => artistAnalyticsApi.timeseries(range) })
  const productsQ = useQuery({ queryKey: ['aa-products-rev', range.from, range.to], queryFn: () => artistAnalyticsApi.products(range, 'gross') })

  const t = summaryQ.data?.totals
  const fee = t ? t.gross - t.net : 0

  const exportCsv = () => {
    const rows = productsQ.data ?? []
    const header = 'Model,Units,Gross,Fee,Net\n'
    const body = rows
      .map((r) => `"${r.name.replace(/"/g, '""')}",${r.units},${r.gross.toFixed(2)},${(r.gross - r.net).toFixed(2)},${r.net.toFixed(2)}`)
      .join('\n')
    const blob = new Blob([header + body], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sales_${range.from}_${range.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="px-4 py-8 max-w-5xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/artist" className="text-sm text-primary">← Analytics</Link>
          <h1 className="text-2xl font-semibold text-foreground">Sales & revenue</h1>
        </div>
        <DateRangePicker range={range} setRange={setRange} setPreset={setPreset} />
      </div>

      {!t ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Gross</p><p className="text-xl font-semibold">{formatPrice(t.gross)}</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Platform fee</p><p className="text-xl font-semibold text-muted-foreground">−{formatPrice(fee)}</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Net (you)</p><p className="text-xl font-semibold text-green-700">{formatPrice(t.net)}</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">Units</p><p className="text-xl font-semibold">{t.sales}</p></div>
          </div>

          <div className="mt-6 rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Over time</h2>
              <div className="inline-flex overflow-hidden rounded-lg border border-border text-sm">
                {(['gross', 'net', 'units'] as const).map((m) => (
                  <button key={m} onClick={() => setMetric(m)} className={`px-3 py-1 capitalize ${metric === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>{m}</button>
                ))}
              </div>
            </div>
            <ColumnChart
              data={(seriesQ.data ?? []).map((d) => ({ label: d.day, value: d[metric] }))}
              format={(v) => (metric === 'units' ? String(v) : formatPrice(v))}
            />
          </div>

          <div className="mt-6 rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Revenue by product</h2>
              <button onClick={exportCsv} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm text-foreground hover:bg-accent">
                <Download size={14} /> Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Model</th><th className="py-2 text-right">Units</th><th className="py-2 text-right">Gross</th><th className="py-2 text-right">Net</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(productsQ.data ?? []).filter((p) => p.units > 0).map((p) => (
                    <tr key={p.modelId}>
                      <td className="py-2"><Link to={`/artist/analytics/model/${p.modelId}`} className="font-medium text-foreground hover:text-primary">{p.name}</Link></td>
                      <td className="py-2 text-right">{p.units}</td>
                      <td className="py-2 text-right text-muted-foreground">{formatPrice(p.gross)}</td>
                      <td className="py-2 text-right font-medium text-green-700">{formatPrice(p.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default SalesDetail
