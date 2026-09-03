// A dependency-free spotlight walkthrough. It highlights the element carrying
// the current step's `data-tour` attribute, dims the rest, and shows a tooltip
// card with Back / Next / Skip. Rendered once (e.g. in DashboardLayout).
import React from 'react'
import { X } from 'lucide-react'
import { useOnboardingStore } from '../../store/onboardingStore'
import type { TourStep } from './tourSteps'

const CARD_W = 320
const PAD = 6

interface Props {
  steps: TourStep[]
  /** Called when the tour ends (finished or skipped). */
  onClose?: () => void
}

const OnboardingTour: React.FC<Props> = ({ steps, onClose }) => {
  const { tourActive, stopTour } = useOnboardingStore()
  const [i, setI] = React.useState(0)
  const [rect, setRect] = React.useState<DOMRect | null>(null)

  const step = steps[i]

  // Reset to the first step each time the tour opens.
  React.useEffect(() => {
    if (tourActive) setI(0)
  }, [tourActive])

  // Bring the current target into view when the step changes.
  React.useEffect(() => {
    if (!tourActive || !step?.target) return
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [tourActive, i, step?.target])

  // Track the target's position (a poll keeps up with smooth-scroll/layout
  // shifts without risking a scroll→measure→scroll feedback loop).
  React.useEffect(() => {
    if (!tourActive) {
      setRect(null)
      return
    }
    const measure = () => {
      const el = step?.target
        ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
        : null
      const r = el?.getBoundingClientRect() ?? null
      // Off-screen (e.g. the collapsed mobile sidebar) → fall back to a centred
      // card instead of spotlighting something the user can't see.
      const onScreen =
        r && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 &&
        r.left < window.innerWidth && r.top < window.innerHeight
      setRect(onScreen ? r : null)
    }
    measure()
    const id = window.setInterval(measure, 150)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('resize', measure)
    }
  }, [tourActive, i, step?.target])

  const finish = React.useCallback(() => {
    stopTour()
    onClose?.()
  }, [stopTour, onClose])

  // Keyboard: Esc to skip, arrows to navigate.
  React.useEffect(() => {
    if (!tourActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight') setI((v) => Math.min(steps.length - 1, v + 1))
      else if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tourActive, steps.length, finish])

  if (!tourActive || !step) return null

  const isLast = i === steps.length - 1
  const highlight = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null

  // Position the card: below the target if there's room, otherwise above;
  // centred when the step has no anchor.
  let cardStyle: React.CSSProperties
  if (highlight) {
    const spaceBelow = window.innerHeight - (highlight.top + highlight.height)
    const top = spaceBelow > 220 ? highlight.top + highlight.height + 12 : Math.max(12, highlight.top - 200)
    let left = Math.min(highlight.left, window.innerWidth - CARD_W - 12)
    left = Math.max(12, left)
    cardStyle = { position: 'fixed', top, left, width: CARD_W }
  } else {
    cardStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: CARD_W }
  }

  return (
    <div className="fixed inset-0 z-100" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* Click catcher — blocks interaction with the page beneath the tour. */}
      <div className="absolute inset-0" style={{ pointerEvents: 'auto' }} />

      {/* Spotlight (box-shadow dims everything but the hole) or a full backdrop. */}
      {highlight ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary/50 transition-all duration-200"
          style={{
            top: highlight.top,
            left: highlight.left,
            width: highlight.width,
            height: highlight.height,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.6)',
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-slate-900/60" />
      )}

      {/* Tooltip card */}
      <div
        style={cardStyle}
        className="pointer-events-auto rounded-xl border border-border bg-card p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
          <button
            onClick={finish}
            className="-mr-1 -mt-1 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Skip tour"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden>
            {steps.map((_, idx) => (
              <span
                key={idx}
                className={`h-1.5 rounded-full transition-all ${
                  idx === i ? 'w-4 bg-primary' : 'w-1.5 bg-border'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <button
                onClick={() => setI((v) => Math.max(0, v - 1))}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (isLast ? finish() : setI((v) => Math.min(steps.length - 1, v + 1)))}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>

        {!isLast && (
          <button
            onClick={finish}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Skip tour
          </button>
        )}
      </div>
    </div>
  )
}

export default OnboardingTour
