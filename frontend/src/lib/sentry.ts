import * as Sentry from '@sentry/react'

/**
 * Frontend error tracking.
 *
 * Without this, a crash in the browser is invisible: the user sees the
 * ErrorBoundary's "Something went wrong", closes the tab, and nobody ever finds
 * out. That matters most on the pages where a bug costs money — checkout, the
 * upload form, the planner.
 *
 * Optional by design: with VITE_SENTRY_DSN unset every export here is a no-op,
 * so local dev and forks behave exactly as before.
 *
 * PRIVACY. Session Replay is deliberately NOT enabled — it records the DOM,
 * which on this site includes billing addresses at checkout. `sendDefaultPii`
 * is off, and the user context carries an id and role only, never an email.
 */

let enabled = false

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    // Tracing is billed per transaction and this exists to catch crashes.
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE ?? 0),

    // Noise that is never actionable: browser extensions injecting scripts, and
    // the benign ResizeObserver warning Chrome emits on legitimate layouts (the
    // planner triggers it constantly on resize).
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
    ],
    denyUrls: [/extensions\//i, /^chrome:\/\//i, /^moz-extension:\/\//i],
  })

  enabled = true
}

export function isSentryEnabled(): boolean {
  return enabled
}

/** Id + role only — enough to group reports, without shipping an email. */
export function setSentryUser(userId?: string | null, role?: string | null): void {
  if (!enabled) return
  if (!userId) {
    Sentry.setUser(null)
    return
  }
  Sentry.setUser({ id: userId, ...(role ? { role } : {}) })
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context)
    Sentry.captureException(error)
  })
}

export { Sentry }
