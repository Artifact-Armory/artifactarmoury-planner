import React from 'react'
import {
  Grid2x2,
  Magnet,
  Ruler,
  RefreshCw,
  Eye,
  Box,
  Circle,
  Trash2,
} from 'lucide-react'

import { useAppStore } from '@state/store'

const cn = (...classes: Array<string | null | undefined | false>) => classes.filter(Boolean).join(' ')

export function BottomToolbar() {
  const showGrid = useAppStore((s) => s.showGrid)
  const toggleGrid = useAppStore((s) => s.toggleGrid)
  const snapToGrid = useAppStore((s) => s.snapToGrid)
  const toggleSnapToGrid = useAppStore((s) => s.toggleSnapToGrid)
  const measurementActive = useAppStore((s) => s.measurement.active)
  const setMeasurementActive = useAppStore((s) => s.setMeasurementActive)
  const cameraMode = useAppStore((s) => s.cameraMode)
  const setCameraMode = useAppStore((s) => s.setCameraMode)
  const fitView = useAppStore((s) => s.actions.fitView)
  const clearInstances = useAppStore((s) => s.actions.clearInstances)

  const toggleMeasurement = () => {
    setMeasurementActive(!measurementActive)
  }

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-8 flex justify-center">
      <div className="flex items-center gap-3 rounded-full border border-white/10 bg-slate-900/85 px-6 py-3 text-sm text-white shadow-2xl shadow-black/50 backdrop-blur-xl">
        <ToggleButton
          icon={Grid2x2}
          label="Toggle grid"
          active={showGrid}
          onClick={() => toggleGrid()}
        />
        <ToggleButton
          icon={Magnet}
          label="Snap to grid"
          active={snapToGrid}
          onClick={() => toggleSnapToGrid()}
        />

        <Divider />

        <ToggleButton
          icon={Ruler}
          label="Measurement tool"
          active={measurementActive}
          onClick={toggleMeasurement}
        />

        <Divider />

        <CameraButton
          icon={Eye}
          label="Top view"
          active={cameraMode === 'top-down'}
          onClick={() => {
            setCameraMode('top-down')
            fitView()
          }}
        />
        <CameraButton
          icon={Box}
          label="Side view"
          active={cameraMode === 'isometric'}
          onClick={() => {
            setCameraMode('isometric')
            fitView()
          }}
        />
        <CameraButton
          icon={Circle}
          label="Perspective view"
          active={cameraMode === 'perspective'}
          onClick={() => {
            setCameraMode('perspective')
            fitView()
          }}
        />
        <CameraButton
          icon={RefreshCw}
          label="Fit view"
          active={false}
          onClick={() => fitView()}
        />

        <Divider />

        <button
          type="button"
          onClick={() => clearInstances()}
          className="inline-flex h-10 min-w-[44px] items-center justify-center gap-2 rounded-md bg-red-500/80 px-4 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
          title="Clear table"
          aria-label="Clear table"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Clear
        </button>
      </div>
    </div>
  )
}

interface ToggleButtonProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  onClick: () => void
}

function ToggleButton({ icon: Icon, label, active, onClick }: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-10 min-w-[44px] items-center justify-center gap-2 rounded-md border border-transparent px-3 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-sky-500',
        active ? 'bg-sky-500 text-white shadow-md' : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700/80',
      )}
      title={label}
      aria-label={label}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

interface CameraButtonProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  onClick: () => void
}

function CameraButton({ icon: Icon, label, active, onClick }: CameraButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-10 min-w-[44px] items-center justify-center gap-2 rounded-md border border-transparent px-3 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-sky-500',
        active ? 'bg-sky-500 text-white shadow-md' : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700/80',
      )}
      title={label}
      aria-label={label}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

function Divider() {
  return <div className="mx-1 h-8 w-px bg-white/10" aria-hidden="true" />
}
