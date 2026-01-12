import React, { useEffect } from 'react'
import { Copy, RotateCcw, Trash2 } from 'lucide-react'

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
        className="pointer-events-auto min-w-[220px] rounded-2xl border border-white/10 bg-slate-950/95 p-3 text-sm text-white shadow-xl shadow-black/40 backdrop-blur-lg"
        style={{ top: y, left: x, position: 'absolute' }}
      >
        <p className="mb-2 text-xs uppercase tracking-wide text-white/40">
          {hasSelection ? `${targetIds.length} item${targetIds.length > 1 ? 's' : ''}` : 'No selection'}
        </p>
        <div className="grid gap-1">
          <ContextMenuButton disabled={!hasSelection} icon={RotateCcw} label="Rotate">
            <div className="flex flex-wrap gap-2">
              {ROTATION_OPTIONS.map((deg) => (
                <button
                  key={deg}
                  type="button"
                  onClick={() => handleRotate(deg)}
                  className="rounded-full bg-sky-500/20 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-100 hover:bg-sky-500/30"
                >
                  +{deg}°
                </button>
              ))}
            </div>
          </ContextMenuButton>

          <ContextMenuButton
            disabled={!hasSelection}
            icon={Copy}
            label="Duplicate"
            onClick={handleDuplicate}
          />

          <ContextMenuButton
            disabled={!hasSelection}
            icon={Trash2}
            label="Remove"
            onClick={handleRemove}
            tone="danger"
          />
        </div>
      </div>
    </div>
  )
}

interface ContextMenuButtonProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  disabled?: boolean
  onClick?: () => void
  tone?: 'default' | 'danger'
  children?: React.ReactNode
}

function ContextMenuButton({ icon: Icon, label, disabled, onClick, tone = 'default', children }: ContextMenuButtonProps) {
  const content = (
    <div
      className={cn(
        'flex items-center justify-between rounded-xl px-3 py-2',
        disabled
          ? 'cursor-not-allowed opacity-40'
          : tone === 'danger'
          ? 'bg-red-500/15 text-red-100 hover:bg-red-500/25'
          : 'bg-white/5 text-white hover:bg-white/10',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      {children && <div>{children}</div>}
    </div>
  )

  if (children) {
    return <div>{content}</div>
  }

  return (
    <button type="button" onClick={disabled ? undefined : onClick} className="w-full text-left" disabled={disabled}>
      {content}
    </button>
  )
}

const cn = (...classes: Array<string | undefined | false | null>) =>
  classes.filter(Boolean).join(' ')
