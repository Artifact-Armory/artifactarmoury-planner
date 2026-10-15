// Dimension controls for a landform — used both for the armed draft ("before
// placing") and for a placed, selected landform. Values are explicit
// millimetres (degrees / percent where that's the natural unit); each field
// has a number box and a slider. A slider drag or a typed edit reports live
// changes through onChange and exactly ONE onCommit when the interaction ends,
// so a whole drag is a single undo step.
import React from 'react'
import { FLAT_RATIO, type TerrainFeature, type TerrainFeaturePatch } from '../core/terrainFeatures'

function Dimension({ label, value, min, max, step = 1, unit, onChange, onCommit }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string
  onChange: (n: number) => void; onCommit: () => void
}) {
  const [text, setText] = React.useState(String(value))
  const focused = React.useRef(false)
  React.useEffect(() => { if (!focused.current) setText(String(value)) }, [value])
  return (
    <div className="tb-landform-dimension">
      <label className="tb-landform-value">
        <span>{label}</span>
        <span>
          <input
            aria-label={`${label} (${unit})`} type="number" min={min} max={max} step={step}
            value={text}
            onFocus={() => { focused.current = true }}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') { e.currentTarget.value = String(value); setText(String(value)); e.currentTarget.blur() }
            }}
            onBlur={(e) => {
              focused.current = false
              const entered = e.currentTarget.value
              const n = Number(entered)
              const next = entered.trim() && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : value
              setText(String(next))
              if (next !== value) onChange(next)
              onCommit()
            }}
          /> {unit}
        </span>
      </label>
      <input
        aria-label={`Adjust ${label.toLowerCase()}`} type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit} onPointerCancel={onCommit} onKeyUp={onCommit} onBlur={onCommit}
      />
    </div>
  )
}

export function LandformControls({ feature, onChange, onCommit, placed = false }: {
  feature: TerrainFeature
  onChange: (patch: TerrainFeaturePatch) => void
  onCommit: () => void
  /** A placed landform also gets numeric position fields. */
  placed?: boolean
}) {
  // Only commit when something actually changed during this interaction.
  const dirty = React.useRef(false)
  const change = (patch: TerrainFeaturePatch) => { dirty.current = true; onChange(patch) }
  const finish = () => { if (dirty.current) { dirty.current = false; onCommit() } }
  const rz = feature.radiusZ ?? feature.radius
  const field = (label: string, value: number, min: number, max: number, unit: string, patch: (n: number) => TerrainFeaturePatch) => (
    <Dimension label={label} value={value} min={min} max={max} unit={unit} onChange={(n) => change(patch(n))} onCommit={finish} />
  )
  return (
    <div className="tb-landform-controls">
      <div className="tb-landform-measurements">
        <strong>{Math.round(feature.radius * 2000)} × {Math.round(rz * 2000)} mm</strong>
        <span>{Math.round(feature.height * 1000)} mm rise</span>
      </div>
      {/* Pin the width when the length changes, so an old circular landform
          (no radiusZ) doesn't stretch both ways at once. */}
      {field('Length', Math.round(feature.radius * 2000), 80, 2000, 'mm', (n) => ({ radius: n / 2000, radiusZ: rz }))}
      {field('Width', Math.round(rz * 2000), 80, 2000, 'mm', (n) => ({ radiusZ: n / 2000 }))}
      {field('Rise', Math.round(feature.height * 1000), -180, 350, 'mm', (n) => ({ height: n / 1000 }))}
      {field('Rotation', Math.round(feature.rotationDeg ?? 0), 0, 359, '°', (n) => ({ rotationDeg: n }))}
      {field('Flat top', Math.round((feature.flatTop ?? FLAT_RATIO[feature.type]) * 100), 0, 90, '%', (n) => ({ flatTop: n / 100 }))}
      <label className="tb-landform-value">
        <span>Overlap</span>
        <select
          aria-label="Landform overlap" value={feature.blend ?? 'add'}
          onChange={(e) => { change({ blend: e.target.value as 'add' | 'merge' }); finish() }}
        >
          <option value="merge">Merge</option>
          <option value="add">Add heights</option>
        </select>
      </label>
      <p className="tb-small tb-terrain-sub">
        {feature.blend === 'merge'
          ? 'Joins other merged landforms without stacking their rises. Landforms set to Add heights still add on top.'
          : 'Adds this rise to whatever landforms are underneath it.'}
      </p>
      {placed && (
        <details className="tb-landform-position">
          <summary>Position on the table</summary>
          {field('Across', Math.round(feature.x * 1000), -2000, 2000, 'mm', (n) => ({ x: n / 1000 }))}
          {field('Along', Math.round(feature.z * 1000), -2000, 2000, 'mm', (n) => ({ z: n / 1000 }))}
          <p className="tb-small">Measured from the table centre.</p>
        </details>
      )}
    </div>
  )
}
