// src/ui/LookPanel.tsx — "Colours & light" panel: paint the selected pieces or
// every piece one colour, and set the scene brightness. Colours multiply into
// each model's own shading (see InstancedScene), so they read as painted plastic.
import React from 'react'
import { ChevronRight, Palette, Sun } from 'lucide-react'
import { useAppStore, BRIGHTNESS_MIN, BRIGHTNESS_MAX } from '@state/store'

const PIECE_COLOURS: Array<{ label: string; hex: string }> = [
  { label: 'Stone grey', hex: '#a3a39e' },
  { label: 'Sandstone', hex: '#d2bc8c' },
  { label: 'Red brick', hex: '#a95a42' },
  { label: 'Terracotta', hex: '#c9804f' },
  { label: 'Dark wood', hex: '#70503a' },
  { label: 'Olive drab', hex: '#717648' },
  { label: 'Field grey', hex: '#79806f' },
  { label: 'Desert yellow', hex: '#cfac5f' },
  { label: 'Chalk white', hex: '#f4f3ee' },
  { label: 'Charcoal', hex: '#45474b' },
]

/** Native colour picker that reports once the picker closes, not on every drag
 *  step, so a custom colour is one undo step. */
function CustomColour({ value, active, title, onPick }: { value: string; active: boolean; title: string; onPick: (hex: string) => void }) {
  const ref = React.useRef<HTMLInputElement>(null)
  const pick = React.useRef(onPick)
  pick.current = onPick
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const onChange = () => pick.current(el.value.toLowerCase())
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [])
  React.useEffect(() => {
    if (ref.current) ref.current.value = value
  }, [value])
  return (
    <label
      className={`tb-colour tb-colour-custom ${active ? 'is-active' : ''}`}
      style={active ? { background: value } : undefined}
      title={title}
    >
      <input ref={ref} type="color" defaultValue={value} />
    </label>
  )
}

function ColourRow({ active, onPick, what }: { active: string | null | undefined; onPick: (hex: string | null) => void; what: string }) {
  const custom = active && !PIECE_COLOURS.some((c) => c.hex === active) ? active : null
  return (
    <div className="tb-colour-row">
      <button
        className={`tb-colour tb-colour-original ${active === null ? 'is-active' : ''}`}
        title={`Original colour for ${what}`}
        onClick={() => onPick(null)}
      />
      {PIECE_COLOURS.map((c) => (
        <button
          key={c.hex}
          className={`tb-colour ${active === c.hex ? 'is-active' : ''}`}
          style={{ background: c.hex }}
          title={`${c.label} for ${what}`}
          onClick={() => onPick(c.hex)}
        />
      ))}
      <CustomColour
        value={custom ?? '#888888'}
        active={!!custom}
        title={`Pick any colour for ${what}`}
        onPick={onPick}
      />
    </div>
  )
}

export function LookPanel({ onClose }: { onClose: () => void }) {
  const instances = useAppStore((s) => s.instances)
  const selectedIds = useAppStore((s) => s.selectedInstanceIds)
  const modelColor = useAppStore((s) => s.modelColor)
  const brightness = useAppStore((s) => s.brightness)
  const setBrightness = useAppStore((s) => s.setBrightness)
  const colourInstances = useAppStore((s) => s.actions.colourInstances)
  const colourAllPieces = useAppStore((s) => s.actions.colourAllPieces)

  // The selection's shared colour: null = all original, undefined = mixed.
  const selected = instances.filter((i) => selectedIds.includes(i.id))
  const colours = new Set(selected.map((i) => i.color ?? null))
  const selectedColour = colours.size === 1 ? [...colours][0] : undefined
  const pieceWord = selected.length === 1 ? 'this piece' : `these ${selected.length} pieces`

  return (
    <div className="tb-terrain tb-look">
      <div className="tb-terrain-head">
        <span><Palette size={14} /> Colours &amp; light</span>
        <button className="tb-icon" title="Collapse" aria-label="Collapse" onClick={onClose}>
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="tb-look-section">
        <div className="tb-terrain-export-head">
          {selected.length ? `Selected (${selected.length})` : 'Selected piece'}
        </div>
        {selected.length
          ? <ColourRow active={selectedColour} what={pieceWord} onPick={(hex) => colourInstances(selectedIds, hex)} />
          : <p className="tb-small tb-terrain-sub">Click a piece on the table to colour it on its own.</p>}
      </div>

      <div className="tb-look-section">
        <div className="tb-terrain-export-head">All pieces</div>
        <ColourRow active={modelColor} what="every piece" onPick={colourAllPieces} />
        <p className="tb-small tb-terrain-sub">Also used for pieces you place later. Replaces any single-piece colours.</p>
      </div>

      <div className="tb-look-section">
        <div className="tb-terrain-export-head tb-look-bright">
          <span><Sun size={13} /> Brightness</span>
          <span>{Math.round(brightness * 100)}%</span>
        </div>
        <div className="tb-terrain-row">
          <input
            type="range"
            min={BRIGHTNESS_MIN}
            max={BRIGHTNESS_MAX}
            step={0.05}
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            aria-label="Table brightness"
          />
        </div>
        {brightness !== 1 && (
          <button className="tb-preset" onClick={() => setBrightness(1)}>Reset brightness</button>
        )}
      </div>
    </div>
  )
}
