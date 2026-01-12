import React from 'react'
import { useForm } from 'react-hook-form'
import { Layers, Scan } from 'lucide-react'
import { toast } from 'react-hot-toast'

import { useAppStore } from '@state/store'
import { fromMetres, parseDimensionToMetres, unitLabel, type Unit } from '@core/units'

interface TopToolbarProps {
  children?: React.ReactNode
}

interface TableFormValues {
  width: string
  height: string
  unit: Unit
  gridSize: string
}

export function TopToolbar({ children }: TopToolbarProps) {
  const table = useAppStore((s) => s.table)
  const setTable = useAppStore((s) => s.setTable)
  const fitView = useAppStore((s) => s.actions.fitView)

  const {
    register,
    handleSubmit,
    reset,
    watch,
  } = useForm<TableFormValues>({
    defaultValues: getDefaults(table),
  })

  const watchUnit = watch('unit')

  React.useEffect(() => {
    reset(getDefaults({ ...table, unitDisplay: watchUnit }))
  }, [table.width, table.height, table.gridSize, table.unitDisplay, reset])

  const onSubmit = handleSubmit((values) => {
    const width = parseDimensionToMetres(values.width, values.unit) || table.width
    const height = parseDimensionToMetres(values.height, values.unit) || table.height
    const grid = Math.max(parseDimensionToMetres(values.gridSize, values.unit), 0.05)

    setTable({
      width,
      height,
      gridSize: grid,
      unitDisplay: values.unit,
    })
    fitView()
    toast.success('Table updated', { duration: 2000 })
  })

  return (
    <header className="pointer-events-auto fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between border-b border-white/10 bg-slate-900/90 px-6 text-slate-50 shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
          <Layers className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Artifact Armoury</p>
          <h1 className="text-lg font-semibold leading-tight">Terrain Builder</h1>
        </div>
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-slate-800/70 px-3 py-2">
          <input
            type="number"
            step="0.1"
            placeholder="W"
            {...register('width', { required: true })}
            className="h-8 w-16 rounded-md border border-white/10 bg-slate-900/80 px-2 text-sm text-slate-50 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
            aria-label="Table width"
          />
          <span className="text-slate-500">×</span>
          <input
            type="number"
            step="0.1"
            placeholder="H"
            {...register('height', { required: true })}
            className="h-8 w-16 rounded-md border border-white/10 bg-slate-900/80 px-2 text-sm text-slate-50 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
            aria-label="Table height"
          />
        </div>

        <select
          {...register('unit')}
          className="h-10 w-20 rounded-md border border-white/10 bg-slate-800/70 px-2 text-sm text-slate-50 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
          aria-label="Measurement unit"
        >
          <option value="m">m</option>
          <option value="cm">cm</option>
          <option value="ft">ft</option>
          <option value="in">in</option>
        </select>

        <input
          type="number"
          step="0.05"
          min="0.05"
          placeholder="Grid"
          {...register('gridSize', { required: true })}
          className="h-10 w-20 rounded-md border border-white/10 bg-slate-800/70 px-2 text-sm text-slate-50 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
          aria-label="Grid size"
        />

        <button
          type="submit"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-sky-500 px-3 text-sm font-semibold text-white shadow-md transition-colors hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          <Scan className="h-4 w-4" aria-hidden="true" />
          Update
        </button>

        <span className="text-xs text-slate-400">
          Grid: {fromMetres(table.gridSize, table.unitDisplay).toFixed(2)} {unitLabel(table.unitDisplay)}
        </span>
      </form>

      <div className="flex items-center gap-3">{children}</div>
    </header>
  )
}

function getDefaults(table: { width: number; height: number; gridSize: number; unitDisplay: Unit }): TableFormValues {
  const unit = table.unitDisplay
  return {
    width: fromMetres(table.width, unit).toFixed(2),
    height: fromMetres(table.height, unit).toFixed(2),
    gridSize: fromMetres(table.gridSize, unit).toFixed(2),
    unit,
  }
}
