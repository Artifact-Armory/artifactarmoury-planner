import React, { useEffect } from 'react'
import { Copy, RotateCcw, RotateCw, Trash2 } from 'lucide-react'

import { useBuilderUIStore } from '@state/uiStore'
import { useAppStore } from '@state/store'

const ROTATION_OPTIONS = [15, 25, 90, 180]

export function ContextMenuOverlay() {
  const contextMenu = useBuilderUIStore((s) => s.contextMenu)
  const closeContextMenu = useBuilderUIStore((s) => s.closeContextMenu)

  const rotateInstances = useAppStore((s) => s.actions.rotateInstances)
  const duplicateInstances = useAppStore((s) => s.actions.duplicateInstances)
  const removeInstances = useAppStore((s) => s.actions.removeInstances)

  useEffect(() => {
    if (!contextMenu.open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [contextMenu.open, closeContextMenu])

  if (!contextMenu.open) return null

  const { x, y, targetIds } = contextMenu
  const hasSelection = targetIds.length > 0

  const handleRotate = (degrees: number) => {
    if (!hasSelection) return
    rotateInstances(targetIds, degrees)
    closeContextMenu()
  }

  const handleDuplicate = () => {
    if (!hasSelection) return
    duplicateInstances(targetIds)
    closeContextMenu()
  }

  const handleRemove = () => {
    if (!hasSelection) return
    removeInstances(targetIds)
    closeContextMenu()
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-40" onClick={closeContextMenu}>
      <div
        className="pointer-events-auto min-w-[240px] origin-top-left rounded-xl border border-white/10 bg-slate-900/95 p-3 text-sm text-white shadow-xl shadow-black/40 backdrop-blur-lg transition-transform duration-150 ease-out"
        style={{ top: y, left: x, position: 'absolute', transform: 'scale(1)', animation: 'contextMenuIn 120ms ease-out' }}
      >
        <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">
          {hasSelection ? `${targetIds.length} selected` : 'No selection'}
        </p>
        <div className="space-y-2">
          <ContextMenuButton
            icon={RotateCcw}
            label="Rotate"
            description="R"
            disabled={!hasSelection}
          >
            <div className="flex flex-wrap gap-2">
              {ROTATION_OPTIONS.map((deg) => (
                <button
                  key={deg}
                  type="button"
                  onClick={() => handleRotate(deg)}
                  className="rounded-md bg-sky-500/20 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-100 transition-colors duration-200 hover:bg-sky-500/30"
                >
                  +{deg}°
                </button>
              ))}
            </div>
          </ContextMenuButton>

          <Divider />

          <ContextMenuAction
            icon={RotateCw}
            label="Duplicate"
            shortcut="Ctrl + D"
            disabled={!hasSelection}
            onClick={handleDuplicate}
          />

          <ContextMenuAction
            icon={Copy}
            label="Copy to basket"
            shortcut="Cmd + C"
            disabled
          />

          <Divider />

          <ContextMenuAction
            icon={Trash2}
            label="Remove"
            shortcut="Del"
            disabled={!hasSelection}
            tone="danger"
            onClick={handleRemove}
          />
        </div>
      </div>
    </div>
  )
}

interface ContextMenuButtonProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  description?: string
  disabled?: boolean
  children?: React.ReactNode
}

function ContextMenuButton({ icon: Icon, label, description, disabled, children }: ContextMenuButtonProps) {
  return (
    <div
      className={[
        'rounded-lg border border-white/10 bg-slate-800/70 px-3 py-2 shadow-md transition-all duration-200',
        disabled ? 'opacity-40' : 'hover:border-sky-500/50 hover:shadow-lg',
      ].join(' ')}
    >
      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-300">
        <span className="inline-flex items-center gap-2">
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
        </span>
        {description && <span className="text-[11px] text-slate-500">{description}</span>}
      </div>
      <div className="space-y-2 text-xs text-slate-300">{children}</div>
    </div>
  )
}

interface ContextMenuActionProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  tone?: 'default' | 'danger'
  disabled?: boolean
  onClick?: () => void
}

function ContextMenuAction({ icon: Icon, label, shortcut, tone = 'default', disabled, onClick }: ContextMenuActionProps) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      className={[
        'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-sky-500',
        tone === 'danger' ? 'text-red-300 hover:bg-red-500/15' : 'text-slate-200 hover:bg-slate-800/70',
        disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : '',
      ].join(' ')}
    >
      <span className="inline-flex items-center gap-2">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </span>
      {shortcut && <span className="text-xs text-slate-500">{shortcut}</span>}
    </button>
  )
}

function Divider() {
  return <div className="h-px w-full bg-white/10" aria-hidden="true" />
}

// Keyframe for subtle scale-in
if (typeof document !== 'undefined' && !document.getElementById('context-menu-keyframes')) {
  const style = document.createElement('style')
  style.id = 'context-menu-keyframes'
  style.innerHTML = `@keyframes contextMenuIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }`
  document.head.appendChild(style)
}
