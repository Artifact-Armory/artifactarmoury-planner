import React, { useMemo } from 'react'

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

  return (
    <div className="pointer-events-auto absolute bottom-8 left-6 z-30 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white shadow-xl shadow-black/50 backdrop-blur-md">
      <dl className="space-y-1">
        <div className="flex items-center justify-between">
          <dt className="text-xs uppercase tracking-wide text-white/50">Models on table</dt>
          <dd className="text-sm font-semibold text-white">{instances.length}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs uppercase tracking-wide text-white/50">Table</dt>
          <dd className="text-sm font-medium text-white">
            {widthValue.toFixed(2)} × {heightValue.toFixed(2)} {unitLabel(table.unitDisplay)}
          </dd>
        </div>
        {measurementLabel && (
          <div className="flex items-center justify-between">
            <dt className="text-xs uppercase tracking-wide text-white/50">Measurement</dt>
            <dd className="text-sm font-medium text-emerald-200">{measurementLabel}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}
