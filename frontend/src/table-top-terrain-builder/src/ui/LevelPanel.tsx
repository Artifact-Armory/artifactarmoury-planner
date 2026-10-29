// src/ui/LevelPanel.tsx — "Level markers" panel, open while the marker tool is on.
// Markers split the layout PDF into one map per real floor (see ui/layoutPdf.ts).
import React from 'react'
import { ChevronRight, SeparatorHorizontal, Trash2 } from 'lucide-react'
import { useAppStore } from '@state/store'
import { useUnitsStore } from '@/store/unitsStore'

export function LevelPanel({ onClose }: { onClose: () => void }) {
  const markers = useAppStore((s) => s.levelMarkers)
  const removeLevelMarker = useAppStore((s) => s.removeLevelMarker)
  const system = useUnitsStore((s) => s.system)
  const fmt = (m: number) => (system === 'imperial' ? `${(m / 0.0254).toFixed(2)}"` : `${(m * 100).toFixed(1)} cm`)

  return (
    <div className="tb-terrain tb-look">
      <div className="tb-terrain-head">
        <span><SeparatorHorizontal size={14} /> Level markers</span>
        <button className="tb-icon" title="Done (Esc)" aria-label="Done" onClick={onClose}>
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="tb-look-section">
        <p className="tb-small tb-terrain-sub">
          Point at the floor of a level (the top of a floor plate, say). The blue glow shows that height across
          the table; click to drop a marker there. The layout PDF then prints one map per floor.
        </p>
      </div>

      <div className="tb-look-section">
        <div className="tb-terrain-export-head">Floors</div>
        <div className="tb-level-row">
          <span className="tb-level-num is-ground">G</span>
          <span>Ground: on the table</span>
        </div>
        {markers.map((y, i) => (
          <div className="tb-level-row" key={`${i}-${y}`}>
            <span className="tb-level-num">{i + 1}</span>
            <span>Floor {i + 1}: from {fmt(y)} up</span>
            <button className="tb-icon is-danger" title={`Remove marker ${i + 1}`} onClick={() => removeLevelMarker(i)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {!markers.length && (
          <p className="tb-small tb-terrain-sub">No markers yet, so the PDF splits busy tables every half inch of height.</p>
        )}
      </div>
    </div>
  )
}
