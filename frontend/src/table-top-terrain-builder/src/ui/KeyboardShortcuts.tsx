import React, { useEffect } from 'react'
import { CircleHelp, X } from 'lucide-react'

import { useBuilderUIStore } from '@state/uiStore'

const SHORTCUTS: Array<{ action: string; shortcut: string }> = [
  { action: 'Remove selected', shortcut: 'Delete' },
  { action: 'Rotate +15°', shortcut: 'R then 15' },
  { action: 'Rotate +25°', shortcut: 'R then 25' },
  { action: 'Rotate +90°', shortcut: 'R or Q/E' },
  { action: 'Rotate +180°', shortcut: 'R then 180' },
  { action: 'Duplicate selection', shortcut: 'Ctrl / ⌘ + D' },
  { action: 'Toggle grid', shortcut: 'G' },
  { action: 'Undo / Redo', shortcut: 'Ctrl / ⌘ + Z / Shift + Z' },
]

export function KeyboardShortcuts() {
  const open = useBuilderUIStore((s) => s.keyboardShortcutsOpen)
  const setOpen = useBuilderUIStore((s) => s.setKeyboardShortcutsOpen)

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, setOpen])

  return (
    <div className="pointer-events-auto absolute right-6 bottom-8 z-30">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/80 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-black/40 backdrop-blur-md hover:bg-slate-900/90"
      >
        <CircleHelp className="h-4 w-4 text-sky-300" />
        Shortcuts
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-950/95 p-6 text-white shadow-2xl shadow-black/60">
            <header className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Keyboard Shortcuts</h3>
                <p className="text-xs text-white/60">Work faster with these power tools.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <dl className="space-y-3">
              {SHORTCUTS.map((item) => (
                <div key={item.action} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-2 text-sm">
                  <dt className="text-white/80">{item.action}</dt>
                  <dd className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/70">
                    {item.shortcut}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}
