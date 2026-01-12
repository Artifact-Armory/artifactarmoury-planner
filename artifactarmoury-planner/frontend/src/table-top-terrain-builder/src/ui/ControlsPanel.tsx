// src/ui/ControlsPanel.tsx
import React from 'react'
import { useAppStore } from '@state/store'

type CameraMode = 'perspective' | 'top-down' | 'isometric'

const CAMERA_OPTIONS: Array<{ mode: CameraMode; label: string; title: string }> = [
  { mode: 'perspective', label: 'Perspective', title: 'Perspective view' },
  { mode: 'top-down', label: 'Top-down', title: 'Top-down view' },
  { mode: 'isometric', label: 'Isometric', title: 'Isometric view' },
]

export function ControlsPanel() {
  const [showSaveDialog, setShowSaveDialog] = React.useState(false)
  const [showLoadDialog, setShowLoadDialog] = React.useState(false)
  const [saveName, setSaveName] = React.useState('')
  const [showHelp, setShowHelp] = React.useState(false)
  const [screenshotMode, setScreenshotMode] = React.useState(false)

  const canUndo = useAppStore((s) => s.actions.canUndo())
  const canRedo = useAppStore((s) => s.actions.canRedo())
  const undo = useAppStore((s) => s.actions.undo)
  const redo = useAppStore((s) => s.actions.redo)
  const saveLayout = useAppStore((s) => s.actions.saveLayout)
  const loadLayout = useAppStore((s) => s.actions.loadLayout)
  const getSavedLayouts = useAppStore((s) => s.actions.getSavedLayouts)
  const deleteLayout = useAppStore((s) => s.actions.deleteLayout)
  const exportLayout = useAppStore((s) => s.actions.exportLayout)
  const importLayout = useAppStore((s) => s.actions.importLayout)
  const cameraMode = useAppStore((s) => s.cameraMode)
  const setCameraMode = useAppStore((s) => s.setCameraMode)
  const fitView = useAppStore((s) => s.actions.fitView)
  const selectedInstanceId = useAppStore((s) => s.selectedInstanceId)
  const duplicateInstance = useAppStore((s) => s.actions.duplicateInstance)
  const renderer = useAppStore((s) => s.renderer)

  const savedLayouts = getSavedLayouts()

  const handleSave = () => {
    if (!saveName.trim()) return
    saveLayout(saveName)
    setSaveName('')
    setShowSaveDialog(false)
  }

  const handleExport = () => {
    const json = exportLayout()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `terrain-layout-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (e) => {
        const json = e.target?.result as string
        if (json) importLayout(json)
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const handleCameraModeChange = (mode: CameraMode) => {
    setCameraMode(mode)
    setTimeout(() => fitView(), 100)
  }

  const handleScreenshot = () => {
    if (!renderer) return
    setScreenshotMode(true)

    setTimeout(() => {
      const canvas = renderer.domElement
      canvas.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `terrain-table-${Date.now()}.png`
        anchor.click()
        URL.revokeObjectURL(url)
        setScreenshotMode(false)
      })
    }, 100)
  }

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey) {
        event.preventDefault()
        redo()
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
        event.preventDefault()
        redo()
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'd' && selectedInstanceId) {
        event.preventDefault()
        duplicateInstance(selectedInstanceId)
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault()
        setShowSaveDialog(true)
      }
      if (event.key === '?' && !event.ctrlKey && !event.metaKey) {
        setShowHelp((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, selectedInstanceId, duplicateInstance])

  if (screenshotMode) {
    return null
  }

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 70,
          right: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: 'rgba(18, 24, 33, 0.95)',
          padding: 12,
          borderRadius: 8,
          border: '1px solid #243246',
          width: 160,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="tb-btn"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            style={{ flex: 1 }}
          >
            Undo
          </button>
          <button
            className="tb-btn"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
            style={{ flex: 1 }}
          >
            Redo
          </button>
        </div>

        <hr style={{ margin: '4px 0', borderColor: '#243246' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {CAMERA_OPTIONS.map(({ mode, label, title }) => (
            <button
              key={mode}
              className="tb-btn"
              onClick={() => handleCameraModeChange(mode)}
              style={{
                padding: '6px 10px',
                background: cameraMode === mode ? '#4da3ff' : '#1a2330',
                color: cameraMode === mode ? '#0b0f14' : undefined,
              }}
              title={title}
            >
              {label}
            </button>
          ))}
        </div>

        <hr style={{ margin: '4px 0', borderColor: '#243246' }} />

        <button
          className="tb-btn"
          onClick={() => setShowSaveDialog(true)}
          title="Save layout (Ctrl+S)"
        >
          Save Layout
        </button>
        <button
          className="tb-btn"
          onClick={() => setShowLoadDialog(true)}
          title="Load a saved layout"
        >
          Load Layout
        </button>
        <button
          className="tb-btn"
          onClick={handleScreenshot}
          title="Download a screenshot of the table"
        >
          Screenshot
        </button>
        <button
          className="tb-btn"
          onClick={() => setShowHelp(true)}
          title="Show keyboard shortcuts"
        >
          Shortcuts
        </button>
      </div>

      {showSaveDialog && (
        <DialogBackdrop onClose={() => setShowSaveDialog(false)}>
          <div
            style={{
              background: '#121821',
              padding: 24,
              borderRadius: 8,
              border: '1px solid #243246',
              minWidth: 360,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Save Layout</h3>
            <input
              className="tb-input"
              placeholder="Enter layout name..."
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSave()
              }}
              autoFocus
              style={{ marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="tb-btn" onClick={() => setShowSaveDialog(false)}>
                Cancel
              </button>
              <button
                className="tb-btn"
                onClick={handleSave}
                disabled={!saveName.trim()}
                style={{ background: '#4da3ff', color: '#0b0f14' }}
              >
                Save
              </button>
            </div>

            <hr style={{ margin: '16px 0', borderColor: '#243246' }} />

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="tb-btn" onClick={handleExport} style={{ flex: 1 }}>
                Export JSON
              </button>
              <button className="tb-btn" onClick={handleImport} style={{ flex: 1 }}>
                Import JSON
              </button>
            </div>
          </div>
        </DialogBackdrop>
      )}

      {showLoadDialog && (
        <DialogBackdrop onClose={() => setShowLoadDialog(false)}>
          <div
            style={{
              background: '#121821',
              padding: 24,
              borderRadius: 8,
              border: '1px solid #243246',
              minWidth: 360,
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Load Layout</h3>
            {savedLayouts.length === 0 ? (
              <div className="tb-small" style={{ color: '#9fb2c8', marginBottom: 16 }}>
                No saved layouts yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {savedLayouts.map((layout) => (
                  <div
                    key={layout.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: 8,
                      background: '#0e141c',
                      borderRadius: 6,
                      border: '1px solid #243246',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{layout.name}</div>
                      <div className="tb-small" style={{ color: '#9fb2c8' }}>
                        {new Date(layout.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="tb-btn"
                        onClick={() => {
                          loadLayout(layout.id)
                          setShowLoadDialog(false)
                        }}
                      >
                        Load
                      </button>
                      <button
                        className="tb-btn"
                        onClick={() => deleteLayout(layout.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button className="tb-btn" onClick={() => setShowLoadDialog(false)} style={{ width: '100%' }}>
              Close
            </button>
          </div>
        </DialogBackdrop>
      )}

      {showHelp && (
        <DialogBackdrop onClose={() => setShowHelp(false)}>
          <div
            style={{
              background: '#121821',
              padding: 24,
              borderRadius: 8,
              border: '1px solid #243246',
              minWidth: 360,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Keyboard Shortcuts</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                ['Undo', 'Ctrl + Z'],
                ['Redo', 'Ctrl + Shift + Z'],
                ['Duplicate selected', 'Ctrl + D'],
                ['Delete selected', 'Delete'],
                ['Save layout', 'Ctrl + S'],
                ['Transform mode', 'T / R'],
                ['Free rotation (no snap)', 'Hold Shift'],
                ['Rotate ghost placement', 'R'],
                ['Cancel placement', 'Esc'],
                ['Toggle help', '?'],
              ].map(([label, shortcut]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="tb-small">{label}</span>
                  <span className="tb-kbd">{shortcut}</span>
                </div>
              ))}
            </div>
            <button
              className="tb-btn"
              onClick={() => setShowHelp(false)}
              style={{ width: '100%', marginTop: 16 }}
            >
              Close
            </button>
          </div>
        </DialogBackdrop>
      )}
    </>
  )
}

interface DialogBackdropProps {
  onClose: () => void
  children: React.ReactNode
}

function DialogBackdrop({ onClose, children }: DialogBackdropProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      {children}
    </div>
  )
}
