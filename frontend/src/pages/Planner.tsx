import React, { Suspense, lazy } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useIsDesktop } from '../hooks/useIsDesktop'
import Logo from '../components/common/Logo'
import Seo from '../components/common/Seo'
import { SITE_NAME } from '../config/brand'

// The 3D Table Planner supports touch (pinch/twist to fly the camera, on-screen
// buttons for the keyboard-only actions) and stows its side panels into drawers
// on a narrow viewport, so tablets are in. What it still can't do is a phone: the
// palette tiles and the table itself need real room. This is the narrowest width
// the compact layout was built for — roughly a small tablet in portrait.
const PLANNER_MIN_WIDTH = 640

// Lazy so the Three.js/planner chunk is only ever requested once the desktop
// check below has passed — mobile visitors never fetch it.
const PlannerApp = lazy(() => import('@ui/App'))

// Full-screen table planner — intentionally renders outside MainLayout
// so the 3D canvas fills the entire viewport.
//   /planner            → scratch (save creates a new table)
//   /planner/t/:id      → edit one of your saved tables
//   /planner/s/:token   → open a shared table as an editable copy
//   /planner/view/:id   → open a published table read-only (marketplace)
export default function Planner({ readOnly = false }: { readOnly?: boolean }) {
  const { id, token } = useParams<{ id?: string; token?: string }>()
  const isDesktop = useIsDesktop(PLANNER_MIN_WIDTH)

  // A saved/shared/viewed table is one person's layout, not a page with its
  // own search-worthy content — only the blank /planner tool is indexable.
  const noindex = Boolean(id || token)
  const seo = (
    <Seo
      title="Free 3D Tabletop Terrain Planner"
      description="Plan your wargaming table in 3D before you print. Add terrain STLs to a virtual board, stack and rotate pieces, then push the whole build into your cart. No account required."
      path="/planner"
      noindex={noindex}
    />
  )

  // Haven't run the client-side check yet — render nothing rather than guess,
  // so neither the planner nor the fallback flashes before we know.
  if (isDesktop === null) return null

  if (!isDesktop) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 10 }}>
        {seo}
        <PlannerUnavailable />
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10 }}>
      {seo}
      <Suspense fallback={<PlannerLoading />}>
        <PlannerApp tableId={id} shareToken={token} readOnly={readOnly} />
      </Suspense>
    </div>
  )
}

function PlannerUnavailable() {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center px-6 text-center bg-background">
      <h2 className="text-2xl font-semibold mb-2">The Table Planner needs a bigger screen</h2>
      <p className="text-muted-foreground max-w-md mb-6">
        Laying out a table needs room for the board and the model palette. It works on a tablet
        or larger — try turning your device landscape, or open this page on a laptop or desktop.
      </p>
      <Link
        to="/browse"
        className="inline-flex items-center rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/80"
      >
        Browse terrain instead →
      </Link>
    </div>
  )
}

function PlannerLoading() {
  // Matches the planner's own `.tb-loading` gate that takes over once the chunk
  // has parsed, so opening the planner doesn't flash a white screen first.
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-5 bg-[#0a0f16]">
      <Logo variant="lockup" title={SITE_NAME} className="h-[84px] w-auto text-[#e8edf5]" />
      <p className="text-sm text-[#e8edf5]/60">Loading planner…</p>
    </div>
  )
}
