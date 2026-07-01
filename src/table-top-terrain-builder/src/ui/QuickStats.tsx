import React, { useMemo } from 'react'
import { Shapes, Ruler, Square } from 'lucide-react'

import { useAppStore } from '@state/store'
import { fromMetres, unitLabel } from '@core/units'

export function QuickStats() {
  const instances = useAppStore((s) => s.instances)
  const table = useAppStore((s) => s.table)
  const measurement = useAppStore((s) => s.measurement)

  const measurementLabel = useMemo(() => {
    if (!measurement.active || !measurement.start || !measurement.end) return null
    const dx = measurement.end.x - measurement.start.x
    const dz = measurement.end.z - measurement.start.z
    const distance = Math.sqrt(dx * dx + dz * dz)
    const value = fromMetres(distance, table.unitDisplay)
    const unit = unitLabel(table.unitDisplay)
    return `${value.toFixed(2)} ${unit}`
  }, [measurement, table.unitDisplay])

  const widthValue = fromMetres(table.width, table.unitDisplay)
  const heightValue = fromMetres(table.height, table.unitDisplay)

  const shouldShow = measurementLabel || instances.length > 0

  return (
    <div
      className={[
        'pointer-events-auto absolute bottom-8 left-6 z-30 rounded-tr-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-200 shadow-xl shadow-black/40 backdrop-blur-md transition-opacity duration-200',
        shouldShow ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
    >
      <div className="flex items-center gap-4 text-xs font-semibold uppercase tracking-wide text-slate-300">
        <span className="flex items-center gap-2">
          <Shapes className="h-4 w-4 text-sky-400" aria-hidden="true" />
          {instances.length} models
        </span>
        <div className="h-4 w-px bg-white/15" aria-hidden="true" />
        <span className="flex items-center gap-2">
          <Square className="h-4 w-4 text-sky-400" aria-hidden="true" />
          {widthValue.toFixed(2)} × {heightValue.toFixed(2)} {unitLabel(table.unitDisplay)}
        </span>
        {measurementLabel && (
          <>
            <div className="h-4 w-px bg-white/15" aria-hidden="true" />
            <span className="flex items-center gap-2 text-emerald-300">
              <Ruler className="h-4 w-4" aria-hidden="true" />
              {measurementLabel}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
