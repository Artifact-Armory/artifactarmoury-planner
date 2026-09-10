// backend/src/services/sentry.ts
//
// Error tracking. Until now a 500 in production existed only as a line in the
// Railway log, which nobody reads unless they already know something is wrong —
// so a crash affecting real users was invisible unless one of them complained.
//
// Entirely optional: with SENTRY_DSN unset every function here is a no-op, so
// local dev and anyone running this without a Sentry account behave exactly as
// before. Nothing in the request path depends on Sentry being reachable.
//
// PRIVACY. This is a marketplace holding real names, addresses and payment
// references, so the default of "send everything and filter later" is wrong.
// `sendDefaultPii` stays off, request bodies are never attached, and
// `beforeSend` strips the headers and query params that carry credentials. The
// user context is deliberately limited to an id and role — enough to tell "one
// user hit this 40 times" from "40 users hit this once", which is the actual
// diagnostic need, without shipping their email to a third party.

import * as Sentry from '@sentry/node'
import logger from '../utils/logger'

const log = logger.child('SENTRY')

let enabled = false

/** Header names that must never leave the building. */
const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'stripe-signature',
]

/** Query/body keys whose values are secrets rather than diagnostics. */
const SENSITIVE_KEYS = [
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'code',
  'invitecode',
  'apikey',
  'authorization',
]

function scrubObject(obj: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!obj) return obj
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEYS.includes(k.toLowerCase().replace(/[_-]/g, '')) ? '[redacted]' : v
  }
  return out
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) {
    log.info('Sentry not configured (SENTRY_DSN unset) — error tracking disabled')
    return
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,

    // Performance tracing off by default: it is billed per transaction and this
    // is here to catch crashes, not to profile. Opt in with SENTRY_TRACES_RATE.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE ?? 0),

    // Never let the SDK harvest PII on its own — see the privacy note above.
    //
    // VERIFIED against the installed SDK (v10) rather than assumed, because the
    // resolution is counter-intuitive: `resolveDataCollectionOptions` picks its
    // base from `sendDefaultPii` ONLY when `dataCollection` is absent. Setting
    // `dataCollection` AT ALL — even `{}`, even one field — switches the base to
    // the permissive DEFAULTS, where cookies, all four HTTP body types, query
    // params and DB query values are collected. So leaving `dataCollection`
    // unset is what actually gives us `httpBodies: []`, `userInfo: false` and
    // PII deny-lists on cookies/headers/query params. Do NOT add a partial
    // `dataCollection` block here — it would silently turn all of that ON.
    sendDefaultPii: false,

    // Drop LocalVariables. It is in Node's DEFAULT integration list, and
    // `stackFrameVariables` is true even under `sendDefaultPii: false`, so a
    // 500 thrown inside a login/register handler would ship that frame's local
    // variables — including the plaintext `password` and `inviteCode` — straight
    // to Sentry. Removed by filtering the defaults rather than via
    // `dataCollection.stackFrameVariables`, since setting `dataCollection` would
    // flip everything above into its permissive mode (see the note on it).
    integrations: (defaults) => defaults.filter((i) => i.name !== 'LocalVariables'),

    beforeSend(event) {
      if (event.request) {
        // Bodies can contain passwords, addresses and whole STL payloads.
        delete event.request.data
        if (event.request.headers) {
          for (const h of Object.keys(event.request.headers)) {
            if (SENSITIVE_HEADERS.includes(h.toLowerCase())) {
              event.request.headers[h] = '[redacted]'
            }
          }
        }
        event.request.query_string = scrubObject(
          event.request.query_string as Record<string, any> | undefined,
        ) as any
      }
      return event
    },
  })

  enabled = true
  log.info('Sentry initialised', {
    environment: process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE ?? 0),
  })
}

export function isSentryEnabled(): boolean {
  return enabled
}

/**
 * Report an exception. `context` lands in Sentry's "extra" — keep it to ids and
 * counts; anything user-identifying belongs in `user` below, not here.
 */
export function captureException(error: unknown, context?: Record<string, any>): void {
  if (!enabled) return
  try {
    Sentry.withScope((scope) => {
      if (context) scope.setExtras(scrubObject(context) ?? {})
      Sentry.captureException(error)
    })
  } catch (err) {
    log.warn('Failed to report error to Sentry', { err })
  }
}

/** Non-exception signal worth alerting on (a failed payout, a stuck queue). */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'error',
  context?: Record<string, any>,
): void {
  if (!enabled) return
  try {
    Sentry.withScope((scope) => {
      scope.setLevel(level)
      if (context) scope.setExtras(scrubObject(context) ?? {})
      Sentry.captureMessage(message)
    })
  } catch (err) {
    log.warn('Failed to report message to Sentry', { err })
  }
}

/**
 * Attach the acting user to the current scope. Id + role only, never the email —
 * enough to group "one user, forty times" vs "forty users, once each".
 */
export function setSentryUser(userId?: string | null, role?: string | null): void {
  if (!enabled) return
  try {
    if (!userId) {
      Sentry.setUser(null)
      return
    }
    Sentry.setUser({ id: userId, ...(role ? { role } : {}) })
  } catch {
    /* never let telemetry break a request */
  }
}

/** Flush pending events before the process exits, so a crash still reports. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled) return
  try {
    await Sentry.flush(timeoutMs)
  } catch {
    /* shutting down anyway */
  }
}

export { Sentry }
