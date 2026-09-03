import React from 'react'

// planner-lab only — never part of the live site. Lets you flip between
// colour-palette candidates live, without a rebuild, while the layout stays
// exactly as-is. Sets data-tb-theme on <html>; the palettes themselves live
// in table-top-terrain-builder/src/ui/styles.css (search "Theme variants").
const THEMES: Array<{ id: string; label: string; swatch: string }> = [
  { id: 'current', label: 'Current (steel blue)', swatch: '#4da3ff' },
  { id: 'forge-bronze', label: 'Forge Bronze', swatch: '#e0963c' },
  { id: 'field-ops', label: 'Field Ops', swatch: '#8db254' },
  { id: 'slate-violet', label: 'Slate Violet', swatch: '#a77cff' },
  { id: 'graphite-mono', label: 'Graphite Mono', swatch: '#ff9e35' },
]

const STORAGE_KEY = 'planner-lab-theme'

function applyTheme(id: string) {
  if (id === 'current') {
    document.documentElement.removeAttribute('data-tb-theme')
  } else {
    document.documentElement.setAttribute('data-tb-theme', id)
  }
}

export default function ThemeSwitcher() {
  const [active, setActive] = React.useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'current'
    } catch {
      return 'current'
    }
  })
  const [open, setOpen] = React.useState(true)

  React.useEffect(() => {
    applyTheme(active)
    try {
      localStorage.setItem(STORAGE_KEY, active)
    } catch {
      /* ignore */
    }
  }, [active])

  return (
    <div
      style={{
        position: 'fixed',
        top: 14,
        right: 14,
        zIndex: 999999,
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial',
        fontSize: 13,
        background: 'rgba(15, 17, 20, 0.94)',
        color: '#e6eef7',
        border: '1px solid #2a2f38',
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          font: 'inherit',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <span>🎨 Theme lab</span>
        <span style={{ opacity: 0.6 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: '4px 6px 8px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 190 }}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 7,
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit',
                color: 'inherit',
                background: active === t.id ? 'rgba(255,255,255,0.12)' : 'transparent',
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  background: t.swatch,
                  border: '1px solid rgba(255,255,255,0.25)',
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{t.label}</span>
              {active === t.id && <span style={{ opacity: 0.7 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
