/** One active bake plus a boolean for the latest requested state. Payloads are
 *  captured only at dispatch, so queued strokes do not clone maps or build up. */
export class LatestPaintJob {
  private nextId = 0
  private activeId: number | null = null
  private pending = false
  private stopped = false
  request() { if (!this.stopped) this.pending = true }
  take(): number | null {
    if (this.stopped || !this.pending || this.activeId !== null) return null
    this.pending = false
    return this.activeId = ++this.nextId
  }
  finish(id: number) {
    if (id !== this.activeId || this.stopped) return false
    this.activeId = null
    return true
  }
  stop() { this.stopped = true; this.pending = false; this.activeId = null }
}
