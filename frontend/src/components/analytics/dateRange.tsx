import React from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AnalyticsRange } from '../../api/endpoints/artistAnalytics'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400_000))

const PRESETS: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '12m', days: 365 },
]

/** Global analytics date range, persisted in the URL (?from&to) so it survives
 *  navigation from a tile into its drill-down. Defaults to the last 30 days. */
export function useAnalyticsRange(): {
  range: AnalyticsRange
  setRange: (r: AnalyticsRange) => void
  setPreset: (days: number) => void
} {
  const [params, setParams] = useSearchParams()
  const from = params.get('from') || daysAgo(29)
  const to = params.get('to') || daysAgo(0)

  const setRange = (r: AnalyticsRange) => {
    const next = new URLSearchParams(params)
    next.set('from', r.from)
    next.set('to', r.to)
    setParams(next, { replace: true })
  }
  return {
    range: { from, to },
    setRange,
    setPreset: (days: number) => setRange({ from: daysAgo(days - 1), to: daysAgo(0) }),
  }
}

export const DateRangePicker: React.FC<{
  range: AnalyticsRange
  setRange: (r: AnalyticsRange) => void
  setPreset: (days: number) => void
}> = ({ range, setRange, setPreset }) => {
  // Which preset (if any) is currently active.
  const activeDays = (() => {
    if (range.to !== daysAgo(0)) return null
    const d = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400_000) + 1
    return PRESETS.find((p) => p.days === d)?.days ?? null
  })()

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-lg border border-border">
        {PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => setPreset(p.days)}
            className={`px-3 py-1.5 text-sm ${
              activeDays === p.days ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <input
          type="date"
          value={range.from}
          max={range.to}
          onChange={(e) => setRange({ ...range, from: e.target.value })}
          className="rounded-md border border-border px-2 py-1"
        />
        <span>→</span>
        <input
          type="date"
          value={range.to}
          min={range.from}
          max={daysAgo(0)}
          onChange={(e) => setRange({ ...range, to: e.target.value })}
          className="rounded-md border border-border px-2 py-1"
        />
      </div>
    </div>
  )
}
