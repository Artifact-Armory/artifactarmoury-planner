// backend/src/services/fullGlb/inline.ts
//
// Fallback drainer that runs inside the API server.
//
// Owner GLBs are normally built by the proxy bake worker (a separate service), so
// none of that CPU touches the web dyno. But the bake worker is optional — with
// PROXY_BAKE_ENABLED unset the previews fall back to the in-process pure-Node
// path, and with no drainer here the owner-GLB queue would just fill up forever
// and the feature would look broken rather than disabled.
//
// So: default ON only when the bake worker is OFF, and force-able either way with
// FULL_GLB_INLINE. It builds strictly one job at a time on a slow poll, and it is
// only ever reached after an upload has already been marked 'ready' — so the
// artist never waits on it.

import logger from '../../utils/logger'
import { isBakeWorkerEnabled } from '../proxyBake/queue'
import { isFullGlbEnabled } from './queue'
import { runOneFullGlbJob } from './runner'

const log = logger.child('FULL_GLB')

const POLL_INTERVAL_MS = Number(process.env.FULL_GLB_INLINE_POLL_MS ?? 30_000)

/** Should the API server drain the owner-GLB queue itself? */
export function isInlineDrainerEnabled(): boolean {
  if (!isFullGlbEnabled()) return false
  const explicit = process.env.FULL_GLB_INLINE
  if (explicit === 'true') return true
  if (explicit === 'false') return false
  // No dedicated worker → nobody else is going to build these.
  return !isBakeWorkerEnabled()
}

let running = false

async function tick(): Promise<void> {
  if (running) return // a long build is still going; skip this beat
  running = true
  try {
    // Drain greedily once woken, but yield between jobs so request handling gets
    // a look in. One build at a time, always.
    while (await runOneFullGlbJob()) { /* keep going while there's work */ }
  } catch (err) {
    log.error('Inline full-GLB drain errored (continuing)', { err })
  } finally {
    running = false
  }
}

/** Start the in-process drainer, if this deployment is the one responsible. */
export function startFullGlbInlineDrainer(): void {
  if (!isInlineDrainerEnabled()) return
  log.info('Owner full-GLB inline drainer started (no bake worker deployed)', {
    pollMs: POLL_INTERVAL_MS,
  })
  const timer = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  // One pass at boot so a queue that built up while the service was down clears
  // without waiting out a poll interval.
  setTimeout(() => { void tick() }, 5_000).unref?.()
}
