import React from 'react'
import { useLocation } from 'react-router-dom'
import { HelpCircle, X, Compass } from 'lucide-react'
import { getHelpForPath } from './helpContent'
import { useOnboardingStore } from '../../store/onboardingStore'

/**
 * A help affordance for the dashboard header. Shows a slide-over panel with
 * help tailored to the current route, and (on artist pages) a button to replay
 * the guided walkthrough.
 */
const HelpButton: React.FC = () => {
  const [open, setOpen] = React.useState(false)
  const location = useLocation()
  const startTour = useOnboardingStore((s) => s.startTour)

  const entry = getHelpForPath(location.pathname)

  // Close on Escape.
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        data-tour="help-button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        aria-label="Help for this page"
      >
        <HelpCircle size={20} />
        <span className="hidden sm:inline">Help</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Help">
          <div className="absolute inset-0 bg-gray-900/40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <HelpCircle size={20} className="text-indigo-600" />
                <h2 className="text-lg font-semibold text-gray-900">{entry.title}</h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close help"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {entry.intro && <p className="mb-5 text-sm leading-relaxed text-gray-600">{entry.intro}</p>}
              <div className="space-y-5">
                {entry.sections.map((s, idx) => (
                  <div key={idx}>
                    <h3 className="text-sm font-semibold text-gray-900">{s.heading}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">{s.body}</p>
                  </div>
                ))}
              </div>

              {entry.showTour && (
                <button
                  onClick={() => {
                    setOpen(false)
                    startTour()
                  }}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  <Compass size={16} />
                  Replay the walkthrough
                </button>
              )}
            </div>

            <div className="border-t border-gray-200 px-5 py-3 text-xs text-gray-400">
              Need more help? Reach out from the Contact page and we’ll get back to you.
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default HelpButton
