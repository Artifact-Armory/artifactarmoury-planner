// src/ui/HelpOverlay.tsx — full controls reference (toggle with ?).
import React from 'react'
import { X } from 'lucide-react'

type Group = { title: string; rows: Array<[string, string]> }

// Shown instead of the mouse/keyboard reference on touch-primary devices — none
// of the keys below exist on a tablet, so listing them there is just misleading.
const TOUCH_GROUPS: Group[] = [
  {
    title: 'Camera',
    rows: [
      ['Pan', 'Drag one finger on empty table'],
      ['Zoom', 'Pinch'],
      ['Look around (orbit)', 'Twist two fingers'],
      ['Tilt the view', 'Drag two fingers up / down'],
      ['Fit to selection or table', 'Fit button'],
    ],
  },
  {
    title: 'Building',
    rows: [
      ['Pick a piece', 'Tap it in the palette'],
      ['Place / stamp piece', 'Tap the table'],
      ['Rotate', 'Rotate buttons (bottom bar)'],
      ['Raise / lower place level', 'Level ▲ / ▼ (bottom bar)'],
      ['Toggle snap ⇄ free', 'Grid button (top bar)'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['Select piece', 'Tap it'],
      ['Move', 'Drag it'],
      ['Rotate freely (any angle)', 'Drag an orange arrow at its base'],
      ['Tilt upright / lay flat', 'Tilt buttons (top bar)'],
      ['Delete', 'Bin button (bottom bar)'],
      ['Undo / Redo', 'Top bar buttons'],
    ],
  },
]

const GROUPS: Group[] = [
  {
    title: 'Camera',
    rows: [
      ['Zoom toward cursor', 'Scroll'],
      ['Look around (orbit)', 'Right click and drag'],
      ['Pan', 'Middle click and drag / WASD'],
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
      ['Rotate freely (any angle)', 'Drag an orange arrow at its base'],
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

export function HelpOverlay({
  onClose,
  onReplayTour,
  onShowPreviewQuality,
  touch = false,
}: {
  onClose: () => void
  onReplayTour?: () => void
  /** Re-open the "previews aren't your final print" comparison. */
  onShowPreviewQuality?: () => void
  /** Show the finger-gesture reference instead of the mouse/keyboard one. */
  touch?: boolean
}) {
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
          <div className="tb-help-head-actions">
            {onShowPreviewQuality && (
              <button className="tb-btn" onClick={onShowPreviewQuality}>Preview vs print</button>
            )}
            {onReplayTour && (
              <button className="tb-btn" onClick={onReplayTour}>Replay walkthrough</button>
            )}
            <button className="tb-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </div>
        <div className="tb-help-grid">
          {(touch ? TOUCH_GROUPS : GROUPS).map((g) => (
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
