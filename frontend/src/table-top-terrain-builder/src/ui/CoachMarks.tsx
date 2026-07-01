// src/ui/CoachMarks.tsx — three one-time hints for first-time players.
import React from 'react'
import { MousePointerClick, Search as ZoomIcon, Rotate3d, X } from 'lucide-react'

const KEY = 'tb_coach_v1'

export function CoachMarks() {
  const [show, setShow] = React.useState(false)

  React.useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true)
    } catch {
      setShow(true)
    }
  }, [])

  if (!show) return null

  const dismiss = () => {
    try { localStorage.setItem(KEY, '1') } catch { /* ignore */ }
    setShow(false)
  }

  return (
    <div className="tb-coach">
      <div className="tb-coach-item"><MousePointerClick size={16} /> Drag terrain onto the table to place it</div>
      <div className="tb-coach-item"><ZoomIcon size={16} /> Scroll to zoom toward your cursor</div>
      <div className="tb-coach-item"><Rotate3d size={16} /> Right-drag to look around</div>
      <button className="tb-coach-x" onClick={dismiss}><X size={14} /> Got it</button>
    </div>
  )
}
