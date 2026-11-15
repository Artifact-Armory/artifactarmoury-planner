// frontend/src/components/models/SpinViewer.tsx
//
// Spin-around view for the product page. The worker draws the model from a ring
// of angles into ONE image (a grid of square pictures); this shows one picture at
// a time and swaps as the buyer drags, so it feels like turning the model in 3D.
// No 3D data is sent to the browser, which is why it can show the full-detail
// model with no logo on it (unlike the "View in 3D" preview mesh).

import React from 'react'

interface Props {
  /** The sheet image. */
  url: string
  /** Pictures in the sheet, and how many per row. */
  frames: number
  cols: number
  name: string
}

/** Pixels of drag per picture: a full turn is roughly one swipe across a phone. */
const PX_PER_FRAME = 10
/** Seconds for the opening turn that shows the buyer it moves. */
const INTRO_SECONDS = 6

const SpinViewer: React.FC<Props> = ({ url, frames, cols, name }) => {
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [frame, setFrame] = React.useState(0)
  const [touched, setTouched] = React.useState(false)
  const drag = React.useRef<{ x: number; frame: number } | null>(null)
  const rows = Math.ceil(frames / cols)
  const wrap = (f: number) => ((Math.round(f) % frames) + frames) % frames

  // Load the sheet up front so a drag never shows a half-loaded picture.
  React.useEffect(() => {
    setStatus('loading')
    setFrame(0)
    setTouched(false)
    const img = new Image()
    img.onload = () => setStatus('ready')
    img.onerror = () => setStatus('error')
    img.src = url
    return () => { img.onload = null; img.onerror = null }
  }, [url])

  // One slow turn on open, stopped for good the moment the buyer takes over.
  React.useEffect(() => {
    if (status !== 'ready' || touched) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const turn = (now - t0) / (INTRO_SECONDS * 1000)
      if (turn >= 1) { setFrame(0); return }
      setFrame(wrap(turn * frames))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, touched, frames])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (status !== 'ready') return
    setTouched(true)
    drag.current = { x: e.clientX, frame }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    // Dragging right pulls the near side of the model to the right.
    setFrame(wrap(drag.current.frame - (e.clientX - drag.current.x) / PX_PER_FRAME))
  }
  const endDrag = () => { drag.current = null }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setTouched(true)
    setFrame((f) => wrap(f + (e.key === 'ArrowLeft' ? 1 : -1)))
  }

  const col = frame % cols
  const row = Math.floor(frame / cols)

  return (
    <div
      role="img"
      aria-label={`${name}: spin-around view. Drag, or use the left and right arrow keys, to turn it.`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      // pan-y: a sideways drag turns the model, an up/down swipe still scrolls the page.
      style={{ touchAction: 'pan-y', background: 'linear-gradient(#f6f7f9, #e2e5ea)' }}
      className={`relative flex h-full w-full select-none items-center justify-center overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        status === 'ready' ? (drag.current ? 'cursor-grabbing' : 'cursor-grab') : ''
      }`}
    >
      {status === 'ready' && (
        <div
          className="aspect-square h-full max-w-full"
          style={{
            backgroundImage: `url("${url}")`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${cols * 100}% ${rows * 100}%`,
            backgroundPosition: `${cols > 1 ? (col / (cols - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
          }}
        />
      )}
      {status === 'loading' && <span className="text-sm text-slate-500">Loading the spin view…</span>}
      {status === 'error' && <span className="text-sm text-slate-500">The spin view couldn&apos;t be loaded.</span>}
      {status === 'ready' && (
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-0.5 text-xs font-medium text-white">
          Drag to turn
        </span>
      )}
    </div>
  )
}

export default SpinViewer
