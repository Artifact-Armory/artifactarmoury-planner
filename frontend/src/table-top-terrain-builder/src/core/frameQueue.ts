/** Latest input wins. flush() is the explicit pointer-up/history boundary. */
export class FrameQueue {
  private frame: number | null = null
  private pending: (() => void) | null = null
  constructor(
    private request: (fn: FrameRequestCallback) => number = (fn) =>
      requestAnimationFrame(fn),
    private cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {}
  enqueue(fn: () => void) {
    this.pending = fn
    if (this.frame === null)
      this.frame = this.request(() => {
        this.frame = null
        const work = this.pending
        this.pending = null
        work?.()
      })
  }
  flush() {
    if (this.frame !== null) this.cancel(this.frame)
    this.frame = null
    const work = this.pending
    this.pending = null
    work?.()
  }
  clear() {
    if (this.frame !== null) this.cancel(this.frame)
    this.frame = null
    this.pending = null
  }
}
