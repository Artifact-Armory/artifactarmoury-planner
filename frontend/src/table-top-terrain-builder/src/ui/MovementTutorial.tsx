// src/ui/MovementTutorial.tsx — hands-on camera tutorial for someone whose first
// sight of the planner is a showcase (read-only) table. The editor's walkthrough
// never runs there, so without this a newcomer lands on a 3D scene with no idea
// that right-drag orbits or the wheel zooms.
//
// Each step completes when the viewer actually does the thing — detected from
// the camera's pose rather than from raw input events, so mouse, keyboard and
// touch gestures all count without separate wiring. The card is non-modal: the
// whole point is that they use the canvas behind it.
import React from 'react'
import { Check, Move, Rotate3d, Search as ZoomIcon, MousePointerClick, X } from 'lucide-react'
import { useAppStore } from '../state/store'
import type { CameraPose } from '../scene/BuilderCamera'

const SEEN_KEY = 'tb_movement_tutorial_v1'
/** Set by every first-visit path in the editable planner (see App.tsx). */
const PLANNER_USED_KEY = 'tb_help_seen_v1'

/**
 * First time anywhere in the planner? Someone who has already been through the
 * editor's onboarding knows the camera, so a showcase shouldn't re-teach it.
 */
export function shouldShowMovementTutorial(): boolean {
  try {
    return !localStorage.getItem(SEEN_KEY) && !localStorage.getItem(PLANNER_USED_KEY)
  } catch {
    return false // storage blocked — don't nag on every visit
  }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1') } catch { /* ignore */ }
}

type Kind = 'orbit' | 'zoom' | 'pan'

interface MoveStep {
  kind: Kind
  icon: React.ReactNode
  title: string
  mouse: string
  touch: string
}

const STEPS: MoveStep[] = [
  {
    kind: 'orbit',
    icon: <Rotate3d size={18} />,
    title: 'Look around',
    mouse: 'Hold the right mouse button and drag to orbit around the table.',
    touch: 'Put two fingers on the table and twist them, or drag them up and down to tilt.',
  },
  {
    kind: 'zoom',
    icon: <ZoomIcon size={18} />,
    title: 'Zoom in and out',
    mouse: 'Scroll the mouse wheel. It zooms toward whatever is under your cursor.',
    touch: 'Pinch two fingers together or apart.',
  },
  {
    kind: 'pan',
    icon: <Move size={18} />,
    title: 'Slide across the table',
    mouse: 'Hold the middle mouse button (the wheel) and drag, or use W A S D / the arrow keys.',
    touch: 'Drag one finger across the table.',
  },
]

// How much of each movement counts as "done". Big enough that it can't happen
// by accident, small enough that one deliberate gesture finishes it.
const ORBIT_GOAL = 35 * (Math.PI / 180) // radians of combined azimuth + tilt
const ZOOM_GOAL = 0.35 // |ln(distance ratio)| ≈ a 30-40% change
const PAN_GOAL = 0.3 // target travel, as a fraction of the viewing distance

const POLL_MS = 80
const CELEBRATE_MS = 700

/** Progress (in that step's own units) made between two poses. */
function stepDelta(kind: Kind, prev: CameraPose, next: CameraPose): number {
  const zoomLog = Math.abs(Math.log(next.distance / prev.distance))
  switch (kind) {
    case 'orbit':
      return Math.abs(next.azimuth - prev.azimuth) + Math.abs(next.polar - prev.polar)
    case 'zoom':
      return zoomLog
    case 'pan': {
      // Zooming toward the cursor also shifts the target, so only count travel
      // made while the distance held steady.
      if (zoomLog > 0.005) return 0
      const dx = next.target.x - prev.target.x
      const dy = next.target.y - prev.target.y
      const dz = next.target.z - prev.target.z
      return Math.hypot(dx, dy, dz) / Math.max(next.distance, 1e-3)
    }
  }
}

const GOAL: Record<Kind, number> = { orbit: ORBIT_GOAL, zoom: ZOOM_GOAL, pan: PAN_GOAL }

export function MovementTutorial({ touch, onClose }: { touch: boolean; onClose: () => void }) {
  // STEPS.length = the closing "you're set" card.
  const [i, setI] = React.useState(0)
  const [progress, setProgress] = React.useState(0)
  const [celebrating, setCelebrating] = React.useState(false)
  const step = STEPS[i] as MoveStep | undefined

  const close = React.useCallback(() => {
    markSeen()
    onClose()
  }, [onClose])

  const advance = React.useCallback(() => {
    setCelebrating(false)
    setProgress(0)
    setI((v) => v + 1)
  }, [])

  // Watch the camera for the current step's movement.
  React.useEffect(() => {
    if (!step || celebrating) return
    let prev: CameraPose | null = null
    let acc = 0
    const id = window.setInterval(() => {
      const pose = useAppStore.getState().cameraApi?.getPose()
      if (!pose) return
      if (prev) acc += stepDelta(step.kind, prev, pose)
      prev = pose
      const frac = Math.min(1, acc / GOAL[step.kind])
      setProgress(frac)
      if (frac >= 1) {
        window.clearInterval(id)
        setCelebrating(true)
      }
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [step, celebrating])

  // Brief tick before moving on, so the viewer sees that it worked.
  React.useEffect(() => {
    if (!celebrating) return
    const t = window.setTimeout(advance, CELEBRATE_MS)
    return () => window.clearTimeout(t)
  }, [celebrating, advance])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const total = STEPS.length

  return (
    <div className="tb-movetut" role="dialog" aria-label="Moving around the table">
      <div className="tb-movetut-head">
        <span className="tb-movetut-kicker">
          {step ? `Moving around · ${i + 1} of ${total}` : 'You’re set'}
        </span>
        <button className="tb-movetut-x" onClick={close} aria-label="Close tutorial" title="Close (Esc)">
          <X size={16} />
        </button>
      </div>

      {step ? (
        <>
          <div className="tb-movetut-title">
            <span className={`tb-movetut-icon${celebrating ? ' is-done' : ''}`}>
              {celebrating ? <Check size={18} /> : step.icon}
            </span>
            {celebrating ? 'Nice!' : step.title}
          </div>
          <p className="tb-movetut-body">{touch ? step.touch : step.mouse}</p>
          <div className="tb-movetut-bar" aria-hidden>
            <div className="tb-movetut-fill" style={{ transform: `scaleX(${progress})` }} />
          </div>
          <div className="tb-movetut-foot">
            <div className="tb-movetut-dots" aria-hidden>
              {STEPS.map((_, idx) => (
                <span key={idx} className={idx < i ? 'is-done' : idx === i ? 'is-on' : ''} />
              ))}
            </div>
            <div className="tb-movetut-actions">
              <button className="tb-movetut-link" onClick={close}>Skip tutorial</button>
              <button className="tb-movetut-link" onClick={advance} disabled={celebrating}>Skip step</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="tb-movetut-title">
            <span className="tb-movetut-icon"><MousePointerClick size={18} /></span>
            Explore the pieces
          </div>
          <p className="tb-movetut-body">
            {touch ? 'Tap' : 'Click'} any model on the table to see what it is and add it to your basket.
            {touch
              ? ' The Fit and Home buttons up top bring the whole table back into view.'
              : ' Press F to fit the table in view, or Home to reset the camera.'}
            {' '}Want to change the layout? Use “Edit a copy”. The Help button lists every control.
          </p>
          <div className="tb-movetut-foot">
            <span />
            <button className="tb-movetut-done" onClick={close}>Got it</button>
          </div>
        </>
      )}
    </div>
  )
}
