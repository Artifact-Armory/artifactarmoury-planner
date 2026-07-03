// src/ui/HelpOverlay.tsx — full controls reference (toggle with ?).
import React from 'react'
import { X } from 'lucide-react'

const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Camera',
    rows: [
      ['Zoom toward cursor', 'Scroll'],
      ['Look around (orbit)', 'Right-drag'],
      ['Pan', 'Middle-drag / WASD'],
      ['Fit to selection or table', 'F'],
      ['Reset view', 'Home'],
    ],
  },
  {
    title: 'Building',
    rows: [
      ['Place / stamp piece', 'Left-click'],
      ['Rotate ghost / selection', 'R'],
      ['Rotate the other way', 'Shift + R'],
      ['Free-place (momentary)', 'Hold Alt'],
      ['Toggle snap ⇄ free', 'G'],
      ['Raise / lower place level', 'PgUp / PgDn'],
      ['Cancel / deselect', 'Esc'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['Select piece', 'Left-click'],
      ['Add / remove from selection', 'Shift + click'],
      ['Box-select', 'Left-drag empty table'],
      ['Move', 'Left-drag a piece'],
      ['Tilt upright / lay flat', 'T'],
      ['Tilt the other way', 'Shift + T'],
      ['Duplicate', 'Ctrl + D'],
      ['Delete', 'Delete / Backspace'],
    ],
  },
  {
    title: 'General',
    rows: [
      ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'],
      ['Save map', 'Ctrl + S'],
      ['Hide UI (screenshots)', 'H'],
      ['This help', '?'],
    ],
  },
]

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="tb-help-backdrop" onClick={onClose}>
      <div className="tb-help" onClick={(e) => e.stopPropagation()}>
        <div className="tb-help-head">
          <strong>Controls</strong>
          <button className="tb-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="tb-help-grid">
          {GROUPS.map((g) => (
            <div key={g.title} className="tb-help-col">
              <div className="tb-help-title">{g.title}</div>
              {g.rows.map(([label, keys]) => (
                <div key={label} className="tb-help-row">
                  <span>{label}</span>
                  <span className="tb-kbd">{keys}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
