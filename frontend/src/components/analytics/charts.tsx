import React from 'react'

/** Simple responsive column chart for a daily series. Not a full dataviz system —
 *  an at-a-glance trend for the artist dashboard. */
export const ColumnChart: React.FC<{
  data: { label: string; value: number }[]
  height?: number
  color?: string
  format?: (v: number) => string
}> = ({ data, height = 120, color = '#6366f1', format = (v) => String(v) }) => {
  if (!data.length) return <p className="py-8 text-center text-sm text-muted-foreground">No data in this range.</p>
  const max = Math.max(1, ...data.map((d) => d.value))
  const w = 100 / data.length
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 4)
        return (
          <rect
            key={i}
            x={i * w + w * 0.15}
            y={height - h}
            width={w * 0.7}
            height={h}
            fill={color}
            rx={0.5}
          >
            <title>{`${d.label}: ${format(d.value)}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

/** Horizontal bar list (e.g. search terms, rating distribution). */
export const BarList: React.FC<{
  data: { label: string; value: number; sub?: string; danger?: boolean }[]
  format?: (v: number) => string
}> = ({ data, format = (v) => String(v) }) => {
  if (!data.length) return <p className="py-6 text-center text-sm text-muted-foreground">Nothing here yet.</p>
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <ul className="space-y-1.5">
      {data.map((d, i) => (
        <li key={i} className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 truncate text-foreground" title={d.label}>{d.label}</span>
          <span className="relative h-4 flex-1 overflow-hidden rounded-sm bg-muted">
            <span
              className={`absolute inset-y-0 left-0 rounded-sm ${d.danger ? 'bg-amber-400' : 'bg-primary'}`}
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </span>
          <span className="w-16 shrink-0 text-right text-muted-foreground">
            {format(d.value)}
            {d.sub && <span className="ml-1 text-xs text-muted-foreground">{d.sub}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}
